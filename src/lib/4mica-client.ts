/**
 * 4Mica SDK Client Wrapper for 4Mica × Agent0 Competitive Solver Game
 *
 * Uses @4mica/sdk directly for Sepolia, or the drop-in mock-sdk for
 * local Hardhat testing. Both share identical code paths:
 *
 * 1. RecipientClient.createTab() — Solver opens a tab for a trader
 * 2. PaymentSigner.signRequest() — Trader signs the guarantee claims (EIP-712)
 * 3. RecipientClient.issuePaymentGuarantee() — Solver submits to get BLS certificate
 * 4. UserClient.payTab() — Happy path: trader pays the tab on-chain
 * 5. RecipientClient.remunerate() — Unhappy path: solver seizes collateral on-chain
 *
 * The SDK module is selected at runtime:
 *   - LOCAL_MODE=true  → mock-sdk (Hardhat + Core4Mica contract)
 *   - LOCAL_MODE=false → @4mica/sdk (Sepolia testnet)
 */

// Type-only imports from real SDK (used for type annotations only)
import type {
  BLSCert,
  UserInfo,
  PaymentRequirementsV2,
  X402SignedPayment,
} from '@4mica/sdk';

import type { Address, Hash, TransactionReceipt } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// =============================================================================
// SDK Module Type (both real and mock export these)
// =============================================================================

interface SDKModule {
  Client: {
    new: (cfg: any) => Promise<any>;
  };
  ConfigBuilder: new () => {
    rpcUrl: (v: string) => any;
    walletPrivateKey: (v: string) => any;
    enableAuth: () => any;
    build: () => any;
  };
  SigningScheme: { EIP712: string; EIP191?: string };
  PaymentGuaranteeRequestClaims: {
    new: (
      userAddress: string,
      recipientAddress: string,
      tabId: number | bigint | string,
      amount: number | bigint | string,
      timestamp: number,
      erc20Token?: string | null,
      reqId?: number | bigint | string
    ) => any;
  };
  PaymentSigner: new (account: any) => {
    signer: any;
    signRequest: (params: any, claims: any, scheme: any) => Promise<any>;
  };
  buildPaymentPayload: (claims: any, sig: any) => any;
}

// =============================================================================
// Constants
// =============================================================================

// The 4Mica facilitator endpoint for x402 payments (Sepolia only)
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
// 4Mica Client Implementation (Unified SDK)
// =============================================================================

export class FourMicaClient {
  private config: FourMicaClientConfig;
  private client: any = null; // SDK Client instance (real or mock)
  private sdk: SDKModule | null = null; // The loaded SDK module
  private initialized: boolean = false;
  private userAddress: Address | null = null;
  private facilitatorUrl: string;

  // Local mode flag - determines which SDK module to load
  private localMode: boolean = false;

  constructor(config: FourMicaClientConfig) {
    this.config = config;
    this.facilitatorUrl = config.facilitatorUrl || FOURMICA_FACILITATOR_URL;

    // Detect local mode from environment or RPC URL
    this.localMode = process.env.LOCAL_MODE === 'true' ||
      config.rpcUrl.includes('localhost:8545') ||
      config.rpcUrl.includes('127.0.0.1:8545') ||
      config.rpcUrl.includes('localhost:3003') ||
      config.rpcUrl.includes('127.0.0.1:3003');
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Load the appropriate SDK module
      this.sdk = this.localMode
        ? await import('./mock-sdk/index.js') as unknown as SDKModule
        : await import('@4mica/sdk') as unknown as SDKModule;

      const sdkLabel = this.localMode ? 'mock-sdk (Hardhat)' : '@4mica/sdk (Sepolia)';
      console.log(`  [4Mica] Initializing client with ${sdkLabel}`);

      // Build config using ConfigBuilder (identical for both SDKs)
      const cfg = new this.sdk.ConfigBuilder()
        .rpcUrl(this.config.rpcUrl)
        .walletPrivateKey(this.config.privateKey)
        .enableAuth()
        .build();

      // Create and authenticate client
      this.client = await this.sdk.Client.new(cfg);
      await this.client.login();
      console.log(`  [4Mica] Authenticated${this.localMode ? ' (mock)' : ' with SIWE'}`);

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

  // ===========================================================================
  // Collateral Management (User operations)
  // ===========================================================================

  async approveToken(tokenAddress: Address, amount: bigint): Promise<Hash> {
    await this.ensureInitialized();
    console.log(`  [4Mica] Approving ${this.formatAmount(amount)} of token ${tokenAddress}`);

    const receipt = await this.client.user.approveErc20(tokenAddress, amount);
    return receipt.transactionHash;
  }

  async deposit(amount: bigint, tokenAddress?: Address): Promise<Hash> {
    await this.ensureInitialized();
    const token = tokenAddress || this.config.tokenAddress;
    if (!token) throw new Error('Token address required');
    console.log(`  [4Mica] Depositing ${this.formatAmount(amount)}`);

    const receipt = await this.client.user.deposit(amount, token);
    return receipt.transactionHash;
  }

  async getCollateralStatus(): Promise<UserCollateral> {
    await this.ensureInitialized();
    const tokenAddress = this.config.tokenAddress || ('0x' as Address);

    // Use getUserAssetBalance on RecipientClient for actual locked amounts
    const balanceInfo = await this.client.recipient.getUserAssetBalance(
      this.userAddress!,
      tokenAddress
    );

    if (balanceInfo) {
      const total = BigInt(balanceInfo.total?.toString() || '0');
      const locked = BigInt(balanceInfo.locked?.toString() || '0');
      const available = total - locked;

      console.log(`  [4Mica] Collateral status for ${this.userAddress?.slice(0, 10)}...: total=${this.formatAmount(total)}, locked=${this.formatAmount(locked)}, available=${this.formatAmount(available)}`);

      // Also get withdrawal info from getUser
      const userInfos: UserInfo[] = await this.client.user.getUser();
      const userInfo = userInfos.find((u: UserInfo) => u.asset.toLowerCase() === tokenAddress.toLowerCase());

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
    const userInfos: UserInfo[] = await this.client.user.getUser();
    const userInfo = userInfos.find((u: UserInfo) => u.asset.toLowerCase() === tokenAddress.toLowerCase());

    if (userInfo) {
      return {
        address: this.userAddress!,
        tokenAddress,
        deposited: userInfo.collateral,
        available: userInfo.collateral,
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
   * Issue a payment guarantee using the SDK (real or mock).
   *
   * FLOW (identical for both Sepolia and local Hardhat):
   * 1. RecipientClient.createTab() — Solver opens tab for the trader
   * 2. PaymentSigner.signRequest() — Trader signs claims with EIP-712
   * 3. RecipientClient.issuePaymentGuarantee() — Solver submits to get BLS cert
   *
   * The BLS certificate locks the trader's collateral. This is the core
   * guarantee that enables the happy/unhappy settlement paths.
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

    if (!traderPrivateKey) {
      throw new Error('Trader private key required to sign payment guarantee');
    }

    // The Solver's address (this client's address) is the recipient
    const recipientAddress = this.userAddress!;

    console.log(`  [4Mica] Issuing guarantee via SDK: ${this.formatAmount(amount)} from ${traderAddress.slice(0, 10)}... to ${recipientAddress.slice(0, 10)}...`);

    // =========================================================================
    // Step 1: Solver creates a tab as the RECIPIENT
    // =========================================================================
    console.log(`  [4Mica] Creating tab (Solver as recipient)...`);
    const tabId = await this.client.recipient.createTab(
      traderAddress,         // userAddress (payer)
      recipientAddress,      // recipientAddress (Solver)
      token,                 // erc20Token
      maxTimeoutSeconds      // ttl
    );
    console.log(`  [4Mica] Tab created: tabId=${tabId}`);

    // =========================================================================
    // Step 2: Determine reqId for this guarantee
    // =========================================================================
    let reqId = 0n;
    try {
      const latest = await this.client.recipient.getLatestGuarantee(tabId);
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
    const claims = this.sdk!.PaymentGuaranteeRequestClaims.new(
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
    // =========================================================================
    const traderAccount = privateKeyToAccount(traderPrivateKey);
    const traderSigner = new this.sdk!.PaymentSigner(traderAccount);
    console.log(`  [4Mica] Signing claims with trader's key (${traderAccount.address.slice(0, 10)}...)`);

    const paymentSig = await traderSigner.signRequest(
      this.client.params,             // CorePublicParameters
      claims,                         // PaymentGuaranteeRequestClaims
      this.sdk!.SigningScheme.EIP712  // Signing scheme
    );
    console.log(`  [4Mica] Claims signed: ${paymentSig.signature.slice(0, 30)}...`);

    const paymentPayload = this.sdk!.buildPaymentPayload(claims, paymentSig);

    // =========================================================================
    // Step 5: Issue guarantee — Solver submits to get BLS cert
    // =========================================================================
    console.log(`  [4Mica] Submitting for BLS certificate (locks collateral)...`);
    let blsCertificate: BLSCert;
    try {
      blsCertificate = await this.client.recipient.issuePaymentGuarantee(
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
    const signedPayment: X402SignedPayment = {
      header: Buffer.from(JSON.stringify({
        x402Version: 1,
        scheme: '4mica-credit',
        network: `eip155:${this.client.params.chainId}`,
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
   * This sends an on-chain transaction via the Core contract.
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

    // Ensure ERC20 approval for the contract
    const contractAddress = this.client.params.contractAddress as Address;
    console.log(`  [4Mica] Ensuring ERC20 approval for contract ${contractAddress.slice(0, 10)}...`);
    try {
      const approvalReceipt = await this.client.user.approveErc20(token, amount);
      console.log(`  [4Mica] Approval confirmed in block ${approvalReceipt.blockNumber}`);
    } catch (approvalError: any) {
      if (approvalError?.message?.includes('allowance') || approvalError?.message?.includes('already')) {
        console.log(`  [4Mica] Sufficient allowance already exists`);
      } else {
        throw approvalError;
      }
    }

    // Call UserClient.payTab() — on-chain transaction
    // Retry up to 3 times for transient errors (nonce collisions, receipt timeouts)
    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const receipt: TransactionReceipt = await this.client.user.payTab(
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
          settlementType: 'happy' as const,
          amount,
          recipient: recipientAddress,
        };
      } catch (error: any) {
        const msg = error?.message || error?.shortMessage || '';
        const isRetryable =
          msg.includes('replacement transaction underpriced') ||
          msg.includes('could not be found') ||
          msg.includes('nonce too low');

        if (isRetryable && attempt < MAX_RETRIES) {
          const delayMs = attempt * 5000;
          console.warn(`  [4Mica] payTab attempt ${attempt} failed (${msg.slice(0, 80)}...), retrying in ${delayMs / 1000}s...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
        throw error;
      }
    }

    throw new Error('payTab: exhausted retries');
  }

  /**
   * Unhappy path: Seize locked collateral via RecipientClient.remunerate()
   * Called by the SOLVER (recipient) when the trader fails to pay before deadline.
   * Uses the BLS certificate from issuePaymentGuarantee as proof.
   */
  async enforceRemuneration(
    blsCertificate: BLSCert,
    _paymentRequirements?: PaymentRequirementsV2
  ): Promise<SettlementResult> {
    await this.ensureInitialized();
    console.log(`  [4Mica] Requesting remuneration (on-chain collateral seizure)...`);
    console.log(`  [4Mica] Calling SDK remunerate (claims ${blsCertificate.claims.length} chars, sig ${blsCertificate.signature.length} chars)...`);

    const receipt = await this.client.recipient.remunerate(blsCertificate);
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
    if (!this.client) {
      throw new Error('4Mica client not initialized');
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
      this.sdk = null;
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
