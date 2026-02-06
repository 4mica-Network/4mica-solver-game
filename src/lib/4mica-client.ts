/**
 * 4Mica SDK Client Wrapper for 4Mica × Agent0 Competitive Solver Game
 *
 * Uses official @4mica/sdk and @4mica/x402 packages for production-ready integration.
 *
 * X402 Flow Architecture:
 * 1. Trader → Solver: "I want to pay X amount"
 * 2. Solver → Facilitator: Create tab via FourMicaFacilitatorClient.openTab()
 * 3. Trader signs the payment claims via FourMicaEvmScheme.createPaymentPayload()
 * 4. Settlement: payTab (happy) or remunerate via facilitator (unhappy)
 */

import {
  Client,
  ConfigBuilder,
  X402Flow,
  SigningScheme,
  PaymentGuaranteeRequestClaims,
  type PaymentRequirementsV2,
  type X402SignedPayment,
} from '@4mica/sdk';
import type {
  BLSCert,
  UserInfo,
} from '@4mica/sdk';

// Import from @4mica/x402 for facilitator communication and payment signing
import { FourMicaFacilitatorClient } from '@4mica/x402/server';
import { FourMicaEvmScheme } from '@4mica/x402/client';
import type { PaymentRequirements } from '@4mica/x402';

import type { Address, Hash, TransactionReceipt } from 'viem';
import { createWalletClient, createPublicClient, http, erc20Abi } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

// =============================================================================
// Constants
// =============================================================================

// The 4Mica facilitator endpoint for x402 payments
const FOURMICA_FACILITATOR_URL = 'https://x402.4mica.xyz';

// =============================================================================
// Type Definitions
// =============================================================================

export interface FourMicaClientConfig {
  rpcUrl: string; // 4Mica API endpoint (e.g., https://ethereum.sepolia.api.4mica.xyz/)
  privateKey: `0x${string}`;
  tokenAddress?: Address; // Default token for operations (e.g., USDC)
  accountId?: string;
  facilitatorUrl?: string; // Override facilitator URL if needed
  tabProxyUrl?: string; // Local proxy URL for FourMicaEvmScheme tab requests (e.g., http://localhost:3001)
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
// 4Mica Client Implementation (X402 Flow)
// =============================================================================

export class FourMicaClient {
  private config: FourMicaClientConfig;
  private client: Client | null = null;
  private x402Flow: X402Flow | null = null;
  private initialized: boolean = false;
  private userAddress: Address | null = null;
  private facilitatorUrl: string;
  private tabProxyUrl: string | null;

  // @4mica/x402 SDK components
  private facilitatorClient: FourMicaFacilitatorClient | null = null;
  private evmScheme: FourMicaEvmScheme | null = null;

  constructor(config: FourMicaClientConfig) {
    this.config = config;
    this.facilitatorUrl = config.facilitatorUrl || FOURMICA_FACILITATOR_URL;
    // tabProxyUrl is where FourMicaEvmScheme.createPaymentPayload() calls for tab creation
    // If set, the proxy should use FourMicaFacilitatorClient.openTab() to forward to facilitator
    this.tabProxyUrl = config.tabProxyUrl || null;
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      console.log(`  [4Mica] Initializing client for ${this.config.rpcUrl}`);
      console.log(`  [4Mica] Facilitator: ${this.facilitatorUrl}`);

      // Initialize @4mica/sdk Client for SIWE auth and collateral operations
      const cfg = new ConfigBuilder()
        .rpcUrl(this.config.rpcUrl)
        .walletPrivateKey(this.config.privateKey)
        .enableAuth()
        .build();

      this.client = await Client.new(cfg);
      await this.client.login();
      console.log(`  [4Mica] Authenticated with SIWE`);

      // Create X402Flow using the standard SDK method
      this.x402Flow = X402Flow.fromClient(this.client);

      this.userAddress = this.client.signer.signer.address as Address;

      // Initialize @4mica/x402 components for X402 flow
      // FourMicaFacilitatorClient handles communication with the facilitator
      this.facilitatorClient = new FourMicaFacilitatorClient({
        url: this.facilitatorUrl,
      });
      console.log(`  [4Mica] Facilitator client initialized`);

      // FourMicaEvmScheme handles payment payload creation and signing
      const account = privateKeyToAccount(this.config.privateKey);
      this.evmScheme = await FourMicaEvmScheme.create(account);
      console.log(`  [4Mica] EVM scheme initialized`);

      console.log(`  [4Mica] Client initialized for address: ${this.userAddress}`);
      this.initialized = true;

    } catch (error) {
      console.error('  [4Mica] Failed to initialize client:', error);
      throw error;
    }
  }

  /**
   * Get the FourMicaFacilitatorClient for use by proxy endpoints.
   * This allows the game server to use the SDK's facilitator client
   * for proper request transformation.
   */
  getFacilitatorClient(): FourMicaFacilitatorClient | null {
    return this.facilitatorClient;
  }

  // ===========================================================================
  // Collateral Management (User operations - these work)
  // ===========================================================================

  async approveToken(tokenAddress: Address, amount: bigint): Promise<Hash> {
    await this.ensureInitialized();
    console.log(`  [4Mica] Approving ${this.formatAmount(amount)} of token ${tokenAddress}`);
    const receipt = await this.client!.user.approveErc20(tokenAddress, amount);
    return receipt.transactionHash;
  }

  async deposit(amount: bigint, tokenAddress?: Address): Promise<Hash> {
    await this.ensureInitialized();
    const token = tokenAddress || this.config.tokenAddress;
    if (!token) throw new Error('Token address required');
    console.log(`  [4Mica] Depositing ${this.formatAmount(amount)}`);
    const receipt = await this.client!.user.deposit(amount, token);
    return receipt.transactionHash;
  }

  async getCollateralStatus(): Promise<UserCollateral> {
    await this.ensureInitialized();
    const tokenAddress = this.config.tokenAddress || ('0x' as Address);

    // Use getUserAssetBalance to get actual locked amounts
    // This method returns AssetBalanceInfo with { total, locked } fields
    const balanceInfo = await this.client!.rpc.getUserAssetBalance(
      this.userAddress!,
      tokenAddress
    );

    if (balanceInfo) {
      // AssetBalanceInfo has total and locked as bigint
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
  // X402 Payment Flow (Uses Facilitator)
  // ===========================================================================

  /**
   * Sign a payment using the X402 flow.
   * The facilitator creates the tab and we sign the payment.
   */
  async signPayment(
    amount: bigint,
    recipientAddress: Address,
    tokenAddress?: Address,
    maxTimeoutSeconds: number = 300
  ): Promise<X402SignedPayment> {
    await this.ensureInitialized();
    const token = tokenAddress || this.config.tokenAddress;
    if (!token) throw new Error('Token address required');

    console.log(`  [4Mica] Signing payment: ${this.formatAmount(amount)} to ${recipientAddress.slice(0, 10)}...`);

    // Build payment requirements - custom fetch adds recipientAddress to root
    const paymentRequirements: PaymentRequirementsV2 = {
      scheme: 'x402-4mica',  // Scheme must include '4mica' per SDK validation
      network: 'ethereum-sepolia',
      asset: token,
      amount: amount.toString(),
      payTo: recipientAddress,  // Custom fetch extracts this as recipientAddress
      maxTimeoutSeconds,
      extra: {
        tabEndpoint: `${this.facilitatorUrl}/tabs`,
      },
    };

    // X402Flow handles: 1) call facilitator to create tab, 2) sign payment
    const signedPayment = await this.x402Flow!.signPayment(
      paymentRequirements as any,
      this.userAddress!
    );

    console.log(`  [4Mica] Payment signed successfully`);
    return signedPayment;
  }

  /**
   * Issue a payment guarantee using the @4mica/x402 SDK.
   *
   * IMPORTANT: The payment must be signed by the TRADER (payer), not the Solver.
   * The Solver is the recipient who will receive the payment.
   *
   * Flow:
   * 1. Create a tab with the facilitator (for the trader)
   * 2. Sign the payment with the TRADER's key (payer signs)
   * 3. Submit to facilitator to issue BLS certificate (locks trader's collateral)
   *
   * @param traderAddress - The address of the trader (payer)
   * @param amount - Amount to be paid
   * @param tokenAddress - Token address (defaults to config token)
   * @param maxTimeoutSeconds - Tab timeout
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

    console.log(`  [4Mica] Requesting guarantee via @4mica/x402 SDK: ${this.formatAmount(amount)} from ${traderAddress.slice(0, 10)}... to ${recipientAddress.slice(0, 10)}...`);

    // Determine the tab endpoint:
    // - If tabProxyUrl is set, use the local proxy (game server's /payment/tab)
    // - Otherwise, use the facilitator directly
    const tabEndpoint = this.tabProxyUrl
      ? `${this.tabProxyUrl}/payment/tab`
      : `${this.facilitatorUrl}/tabs`;

    console.log(`  [4Mica] Tab endpoint: ${tabEndpoint}`);

    // Build payment requirements for the SDK
    // PaymentRequirements type from @x402/core
    // tabEndpoint tells FourMicaEvmScheme where to create tabs
    const paymentRequirements: PaymentRequirements = {
      scheme: '4mica-credit',  // Scheme used by @4mica/x402
      network: 'eip155:11155111' as `${string}:${string}`,  // Ethereum Sepolia in CAIP-2 format
      amount: amount.toString(),
      payTo: recipientAddress,
      asset: token,
      maxTimeoutSeconds,
      extra: {
        tabEndpoint,  // FourMicaEvmScheme.createPaymentPayload() calls this endpoint
      },
    };

    // The payment MUST be signed by the TRADER (payer), not the Solver
    // Create a temporary EvmScheme with the trader's key if provided
    let signingScheme = this.evmScheme!;
    if (traderPrivateKey) {
      const traderAccount = privateKeyToAccount(traderPrivateKey);
      signingScheme = await FourMicaEvmScheme.create(traderAccount);
      console.log(`  [4Mica] Using TRADER's key for signing (${traderAccount.address.slice(0, 10)}...)`);
    } else {
      console.warn(`  [4Mica] WARNING: No trader private key provided, using Solver's key (may cause issues)`);
    }

    // FourMicaEvmScheme.createPaymentPayload() handles:
    // 1. Calls the tabEndpoint to create a tab (THIS CREATES THE TAB!)
    // 2. Signs the payment with EIP-712 using the TRADER's key
    //
    // IMPORTANT: Once this call succeeds, a tab exists on the facilitator.
    // If subsequent operations fail, we'll have an orphan tab.
    // The SDK doesn't provide a way to delete tabs, so we must ensure
    // all subsequent operations succeed or handle the orphan gracefully.
    let paymentPayload: Awaited<ReturnType<typeof signingScheme.createPaymentPayload>>;
    try {
      paymentPayload = await signingScheme.createPaymentPayload(
        1,  // x402Version
        paymentRequirements
      );
      console.log(`  [4Mica] Payment payload created (signed by trader)`);
    } catch (error) {
      console.error(`  [4Mica] Failed to create payment payload (tab may have been created):`, error);
      throw error;
    }

    // Debug: log the full payload structure to understand its shape
    // Note: BigInt values won't serialize to JSON, so we use a custom replacer
    const bigIntReplacer = (_: string, v: unknown) => typeof v === 'bigint' ? v.toString() : v;
    console.log(`  [4Mica] Full paymentPayload structure:`, JSON.stringify(paymentPayload, bigIntReplacer, 2));

    // Extract data from the signed payment
    // The structure can be:
    // Option A: { x402Version, payload: { claims: {...}, signature, scheme } }  - If SDK builds envelope
    // Option B: { x402Version, payload: undefined, ...X402SignedPayment props } - If SDK returns signed payment directly
    // Option C: The signed payment directly: { header, claims: PaymentGuaranteeRequestClaims, signature }

    let tabId: bigint;
    let reqId: bigint;
    let timestamp: number;
    let signature = '';

    // Type guard for PaymentGuaranteeRequestClaims-like objects
    interface ClaimsLike {
      tabId?: bigint;
      tab_id?: string;
      reqId?: bigint;
      req_id?: string;
      timestamp?: number;
      userAddress?: string;
      recipientAddress?: string;
      amount?: bigint;
      assetAddress?: string;
    }

    const ppAny = paymentPayload as any;

    // Check if we have a PaymentGuaranteeRequestClaims object directly (from X402SignedPayment.claims)
    if (ppAny.claims && typeof ppAny.claims.tabId === 'bigint') {
      // Option C: This is X402SignedPayment structure with PaymentGuaranteeRequestClaims
      console.log(`  [4Mica] Found X402SignedPayment structure with PaymentGuaranteeRequestClaims`);
      const claims = ppAny.claims as ClaimsLike;
      tabId = claims.tabId!;
      reqId = claims.reqId ?? 0n;
      timestamp = claims.timestamp ?? Math.floor(Date.now() / 1000);

      // Signature is a SignatureResult object { scheme, signature }
      if (ppAny.signature && typeof ppAny.signature === 'object') {
        signature = ppAny.signature.signature || '';
      } else if (typeof ppAny.signature === 'string') {
        signature = ppAny.signature;
      }
    }
    // Check if payload exists and has nested claims with hex strings
    else if (ppAny.payload && typeof ppAny.payload === 'object') {
      const payload = ppAny.payload;
      console.log(`  [4Mica] Found payload object, checking for claims...`);

      let claimsObj: Record<string, unknown>;
      if (payload.claims && typeof payload.claims === 'object') {
        // Nested claims: { claims: { tab_id: '0x...', ... }, signature }
        claimsObj = payload.claims;
        console.log(`  [4Mica] Found nested claims in payload`);
      } else {
        // Direct: { tab_id: '0x...', signature }
        claimsObj = payload;
        console.log(`  [4Mica] Claims are at payload root`);
      }

      // Extract as hex strings
      const tabIdStr = (claimsObj.tab_id as string) || (claimsObj.tabId as string) || '0';
      const reqIdStr = (claimsObj.req_id as string) || (claimsObj.reqId as string) || '0';
      tabId = tabIdStr.startsWith('0x') ? BigInt(tabIdStr) : BigInt(tabIdStr || '0');
      reqId = reqIdStr.startsWith('0x') ? BigInt(reqIdStr) : BigInt(reqIdStr || '0');
      timestamp = (claimsObj.timestamp as number) || Math.floor(Date.now() / 1000);

      // Find signature
      if (typeof payload.signature === 'string') {
        signature = payload.signature;
      } else if (typeof ppAny.signature === 'string') {
        signature = ppAny.signature;
      } else if (ppAny.signature?.signature) {
        signature = ppAny.signature.signature;
      }
    }
    // Try to decode the header if it exists (base64 encoded JSON)
    else if (typeof ppAny.header === 'string') {
      console.log(`  [4Mica] Found base64 header, decoding...`);
      try {
        const decoded = JSON.parse(Buffer.from(ppAny.header, 'base64').toString('utf-8'));
        console.log(`  [4Mica] Decoded header:`, JSON.stringify(decoded, null, 2));

        const claims = decoded.payload?.claims || decoded.claims || decoded;
        const tabIdStr = claims.tab_id || claims.tabId || '0';
        const reqIdStr = claims.req_id || claims.reqId || '0';
        tabId = typeof tabIdStr === 'bigint' ? tabIdStr : (tabIdStr.startsWith?.('0x') ? BigInt(tabIdStr) : BigInt(tabIdStr || '0'));
        reqId = typeof reqIdStr === 'bigint' ? reqIdStr : (reqIdStr.startsWith?.('0x') ? BigInt(reqIdStr) : BigInt(reqIdStr || '0'));
        timestamp = claims.timestamp || Math.floor(Date.now() / 1000);
        signature = decoded.payload?.signature || decoded.signature || '';
      } catch (e) {
        console.error(`  [4Mica] Failed to decode header:`, e);
        throw new Error('Could not decode payment payload header');
      }
    }
    else {
      console.error(`  [4Mica] Unknown payload structure:`, Object.keys(ppAny));
      throw new Error('Unknown payment payload structure - cannot extract tab/req IDs');
    }

    console.log(`  [4Mica] Extracted: tabId=${tabId}, reqId=${reqId}, timestamp=${timestamp}`);
    console.log(`  [4Mica] Signature: ${signature ? signature.slice(0, 30) + '...' : 'MISSING'}`);

    // Validate extracted data
    if (tabId === 0n) {
      console.warn(`  [4Mica] WARNING: tabId is 0 - this might indicate extraction failed`);
    }
    if (!signature) {
      throw new Error('Failed to extract signature from payment payload');
    }

    // Build claims for issuing the guarantee
    // PaymentGuaranteeRequestClaims is what the RPC needs to issue the guarantee
    const guaranteeClaims = PaymentGuaranteeRequestClaims.new(
      traderAddress,      // userAddress (payer)
      recipientAddress,   // recipientAddress (Solver)
      tabId,              // tabId
      amount,             // amount
      timestamp,          // timestamp
      token,              // assetAddress (USDC)
      reqId               // reqId
    );

    // CRITICAL STEP: Submit the signed payment to 4Mica to ISSUE THE GUARANTEE
    // This is what actually LOCKS THE COLLATERAL off-chain!
    // The Solver (as recipient) calls this to issue the BLS certificate
    //
    // NOTE: If this fails, a tab already exists (from createPaymentPayload above).
    // The tab will become an "orphan tab" with no guarantee.
    // Orphan tabs will expire naturally after TTL (90s by default).
    console.log(`  [4Mica] Submitting signed payment to issue guarantee (locks collateral)...`);
    console.log(`  [4Mica] Claims: tabId=${tabId}, reqId=${reqId}, amount=${amount}, timestamp=${timestamp}`);

    let blsCertificate;
    try {
      blsCertificate = await this.client!.recipient.issuePaymentGuarantee(
        guaranteeClaims,
        signature,
        SigningScheme.EIP712
      );
      console.log(`  [4Mica] BLS Certificate issued! Collateral is now LOCKED.`);
    } catch (error) {
      // Log the error with context about the orphan tab
      console.error(`  [4Mica] FAILED to issue guarantee for tabId=${tabId}`);
      console.error(`  [4Mica] This creates an ORPHAN TAB that will lock collateral until TTL expires.`);
      console.error(`  [4Mica] Error:`, error);
      throw error;
    }

    // Build the signed payment structure
    const signedPayment: X402SignedPayment = {
      header: Buffer.from(JSON.stringify(paymentPayload)).toString('base64'),
      payload: paymentPayload.payload as any,
      signature: {
        scheme: SigningScheme.EIP712,
        signature,
      },
    };

    return {
      certificate: blsCertificate,  // Use the actual BLS certificate from 4Mica
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
   * Happy path: Pay a tab within the deadline
   * Note: This requires the user to have approved the 4Mica contract to spend their tokens
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

    // Get the 4Mica contract address from the SDK's public params
    // This is the contract that needs approval to spend tokens
    const fourMicaContractAddress = '0x9caea570b42a192ef0e2a2f1533bf021bc95da29' as Address; // Sepolia 4Mica contract

    // Use a reliable RPC - prefer Infura/Alchemy from env over public RPC
    const sepoliaRpc = process.env.SEPOLIA_RPC_URL || 'https://sepolia.infura.io/v3/0605fd1fb9eb4a2aa30eaa3a3ff26383';

    // Create viem clients for direct token approval
    const account = privateKeyToAccount(this.config.privateKey);
    const publicClient = createPublicClient({
      chain: sepolia,
      transport: http(sepoliaRpc),
    });
    const walletClient = createWalletClient({
      account,
      chain: sepolia,
      transport: http(sepoliaRpc),
    });

    // Check current allowance
    const currentAllowance = await publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [account.address, fourMicaContractAddress],
    });

    console.log(`  [4Mica] Current allowance: ${this.formatAmount(currentAllowance)}, need: ${this.formatAmount(amount)}`);

    // Approve if needed (use max uint256 for convenience)
    if (currentAllowance < amount) {
      console.log(`  [4Mica] Approving 4Mica contract (${fourMicaContractAddress.slice(0, 10)}...) to spend USDC...`);
      const approvalAmount = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'); // max uint256

      const approvalHash = await walletClient.writeContract({
        address: token,
        abi: erc20Abi,
        functionName: 'approve',
        args: [fourMicaContractAddress, approvalAmount],
      });

      console.log(`  [4Mica] Approval tx submitted: ${approvalHash.slice(0, 20)}...`);

      // Wait for approval to be mined
      const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approvalHash });
      if (approvalReceipt.status !== 'success') {
        throw new Error('Token approval transaction failed');
      }
      console.log(`  [4Mica] Approval confirmed in block ${approvalReceipt.blockNumber}`);
    } else {
      console.log(`  [4Mica] Sufficient allowance already exists`);
    }

    // Now call the SDK's payTab
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
   * Unhappy path: Request remuneration via facilitator
   * The facilitator has recipient scope to call remunerate
   */
  async enforceRemuneration(
    signedPayment: X402SignedPayment,
    paymentRequirements: PaymentRequirementsV2
  ): Promise<SettlementResult> {
    await this.ensureInitialized();
    console.log(`  [4Mica] Requesting remuneration via facilitator...`);

    // Call facilitator's remunerate endpoint
    const response = await fetch(`${this.facilitatorUrl}/remunerate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        paymentHeader: signedPayment.header,
        paymentRequirements,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Remuneration failed: ${response.status} ${text}`);
    }

    const result = await response.json() as { txHash?: string; gasUsed?: string | number };
    console.log(`  [4Mica] Remuneration processed via facilitator`);

    return {
      success: true,
      txHash: (result.txHash || '0x') as Hash,
      gasUsed: BigInt(result.gasUsed || 0),
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
    if (!this.client || !this.x402Flow) {
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
      this.x402Flow = null;
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
