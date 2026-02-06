/**
 * Reputation System Utilities for 4Mica × Agent0 Competitive Solver Game
 *
 * This module provides utilities for:
 * - Querying agent reputation scores
 * - Giving feedback after settlements
 * - Building and querying the leaderboard
 * - Reputation-based solver ranking
 */

import type { Address } from 'viem';
import {
  Agent0Client,
  createAgent0Client,
  type ReputationSummary,
  type FeedbackEntry,
  type Agent0ClientConfig,
} from './agent0-client.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Solver leaderboard entry
 */
export interface LeaderboardEntry {
  rank: number;
  agentName: string;
  address: Address;
  wins: number;
  losses: number;
  totalSettlements: number;
  happyPathRate: number;
  avgExecutionTimeMs: number;
  totalVolume: bigint;
  reputationScore: number;
  streak: number; // Current win streak
}

/**
 * Settlement outcome for reputation feedback
 */
export interface SettlementOutcome {
  intentId: string;
  solver: Address;
  trader: Address;
  isHappyPath: boolean;
  executionTimeMs: number;
  profit: bigint;
  volume: bigint;
  timestamp: number;
}

/**
 * Feedback context for settlement-based reputation
 */
export interface SettlementFeedbackContext {
  intentId: string;
  settlementType: 'happy' | 'unhappy';
  executionTimeMs: number;
  profitBps: number;
}

// =============================================================================
// In-Memory Reputation Cache
// =============================================================================

/**
 * Local cache for reputation data to reduce on-chain queries
 */
class ReputationCache {
  private cache: Map<Address, ReputationSummary & { cachedAt: number }> = new Map();
  private readonly ttlMs: number = 60000; // 1 minute TTL

  get(address: Address): ReputationSummary | null {
    const entry = this.cache.get(address);
    if (!entry) return null;

    if (Date.now() - entry.cachedAt > this.ttlMs) {
      this.cache.delete(address);
      return null;
    }

    return entry;
  }

  set(address: Address, summary: ReputationSummary): void {
    this.cache.set(address, { ...summary, cachedAt: Date.now() });
  }

  invalidate(address: Address): void {
    this.cache.delete(address);
  }

  clear(): void {
    this.cache.clear();
  }
}

// =============================================================================
// Local Settlement Tracking
// =============================================================================

/**
 * Local tracker for settlement statistics (supplements on-chain data)
 */
class SettlementTracker {
  private settlements: Map<Address, SettlementOutcome[]> = new Map();

  addSettlement(outcome: SettlementOutcome): void {
    const existing = this.settlements.get(outcome.solver) || [];
    existing.push(outcome);
    this.settlements.set(outcome.solver, existing);
  }

  getSettlements(address: Address): SettlementOutcome[] {
    return this.settlements.get(address) || [];
  }

  getStats(address: Address): {
    wins: number;
    losses: number;
    happyPathRate: number;
    avgExecutionTime: number;
    totalVolume: bigint;
    streak: number;
  } {
    const settlements = this.getSettlements(address);

    if (settlements.length === 0) {
      return {
        wins: 0,
        losses: 0,
        happyPathRate: 0,
        avgExecutionTime: 0,
        totalVolume: 0n,
        streak: 0,
      };
    }

    const wins = settlements.filter(s => s.isHappyPath).length;
    const losses = settlements.length - wins;
    const happyPathRate = (wins / settlements.length) * 100;
    const avgExecutionTime = settlements.reduce((sum, s) => sum + s.executionTimeMs, 0) / settlements.length;
    const totalVolume = settlements.reduce((sum, s) => sum + s.volume, 0n);

    // Calculate current streak
    let streak = 0;
    const sorted = [...settlements].sort((a, b) => b.timestamp - a.timestamp);
    for (const s of sorted) {
      if (s.isHappyPath) {
        streak++;
      } else {
        break;
      }
    }

    return {
      wins,
      losses,
      happyPathRate,
      avgExecutionTime,
      totalVolume,
      streak,
    };
  }

  getAllAddresses(): Address[] {
    return Array.from(this.settlements.keys());
  }
}

// =============================================================================
// Reputation Manager
// =============================================================================

/**
 * Manages reputation queries and feedback for the competitive solver game
 */
export class ReputationManager {
  private agent0Client: Agent0Client;
  private cache: ReputationCache;
  private tracker: SettlementTracker;
  private agentNames: Map<Address, string> = new Map();

  constructor(config: Agent0ClientConfig) {
    this.agent0Client = createAgent0Client(config);
    this.cache = new ReputationCache();
    this.tracker = new SettlementTracker();
  }

  // ===========================================================================
  // Agent Name Registration
  // ===========================================================================

  /**
   * Register an agent name for display purposes
   */
  registerAgentName(address: Address, name: string): void {
    this.agentNames.set(address, name);
  }

  /**
   * Get agent name by address
   */
  getAgentName(address: Address): string {
    return this.agentNames.get(address) || `Agent-${address.slice(0, 8)}`;
  }

  // ===========================================================================
  // Reputation Queries
  // ===========================================================================

  /**
   * Get reputation summary for an agent (cached)
   */
  async getReputation(address: Address): Promise<ReputationSummary> {
    // Check cache first
    const cached = this.cache.get(address);
    if (cached) {
      return cached;
    }

    // Fetch from Agent0
    const summary = await this.agent0Client.getReputationSummary(address);
    this.cache.set(address, summary);

    return summary;
  }

  /**
   * Calculate composite reputation score (0-100)
   */
  async calculateReputationScore(address: Address): Promise<number> {
    const reputation = await this.getReputation(address);
    const stats = this.tracker.getStats(address);

    // Weighted scoring:
    // - 40% from Agent0 feedback score
    // - 30% from happy path rate
    // - 20% from total settlements (experience)
    // - 10% from current streak

    const feedbackScore = reputation.totalFeedback > 0
      ? ((reputation.averageScore + 1) / 2) * 100 // Normalize from [-1,1] to [0,100]
      : 50; // Neutral default

    const happyPathScore = stats.happyPathRate;

    const experienceScore = Math.min(100, (stats.wins + stats.losses) * 5); // Cap at 20 settlements

    const streakScore = Math.min(100, stats.streak * 10); // Cap at 10 streak

    const composite = (
      feedbackScore * 0.4 +
      happyPathScore * 0.3 +
      experienceScore * 0.2 +
      streakScore * 0.1
    );

    return Math.round(composite * 100) / 100;
  }

  // ===========================================================================
  // Feedback Management
  // ===========================================================================

  /**
   * Give positive feedback to an agent
   */
  async givePositiveFeedback(
    toAddress: Address,
    context: SettlementFeedbackContext
  ): Promise<void> {
    const contextStr = JSON.stringify(context);
    await this.agent0Client.giveFeedback(
      toAddress,
      1,
      'Successful settlement in competitive solver game',
      contextStr
    );
    this.cache.invalidate(toAddress);
  }

  /**
   * Give negative feedback to an agent
   */
  async giveNegativeFeedback(
    toAddress: Address,
    context: SettlementFeedbackContext
  ): Promise<void> {
    const contextStr = JSON.stringify(context);
    await this.agent0Client.giveFeedback(
      toAddress,
      -1,
      'Failed settlement in competitive solver game',
      contextStr
    );
    this.cache.invalidate(toAddress);
  }

  /**
   * Record settlement outcome and give appropriate feedback
   */
  async recordSettlement(outcome: SettlementOutcome): Promise<void> {
    // Track locally
    this.tracker.addSettlement(outcome);

    // Give feedback based on outcome
    const context: SettlementFeedbackContext = {
      intentId: outcome.intentId,
      settlementType: outcome.isHappyPath ? 'happy' : 'unhappy',
      executionTimeMs: outcome.executionTimeMs,
      profitBps: outcome.volume > 0n
        ? Number((outcome.profit * 10000n) / outcome.volume)
        : 0,
    };

    if (outcome.isHappyPath) {
      // Trader gives positive feedback to solver
      await this.givePositiveFeedback(outcome.solver, context);
    } else {
      // Trader gives negative feedback to solver
      await this.giveNegativeFeedback(outcome.solver, context);
    }
  }

  // ===========================================================================
  // Leaderboard
  // ===========================================================================

  /**
   * Build the solver leaderboard
   */
  async buildLeaderboard(solverAddresses: Address[]): Promise<LeaderboardEntry[]> {
    const entries: LeaderboardEntry[] = [];

    for (const address of solverAddresses) {
      const score = await this.calculateReputationScore(address);
      const stats = this.tracker.getStats(address);

      entries.push({
        rank: 0, // Will be assigned after sorting
        agentName: this.getAgentName(address),
        address,
        wins: stats.wins,
        losses: stats.losses,
        totalSettlements: stats.wins + stats.losses,
        happyPathRate: stats.happyPathRate,
        avgExecutionTimeMs: stats.avgExecutionTime,
        totalVolume: stats.totalVolume,
        reputationScore: score,
        streak: stats.streak,
      });
    }

    // Sort by reputation score (descending)
    entries.sort((a, b) => b.reputationScore - a.reputationScore);

    // Assign ranks
    entries.forEach((entry, index) => {
      entry.rank = index + 1;
    });

    return entries;
  }

  /**
   * Get top N solvers by reputation
   */
  async getTopSolvers(n: number = 10): Promise<LeaderboardEntry[]> {
    const allAddresses = this.tracker.getAllAddresses();
    const leaderboard = await this.buildLeaderboard(allAddresses);
    return leaderboard.slice(0, n);
  }

  // ===========================================================================
  // Solver Ranking for Intent Evaluation
  // ===========================================================================

  /**
   * Rank solvers for a specific intent based on reputation and capabilities
   */
  async rankSolversForIntent(
    solverAddresses: Address[],
    intentValue: bigint
  ): Promise<Array<{ address: Address; score: number; reason: string }>> {
    const rankings: Array<{ address: Address; score: number; reason: string }> = [];

    for (const address of solverAddresses) {
      const reputationScore = await this.calculateReputationScore(address);
      const stats = this.tracker.getStats(address);

      // Boost for high-value intents if solver has handled similar volumes
      let volumeBoost = 0;
      if (stats.totalVolume > intentValue * 10n) {
        volumeBoost = 10; // Experienced with high volumes
      }

      // Boost for consistent performers
      let consistencyBoost = 0;
      if (stats.happyPathRate > 95 && stats.wins > 5) {
        consistencyBoost = 15;
      }

      const finalScore = reputationScore + volumeBoost + consistencyBoost;

      let reason = `Base score: ${reputationScore.toFixed(1)}`;
      if (volumeBoost > 0) reason += `, +${volumeBoost} volume exp`;
      if (consistencyBoost > 0) reason += `, +${consistencyBoost} consistency`;

      rankings.push({ address, score: finalScore, reason });
    }

    // Sort by score descending
    rankings.sort((a, b) => b.score - a.score);

    return rankings;
  }

  // ===========================================================================
  // Cache Management
  // ===========================================================================

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get settlement tracker for direct access
   */
  getTracker(): SettlementTracker {
    return this.tracker;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a ReputationManager instance
 */
export function createReputationManager(config: Agent0ClientConfig): ReputationManager {
  return new ReputationManager(config);
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Format reputation score for display
 */
export function formatReputationScore(score: number): string {
  if (score >= 90) return `${score.toFixed(1)} ⭐⭐⭐`;
  if (score >= 75) return `${score.toFixed(1)} ⭐⭐`;
  if (score >= 50) return `${score.toFixed(1)} ⭐`;
  return `${score.toFixed(1)}`;
}

/**
 * Get reputation tier name
 */
export function getReputationTier(score: number): string {
  if (score >= 95) return 'Elite';
  if (score >= 85) return 'Expert';
  if (score >= 70) return 'Proficient';
  if (score >= 50) return 'Intermediate';
  if (score >= 25) return 'Novice';
  return 'Newcomer';
}

/**
 * Format leaderboard entry for display
 */
export function formatLeaderboardEntry(entry: LeaderboardEntry): string {
  const medal = entry.rank <= 3
    ? ['🥇', '🥈', '🥉'][entry.rank - 1]
    : `#${entry.rank}`;

  return `${medal} ${entry.agentName} | Score: ${entry.reputationScore.toFixed(1)} | ` +
         `Wins: ${entry.wins} | Happy Path: ${entry.happyPathRate.toFixed(0)}%`;
}

export default ReputationManager;
