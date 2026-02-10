/**
 * 4Mica SDK Client Wrapper for 4Mica × Agent0 Competitive Solver Game
 *
 * Uses official @4mica/sdk directly for all operations:
 * 1. RecipientClient.createTab() — Solver opens a tab for a trader
 * 2. PaymentSigner.signRequest() — Trader signs the guarantee claims (EIP-712)
 * 3. RecipientClient.issuePaymentGuarantee() — Solver submits to get BLS certificate
 * 4. UserClient.payTab() — Happy path: trader pays the tab on-chain
 * 5. RecipientClient.remunerate() — Unhappy path: solver seizes collateral on-chain
 */

import {
  Client,
  ConfigBuilder,
  SigningScheme,
  PaymentGuaranteeRequestClaims,
  PaymentSigner,
  buildPaymentPayload,
  type PaymentRequirementsV2,
  type X402SignedPayment,
} from '@4mica/sdk';
import type {
  BLSCert,
  UserInfo,
} from '@4mica/sdk';

import type { Address, Hash, TransactionReceipt } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// =============================================================================
// Constants
// =============================================================================

// The 4Mica facilitator endpoint for x402 payments (used only for local mock)
const FOURMICA_FACILITATOR_URL = 'https://x402.4mica.xyz';

// =============================================================================
// Type Definitions
// =============================================================================

export interface FourMicaClientConfig {
  rpcUrl: string; // 4Mica API endpoint (e.g., https://ethereum.sepolia.api.4mica.xyz/)
  privateKey: `0x${string}`;
  tokenAddress?: Address; // Default token for operations (e.g., USDC)
  accountId?: string;
  facilitatorUrl?: string; // Override facilitator URL (used in local mock mode)
}

export interface UserCollateral {
  address: Address;
  tokenAddress: Address;
  deposited: bigint;
  available: bigint;
  locked: bigint;
  pendingWithdrawal: bigint;
}

export interface PaymentClaims {
  tabId: bigint;
  amount: bigint;
  recipient: Address;
  deadline: number;
  nonce: bigint;
}

export interface PaymentGuarantee {
  certificate: BLSCert;
  claims: PaymentClaims;
  signedPayment: X402SignedPayment;
  issuedAt: number;
  expiresAt: number;
  verified: boolean;
}

export interface SettlementResult {
  success: boolean;
  txHash: Hash;
  gasUsed: bigint;
  settlementType: 'happy' | 'unhappy';
  amount: bigint;
  recipient: Address;
}

// =============================================================================
// 4Mica Client Implementation (Direct SDK)
// =============================================================================

export class FourMicaClient {
  private config: FourMicaClientConfig;
  private client: Client | null = null;
  private initialized: boolean = false;
  private userAddress: Address | null = null;
  private facilitatorUrl: string;

  // Local mode flag - when true, skip SDK and use direct mock API calls
  private localMode: boolean = false;

  constructor(config: FourMicaClientConfig) {
    this.config = config;
    this.facilitatorUrl = config.facilitatorUrl || FOURMICA_FACILITATOR_URL;

    // Detect local mode: if rpcUrl points to localhost:3003 (mock 4Mica API)
    this.localMode = config.rpcUrl.includes('localhost:3003') || config.rpcUrl.includes('127.0.0.1:3003');
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // In local mode, skip SDK initialization and use mock API directly
    if (this.localMode) {
      await this.initializeLocalMode();
      return;
    }

    try {
      console.log(`  [4Mica] Initializing client for ${this.config.rpcUrl}`);

      // Initialize @4mica/sdk Client for SIWE auth, collateral, and tab operations
      const cfg = new ConfigBuilder()
        .rpcUrl(this.config.rpcUrl)
        .walletPrivateKey(this.config.privateKey)
        .enableAuth()
        .build();

      this.client = await Client.new(cfg);
      await this.client.login();
      console.log(`  [4Mica] Authenticated with SIWE`);

      this.userAddress = this.client.signer.signer.address as Address;

      console.log(`  [4Mica] Client initialized for address: ${this.userAddress}`);
      console.log(`  [4Mica] Contract: ${this.client.params.contractAddress}`);
      console.log(`  [4Mica] EIP-712 domain: ${this.client.params.eip712Name} v${this.client.params.eip712Version} (chain ${this.client.params.chainId})`);
      this.initialized = true;

    } catch (error) {
      console.error('  [4Mica] Failed to initialize client:', error);
      throw error;
    }
  }

  /**
   * Initialize in local mode - uses mock API directly without SDK
   * This allows local testing without the full 4Mica SDK infrastructure
   */
  private async initializeLocalMode(): Promise<void> {
    console.log(`  [4Mica] LOCAL MODE: Initializing with mock API at ${this.config.rpcUrl}`);
    console.log(`  [4Mica] LOCAL MODE: Skipping SDK initialization (not supported for local networks)`);

    // Get user address from private key
    const account = privateKeyToAccount(this.config.privateKey);
    this.userAddress = account.address as Address;

    console.log(`  [4Mica] LOCAL MODE: Client initialized for address: ${this.userAddress}`);
    this.initialized = true;
  }

  /**
   * LOCAL MODE: Issue payment guarantee directly via mock API
   * Bypasses the SDK entirely for local testing
   */
  private async issuePaymentGuaranteeLocalMode(
    traderAddress: Address,
    amount: bigint,
    token: Address,
    recipientAddress: Address,
    maxTimeoutSeconds: number
  ): Promise<PaymentGuarantee> {
    console.log(`  [4Mica] LOCAL MODE: Issuing guarantee via mock API`);
    console.log(`  [4Mica] LOCAL MODE: ${this.formatAmount(amount)} from ${traderAddress.slice(0, 10)}... to ${recipientAddress.slice(0, 10)}...`);

    // Step 1: Create a tab directly via mock API
    const tabResponse = await fetch(`${this.facilitatorUrl}/tabs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userAddress: traderAddress,
        recipientAddress: recipientAddress,
        amount: amount.toString(),
        asset: token,
        maxTimeoutSeconds,
      }),
    });

    if (!tabResponse.ok) {
      const errorText = await tabResponse.text();
      throw new Error(`Failed to create tab: ${tabResponse.status} ${errorText}`);
    }

    const tabData = await tabResponse.json() as {
      tabId: string;
      tab_id?: string;
      reqId: string;
      req_id?: string;
      timestamp: number;
    };

    const tabIdStr = tabData.tabId || tabData.tab_id || '0x1';
    const reqIdStr = tabData.reqId || tabData.req_id || '0x1';
    const tabId = tabIdStr.startsWith('0x') ? BigInt(tabIdStr) : BigInt(tabIdStr);
    const reqId = reqIdStr.startsWith('0x') ? BigInt(reqIdStr) : BigInt(reqIdStr);
    const timestamp = tabData.timestamp || Math.floor(Date.now() / 1000);

    console.log(`  [4Mica] LOCAL MODE: Tab created: tabId=${tabId}, reqId=${reqId}`);

    // Step 2: Generate mock signature (in real flow, trader would sign)
    const mockSignature = '0x' + 'e'.repeat(130); // Mock EIP-712 signature

    // Build SDK-aligned claims + payload (for type compatibility)
    const claims = PaymentGuaranteeRequestClaims.new(
      traderAddress,
      recipientAddress,
      tabId,
      amount,
      timestamp,
      token,
      reqId
    );
    const mockPaymentSig = { signature: mockSignature, scheme: SigningScheme.EIP712 };
    const paymentPayload = buildPaymentPayload(claims, mockPaymentSig);

    // Step 3: Issue guarantee via mock API RPC
    const guaranteeResponse = await fetch(this.config.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'issuePaymentGuarantee',
        params: [{
          tabId: tabId.toString(),
          reqId: reqId.toString(),
          userAddress: traderAddress,
          recipientAddress,
          amount: amount.toString(),
          assetAddress: token,
          timestamp,
        }, mockSignature, 'EIP712'],
      }),
    });

    const guaranteeResult = await guaranteeResponse.json() as {
      result?: { claims: string; signature: string };
      error?: { code: number; message: string };
    };

    if (guaranteeResult.error) {
      throw new Error(guaranteeResult.error.message);
    }

    console.log(`  [4Mica] LOCAL MODE: Guarantee issued! Collateral locked.`);

    // Build mock BLS certificate
    const blsCertificate: BLSCert = {
      claims: guaranteeResult.result?.claims || JSON.stringify({ tabId: tabId.toString(), amount: amount.toString() }),
      signature: guaranteeResult.result?.signature || '0x' + 'f'.repeat(128),
    } as BLSCert;

    // Build mock signed payment (minimal structure — not used for settlement)
    const signedPayment: X402SignedPayment = {
      header: Buffer.from(JSON.stringify({
        x402Version: 1,
        scheme: '4mica-credit',
        network: 'eip155:11155111',
        payload: paymentPayload,
      })).toString('base64'),
      payload: paymentPayload,
      signature: mockPaymentSig,
    };

    return {
      certificate: blsCertificate,
      claims: {
        tabId,
        amount,
        recipient: recipientAddress,
        deadline: Math.floor(Date.now() / 1000) + maxTimeoutSeconds,
        nonce: reqId,
      },
      signedPayment,
      issuedAt: Date.now(),
      expiresAt: (Math.floor(Date.now() / 1000) + maxTimeoutSeconds) * 1000,
      verified: true,
    };
  }

  // ===========================================================================
  // Collateral Management (User operations)
  // ===========================================================================

  async approveToken(tokenAddress: Address, amount: bigint): Promise<Hash> {
    await this.ensureInitialized();
    console.log(`  [4Mica] Approving ${this.formatAmount(amount)} of token ${tokenAddress}`);

    if (this.localMode) {
      // In local mode, return mock tx hash - approvals happen on local chain directly
      console.log(`  [4Mica] LOCAL MODE: Mock approval (local chain handles this)`);
      return '0x' + 'a'.repeat(64) as Hash;
    }

    const receipt = await this.client!.user.approveErc20(tokenAddress, amount);
    return receipt.transactionHash;
  }

  async deposit(amount: bigint, tokenAddress?: Address): Promise<Hash> {
    await this.ensureInitialized();
    const token = tokenAddress || this.config.tokenAddress;
    if (!token) throw new Error('Token address required');
    console.log(`  [4Mica] Depositing ${this.formatAmount(amount)}`);

    if (this.localMode) {
      // In local mode, call mock API directly
      console.log(`  [4Mica] LOCAL MODE: Mock deposit via API`);
      const response = await fetch(this.config.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'deposit',
          params: [this.userAddress, amount.toString(), token],
        }),
      });
      const result = await response.json() as { result?: { txHash: string } };
      return (result.result?.txHash || '0x' + 'b'.repeat(64)) as Hash;
    }

    const receipt = await this.client!.user.deposit(amount, token);
    return receipt.transactionHash;
  }

  async getCollateralStatus(): Promise<UserCollateral> {
    await this.ensureInitialized();
    const tokenAddress = this.config.tokenAddress || ('0x' as Address);

    if (this.localMode) {
      // In local mode, call mock API directly
      const response = await fetch(this.config.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getUserAssetBalance',
          params: [this.userAddress, tokenAddress],
        }),
      });
      const result = await response.json() as { result?: { total: string; locked: string } | null };

      if (result.result) {
        const total = BigInt(result.result.total || '0');
        const locked = BigInt(result.result.locked || '0');
        const available = total - locked;

        console.log(`  [4Mica] LOCAL MODE: Collateral status: total=${this.formatAmount(total)}, locked=${this.formatAmount(locked)}, available=${this.formatAmount(available)}`);

        return {
          address: this.userAddress!,
          tokenAddress,
          deposited: total,
          available,
          locked,
          pendingWithdrawal: BigInt(0),
        };
      }

      // User not registered - return zeros
      return {
        address: this.userAddress!,
        tokenAddress,
        deposited: BigInt(0),
        available: BigInt(0),
        locked: BigInt(0),
        pendingWithdrawal: BigInt(0),
      };
    }

    // Use getUserAssetBalance on RecipientClient for actual locked amounts
    const balanceInfo = await this.client!.recipient.getUserAssetBalance(
      this.userAddress!,
      tokenAddress
    );

    if (balanceInfo) {
      const total = BigInt(balanceInfo.total?.toString() || '0');
      const locked = BigInt(balanceInfo.locked?.toString() || '0');
      const available = total - locked;

      console.log(`  [4Mica] Collateral status for ${this.userAddress?.slice(0, 10)}...: total=${this.formatAmount(total)}, locked=${this.formatAmount(locked)}, available=${this.formatAmount(available)}`);

      // Also get withdrawal info from getUser
      const userInfos: UserInfo[] = await this.client!.user.getUser();
      const userInfo = userInfos.find(u => u.asset.toLowerCase() === tokenAddress.toLowerCase());

      return {
        address: this.userAddress!,
        tokenAddress,
        deposited: total,
        available,
        locked,
        pendingWithdrawal: userInfo?.withdrawalRequestAmount || BigInt(0),
      };
    }

    // Fallback to getUser if getUserAssetBalance returns null
    const userInfos: UserInfo[] = await this.client!.user.getUser();
    const userInfo = userInfos.find(u => u.asset.toLowerCase() === tokenAddress.toLowerCase());

    if (userInfo) {
      return {
        address: this.userAddress!,
        tokenAddress,
        deposited: userInfo.collateral,
        available: userInfo.collateral, // No locked info available from this method
        locked: BigInt(0),
        pendingWithdrawal: userInfo.withdrawalRequestAmount,
      };
    }

    return {
      address: this.userAddress!,
      tokenAddress,
      deposited: BigInt(0),
      available: BigInt(0),
      locked: BigInt(0),
      pendingWithdrawal: BigInt(0),
    };
  }

  // ===========================================================================
  // Payment Guarantee Issuance (Direct SDK Flow)
  // ===========================================================================

  /**
   * Issue a payment guarantee using the @4mica/sdk directly.
   *
   * FLOW (Sepolia):
   * 1. RecipientClient.createTab() — Solver opens tab for the trader
   * 2. PaymentSigner.signRequest() — Trader signs claims with EIP-712
   * 3. RecipientClient.issuePaymentGuarantee() — Solver submits to get BLS cert
   *
   * The BLS certificate locks the trader's collateral. This is the core
   * guarantee that enables the happy/unhappy settlement paths.
   *
   * @param traderAddress - The address of the trader (payer)
   * @param amount - Amount to be paid
   * @param tokenAddress - Token address (defaults to config token)
   * @param maxTimeoutSeconds - Tab timeout (TTL)
   * @param traderPrivateKey - The trader's private key (required to sign the payment)
   */
  async issuePaymentGuarantee(
    traderAddress: Address,
    amount: bigint,
    tokenAddress?: Address,
    maxTimeoutSeconds: number = 300,
    traderPrivateKey?: `0x${string}`
  ): Promise<PaymentGuarantee> {
    await this.ensureInitialized();
    const token = tokenAddress || this.config.tokenAddress;
    if (!token) throw new Error('Token address required');

    // The Solver's address (this client's address) is the recipient
    const recipientAddress = this.userAddress!;

    // LOCAL MODE: Bypass SDK entirely and use mock API directly
    if (this.localMode) {
      return this.issuePaymentGuaranteeLocalMode(
        traderAddress,
        amount,
        token,
        recipientAddress,
        maxTimeoutSeconds
      );
    }

    if (!traderPrivateKey) {
      throw new Error('Trader private key required to sign payment guarantee');
    }

    console.log(`  [4Mica] Issuing guarantee via SDK: ${this.formatAmount(amount)} from ${traderAddress.slice(0, 10)}... to ${recipientAddress.slice(0, 10)}...`);

    // =========================================================================
    // Step 1: Solver creates a tab as the RECIPIENT
    // RecipientClient.createTab() sends an authenticated RPC to 4Mica core.
    // This returns a tabId — no HTTP facilitator endpoint involved.
    // =========================================================================
    console.log(`  [4Mica] Creating tab (Solver as recipient)...`);
    const tabId = await this.client!.recipient.createTab(
      traderAddress,         // userAddress (payer)
      recipientAddress,      // recipientAddress (Solver)
      token,                 // erc20Token
      maxTimeoutSeconds      // ttl
    );
    console.log(`  [4Mica] Tab created: tabId=${tabId}`);

    // =========================================================================
    // Step 2: Determine reqId for this guarantee
    // For a fresh tab the first reqId is 0. For subsequent guarantees
    // on the same tab (accumulated intents), query the latest.
    // =========================================================================
    let reqId = 0n;
    try {
      const latest = await this.client!.recipient.getLatestGuarantee(tabId);
      if (latest) {
        reqId = latest.reqId + 1n;
        console.log(`  [4Mica] Existing guarantees found, using reqId=${reqId}`);
      }
    } catch {
      // New tab, no existing guarantees — reqId stays 0
    }

    // =========================================================================
    // Step 3: Build PaymentGuaranteeRequestClaims
    // =========================================================================
    const timestamp = Math.floor(Date.now() / 1000);
    const claims = PaymentGuaranteeRequestClaims.new(
      traderAddress,     // userAddress (payer)
      recipientAddress,  // recipientAddress (Solver)
      tabId,             // tabId from createTab
      amount,            // payment amount
      timestamp,         // current unix timestamp
      token,             // erc20 asset address
      reqId              // request ID within this tab
    );
    console.log(`  [4Mica] Claims built: tabId=${tabId}, reqId=${reqId}, amount=${amount}, timestamp=${timestamp}`);

    // =========================================================================
    // Step 4: Sign with TRADER's key using PaymentSigner
    // PaymentSigner uses the CorePublicParameters (EIP-712 domain from 4Mica core)
    // to produce a proper EIP-712 typed data signature. No full Client needed.
    // =========================================================================
    const traderAccount = privateKeyToAccount(traderPrivateKey);
    const traderSigner = new PaymentSigner(traderAccount);
    console.log(`  [4Mica] Signing claims with trader's key (${traderAccount.address.slice(0, 10)}...)`);

    const paymentSig = await traderSigner.signRequest(
      this.client!.params,    // CorePublicParameters (eip712Name, version, chainId)
      claims,                 // PaymentGuaranteeRequestClaims
      SigningScheme.EIP712    // Signing scheme
    );
    console.log(`  [4Mica] Claims signed: ${paymentSig.signature.slice(0, 30)}...`);

    const paymentPayload = buildPaymentPayload(claims, paymentSig);

    // =========================================================================
    // Step 5: Issue guarantee — Solver submits to 4Mica as RECIPIENT
    // This is the critical step: 4Mica verifies the signature, checks the trader's
    // collateral, and issues a BLS certificate. The trader's collateral is now LOCKED.
    // =========================================================================
    console.log(`  [4Mica] Submitting to 4Mica for BLS certificate (locks collateral)...`);
    let blsCertificate: BLSCert;
    try {
      blsCertificate = await this.client!.recipient.issuePaymentGuarantee(
        claims,
        paymentSig.signature,
        paymentSig.scheme
      );
      console.log(`  [4Mica] BLS Certificate issued! Collateral is now LOCKED.`);
    } catch (error) {
      console.error(`  [4Mica] FAILED to issue guarantee for tabId=${tabId}`);
      console.error(`  [4Mica] Tab exists but collateral is NOT locked — tab will expire after TTL.`);
      console.error(`  [4Mica] Error:`, error);
      throw error;
    }

    // =========================================================================
    // Build return value
    // =========================================================================

    // X402SignedPayment — constructed for type compatibility.
    // The header is a base64-encoded X402 envelope (version + scheme + network).
    // The payload contains the signed claims in the X402PaymentPayload format.
    const signedPayment: X402SignedPayment = {
      header: Buffer.from(JSON.stringify({
        x402Version: 1,
        scheme: '4mica-credit',
        network: `eip155:${this.client!.params.chainId}`,
        payload: paymentPayload,
      })).toString('base64'),
      payload: paymentPayload,
      signature: paymentSig,
    };

    return {
      certificate: blsCertificate,
      claims: {
        tabId,
        amount,
        recipient: recipientAddress,
        deadline: Math.floor(Date.now() / 1000) + maxTimeoutSeconds,
        nonce: reqId,
      },
      signedPayment,
      issuedAt: Date.now(),
      expiresAt: (Math.floor(Date.now() / 1000) + maxTimeoutSeconds) * 1000,
      verified: true,
    };
  }

  // ===========================================================================
  // Settlement
  // ===========================================================================

  /**
   * Happy path: Pay a tab within the deadline.
   * Called by the TRADER (payer) to fulfill their obligation.
   * This sends an on-chain transaction via the 4Mica Core contract.
   */
  async payTab(
    tabId: bigint,
    amount: bigint,
    recipientAddress: Address,
    reqId: bigint,
    tokenAddress?: Address
  ): Promise<SettlementResult> {
    await this.ensureInitialized();
    const token = tokenAddress || this.config.tokenAddress;
    if (!token) throw new Error('Token address required');

    console.log(`  [4Mica] Paying tab ${tabId} - ${this.formatAmount(amount)} to ${recipientAddress.slice(0, 10)}...`);

    // In local mode, call mock API directly
    if (this.localMode) {
      console.log(`  [4Mica] LOCAL MODE: Calling mock payTab`);
      const response = await fetch(this.config.rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'payTab',
          params: [tabId.toString(), reqId.toString(), amount.toString(), recipientAddress, token],
        }),
      });
      const result = await response.json() as {
        result?: { transactionHash: string; status: string; gasUsed: string };
        error?: { message: string };
      };

      if (result.error) {
        throw new Error(result.error.message);
      }

      console.log(`  [4Mica] LOCAL MODE: Tab paid successfully`);
      return {
        success: result.result?.status === 'success',
        txHash: (result.result?.transactionHash || '0x' + 'c'.repeat(64)) as Hash,
        gasUsed: BigInt(result.result?.gasUsed || '50000'),
        settlementType: 'happy',
        amount,
        recipient: recipientAddress,
      };
    }

    // Sepolia: use SDK's UserClient to approve + pay on-chain
    const fourMicaContractAddress = this.client!.params.contractAddress as Address;
    console.log(`  [4Mica] Contract address: ${fourMicaContractAddress}`);

    // Ensure ERC20 approval for the 4Mica contract
    console.log(`  [4Mica] Ensuring ERC20 approval for 4Mica contract...`);
    try {
      const approvalReceipt = await this.client!.user.approveErc20(token, amount);
      console.log(`  [4Mica] Approval confirmed in block ${approvalReceipt.blockNumber}`);
    } catch (approvalError: any) {
      if (approvalError?.message?.includes('allowance') || approvalError?.message?.includes('already')) {
        console.log(`  [4Mica] Sufficient allowance already exists`);
      } else {
        throw approvalError;
      }
    }

    // Call UserClient.payTab() — on-chain transaction
    const receipt: TransactionReceipt = await this.client!.user.payTab(
      tabId,
      reqId,
      amount,
      recipientAddress,
      token
    );
    console.log(`  [4Mica] Tab paid successfully, tx: ${receipt.transactionHash}`);

    return {
      success: receipt.status === 'success',
      txHash: receipt.transactionHash,
      gasUsed: receipt.gasUsed,
      settlementType: 'happy',
      amount,
      recipient: recipientAddress,
    };
  }

  /**
   * Unhappy path: Seize locked collateral via RecipientClient.remunerate()
   * Called by the SOLVER (recipient) when the trader fails to pay before deadline.
   * Uses the BLS certificate from issuePaymentGuarantee as proof.
   * This is a direct on-chain call — no facilitator HTTP endpoint involved.
   */
  async enforceRemuneration(
    blsCertificate: BLSCert,
    _paymentRequirements?: PaymentRequirementsV2
  ): Promise<SettlementResult> {
    await this.ensureInitialized();
    console.log(`  [4Mica] Requesting remuneration (on-chain collateral seizure)...`);

    if (this.localMode) {
      // In local mode, call mock API's /remunerate REST endpoint
      const response = await fetch(`${this.facilitatorUrl}/remunerate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          certificate: blsCertificate,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Local remuneration failed: ${response.status} ${text}`);
      }

      const result = await response.json() as { txHash?: string; gasUsed?: string | number };
      console.log(`  [4Mica] LOCAL MODE: Remuneration processed`);

      return {
        success: true,
        txHash: (result.txHash || '0x' + 'e'.repeat(64)) as Hash,
        gasUsed: BigInt(result.gasUsed || 0),
        settlementType: 'unhappy',
        amount: BigInt(0),
        recipient: '0x' as Address,
      };
    }

    // Sepolia: Use SDK's RecipientClient.remunerate(cert) for on-chain collateral seizure.
    console.log(`  [4Mica] Calling SDK remunerate (claims ${blsCertificate.claims.length} chars, sig ${blsCertificate.signature.length} chars)...`);
    const receipt = await this.client!.recipient.remunerate(blsCertificate);
    console.log(`  [4Mica] Remuneration tx confirmed: ${receipt.transactionHash}`);

    return {
      success: receipt.status === 'success',
      txHash: receipt.transactionHash,
      gasUsed: receipt.gasUsed,
      settlementType: 'unhappy',
      amount: BigInt(0),
      recipient: '0x' as Address,
    };
  }

  // ===========================================================================
  // Utility Methods
  // ===========================================================================

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
    // In local mode, we don't have a Client — that's OK
    if (!this.localMode && !this.client) {
      throw new Error('4Mica client not initialized');
    }
    if (this.localMode && !this.initialized) {
      throw new Error('4Mica client not initialized (local mode)');
    }
  }

  private formatAmount(amount: bigint, decimals: number = 6): string {
    return (Number(amount) / 10 ** decimals).toLocaleString();
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getRpcUrl(): string {
    return this.config.rpcUrl;
  }

  getFacilitatorUrl(): string {
    return this.facilitatorUrl;
  }

  getUserAddress(): Address | null {
    return this.userAddress;
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.aclose();
      this.client = null;
      this.initialized = false;
    }
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

export function createFourMicaClient(config: FourMicaClientConfig): FourMicaClient {
  return new FourMicaClient(config);
}

export async function createAndInitFourMicaClient(config: FourMicaClientConfig): Promise<FourMicaClient> {
  const client = new FourMicaClient(config);
  await client.initialize();
  return client;
}

export default FourMicaClient;
