/**
 * Settlement Manager for 4Mica × Agent0 Competitive Solver Game
 *
 * Manages trader "tabs" - accumulated collateral that can be settled in batch:
 * - Each trader has a single tab with multiple pending intents
 * - One timer per trader to settle their entire tab
 * - Batch settlement: pay once for all intents via 4Mica API
 * - Fetches tab/collateral data from 4Mica API
 */

import { EventEmitter } from 'events';
import type { Address } from 'viem';
import type { IntentManager, TradeIntent } from './intent-manager.js';
import { FourMicaClient, type UserCollateral, type PaymentGuarantee } from '../lib/4mica-client.js';
import type { BLSCert } from '@4mica/sdk';

// =============================================================================
// Types
// =============================================================================

// Track each intent's guarantee (one per intent)
export interface IntentGuarantee {
  intentId: string;
  guarantee: PaymentGuarantee;
  reqId: bigint;
  amount: bigint; // This guarantee's locked amount
}

export interface TraderTab {
  traderId: string;
  traderAddress: Address;
  traderName: string;
  intentIds: string[];
  // All collateral data comes from 4Mica API
  fourMicaCollateral?: UserCollateral; // From 4Mica API (deposited, available, locked)
  // 4Mica tab (same tabId for all guarantees between this trader-solver pair)
  fourMicaTabId?: bigint; // 4Mica tab ID (set from first guarantee, same for all)
  // Track ALL guarantees - one per intent, SDK auto-batches to same tab
  fourMicaGuarantees: IntentGuarantee[];
  deadline: number;
  secondsRemaining: number;
  status: 'open' | 'settling' | 'settled';
  scheduledPaymentTime?: number;
  willPay: boolean;
}

export interface SettlementStatus {
  intentId: string;
  deadline: number;
  secondsRemaining: number;
  isOverdue: boolean;
  status: 'countdown' | 'enforcing' | 'settled';
  scheduledPaymentTime?: number;
  willPay: boolean;
}

export interface SettlementResult {
  intentId: string;
  isHappyPath: boolean;
  settledAt: number;
  txHash?: string;
  penaltyAmount?: bigint;
}

export interface TabSettlementResult {
  traderId: string;
  traderAddress: string;
  intentIds: string[];
  totalCollateral: bigint;
  isHappyPath: boolean;
  settledAt: number;
  txHash?: string;
}

export interface SettlementManagerConfig {
  settlementWindowSeconds: number;
  gracePeriodSeconds?: number;
  countdownIntervalMs: number;
  unhappyPathProbability: number;
  fourMicaRpcUrl?: string;
  recipientAddress?: Address; // Solver/recipient address for tabs
  tokenAddress?: Address; // Token (e.g., USDC) for 4Mica operations
  solverPrivateKey?: `0x${string}`; // Solver's private key for X402 flow
  tabProxyUrl?: string; // Local proxy URL for FourMicaEvmScheme (e.g., http://localhost:3001)
  // Getter function to retrieve private keys for traders/agents
  getPrivateKey?: (agentId: string) => `0x${string}` | undefined;
}

// =============================================================================
// Settlement Manager Class
// =============================================================================

export class SettlementManager extends EventEmitter {
  private config: SettlementManagerConfig;
  private intentManager: IntentManager;
  private countdownInterval: NodeJS.Timeout | null = null;
  private collateralRefreshInterval: NodeJS.Timeout | null = null;

  // Track trader tabs
  private traderTabs: Map<string, TraderTab> = new Map();
  private activeSettlements: Map<string, SettlementStatus> = new Map();

  // 4Mica Solver client (for X402 flow - Solver talks to facilitator)
  private fourMicaSolverClient: FourMicaClient | null = null;

  // 4Mica client instances per trader (for collateral queries)
  private fourMicaClients: Map<string, FourMicaClient> = new Map();

  constructor(config: SettlementManagerConfig, intentManager: IntentManager) {
    super();
    this.config = config;
    this.intentManager = intentManager;

    // Listen for intents entering settlement
    this.intentManager.on('intent:executed', (data: { intentId: string; deadline: number }) => {
      this.addIntentToTab(data.intentId, data.deadline);
    });
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  start(): void {
    if (this.countdownInterval) {
      console.log('[SettlementManager] Already running');
      return;
    }

    console.log(`[SettlementManager] Starting settlement monitoring (Tab Mode)`);
    console.log(`[SettlementManager] Settlement window: ${this.config.settlementWindowSeconds}s`);
    console.log(`[SettlementManager] Unhappy path probability: ${(this.config.unhappyPathProbability * 100).toFixed(0)}%`);
    if (this.config.fourMicaRpcUrl) {
      console.log(`[SettlementManager] 4Mica API: ${this.config.fourMicaRpcUrl}`);
    }

    this.countdownInterval = setInterval(() => {
      this.checkTabs();
    }, this.config.countdownIntervalMs);

    // Periodically refresh 4Mica collateral data
    this.collateralRefreshInterval = setInterval(() => {
      this.refreshCollateralData();
    }, 5000); // Every 5 seconds
  }

  stop(): void {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    if (this.collateralRefreshInterval) {
      clearInterval(this.collateralRefreshInterval);
      this.collateralRefreshInterval = null;
    }
    console.log('[SettlementManager] Stopped');
  }

  // ===========================================================================
  // 4Mica Integration
  // ===========================================================================

  /**
   * Get or create a 4Mica client for a trader
   * Uses traderId as the accountId to share state with game-server's clients
   */
  private async getFourMicaClient(traderAddress: Address, traderId?: string, privateKey?: `0x${string}`): Promise<FourMicaClient | null> {
    if (!this.config.fourMicaRpcUrl) return null;

    // Use traderId as the key (matching game-server's pattern)
    const key = traderId || traderAddress.toLowerCase();
    if (this.fourMicaClients.has(key)) {
      return this.fourMicaClients.get(key)!;
    }

    // Try to get the actual private key for this trader
    let actualKey = privateKey;
    if (!actualKey && traderId && this.config.getPrivateKey) {
      actualKey = this.config.getPrivateKey(traderId);
    }

    // If no private key found, we can only do read-only operations
    if (!actualKey) {
      console.warn(`[SettlementManager] No private key for ${traderId || traderAddress}, using read-only mode`);
      // Use a placeholder for read-only operations (collateral queries don't need signing)
      actualKey = '0x0000000000000000000000000000000000000000000000000000000000000001' as `0x${string}`;
    }

    const client = new FourMicaClient({
      rpcUrl: this.config.fourMicaRpcUrl,
      privateKey: actualKey,
      accountId: traderId || traderAddress.toLowerCase(), // Use traderId for per-trader state
      tokenAddress: this.config.tokenAddress, // Token (e.g., USDC) for operations
    });

    try {
      await client.initialize();
      this.fourMicaClients.set(key, client);
      return client;
    } catch (error) {
      console.error(`[SettlementManager] Failed to init 4Mica client for ${traderId || traderAddress}:`, error);
      return null;
    }
  }

  /**
   * Fetch collateral status from 4Mica API for a trader
   */
  async fetchTraderCollateral(traderAddress: Address, traderId?: string): Promise<UserCollateral | null> {
    const client = await this.getFourMicaClient(traderAddress, traderId);
    if (!client) return null;

    try {
      return await client.getCollateralStatus();
    } catch (error) {
      console.error(`[SettlementManager] Failed to fetch collateral for ${traderId || traderAddress}:`, error);
      return null;
    }
  }

  /**
   * Refresh collateral data for all active tabs
   */
  private async refreshCollateralData(): Promise<void> {
    for (const [traderId, tab] of this.traderTabs) {
      if (tab.status !== 'open') continue;

      const collateral = await this.fetchTraderCollateral(tab.traderAddress, traderId);
      if (collateral) {
        tab.fourMicaCollateral = collateral;

        // Emit update with fresh 4Mica data
        this.emit('tab:collateralUpdate', {
          traderId,
          traderAddress: tab.traderAddress,
          deposited: collateral.deposited.toString(),
          available: collateral.available.toString(),
          locked: collateral.locked.toString(),
        });
      }
    }
  }

  /**
   * Get or create the Solver's 4Mica client (for X402 flow)
   * The Solver calls the facilitator - facilitator knows recipient from Solver's auth
   */
  private async getSolverClient(): Promise<FourMicaClient | null> {
    if (this.fourMicaSolverClient) return this.fourMicaSolverClient;
    if (!this.config.fourMicaRpcUrl || !this.config.solverPrivateKey) return null;

    try {
      this.fourMicaSolverClient = new FourMicaClient({
        rpcUrl: this.config.fourMicaRpcUrl,
        privateKey: this.config.solverPrivateKey,
        accountId: 'settlement-solver',
        tokenAddress: this.config.tokenAddress,
        // tabProxyUrl is where FourMicaEvmScheme will call for tab creation
        // The game server's /payment/tab endpoint uses FourMicaFacilitatorClient
        tabProxyUrl: this.config.tabProxyUrl,
      });
      await this.fourMicaSolverClient.initialize();
      console.log(`[SettlementManager] Solver client initialized with @4mica/x402 SDK`);
      console.log(`[SettlementManager] Tab proxy URL: ${this.config.tabProxyUrl}`);
      return this.fourMicaSolverClient;
    } catch (error) {
      console.error(`[SettlementManager] Failed to init Solver client:`, error);
      return null;
    }
  }

  /**
   * Issue a payment guarantee via 4Mica X402 facilitator
   * Uses Solver's client - facilitator knows recipient from Solver's auth
   * IMPORTANT: The payment must be signed by the TRADER (payer), not the Solver
   */
  private async issueFourMicaGuarantee(traderAddress: Address, traderId: string, amount: bigint): Promise<PaymentGuarantee | null> {
    if (!this.config.fourMicaRpcUrl) return null;

    // Use Solver client for X402 flow
    const solverClient = await this.getSolverClient();
    if (!solverClient) return null;

    // Get the TRADER's private key - payment must be signed by the payer
    const traderPrivateKey = this.config.getPrivateKey?.(traderId);
    if (!traderPrivateKey) {
      console.error(`[SettlementManager] No private key for trader ${traderId}, cannot issue guarantee`);
      return null;
    }

    try {
      // Solver calls facilitator, payment is signed by TRADER
      const guarantee = await solverClient.issuePaymentGuarantee(
        traderAddress,  // Trader address (the payer)
        amount,
        this.config.tokenAddress,
        this.config.settlementWindowSeconds,
        traderPrivateKey  // IMPORTANT: Trader's key for signing the payment
      );
      console.log(`[SettlementManager] Issued 4Mica guarantee (tab ${guarantee.claims.tabId.toString()}) for ${traderId}`);
      return guarantee;
    } catch (error) {
      console.error(`[SettlementManager] Failed to issue 4Mica guarantee:`, error);
      return null;
    }
  }

  /**
   * Pay a 4Mica tab (happy path)
   */
  private async payFourMicaTab(traderAddress: Address, traderId: string, tabId: bigint, amount: bigint, reqId: bigint): Promise<string | null> {
    const client = await this.getFourMicaClient(traderAddress, traderId);
    if (!client) return null;

    // Use configured recipient or fallback to a dummy address
    const recipient = this.config.recipientAddress || '0x0000000000000000000000000000000000000001' as Address;

    try {
      const result = await client.payTab(
        tabId,
        amount,
        recipient,
        reqId
      );
      console.log(`[SettlementManager] 4Mica payTab success for ${traderId}: ${result.txHash}`);
      return result.txHash;
    } catch (error) {
      console.error(`[SettlementManager] Failed to pay 4Mica tab for ${traderId}:`, error);
      return null;
    }
  }

  /**
   * Enforce remuneration for a 4Mica tab (unhappy path)
   * This seizes the locked collateral and releases it to the recipient via the facilitator
   */
  private async enforceFourMicaTab(traderAddress: Address, traderId: string, guarantee?: PaymentGuarantee): Promise<string | null> {
    const client = await this.getFourMicaClient(traderAddress, traderId);
    if (!client) return null;

    // Can't enforce without a valid guarantee
    if (!guarantee?.signedPayment) {
      console.error(`[SettlementManager] Cannot enforce remuneration for ${traderId}: no signed payment`);
      return null;
    }

    try {
      const result = await client.enforceRemuneration(
        guarantee.signedPayment,
        {
          scheme: 'x402-4mica',  // Scheme must include '4mica' per SDK validation
          network: 'ethereum-sepolia',
          asset: this.config.tokenAddress || '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as Address,
          amount: guarantee.claims.amount.toString(),
          payTo: guarantee.claims.recipient,
          maxTimeoutSeconds: this.config.settlementWindowSeconds,
        }
      );
      console.log(`[SettlementManager] 4Mica remuneration enforced for ${traderId}: ${result.txHash}`);
      return result.txHash;
    } catch (error) {
      console.error(`[SettlementManager] Failed to enforce 4Mica remuneration for ${traderId}:`, error);
      return null;
    }
  }

  // ===========================================================================
  // Tab Management
  // ===========================================================================

  /**
   * Add an executed intent to the trader's tab
   *
   * GUARANTEE PER INTENT:
   * - Each intent MUST have a guarantee before solver fulfills it
   * - SDK auto-batches: all guarantees between same trader-solver use same tabId
   * - Collateral is locked immediately when guarantee is issued
   * - At settlement: use latest reqId with cumulative total amount
   */
  private async addIntentToTab(intentId: string, deadline: number): Promise<void> {
    const intent = this.intentManager.getIntent(intentId);
    if (!intent) {
      console.error(`[SettlementManager] Intent ${intentId} not found`);
      return;
    }

    const traderId = intent.traderId;
    const now = Date.now();

    // CHECK: Does the intent already have a guarantee from the game server?
    // If so, use it instead of issuing a new one (prevents double-locking!)
    let guarantee = intent.fourMicaGuarantee;

    if (guarantee) {
      console.log(`[SettlementManager] Using EXISTING guarantee from intent for ${traderId}`);
      console.log(`[SettlementManager]   tabId: ${guarantee.claims.tabId}, reqId: ${guarantee.claims.nonce}, amount: ${this.formatAmount(guarantee.claims.amount)}`);
    } else {
      // No existing guarantee - need to issue one (fallback for demo mode or old intents)
      console.log(`[SettlementManager] No existing guarantee found for ${traderId}, issuing new one...`);

      // Check available collateral BEFORE issuing guarantee
      // This is a PRE-FLIGHT CHECK to avoid creating orphan tabs
      const preCollateral = await this.fetchTraderCollateral(intent.traderAddress as Address, traderId);
      if (!preCollateral) {
        console.error(`[SettlementManager] SKIPPING intent ${intentId}: Could not fetch collateral for ${traderId}`);
        this.emit('intent:guaranteeFailed', { intentId, traderId, error: 'Could not fetch collateral' });
        return;
      }

      console.log(`[SettlementManager] Pre-flight collateral check for ${traderId}:`);
      console.log(`[SettlementManager]   Total: ${this.formatAmount(preCollateral.deposited)}, Locked: ${this.formatAmount(preCollateral.locked)}, Available: ${this.formatAmount(preCollateral.available)}`);
      console.log(`[SettlementManager]   Intent amount: ${this.formatAmount(intent.amount)}`);

      if (preCollateral.available < intent.amount) {
        console.error(`[SettlementManager] SKIPPING intent ${intentId}: ${traderId} has insufficient available collateral`);
        console.error(`[SettlementManager] Needed: ${this.formatAmount(intent.amount)}, Available: ${this.formatAmount(preCollateral.available)}`);
        this.emit('intent:guaranteeFailed', { intentId, traderId, error: `Insufficient collateral: need ${this.formatAmount(intent.amount)}, have ${this.formatAmount(preCollateral.available)}` });
        return;
      }

      // Issue guarantee for THIS intent - SDK will auto-batch to same tabId
      // IMPORTANT: This is an ATOMIC operation from the perspective of the settlement manager.
      // If it fails, we should NOT add the intent to the tab.
      let newGuarantee: PaymentGuarantee | null = null;
      try {
        newGuarantee = await this.issueFourMicaGuarantee(intent.traderAddress as Address, traderId, intent.amount);
      } catch (error) {
        console.error(`[SettlementManager] Exception issuing guarantee for ${traderId}:`, error);
        // Emit event so UI can show the failure
        this.emit('intent:guaranteeFailed', { intentId, traderId, error: String(error) });
        return;
      }

      if (!newGuarantee) {
        console.error(`[SettlementManager] Failed to issue guarantee for ${traderId}, skipping intent ${intentId}`);
        this.emit('intent:guaranteeFailed', { intentId, traderId, error: 'Guarantee returned null' });
        return;
      }

      guarantee = newGuarantee;
    }

    // Create the intent guarantee record
    const intentGuarantee: IntentGuarantee = {
      intentId,
      guarantee,
      reqId: guarantee.claims.nonce,
      amount: intent.amount,
    };

    // Refresh collateral after guarantee issued (shows new locked amount)
    const collateral = await this.fetchTraderCollateral(intent.traderAddress as Address, traderId);

    let tab = this.traderTabs.get(traderId);

    if (tab && tab.status === 'open') {
      // ADD TO EXISTING TAB
      console.log(`[SettlementManager] Adding intent ${intentId} to existing tab for ${traderId}`);

      tab.intentIds.push(intentId);
      tab.fourMicaGuarantees.push(intentGuarantee);

      // Verify same tabId (SDK should auto-batch)
      if (tab.fourMicaTabId && tab.fourMicaTabId !== guarantee.claims.tabId) {
        console.warn(`[SettlementManager] WARNING: Different tabId! Expected ${tab.fourMicaTabId}, got ${guarantee.claims.tabId}`);
      }

      // Update collateral data
      if (collateral) {
        tab.fourMicaCollateral = collateral;
      }

      // Extend deadline if this intent has a later deadline
      if (deadline > tab.deadline) {
        tab.deadline = deadline;
        if (tab.willPay) {
          const settlementWindow = deadline - now;
          const paymentProgress = 0.4 + Math.random() * 0.4;
          tab.scheduledPaymentTime = now + Math.floor(settlementWindow * paymentProgress);
        }
      }

      // Calculate total from all guarantees
      const totalLocked = tab.fourMicaGuarantees.reduce((sum, g) => sum + g.amount, 0n);
      console.log(`[SettlementManager] Added to ${traderId}'s tab: ${tab.intentIds.length} intents, ${tab.fourMicaGuarantees.length} guarantees`);
      console.log(`[SettlementManager] Total locked: ${this.formatAmount(totalLocked)}, Latest reqId: ${intentGuarantee.reqId}`);
    } else {
      // CREATE NEW TAB for this trader
      const willPay = Math.random() > this.config.unhappyPathProbability;
      const settlementWindow = deadline - now;

      let scheduledPaymentTime: number | undefined;
      if (willPay) {
        const paymentProgress = 0.4 + Math.random() * 0.4;
        scheduledPaymentTime = now + Math.floor(settlementWindow * paymentProgress);
      }

      tab = {
        traderId,
        traderAddress: intent.traderAddress as Address,
        traderName: intent.traderId,
        intentIds: [intentId],
        fourMicaCollateral: collateral || undefined,
        fourMicaTabId: guarantee.claims.tabId, // Set tabId from first guarantee
        fourMicaGuarantees: [intentGuarantee], // Start tracking guarantees
        deadline,
        secondsRemaining: Math.floor(settlementWindow / 1000),
        status: 'open',
        scheduledPaymentTime,
        willPay,
      };

      this.traderTabs.set(traderId, tab);
      console.log(`[SettlementManager] Created tab for ${traderId}: tabId=${guarantee.claims.tabId}`);
      console.log(`[SettlementManager] First guarantee: reqId=${intentGuarantee.reqId}, amount=${this.formatAmount(intentGuarantee.amount)}`);
    }

    // Track in legacy map
    this.activeSettlements.set(intentId, {
      intentId,
      deadline,
      secondsRemaining: tab.secondsRemaining,
      isOverdue: false,
      status: 'countdown',
      scheduledPaymentTime: tab.scheduledPaymentTime,
      willPay: tab.willPay,
    });

    // Emit tab update
    this.emit('tab:updated', this.formatTabForBroadcast(tab));
  }

  /**
   * Check all trader tabs for payments/deadlines
   */
  private checkTabs(): void {
    const now = Date.now();

    for (const [traderId, tab] of this.traderTabs) {
      if (tab.status !== 'open') continue;

      const secondsRemaining = Math.floor((tab.deadline - now) / 1000);
      tab.secondsRemaining = secondsRemaining;
      const isOverdue = secondsRemaining <= 0;

      // Emit countdown update for this tab
      this.emit('tab:countdown', this.formatTabForBroadcast(tab));

      // Check if trader "pays" before deadline (happy path)
      if (tab.willPay && tab.scheduledPaymentTime && now >= tab.scheduledPaymentTime) {
        console.log(`[SettlementManager] ${traderId} paid tab with ${secondsRemaining}s remaining - Happy path!`);
        this.settleTab(traderId, true);
        continue;
      }

      // Check if deadline reached without payment (unhappy path)
      if (isOverdue && !tab.willPay) {
        console.log(`[SettlementManager] ${traderId}'s tab deadline reached - Unhappy path!`);
        this.settleTab(traderId, false);
        continue;
      }

      if (isOverdue) {
        console.log(`[SettlementManager] ${traderId}'s tab deadline reached - settling based on payment status`);
        this.settleTab(traderId, tab.willPay);
      }
    }
  }

  /**
   * Settle an entire trader tab
   *
   * BATCHED PAYMENT APPROACH:
   * - All guarantees were issued per intent (collateral already locked)
   * - Use LATEST reqId (from most recent guarantee)
   * - Pay CUMULATIVE TOTAL amount in single transaction
   * - Unhappy path: enforce with latest guarantee
   */
  private async settleTab(traderId: string, isHappyPath: boolean, txHash?: string): Promise<TabSettlementResult> {
    const tab = this.traderTabs.get(traderId);
    if (!tab) {
      throw new Error(`No tab for trader ${traderId}`);
    }

    tab.status = 'settling';

    // Get all guarantees and find latest reqId
    const guarantees = tab.fourMicaGuarantees;
    if (guarantees.length === 0) {
      console.error(`[SettlementManager] Cannot settle tab for ${traderId}: no guarantees`);
      tab.status = 'open';
      throw new Error(`No guarantees found for tab`);
    }

    // Calculate cumulative total from all guarantees
    const totalAmount = guarantees.reduce((sum, g) => sum + g.amount, 0n);

    // Find latest guarantee (highest reqId)
    const latestGuarantee = guarantees.reduce((latest, current) =>
      current.reqId > latest.reqId ? current : latest
    );

    const tabId = tab.fourMicaTabId!;
    const latestReqId = latestGuarantee.reqId;

    console.log(`[SettlementManager] Settling ${traderId}'s tab: ${tab.intentIds.length} intents, ${guarantees.length} guarantees`);
    console.log(`[SettlementManager] tabId=${tabId}, latestReqId=${latestReqId}, totalAmount=${this.formatAmount(totalAmount)}`);

    let finalTxHash = txHash;

    if (isHappyPath) {
      // HAPPY PATH: Single payTab call with latest reqId and cumulative total
      console.log(`[SettlementManager] Paying cumulative total with latest reqId...`);

      try {
        const result = await this.payFourMicaTab(tab.traderAddress, traderId, tabId, totalAmount, latestReqId);
        if (result) {
          finalTxHash = result;
          console.log(`[SettlementManager] ✓ Paid ${this.formatAmount(totalAmount)} for ${traderId}: ${result}`);
        }
      } catch (error) {
        console.error(`[SettlementManager] ✗ Failed to pay tab for ${traderId}:`, error);
      }
    } else {
      // UNHAPPY PATH: Enforce remuneration with latest guarantee
      console.log(`[SettlementManager] Enforcing remuneration with latest guarantee (reqId=${latestReqId})...`);

      try {
        const result = await this.enforceFourMicaTab(tab.traderAddress, traderId, latestGuarantee.guarantee);
        if (result) {
          finalTxHash = result;
          console.log(`[SettlementManager] ✓ Enforced remuneration for ${traderId}: ${result}`);
        }
      } catch (error) {
        console.error(`[SettlementManager] ✗ Failed to enforce remuneration for ${traderId}:`, error);
      }
    }

    tab.status = 'settled';

    // Settle all intents in the tab
    for (const intentId of tab.intentIds) {
      if (isHappyPath) {
        this.intentManager.completeIntent(intentId, finalTxHash);
      } else {
        this.intentManager.defaultIntent(intentId, finalTxHash);
      }

      const result: SettlementResult = {
        intentId,
        isHappyPath,
        settledAt: Date.now(),
        txHash: finalTxHash,
      };

      const eventName = isHappyPath ? 'settlement:happy' : 'settlement:unhappy';
      this.emit(eventName, result);
      this.emit('settlement:completed', result);
      this.activeSettlements.delete(intentId);
    }

    const tabResult: TabSettlementResult = {
      traderId,
      traderAddress: tab.traderAddress,
      intentIds: [...tab.intentIds],
      totalCollateral: totalAmount,
      isHappyPath,
      settledAt: Date.now(),
      txHash: finalTxHash,
    };

    this.traderTabs.delete(traderId);

    this.emit('tab:settled', {
      ...tabResult,
      totalCollateral: tabResult.totalCollateral.toString(),
    });

    console.log(`[SettlementManager] ${traderId}'s tab settled: ${tab.intentIds.length} intents, ${this.formatAmount(totalAmount)} - ${isHappyPath ? 'happy' : 'unhappy'} path`);

    // Refresh and broadcast updated collateral after settlement (shows unlocked amount)
    try {
      const updatedCollateral = await this.fetchTraderCollateral(tab.traderAddress, traderId);
      if (updatedCollateral) {
        console.log(`[SettlementManager] Post-settlement collateral for ${traderId}: locked=${this.formatAmount(updatedCollateral.locked)}, available=${this.formatAmount(updatedCollateral.available)}`);
        this.emit('tab:collateralUpdate', {
          traderId,
          traderAddress: tab.traderAddress,
          deposited: updatedCollateral.deposited.toString(),
          available: updatedCollateral.available.toString(),
          locked: updatedCollateral.locked.toString(),
        });
      }
    } catch (err) {
      console.warn(`[SettlementManager] Failed to refresh collateral after settlement for ${traderId}:`, err);
    }

    return tabResult;
  }

  // ===========================================================================
  // Public Methods
  // ===========================================================================

  getAllTabs(): TraderTab[] {
    return Array.from(this.traderTabs.values());
  }

  getTabsForBroadcast(): Array<ReturnType<typeof this.formatTabForBroadcast>> {
    return Array.from(this.traderTabs.values()).map(tab => this.formatTabForBroadcast(tab));
  }

  getTab(traderId: string): TraderTab | undefined {
    return this.traderTabs.get(traderId);
  }

  async settleTraderTab(traderId: string, txHash?: string): Promise<TabSettlementResult> {
    return this.settleTab(traderId, true, txHash);
  }

  async enforceTraderTab(traderId: string, txHash?: string): Promise<TabSettlementResult> {
    return this.settleTab(traderId, false, txHash);
  }

  // Legacy compatibility
  async settleHappyPath(intentId: string, txHash?: string): Promise<SettlementResult> {
    for (const [traderId, tab] of this.traderTabs) {
      if (tab.intentIds.includes(intentId)) {
        await this.settleTab(traderId, true, txHash);
        break;
      }
    }
    return { intentId, isHappyPath: true, settledAt: Date.now(), txHash };
  }

  async enforceUnhappyPath(intentId: string, txHash?: string): Promise<SettlementResult> {
    for (const [traderId, tab] of this.traderTabs) {
      if (tab.intentIds.includes(intentId)) {
        await this.settleTab(traderId, false, txHash);
        break;
      }
    }
    return { intentId, isHappyPath: false, settledAt: Date.now(), txHash };
  }

  getStatus(intentId: string): SettlementStatus | undefined {
    return this.activeSettlements.get(intentId);
  }

  getAllActive(): SettlementStatus[] {
    return Array.from(this.activeSettlements.values());
  }

  getOverdue(): SettlementStatus[] {
    return Array.from(this.activeSettlements.values()).filter(s => s.isOverdue);
  }

  isSettling(intentId: string): boolean {
    return this.activeSettlements.has(intentId);
  }

  getStats(): {
    activeCount: number;
    overdueCount: number;
    avgRemainingSeconds: number;
    tabCount: number;
    totalLockedCollateral: string;
  } {
    const tabs = this.getAllTabs();
    // Sum locked amounts from all guarantees across all tabs
    const totalLocked = tabs.reduce((sum, t) =>
      sum + t.fourMicaGuarantees.reduce((gSum, g) => gSum + g.amount, 0n), 0n);
    const active = this.getAllActive();
    const overdue = active.filter(s => s.isOverdue);
    const avgRemaining = tabs.length > 0
      ? tabs.reduce((sum, t) => sum + Math.max(0, t.secondsRemaining), 0) / tabs.length
      : 0;

    return {
      activeCount: active.length,
      overdueCount: overdue.length,
      avgRemainingSeconds: Math.round(avgRemaining),
      tabCount: tabs.length,
      totalLockedCollateral: this.formatAmount(totalLocked),
    };
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  private formatAmount(amount: bigint): string {
    return `$${(Number(amount) / 1_000_000).toLocaleString()}`;
  }

  private formatTabForBroadcast(tab: TraderTab) {
    // Calculate total from all guarantees (collateral already locked)
    const totalAmount = tab.fourMicaGuarantees.reduce((sum, g) => sum + g.amount, 0n);
    // Latest reqId for display
    const latestReqId = tab.fourMicaGuarantees.length > 0
      ? tab.fourMicaGuarantees.reduce((latest, g) => g.reqId > latest ? g.reqId : latest, 0n)
      : undefined;

    return {
      traderId: tab.traderId,
      traderAddress: tab.traderAddress,
      traderName: tab.traderName,
      intentIds: tab.intentIds,
      intentCount: tab.intentIds.length,
      guaranteeCount: tab.fourMicaGuarantees.length,
      // Total locked amount (sum of all guarantees)
      totalAmount: totalAmount.toString(),
      totalAmountFormatted: this.formatAmount(totalAmount),
      lockedCollateral: totalAmount.toString(),
      lockedCollateralFormatted: this.formatAmount(totalAmount),
      // Latest reqId (used for settlement)
      latestReqId: latestReqId?.toString(),
      // Full 4Mica collateral data from API
      fourMicaDeposited: tab.fourMicaCollateral?.deposited.toString(),
      fourMicaAvailable: tab.fourMicaCollateral?.available.toString(),
      fourMicaLocked: tab.fourMicaCollateral?.locked.toString(),
      fourMicaTabId: tab.fourMicaTabId?.toString(),
      deadline: tab.deadline,
      secondsRemaining: Math.max(0, tab.secondsRemaining),
      status: tab.status,
    };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createSettlementManager(
  config: SettlementManagerConfig,
  intentManager: IntentManager
): SettlementManager {
  return new SettlementManager(config, intentManager);
}

export default SettlementManager;
