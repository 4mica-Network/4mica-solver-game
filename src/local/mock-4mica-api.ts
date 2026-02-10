/**
 * Mock 4Mica API Server for Local Testing
 *
 * This server simulates the FULL 4Mica API (RPC + Facilitator) for local development:
 * - SIWE Authentication (login/logout)
 * - User/Collateral management (deposit, withdraw, balance queries)
 * - BLS Certificate issuance (issuePaymentGuarantee)
 * - Tab management (create, pay, remunerate)
 *
 * The mock preserves the exact same API contract as the real 4Mica
 * so the @4mica/sdk works identically in local and Sepolia modes.
 *
 * Endpoints:
 *   RPC (JSON-RPC):     http://localhost:3003/
 *   Facilitator:        http://localhost:3003/x402/
 *
 * Usage:
 *   npx tsx src/local/mock-4mica-api.ts
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import chalk from 'chalk';
import { randomBytes, createHash } from 'crypto';

// =============================================================================
// Types (matching 4Mica API)
// =============================================================================

interface UserCollateral {
  address: string;
  asset: string;
  deposited: bigint;
  available: bigint;
  locked: bigint;
  pendingWithdrawal: bigint;
}

interface Tab {
  id: bigint;
  reqId: bigint;
  userAddress: string;
  recipientAddress: string;
  amount: bigint;
  asset: string;
  timestamp: number;
  deadline: number;
  settled: boolean;
  guaranteeIssued: boolean;
  paidAmount: bigint;
}

interface BLSCertificate {
  claims: string;
  signature: string;
}

interface PaymentGuarantee {
  tabId: bigint;
  reqId: bigint;
  amount: bigint;
  certificate: BLSCertificate;
  issuedAt: number;
}

// JSON-RPC types
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown[];
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// =============================================================================
// Mock 4Mica API Server
// =============================================================================

export class Mock4MicaAPI {
  private app: express.Application;
  private port: number;

  // State
  private users: Map<string, UserCollateral> = new Map();
  private tabs: Map<string, Tab> = new Map();
  private guarantees: Map<string, PaymentGuarantee[]> = new Map(); // tabId -> guarantees
  private sessions: Map<string, string> = new Map(); // sessionToken -> userAddress
  private nextTabId = 1n;
  private nextReqId = 1n;

  // Default collateral for registered users (10 USDC)
  private defaultCollateral = 10_000_000n; // 10 USDC (6 decimals)

  constructor(port: number = 3003) {
    this.port = port;
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  // ===========================================================================
  // Pre-register users with collateral (for local testing)
  // ===========================================================================

  registerUser(address: string, collateral: bigint = this.defaultCollateral, asset: string = '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238'): void {
    const normalizedAddress = address.toLowerCase();
    this.users.set(`${normalizedAddress}:${asset.toLowerCase()}`, {
      address: normalizedAddress,
      asset: asset.toLowerCase(),
      deposited: collateral,
      available: collateral,
      locked: 0n,
      pendingWithdrawal: 0n,
    });
    console.log(chalk.green(`[Mock4Mica] Registered user ${address.slice(0, 10)}... with ${this.formatAmount(collateral)} USDC collateral`));
  }

  // ===========================================================================
  // Middleware
  // ===========================================================================

  private setupMiddleware(): void {
    this.app.use(cors());
    this.app.use(express.json());

    // Request logging
    this.app.use((req: Request, _res: Response, next: NextFunction) => {
      const body = req.body;
      if (body?.method) {
        console.log(chalk.gray(`[Mock4Mica] RPC: ${body.method}`));
      } else {
        console.log(chalk.gray(`[Mock4Mica] ${req.method} ${req.path}`));
      }
      next();
    });
  }

  // ===========================================================================
  // Routes
  // ===========================================================================

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', mock: true, users: this.users.size, tabs: this.tabs.size });
    });

    // Core SDK endpoints (required for SDK initialization)
    this.app.get('/core/public-params', this.getPublicParams.bind(this));
    this.app.get('/core/config', this.getCoreConfig.bind(this));
    this.app.get('/core/status', this.getCoreStatus.bind(this));

    // SDK REST endpoints — used by @4mica/sdk RpcProxy (these are REST, NOT JSON-RPC!)
    // The SDK's RpcProxy class sends HTTP REST requests to /core/* paths.
    this.app.post('/core/payment-tabs', this.sdkCreateTab.bind(this));
    this.app.post('/core/guarantees', this.sdkIssueGuarantee.bind(this));
    this.app.get('/core/tabs/:tabId/guarantees/latest', this.sdkGetLatestGuarantee.bind(this));
    this.app.get('/core/tabs/:tabId/guarantees', this.sdkGetTabGuarantees.bind(this));
    this.app.get('/core/tabs/:tabId', this.sdkGetTab.bind(this));
    this.app.get('/core/users/:addr/assets/:asset', this.sdkGetUserAssetBalance.bind(this));

    // JSON-RPC endpoint (used by FourMicaClient local mode)
    this.app.post('/', this.handleRpc.bind(this));

    // X402 Facilitator REST endpoints (used by FourMicaClient local mode)
    this.app.post('/tabs', this.createTab.bind(this));
    this.app.get('/tabs/:tabId', this.getTab.bind(this));
    this.app.post('/tabs/:tabId/guarantee', this.issueGuaranteeEndpoint.bind(this));
    this.app.post('/remunerate', this.remunerate.bind(this));
    this.app.post('/tabs/:tabId/settle', this.settleTab.bind(this));
    this.app.get('/tabs', this.listTabs.bind(this));

    // SIWE endpoints
    this.app.post('/siwe/nonce', this.getNonce.bind(this));
    this.app.post('/siwe/verify', this.verifySiwe.bind(this));
    this.app.post('/siwe/logout', this.logout.bind(this));

    // Debug endpoint
    this.app.get('/debug/users', (_req: Request, res: Response) => {
      const userList = Array.from(this.users.values()).map(u => ({
        address: u.address,
        asset: u.asset,
        deposited: u.deposited.toString(),
        available: u.available.toString(),
        locked: u.locked.toString(),
      }));
      res.json({ users: userList });
    });
  }

  // ===========================================================================
  // Core SDK Endpoints (required for initialization)
  // ===========================================================================

  /**
   * Returns public parameters for BLS cryptography
   * Called by SDK during initialization
   *
   * CRITICAL: The SDK uses this response to create its internal blockchain client.
   * Must include rpcUrl and contractAddress for the SDK to function.
   */
  private getPublicParams(_req: Request, res: Response): void {
    // These field names must match what @4mica/sdk CorePublicParameters.fromRpc() expects:
    //   public_key / publicKey → BLS public key bytes
    //   contract_address / contractAddress → Core4Mica contract on-chain
    //   ethereum_http_rpc_url / ethereumHttpRpcUrl → Ethereum RPC for on-chain calls
    //   eip712_name / eip712Name → EIP-712 domain name (default: '4Mica')
    //   eip712_version / eip712Version → EIP-712 domain version (default: '1')
    //   chain_id / chainId → chain ID
    const stubContractAddress = process.env.MOCK_CORE_CONTRACT || '0x0000000000000000000000000000000000000000';
    const publicParams = {
      // SDK CorePublicParameters fields (snake_case for SDK compatibility)
      public_key: '0x' + 'a'.repeat(96), // Mock 48-byte BLS key
      contract_address: stubContractAddress,
      ethereum_http_rpc_url: process.env.LOCAL_RPC_URL || 'http://localhost:8545',
      eip712_name: '4Mica',
      eip712_version: '1',
      chain_id: parseInt(process.env.LOCAL_CHAIN_ID || '31337'),
      // Also include camelCase aliases
      publicKey: '0x' + 'a'.repeat(96),
      contractAddress: stubContractAddress,
      ethereumHttpRpcUrl: process.env.LOCAL_RPC_URL || 'http://localhost:8545',
      eip712Name: '4Mica',
      eip712Version: '1',
      chainId: parseInt(process.env.LOCAL_CHAIN_ID || '31337'),
      // Extra fields for legacy local mode
      rpcUrl: process.env.LOCAL_RPC_URL || 'http://localhost:8545',
      network: 'hardhat-local',
      version: '1.0.0-mock',
    };

    console.log(chalk.gray('[Mock4Mica] Served public-params'));
    res.json(publicParams);
  }

  /**
   * Returns core configuration
   */
  private getCoreConfig(_req: Request, res: Response): void {
    const config = {
      network: 'hardhat-local',
      chainId: 31337,
      rpcUrl: 'http://localhost:8545',
      facilitatorUrl: `http://localhost:${this.port}`,
      version: '1.0.0-mock',
      features: {
        x402: true,
        multiAsset: true,
        remuneration: true,
      },
    };

    console.log(chalk.gray('[Mock4Mica] Served core config'));
    res.json(config);
  }

  /**
   * Returns server status
   */
  private getCoreStatus(_req: Request, res: Response): void {
    const status = {
      status: 'healthy',
      mock: true,
      uptime: process.uptime(),
      stats: this.getStats(),
      timestamp: Date.now(),
    };

    res.json(status);
  }

  // ===========================================================================
  // JSON-RPC Handler (main 4Mica SDK interface)
  // ===========================================================================

  private async handleRpc(req: Request, res: Response): Promise<void> {
    const rpcRequest = req.body as JsonRpcRequest;

    if (!rpcRequest.method) {
      res.json(this.rpcError(rpcRequest.id, -32600, 'Invalid Request'));
      return;
    }

    try {
      const result = await this.dispatchRpc(rpcRequest);
      res.json(this.rpcSuccess(rpcRequest.id, result));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`[Mock4Mica] RPC error (${rpcRequest.method}): ${message}`));
      res.json(this.rpcError(rpcRequest.id, -32000, message));
    }
  }

  private async dispatchRpc(req: JsonRpcRequest): Promise<unknown> {
    const params = req.params || [];

    switch (req.method) {
      // Authentication
      case 'siwe_getNonce':
        return this.rpcGetNonce();

      case 'siwe_verify':
        return this.rpcVerifySiwe(params[0] as string, params[1] as string);

      // User/Collateral queries
      case 'getUserAssetBalance':
        return this.rpcGetUserAssetBalance(params[0] as string, params[1] as string);

      case 'getUser':
        return this.rpcGetUser(params[0] as string);

      // Collateral operations
      case 'deposit':
        return this.rpcDeposit(params[0] as string, params[1] as string, params[2] as string);

      case 'requestWithdrawal':
        return this.rpcRequestWithdrawal(params[0] as string, params[1] as string, params[2] as string);

      // Payment guarantee (BLS cert) - called by client.recipient.issuePaymentGuarantee
      case 'issuePaymentGuarantee':
        return this.rpcIssuePaymentGuarantee(params[0] as Record<string, unknown>, params[1] as string, params[2] as string);

      // Tab payment (happy path) - called by client.user.payTab
      case 'payTab':
        return this.rpcPayTab(
          params[0] as string, // tabId
          params[1] as string, // reqId
          params[2] as string, // amount
          params[3] as string, // recipientAddress
          params[4] as string  // asset
        );

      default:
        // Proxy standard Ethereum JSON-RPC methods to Hardhat
        // This allows the @4mica/sdk to use our mock as both 4Mica API and blockchain RPC
        if (req.method.startsWith('eth_') || req.method.startsWith('net_') || req.method.startsWith('web3_')) {
          return this.proxyToHardhat(req);
        }
        console.log(chalk.yellow(`[Mock4Mica] Unknown RPC method: ${req.method}`));
        throw new Error(`Method not found: ${req.method}`);
    }
  }

  /**
   * Proxy Ethereum JSON-RPC calls to Hardhat node
   * This allows the SDK to use our mock URL for both 4Mica and blockchain operations
   */
  private async proxyToHardhat(req: JsonRpcRequest): Promise<unknown> {
    const hardhatUrl = process.env.LOCAL_RPC_URL || 'http://localhost:8545';

    try {
      const response = await fetch(hardhatUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: req.id,
          method: req.method,
          params: req.params || [],
        }),
      });

      const result = await response.json() as JsonRpcResponse;

      if (result.error) {
        throw new Error(result.error.message);
      }

      console.log(chalk.gray(`[Mock4Mica] Proxied ${req.method} to Hardhat`));
      return result.result;
    } catch (error) {
      console.error(chalk.red(`[Mock4Mica] Hardhat proxy error (${req.method}):`), error);
      throw error;
    }
  }

  // ===========================================================================
  // RPC Methods
  // ===========================================================================

  private rpcGetNonce(): { nonce: string } {
    const nonce = randomBytes(16).toString('hex');
    return { nonce };
  }

  private rpcVerifySiwe(message: string, signature: string): { success: boolean; address: string } {
    // In mock mode, we trust the signature and extract the address from the message
    // Real 4Mica would verify the SIWE signature
    const addressMatch = message.match(/0x[a-fA-F0-9]{40}/);
    if (!addressMatch) {
      throw new Error('Invalid SIWE message: no address found');
    }

    const address = addressMatch[0].toLowerCase();
    const sessionToken = randomBytes(32).toString('hex');
    this.sessions.set(sessionToken, address);

    console.log(chalk.green(`[Mock4Mica] SIWE login: ${address.slice(0, 10)}...`));
    return { success: true, address };
  }

  private rpcGetUserAssetBalance(userAddress: string, asset: string): { total: string; locked: string } | null {
    const key = `${userAddress.toLowerCase()}:${asset.toLowerCase()}`;
    const user = this.users.get(key);

    if (!user) {
      // Return null for unregistered users (SDK handles this)
      return null;
    }

    return {
      total: user.deposited.toString(),
      locked: user.locked.toString(),
    };
  }

  private rpcGetUser(userAddress: string): Array<{
    asset: string;
    collateral: string;
    withdrawalRequestAmount: string;
  }> {
    const result: Array<{ asset: string; collateral: string; withdrawalRequestAmount: string }> = [];

    for (const [key, user] of this.users) {
      if (key.startsWith(userAddress.toLowerCase())) {
        result.push({
          asset: user.asset,
          collateral: user.deposited.toString(),
          withdrawalRequestAmount: user.pendingWithdrawal.toString(),
        });
      }
    }

    return result;
  }

  private rpcDeposit(userAddress: string, amount: string, asset: string): { txHash: string } {
    const key = `${userAddress.toLowerCase()}:${asset.toLowerCase()}`;
    let user = this.users.get(key);

    if (!user) {
      // Auto-register user on first deposit
      user = {
        address: userAddress.toLowerCase(),
        asset: asset.toLowerCase(),
        deposited: 0n,
        available: 0n,
        locked: 0n,
        pendingWithdrawal: 0n,
      };
      this.users.set(key, user);
    }

    const depositAmount = BigInt(amount);
    user.deposited += depositAmount;
    user.available += depositAmount;

    console.log(chalk.green(`[Mock4Mica] Deposit: ${this.formatAmount(depositAmount)} for ${userAddress.slice(0, 10)}...`));
    return { txHash: '0x' + randomBytes(32).toString('hex') };
  }

  private rpcRequestWithdrawal(userAddress: string, amount: string, asset: string): { txHash: string } {
    const key = `${userAddress.toLowerCase()}:${asset.toLowerCase()}`;
    const user = this.users.get(key);

    if (!user) {
      throw new Error('User not registered');
    }

    const withdrawAmount = BigInt(amount);
    if (withdrawAmount > user.available) {
      throw new Error('Insufficient available collateral');
    }

    user.available -= withdrawAmount;
    user.pendingWithdrawal += withdrawAmount;

    console.log(chalk.yellow(`[Mock4Mica] Withdrawal requested: ${this.formatAmount(withdrawAmount)} for ${userAddress.slice(0, 10)}...`));
    return { txHash: '0x' + randomBytes(32).toString('hex') };
  }

  /**
   * Issue a BLS payment guarantee certificate
   * This is what locks the collateral and creates the guarantee
   */
  private rpcIssuePaymentGuarantee(
    claims: Record<string, unknown>,
    signature: string,
    scheme: string
  ): BLSCertificate {
    // Extract claims
    const userAddress = (claims.userAddress as string)?.toLowerCase();
    const recipientAddress = (claims.recipientAddress as string)?.toLowerCase();
    const tabId = BigInt(claims.tabId as string || '0');
    const amount = BigInt(claims.amount as string || '0');
    const asset = (claims.assetAddress as string)?.toLowerCase() || '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238';
    const reqId = BigInt(claims.reqId as string || '0');

    console.log(chalk.cyan(`[Mock4Mica] Issuing guarantee: tabId=${tabId}, user=${userAddress?.slice(0, 10)}..., amount=${this.formatAmount(amount)}`));

    // Verify user has enough collateral
    const userKey = `${userAddress}:${asset}`;
    const user = this.users.get(userKey);

    if (!user) {
      throw new Error(`User ${userAddress} not registered for asset ${asset}`);
    }

    if (user.available < amount) {
      throw new Error(`Insufficient collateral: need ${this.formatAmount(amount)}, have ${this.formatAmount(user.available)}`);
    }

    // Lock the collateral
    user.available -= amount;
    user.locked += amount;

    // Create BLS certificate (mock)
    const certClaims = JSON.stringify({
      tabId: tabId.toString(),
      reqId: reqId.toString(),
      userAddress,
      recipientAddress,
      amount: amount.toString(),
      asset,
      timestamp: Math.floor(Date.now() / 1000),
    });

    const certSignature = '0x' + createHash('sha256')
      .update(certClaims + signature)
      .digest('hex');

    const certificate: BLSCertificate = {
      claims: certClaims,
      signature: certSignature,
    };

    // Store guarantee
    const tabKey = tabId.toString();
    if (!this.guarantees.has(tabKey)) {
      this.guarantees.set(tabKey, []);
    }
    this.guarantees.get(tabKey)!.push({
      tabId,
      reqId,
      amount,
      certificate,
      issuedAt: Date.now(),
    });

    // Update tab if it exists
    const tab = this.tabs.get(tabKey);
    if (tab) {
      tab.guaranteeIssued = true;
    }

    console.log(chalk.green(`[Mock4Mica] Guarantee issued! User ${userAddress?.slice(0, 10)}... locked=${this.formatAmount(user.locked)}, available=${this.formatAmount(user.available)}`));

    return certificate;
  }

  /**
   * Pay a tab (happy path settlement)
   */
  private rpcPayTab(
    tabIdStr: string,
    reqIdStr: string,
    amountStr: string,
    recipientAddress: string,
    asset: string
  ): { transactionHash: string; status: string; gasUsed: string; blockNumber: string } {
    const tabId = BigInt(tabIdStr);
    const reqId = BigInt(reqIdStr);
    const amount = BigInt(amountStr);

    const tabKey = tabId.toString();
    const tab = this.tabs.get(tabKey);

    console.log(chalk.cyan(`[Mock4Mica] PayTab: tabId=${tabId}, reqId=${reqId}, amount=${this.formatAmount(amount)}`));

    if (!tab) {
      // Tab might be created by the SDK directly, not via our facilitator
      // Still process the payment
      console.log(chalk.yellow(`[Mock4Mica] Tab ${tabId} not found, processing payment anyway`));
    } else {
      // Mark tab as settled
      tab.settled = true;
      tab.paidAmount = amount;
    }

    // Find the user who has locked collateral for this tab
    const guaranteeList = this.guarantees.get(tabKey);
    if (guaranteeList && guaranteeList.length > 0) {
      // Get the latest guarantee's user from the claims
      const latestGuarantee = guaranteeList[guaranteeList.length - 1];
      const certClaims = JSON.parse(latestGuarantee.certificate.claims) as { userAddress: string; asset: string };
      const userKey = `${certClaims.userAddress.toLowerCase()}:${(asset || certClaims.asset).toLowerCase()}`;
      const user = this.users.get(userKey);

      if (user) {
        // HAPPY PATH: Trader paid from their wallet (on-chain tx), so
        // the collateral is just released back to available — NOT deducted.
        // The deposit acts as leverage/insurance, not the payment source.
        const totalLocked = guaranteeList.reduce((sum, g) => sum + g.amount, 0n);
        user.locked -= totalLocked;
        user.available += totalLocked; // Restore collateral to available

        console.log(chalk.green(`[Mock4Mica] Tab ${tabId} paid (happy path)! User ${certClaims.userAddress.slice(0, 10)}... collateral restored: locked=${this.formatAmount(user.locked)}, available=${this.formatAmount(user.available)}, total=${this.formatAmount(user.deposited)}`));
      }
    }

    // Generate mock transaction receipt
    return {
      transactionHash: '0x' + randomBytes(32).toString('hex'),
      status: 'success',
      gasUsed: '50000',
      blockNumber: String(Math.floor(Date.now() / 1000)),
    };
  }

  // ===========================================================================
  // REST Endpoints (Facilitator API)
  // ===========================================================================

  private getNonce(_req: Request, res: Response): void {
    res.json(this.rpcGetNonce());
  }

  private verifySiwe(req: Request, res: Response): void {
    try {
      const { message, signature } = req.body as { message: string; signature: string };
      const result = this.rpcVerifySiwe(message, signature);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: String(error) });
    }
  }

  private logout(req: Request, res: Response): void {
    // In mock mode, we don't track sessions strictly
    res.json({ success: true });
  }

  private createTab(req: Request, res: Response): void {
    try {
      const { userAddress, recipientAddress, amount, asset, erc20Token, maxTimeoutSeconds, ttlSeconds, network } = req.body;

      const normalUser = (userAddress || '').toLowerCase();
      const normalRecipient = (recipientAddress || '').toLowerCase();
      const normalAsset = (asset || erc20Token || '').toLowerCase();
      const addAmount = BigInt(amount || '0');
      const timestamp = Math.floor(Date.now() / 1000);
      const timeout = maxTimeoutSeconds || ttlSeconds || 300;

      // 4Mica reuses an existing open tab for the same user-recipient-asset triple
      // instead of creating a new one each time. The reqId increments within the tab.
      let existingTab: Tab | undefined;
      for (const tab of this.tabs.values()) {
        if (
          tab.userAddress === normalUser &&
          tab.recipientAddress === normalRecipient &&
          tab.asset === normalAsset &&
          !tab.settled
        ) {
          existingTab = tab;
          break;
        }
      }

      if (existingTab) {
        // Add to existing tab: bump reqId, accumulate amount, extend deadline
        existingTab.reqId = this.nextReqId++;
        existingTab.amount += addAmount;
        existingTab.deadline = Math.max(existingTab.deadline, timestamp + timeout);

        console.log(chalk.cyan(`[Mock4Mica] Tab updated: id=${existingTab.id}, reqId=${existingTab.reqId}, cumulative=${this.formatAmount(existingTab.amount)}`));

        res.status(201).json({
          tabId: '0x' + existingTab.id.toString(16).padStart(64, '0'),
          tab_id: '0x' + existingTab.id.toString(16).padStart(64, '0'),
          reqId: '0x' + existingTab.reqId.toString(16).padStart(64, '0'),
          req_id: '0x' + existingTab.reqId.toString(16).padStart(64, '0'),
          timestamp: existingTab.timestamp,
          deadline: existingTab.deadline,
          userAddress: existingTab.userAddress,
          recipientAddress: existingTab.recipientAddress,
          amount: existingTab.amount.toString(),
          asset: existingTab.asset,
        });
        return;
      }

      // No existing tab — create a new one
      const tabId = this.nextTabId++;
      const reqId = this.nextReqId++;
      const deadline = timestamp + timeout;

      const tab: Tab = {
        id: tabId,
        reqId,
        userAddress: normalUser,
        recipientAddress: normalRecipient,
        amount: addAmount,
        asset: normalAsset,
        timestamp,
        deadline,
        settled: false,
        guaranteeIssued: false,
        paidAmount: 0n,
      };

      this.tabs.set(tabId.toString(), tab);

      console.log(chalk.green(`[Mock4Mica] Tab created: id=${tabId}, user=${tab.userAddress.slice(0, 10)}..., amount=${this.formatAmount(tab.amount)}`));

      res.status(201).json({
        tabId: '0x' + tabId.toString(16).padStart(64, '0'),
        tab_id: '0x' + tabId.toString(16).padStart(64, '0'),
        reqId: '0x' + reqId.toString(16).padStart(64, '0'),
        req_id: '0x' + reqId.toString(16).padStart(64, '0'),
        timestamp,
        deadline,
        userAddress: tab.userAddress,
        recipientAddress: tab.recipientAddress,
        amount: tab.amount.toString(),
        asset: tab.asset,
      });
    } catch (error) {
      console.error(chalk.red('[Mock4Mica] Tab creation error:'), error);
      res.status(500).json({ error: String(error) });
    }
  }

  private getTab(req: Request, res: Response): void {
    try {
      const tabId = this.parseTabId(req.params.tabId);
      const tab = this.tabs.get(tabId.toString());

      if (!tab) {
        res.status(404).json({ error: 'Tab not found' });
        return;
      }

      res.json({
        tabId: '0x' + tab.id.toString(16).padStart(64, '0'),
        reqId: '0x' + tab.reqId.toString(16).padStart(64, '0'),
        timestamp: tab.timestamp,
        deadline: tab.deadline,
        userAddress: tab.userAddress,
        recipientAddress: tab.recipientAddress,
        amount: tab.amount.toString(),
        asset: tab.asset,
        settled: tab.settled,
        guaranteeIssued: tab.guaranteeIssued,
      });
    } catch (error) {
      res.status(400).json({ error: 'Invalid tab ID' });
    }
  }

  private issueGuaranteeEndpoint(req: Request, res: Response): void {
    try {
      const tabId = this.parseTabId(req.params.tabId);
      const tab = this.tabs.get(tabId.toString());

      if (!tab) {
        res.status(404).json({ error: 'Tab not found' });
        return;
      }

      // Build claims from tab data
      const claims = {
        tabId: tabId.toString(),
        reqId: tab.reqId.toString(),
        userAddress: tab.userAddress,
        recipientAddress: tab.recipientAddress,
        amount: tab.amount.toString(),
        assetAddress: tab.asset,
      };

      const certificate = this.rpcIssuePaymentGuarantee(claims, req.body.signature || '', 'EIP712');

      res.status(201).json({
        tabId: '0x' + tabId.toString(16).padStart(64, '0'),
        certificate,
        issuedAt: Date.now(),
      });
    } catch (error) {
      console.error(chalk.red('[Mock4Mica] Guarantee error:'), error);
      res.status(400).json({ error: String(error) });
    }
  }

  private remunerate(req: Request, res: Response): void {
    console.log(chalk.yellow(`[Mock4Mica] Remuneration requested (unhappy path)`));

    // UNHAPPY PATH: The solver seizes the trader's locked collateral.
    // The BLS certificate proves the trader owed this amount, so 4Mica
    // deducts from the trader's deposit to pay the solver.
    const { certificate } = req.body as { certificate?: BLSCertificate };

    if (certificate?.claims) {
      try {
        const certClaims = JSON.parse(certificate.claims) as {
          userAddress: string;
          asset: string;
          amount: string;
          tabId: string;
        };

        const userKey = `${certClaims.userAddress.toLowerCase()}:${certClaims.asset.toLowerCase()}`;
        const user = this.users.get(userKey);

        if (user) {
          const seizedAmount = BigInt(certClaims.amount);
          const tabKey = certClaims.tabId;

          // On unhappy path, collateral is seized from the deposit
          // The locked amount is consumed (not returned to available)
          const guaranteeList = this.guarantees.get(tabKey);
          const totalLocked = guaranteeList
            ? guaranteeList.reduce((sum, g) => sum + g.amount, 0n)
            : seizedAmount;

          user.locked -= totalLocked;
          user.deposited -= seizedAmount; // Collateral is actually seized

          // Mark tab as settled
          const tab = this.tabs.get(tabKey);
          if (tab) tab.settled = true;

          console.log(chalk.red(`[Mock4Mica] Collateral seized! User ${certClaims.userAddress.slice(0, 10)}... lost ${this.formatAmount(seizedAmount)}. Remaining: deposited=${this.formatAmount(user.deposited)}, available=${this.formatAmount(user.available)}`));
        }
      } catch (e) {
        console.error(chalk.red('[Mock4Mica] Failed to parse remuneration certificate:'), e);
      }
    }

    res.json({
      success: true,
      txHash: '0x' + randomBytes(32).toString('hex'),
      gasUsed: '75000',
      message: 'Mock remuneration processed — collateral seized',
    });
  }

  private settleTab(req: Request, res: Response): void {
    try {
      const tabId = this.parseTabId(req.params.tabId);
      const tab = this.tabs.get(tabId.toString());

      if (!tab) {
        res.status(404).json({ error: 'Tab not found' });
        return;
      }

      tab.settled = true;
      console.log(chalk.green(`[Mock4Mica] Tab ${tabId} settled`));

      res.json({ success: true, tabId: '0x' + tabId.toString(16).padStart(64, '0') });
    } catch (error) {
      res.status(400).json({ error: 'Invalid tab ID' });
    }
  }

  private listTabs(_req: Request, res: Response): void {
    const tabList = Array.from(this.tabs.values()).map(tab => ({
      id: '0x' + tab.id.toString(16),
      userAddress: tab.userAddress,
      recipientAddress: tab.recipientAddress,
      amount: tab.amount.toString(),
      settled: tab.settled,
      guaranteeIssued: tab.guaranteeIssued,
    }));
    res.json({ tabs: tabList });
  }

  // ===========================================================================
  // SDK REST Endpoints (used by @4mica/sdk RpcProxy)
  //
  // The SDK's RpcProxy sends REST calls to /core/* paths:
  //   POST /core/payment-tabs        → RecipientClient.createTab()
  //   POST /core/guarantees          → RecipientClient.issuePaymentGuarantee()
  //   GET  /core/tabs/:id/guarantees/latest → RecipientClient.getLatestGuarantee()
  //   GET  /core/users/:addr/assets/:asset  → RecipientClient.getUserAssetBalance()
  // ===========================================================================

  /** POST /core/payment-tabs — SDK's RecipientClient.createTab() */
  private sdkCreateTab(req: Request, res: Response): void {
    try {
      const { user_address, recipient_address, erc20_token, ttl } = req.body;
      const normalUser = (user_address || '').toLowerCase();
      const normalRecipient = (recipient_address || '').toLowerCase();
      const normalAsset = (erc20_token || '0x0000000000000000000000000000000000000000').toLowerCase();
      const timestamp = Math.floor(Date.now() / 1000);
      const timeout = ttl || 300;

      // Check for existing unsettled tab (same user-recipient-asset triple)
      for (const tab of this.tabs.values()) {
        if (tab.userAddress === normalUser && tab.recipientAddress === normalRecipient && tab.asset === normalAsset && !tab.settled) {
          console.log(chalk.cyan(`[Mock4Mica] SDK: Reusing tab ${tab.id} for ${normalUser.slice(0, 10)}...`));
          res.json({ id: '0x' + tab.id.toString(16), tab_id: '0x' + tab.id.toString(16), tabId: '0x' + tab.id.toString(16) });
          return;
        }
      }

      const tabId = this.nextTabId++;
      const tab: Tab = {
        id: tabId, reqId: 0n, userAddress: normalUser, recipientAddress: normalRecipient,
        amount: 0n, asset: normalAsset, timestamp, deadline: timestamp + timeout,
        settled: false, guaranteeIssued: false, paidAmount: 0n,
      };
      this.tabs.set(tabId.toString(), tab);
      console.log(chalk.green(`[Mock4Mica] SDK: Tab created id=${tabId} user=${normalUser.slice(0, 10)}... recipient=${normalRecipient.slice(0, 10)}...`));
      res.json({ id: '0x' + tabId.toString(16), tab_id: '0x' + tabId.toString(16), tabId: '0x' + tabId.toString(16) });
    } catch (error) {
      console.error(chalk.red('[Mock4Mica] SDK createTab error:'), error);
      res.status(500).json({ error: String(error) });
    }
  }

  /** POST /core/guarantees — SDK's RecipientClient.issuePaymentGuarantee() */
  private sdkIssueGuarantee(req: Request, res: Response): void {
    try {
      const { claims, signature, scheme } = req.body;
      // claims has: { version, user_address, recipient_address, tab_id, amount, asset_address, timestamp }
      const internalClaims: Record<string, unknown> = {
        userAddress: claims.user_address,
        recipientAddress: claims.recipient_address,
        tabId: claims.tab_id,
        amount: claims.amount,
        assetAddress: claims.asset_address,
        reqId: '0',
      };

      // Determine reqId from existing guarantees on this tab
      const tabId = BigInt(claims.tab_id);
      const tabKey = tabId.toString();
      const existingGuarantees = this.guarantees.get(tabKey);
      if (existingGuarantees && existingGuarantees.length > 0) {
        internalClaims.reqId = String(existingGuarantees.length);
      }

      const cert = this.rpcIssuePaymentGuarantee(internalClaims, signature, scheme);
      console.log(chalk.green(`[Mock4Mica] SDK: Guarantee issued for tab ${tabId}`));
      res.json(cert);
    } catch (error) {
      console.error(chalk.red('[Mock4Mica] SDK issueGuarantee error:'), error);
      res.status(400).json({ error: String(error) });
    }
  }

  /** GET /core/tabs/:tabId/guarantees/latest — SDK's RecipientClient.getLatestGuarantee() */
  private sdkGetLatestGuarantee(req: Request, res: Response): void {
    try {
      const tabId = this.parseTabId(req.params.tabId);
      const tabKey = tabId.toString();
      const guaranteeList = this.guarantees.get(tabKey);

      if (!guaranteeList || guaranteeList.length === 0) {
        res.json(null);
        return;
      }

      const latest = guaranteeList[guaranteeList.length - 1];
      res.json({
        tabId: '0x' + latest.tabId.toString(16),
        reqId: '0x' + latest.reqId.toString(16),
        amount: '0x' + latest.amount.toString(16),
        certificate: latest.certificate,
        issuedAt: latest.issuedAt,
      });
    } catch (error) {
      res.status(400).json({ error: String(error) });
    }
  }

  /** GET /core/tabs/:tabId/guarantees — SDK's getTabGuarantees() */
  private sdkGetTabGuarantees(req: Request, res: Response): void {
    try {
      const tabId = this.parseTabId(req.params.tabId);
      const guaranteeList = this.guarantees.get(tabId.toString()) || [];
      res.json(guaranteeList.map(g => ({
        tabId: '0x' + g.tabId.toString(16),
        reqId: '0x' + g.reqId.toString(16),
        amount: '0x' + g.amount.toString(16),
        certificate: g.certificate,
        issuedAt: g.issuedAt,
      })));
    } catch (error) {
      res.status(400).json({ error: String(error) });
    }
  }

  /** GET /core/tabs/:tabId — SDK's getTab() */
  private sdkGetTab(req: Request, res: Response): void {
    try {
      const tabId = this.parseTabId(req.params.tabId);
      const tab = this.tabs.get(tabId.toString());
      if (!tab) { res.status(404).json({ error: 'Tab not found' }); return; }
      res.json({
        id: '0x' + tab.id.toString(16),
        reqId: '0x' + tab.reqId.toString(16),
        userAddress: tab.userAddress, recipientAddress: tab.recipientAddress,
        amount: '0x' + tab.amount.toString(16), asset: tab.asset,
        timestamp: tab.timestamp, deadline: tab.deadline,
        settled: tab.settled, guaranteeIssued: tab.guaranteeIssued,
      });
    } catch (error) {
      res.status(400).json({ error: String(error) });
    }
  }

  /** GET /core/users/:addr/assets/:asset — SDK's getUserAssetBalance() */
  private sdkGetUserAssetBalance(req: Request, res: Response): void {
    const result = this.rpcGetUserAssetBalance(req.params.addr, req.params.asset);
    res.json(result);
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private parseTabId(tabIdStr: string): bigint {
    if (tabIdStr.startsWith('0x')) {
      return BigInt(tabIdStr);
    }
    return BigInt(tabIdStr);
  }

  private rpcSuccess(id: number | string, result: unknown): JsonRpcResponse {
    return { jsonrpc: '2.0', id, result };
  }

  private rpcError(id: number | string, code: number, message: string): JsonRpcResponse {
    return { jsonrpc: '2.0', id, error: { code, message } };
  }

  private formatAmount(amount: bigint): string {
    return `$${(Number(amount) / 1_000_000).toFixed(2)}`;
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.app.listen(this.port, () => {
        console.log(chalk.bold(`\n🎭 Mock 4Mica API running on http://localhost:${this.port}\n`));
        console.log(chalk.gray('  This server simulates the full 4Mica SDK backend'));
        console.log(chalk.gray('  Core params:     GET  /core/public-params'));
        console.log(chalk.gray('  SDK REST:        POST /core/payment-tabs, /core/guarantees'));
        console.log(chalk.gray('  SDK REST:        GET  /core/tabs/:id/guarantees/latest'));
        console.log(chalk.gray('  SDK REST:        GET  /core/users/:addr/assets/:asset'));
        console.log(chalk.gray('  JSON-RPC:        POST /'));
        console.log(chalk.gray('  Facilitator:     POST /tabs, /remunerate'));
        console.log(chalk.gray('  Health:          GET  /health'));
        console.log(chalk.gray('  Debug:           GET  /debug/users\n'));
        resolve();
      });
    });
  }

  getUrl(): string {
    return `http://localhost:${this.port}`;
  }

  getStats(): { userCount: number; tabCount: number; guaranteeCount: number } {
    let guaranteeCount = 0;
    for (const list of this.guarantees.values()) {
      guaranteeCount += list.length;
    }
    return {
      userCount: this.users.size,
      tabCount: this.tabs.size,
      guaranteeCount,
    };
  }
}

// =============================================================================
// Main Entry Point
// =============================================================================

async function main(): Promise<void> {
  const port = parseInt(process.env.MOCK_4MICA_PORT || '3003');
  const api = new Mock4MicaAPI(port);

  // Pre-register some test users with collateral
  // These addresses would come from the local Hardhat deployment
  console.log(chalk.cyan('\n[Mock4Mica] Pre-registering test users with collateral...\n'));

  // Hardhat default accounts (first 10)
  const hardhatAccounts = [
    '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', // Account 0
    '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', // Account 1
    '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', // Account 2
    '0x90F79bf6EB2c4f870365E785982E1f101E93b906', // Account 3
    '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65', // Account 4
    '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc', // Account 5
    '0x976EA74026E726554dB657fA54763abd0C3a0aa9', // Account 6
    '0x14dC79964da2C08b23698B3D3cc7Ca32193d9955', // Account 7
    '0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f', // Account 8
    '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720', // Account 9
  ];

  // Register each with 100 USDC
  const collateralPerUser = 100_000_000n; // 100 USDC
  for (const address of hardhatAccounts) {
    api.registerUser(address, collateralPerUser);
  }

  await api.start();

  // Handle shutdown
  process.on('SIGINT', () => {
    console.log(chalk.yellow('\n\nShutting down Mock 4Mica API...'));
    process.exit(0);
  });
}

// Run if executed directly
const isMainModule = process.argv[1]?.endsWith('mock-4mica-api.ts') ||
                      process.argv[1]?.endsWith('mock-4mica-api.js');
if (isMainModule) {
  main().catch(console.error);
}

export default Mock4MicaAPI;
