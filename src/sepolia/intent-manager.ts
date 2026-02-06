/**
 * Intent Manager for 4Mica × Agent0 Competitive Solver Game
 *
 * Manages the lifecycle of trade intents:
 * - Intent creation from arbitrage opportunities
 * - Solver bidding and winner selection
 * - Intent state transitions
 * - Integration with 4Mica guarantees
 */

import { EventEmitter } from 'events';
import type { Address } from 'viem';
import type { ArbitrageOpportunity } from './price-indexer.js';
import type { PaymentGuarantee } from '../lib/4mica-client.js';

// =============================================================================
// Types
// =============================================================================

export type IntentStatus =
  | 'pending'      // Created, waiting for solver bids
  | 'claimed'      // Solver won the bid
  | 'executing'    // Solver is executing the trade
  | 'settling'     // In settlement window
  | 'completed'    // Happy path - settled successfully
  | 'defaulted'    // Unhappy path - remuneration enforced
  | 'cancelled';   // Intent was cancelled

export interface TradeIntent {
  id: string;
  traderId: string;
  traderAddress: Address;
  amount: bigint;
  direction: 'ALPHA_TO_BETA' | 'BETA_TO_ALPHA';
  expectedProfit: bigint;
  spreadBps: number;
  status: IntentStatus;
  createdAt: number;
  claimedAt?: number;
  executedAt?: number;
  settledAt?: number;

  // 4Mica integration
  tabId?: string;
  guaranteeCertificate?: string;
  guaranteeVerified: boolean;
  fourMicaGuarantee?: PaymentGuarantee; // Full guarantee object for settlement

  // Solver info (after claiming)
  solverId?: string;
  solverAddress?: Address;
  solverBid?: SolverBid;

  // Settlement
  settlementDeadline?: number;
  settlementTxHash?: string;
  isHappyPath?: boolean;
}

export interface SolverBid {
  solverId: string;
  solverAddress: Address;
  solverName: string;
  bidScore: number;
  executionTimeEstimateMs: number;
  profitShareBps: number;
  timestamp: number;
}

export interface IntentManagerConfig {
  maxPendingIntents: number;
  bidWindowMs: number;
  settlementWindowSeconds: number;
  unhappyPathProbability: number;
}

// =============================================================================
// Intent Manager Class
// =============================================================================

export class IntentManager extends EventEmitter {
  private config: IntentManagerConfig;
  private intents: Map<string, TradeIntent> = new Map();
  private pendingBids: Map<string, SolverBid[]> = new Map();
  private bidTimers: Map<string, NodeJS.Timeout> = new Map();
  private intentCounter = 0;

  constructor(config: IntentManagerConfig) {
    super();
    this.config = config;
  }

  // ===========================================================================
  // Intent Creation
  // ===========================================================================

  /**
   * Create a new trade intent from an arbitrage opportunity
   * @param guaranteeCertificate - Optional 4Mica guarantee certificate string (for display)
   * @param fourMicaGuarantee - Optional full PaymentGuarantee object (for settlement)
   */
  createIntent(
    traderId: string,
    traderAddress: Address,
    opportunity: ArbitrageOpportunity,
    amount: bigint,
    guaranteeCertificate?: string,
    fourMicaGuarantee?: PaymentGuarantee
  ): TradeIntent {
    const intentId = `intent_${++this.intentCounter}_${Date.now()}`;

    const intent: TradeIntent = {
      id: intentId,
      traderId,
      traderAddress,
      amount,
      direction: opportunity.direction,
      expectedProfit: opportunity.expectedProfit,
      spreadBps: opportunity.spreadBps,
      status: 'pending',
      createdAt: Date.now(),
      guaranteeCertificate,
      guaranteeVerified: !!guaranteeCertificate, // Verified if certificate provided
      fourMicaGuarantee, // Full guarantee for settlement
      tabId: fourMicaGuarantee?.claims.tabId.toString(),
    };

    this.intents.set(intentId, intent);
    this.pendingBids.set(intentId, []);

    // Start bid collection timer
    const timer = setTimeout(() => {
      this.closeBidding(intentId);
    }, this.config.bidWindowMs);
    this.bidTimers.set(intentId, timer);

    const verifiedStatus = intent.guaranteeVerified ? '✓ 4Mica Verified' : '⚠ No Guarantee';
    console.log(`[IntentManager] Created intent ${intentId} for ${this.formatAmount(amount)} USDC [${verifiedStatus}]`);
    this.emit('intent:created', intent);

    return intent;
  }

  /**
   * Attach 4Mica guarantee to intent
   * @param fourMicaGuarantee - Optional full PaymentGuarantee object for settlement
   */
  attachGuarantee(
    intentId: string,
    tabId: string,
    certificate: string,
    verified: boolean,
    fourMicaGuarantee?: PaymentGuarantee
  ): void {
    const intent = this.intents.get(intentId);
    if (!intent) {
      throw new Error(`Intent ${intentId} not found`);
    }

    intent.tabId = tabId;
    intent.guaranteeCertificate = certificate;
    intent.guaranteeVerified = verified;
    if (fourMicaGuarantee) {
      intent.fourMicaGuarantee = fourMicaGuarantee;
    }

    this.emit('intent:guaranteed', { intentId, tabId, verified });
  }

  // ===========================================================================
  // Solver Bidding
  // ===========================================================================

  /**
   * Submit a solver bid for an intent
   * Solvers should only bid on intents with verified 4Mica guarantees
   */
  submitBid(intentId: string, bid: SolverBid): boolean {
    const intent = this.intents.get(intentId);
    if (!intent || intent.status !== 'pending') {
      console.log(`[IntentManager] Cannot bid on intent ${intentId}: not pending`);
      return false;
    }

    // Solvers should only bid on intents with verified 4Mica guarantees
    if (!intent.guaranteeVerified) {
      console.log(`[IntentManager] Solver ${bid.solverId} rejected bid on ${intentId}: no verified 4Mica guarantee`);
      return false;
    }

    const bids = this.pendingBids.get(intentId) || [];

    // Check if solver already bid
    if (bids.some(b => b.solverId === bid.solverId)) {
      console.log(`[IntentManager] Solver ${bid.solverId} already bid on ${intentId}`);
      return false;
    }

    bids.push(bid);
    this.pendingBids.set(intentId, bids);

    console.log(`[IntentManager] Bid from ${bid.solverName} on ${intentId}: score=${bid.bidScore}`);
    this.emit('intent:bid', { intentId, bid });

    return true;
  }

  /**
   * Close bidding and select winner
   */
  private closeBidding(intentId: string): void {
    const intent = this.intents.get(intentId);
    if (!intent || intent.status !== 'pending') return;

    const bids = this.pendingBids.get(intentId) || [];
    this.bidTimers.delete(intentId);

    if (bids.length === 0) {
      console.log(`[IntentManager] No bids for ${intentId}, cancelling`);
      this.cancelIntent(intentId, 'No solver bids received');
      return;
    }

    // Select winner (highest bid score)
    const winner = bids.reduce((best, bid) =>
      bid.bidScore > best.bidScore ? bid : best
    );

    this.claimIntent(intentId, winner);
  }

  /**
   * Claim intent for a solver
   */
  private claimIntent(intentId: string, winningBid: SolverBid): void {
    const intent = this.intents.get(intentId);
    if (!intent) return;

    intent.status = 'claimed';
    intent.claimedAt = Date.now();
    intent.solverId = winningBid.solverId;
    intent.solverAddress = winningBid.solverAddress;
    intent.solverBid = winningBid;

    console.log(`[IntentManager] Intent ${intentId} claimed by ${winningBid.solverName}`);
    this.emit('intent:claimed', { intentId, solver: winningBid });
  }

  // ===========================================================================
  // Intent Lifecycle
  // ===========================================================================

  /**
   * Mark intent as executing
   */
  startExecution(intentId: string): void {
    const intent = this.intents.get(intentId);
    if (!intent || intent.status !== 'claimed') {
      throw new Error(`Cannot start execution for intent ${intentId}`);
    }

    intent.status = 'executing';
    this.emit('intent:executing', { intentId });
  }

  /**
   * Mark intent as executed, start settlement window
   */
  markExecuted(intentId: string, txHash?: string): void {
    const intent = this.intents.get(intentId);
    if (!intent || intent.status !== 'executing') {
      throw new Error(`Cannot mark executed for intent ${intentId}`);
    }

    intent.status = 'settling';
    intent.executedAt = Date.now();
    intent.settlementDeadline = Date.now() + (this.config.settlementWindowSeconds * 1000);
    if (txHash) {
      intent.settlementTxHash = txHash;
    }

    console.log(`[IntentManager] Intent ${intentId} executed, settlement deadline: ${new Date(intent.settlementDeadline).toISOString()}`);
    this.emit('intent:executed', { intentId, txHash, deadline: intent.settlementDeadline });
  }

  /**
   * Complete intent (happy path)
   */
  completeIntent(intentId: string, txHash?: string): void {
    const intent = this.intents.get(intentId);
    if (!intent || intent.status !== 'settling') {
      throw new Error(`Cannot complete intent ${intentId}`);
    }

    intent.status = 'completed';
    intent.settledAt = Date.now();
    intent.isHappyPath = true;
    if (txHash) {
      intent.settlementTxHash = txHash;
    }

    console.log(`[IntentManager] Intent ${intentId} completed (happy path)`);
    this.emit('intent:completed', { intentId, isHappyPath: true });
  }

  /**
   * Default intent (unhappy path)
   */
  defaultIntent(intentId: string, txHash?: string): void {
    const intent = this.intents.get(intentId);
    if (!intent || intent.status !== 'settling') {
      throw new Error(`Cannot default intent ${intentId}`);
    }

    intent.status = 'defaulted';
    intent.settledAt = Date.now();
    intent.isHappyPath = false;
    if (txHash) {
      intent.settlementTxHash = txHash;
    }

    console.log(`[IntentManager] Intent ${intentId} defaulted (unhappy path)`);
    this.emit('intent:defaulted', { intentId, isHappyPath: false });
  }

  /**
   * Cancel intent
   */
  cancelIntent(intentId: string, reason: string): void {
    const intent = this.intents.get(intentId);
    if (!intent) return;

    // Clear bid timer if exists
    const timer = this.bidTimers.get(intentId);
    if (timer) {
      clearTimeout(timer);
      this.bidTimers.delete(intentId);
    }

    intent.status = 'cancelled';
    console.log(`[IntentManager] Intent ${intentId} cancelled: ${reason}`);
    this.emit('intent:cancelled', { intentId, reason });
  }

  // ===========================================================================
  // Queries
  // ===========================================================================

  /**
   * Get intent by ID
   */
  getIntent(intentId: string): TradeIntent | undefined {
    return this.intents.get(intentId);
  }

  /**
   * Get all intents
   */
  getAllIntents(): TradeIntent[] {
    return Array.from(this.intents.values());
  }

  /**
   * Get intents by status
   */
  getIntentsByStatus(status: IntentStatus): TradeIntent[] {
    return Array.from(this.intents.values()).filter(i => i.status === status);
  }

  /**
   * Get active intents (pending, claimed, executing, settling)
   */
  getActiveIntents(): TradeIntent[] {
    const activeStatuses: IntentStatus[] = ['pending', 'claimed', 'executing', 'settling'];
    return Array.from(this.intents.values()).filter(i => activeStatuses.includes(i.status));
  }

  /**
   * Get intents in settlement window
   */
  getSettlingIntents(): TradeIntent[] {
    return this.getIntentsByStatus('settling');
  }

  /**
   * Get bids for an intent
   */
  getBids(intentId: string): SolverBid[] {
    return this.pendingBids.get(intentId) || [];
  }

  /**
   * Get statistics
   */
  getStats(): {
    total: number;
    pending: number;
    active: number;
    completed: number;
    defaulted: number;
    happyPathRate: number;
  } {
    const all = this.getAllIntents();
    const completed = all.filter(i => i.status === 'completed').length;
    const defaulted = all.filter(i => i.status === 'defaulted').length;
    const finished = completed + defaulted;

    return {
      total: all.length,
      pending: all.filter(i => i.status === 'pending').length,
      active: this.getActiveIntents().length,
      completed,
      defaulted,
      happyPathRate: finished > 0 ? (completed / finished) * 100 : 100,
    };
  }

  // ===========================================================================
  // Utility
  // ===========================================================================

  private formatAmount(amount: bigint): string {
    return (Number(amount) / 1_000_000).toLocaleString();
  }

  /**
   * Clean up old completed intents
   */
  cleanup(maxAgeMs: number = 3600000): void {
    const cutoff = Date.now() - maxAgeMs;
    const toDelete: string[] = [];

    for (const [id, intent] of this.intents) {
      if (
        (intent.status === 'completed' || intent.status === 'defaulted' || intent.status === 'cancelled') &&
        (intent.settledAt || intent.createdAt) < cutoff
      ) {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      this.intents.delete(id);
      this.pendingBids.delete(id);
    }

    if (toDelete.length > 0) {
      console.log(`[IntentManager] Cleaned up ${toDelete.length} old intents`);
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createIntentManager(config: IntentManagerConfig): IntentManager {
  return new IntentManager(config);
}

export default IntentManager;
