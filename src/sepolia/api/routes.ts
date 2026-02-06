/**
 * API Routes for 4Mica × Agent0 Competitive Solver Game
 *
 * REST API endpoints for:
 * - Price data
 * - Intent management
 * - Solver information
 * - Settlement status
 * - Leaderboard
 * - Agent profiles
 */

import { Router, type Request, type Response } from 'express';
import type { PriceIndexer } from '../price-indexer.js';
import type { IntentManager, TradeIntent, SolverBid } from '../intent-manager.js';
import type { SettlementManager } from '../settlement-mgr.js';
import type { ReputationManager, LeaderboardEntry } from '../../lib/reputation.js';
import type { Address } from 'viem';

// =============================================================================
// Types
// =============================================================================

export interface APIContext {
  priceIndexer: PriceIndexer;
  intentManager: IntentManager;
  settlementManager: SettlementManager;
  reputationManager: ReputationManager;
  solverAddresses: Address[];
  agentProfiles: Map<string, AgentProfile>;
}

export interface AgentProfile {
  id: string;
  name: string;
  address: Address;
  role: 'trader' | 'solver';
  registered: boolean;
  collateral: bigint;
  stats: {
    trades: number;
    wins: number;
    profit: bigint;
    volume: bigint;
  };
}

// =============================================================================
// Route Factory
// =============================================================================

export function createAPIRoutes(context: APIContext): Router {
  const router = Router();

  // ===========================================================================
  // Price Endpoints
  // ===========================================================================

  /**
   * GET /api/prices
   * Current prices from both AMMs
   */
  router.get('/prices', (req: Request, res: Response) => {
    const priceData = context.priceIndexer.getLastPrice();
    if (!priceData) {
      return res.status(503).json({ error: 'Price data not available yet' });
    }

    res.json({
      alpha: {
        price: priceData.alphaPriceFormatted,
        priceRaw: priceData.alphaPrice.toString(),
      },
      beta: {
        price: priceData.betaPriceFormatted,
        priceRaw: priceData.betaPrice.toString(),
      },
      spread: {
        bps: priceData.spreadBps,
        percent: (priceData.spreadBps / 100).toFixed(2),
      },
      direction: priceData.direction,
      timestamp: priceData.timestamp,
    });
  });

  /**
   * GET /api/prices/history
   * Price history for charts
   */
  router.get('/prices/history', (req: Request, res: Response) => {
    const limit = parseInt(req.query.limit as string) || 60;
    const history = context.priceIndexer.getPriceHistory(limit);

    res.json({
      count: history.length,
      data: history.map(p => ({
        alpha: p.alphaPriceFormatted,
        beta: p.betaPriceFormatted,
        spreadBps: p.spreadBps,
        timestamp: p.timestamp,
      })),
    });
  });

  // ===========================================================================
  // Intent Endpoints
  // ===========================================================================

  /**
   * GET /api/intents
   * List all intents (with optional status filter)
   */
  router.get('/intents', (req: Request, res: Response) => {
    const status = req.query.status as string;
    let intents: TradeIntent[];

    if (status) {
      intents = context.intentManager.getIntentsByStatus(status as any);
    } else {
      intents = context.intentManager.getAllIntents();
    }

    res.json({
      count: intents.length,
      data: intents.map(formatIntent),
    });
  });

  /**
   * GET /api/intents/active
   * List active intents only
   */
  router.get('/intents/active', (req: Request, res: Response) => {
    const intents = context.intentManager.getActiveIntents();

    res.json({
      count: intents.length,
      data: intents.map(formatIntent),
    });
  });

  /**
   * GET /api/intents/:id
   * Get specific intent details
   */
  router.get('/intents/:id', (req: Request, res: Response) => {
    const intent = context.intentManager.getIntent(req.params.id);
    if (!intent) {
      return res.status(404).json({ error: 'Intent not found' });
    }

    const bids = context.intentManager.getBids(intent.id);

    res.json({
      ...formatIntent(intent),
      bids: bids.map(formatBid),
    });
  });

  /**
   * GET /api/intents/:id/bids
   * Get bids for an intent
   */
  router.get('/intents/:id/bids', (req: Request, res: Response) => {
    const bids = context.intentManager.getBids(req.params.id);

    res.json({
      intentId: req.params.id,
      count: bids.length,
      data: bids.map(formatBid),
    });
  });

  // ===========================================================================
  // Settlement Endpoints
  // ===========================================================================

  /**
   * GET /api/settlement
   * Get all active settlements with countdown
   */
  router.get('/settlement', (req: Request, res: Response) => {
    const countdowns = context.settlementManager.getTabsForBroadcast();
    const stats = context.settlementManager.getStats();

    res.json({
      stats,
      countdowns,
    });
  });

  /**
   * GET /api/settlement/:id
   * Get settlement status for specific intent
   */
  router.get('/settlement/:id', (req: Request, res: Response) => {
    const status = context.settlementManager.getStatus(req.params.id);
    if (!status) {
      return res.status(404).json({ error: 'Settlement not found or already completed' });
    }

    res.json({
      intentId: status.intentId,
      deadline: status.deadline,
      secondsRemaining: Math.max(0, status.secondsRemaining),
      isOverdue: status.isOverdue,
      status: status.status,
    });
  });

  // ===========================================================================
  // Solver Endpoints
  // ===========================================================================

  /**
   * GET /api/solvers
   * List all registered solvers with stats
   */
  router.get('/solvers', async (req: Request, res: Response) => {
    try {
      const leaderboard = await context.reputationManager.buildLeaderboard(
        context.solverAddresses
      );

      res.json({
        count: leaderboard.length,
        data: leaderboard.map(formatLeaderboardEntry),
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch solver data' });
    }
  });

  /**
   * GET /api/solvers/:address
   * Get specific solver details
   */
  router.get('/solvers/:address', async (req: Request, res: Response) => {
    try {
      const address = req.params.address as Address;
      const reputation = await context.reputationManager.getReputation(address);
      const score = await context.reputationManager.calculateReputationScore(address);
      const profile = context.agentProfiles.get(address);

      res.json({
        address,
        name: profile?.name || context.reputationManager.getAgentName(address),
        reputationScore: score,
        feedback: {
          total: reputation.totalFeedback,
          positive: reputation.positiveCount,
          negative: reputation.negativeCount,
          neutral: reputation.neutralCount,
        },
        stats: profile?.stats || null,
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch solver data' });
    }
  });

  // ===========================================================================
  // Leaderboard Endpoints
  // ===========================================================================

  /**
   * GET /api/leaderboard
   * Get solver leaderboard ranked by reputation
   */
  router.get('/leaderboard', async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const leaderboard = await context.reputationManager.getTopSolvers(limit);

      res.json({
        count: leaderboard.length,
        updatedAt: Date.now(),
        data: leaderboard.map(formatLeaderboardEntry),
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
  });

  // ===========================================================================
  // Agent Endpoints
  // ===========================================================================

  /**
   * GET /api/agents
   * List all registered agents
   */
  router.get('/agents', (req: Request, res: Response) => {
    const agents = Array.from(context.agentProfiles.values());

    res.json({
      count: agents.length,
      traders: agents.filter(a => a.role === 'trader').map(formatAgentProfile),
      solvers: agents.filter(a => a.role === 'solver').map(formatAgentProfile),
    });
  });

  /**
   * GET /api/agents/:id
   * Get specific agent profile
   */
  router.get('/agents/:id', async (req: Request, res: Response) => {
    const profile = context.agentProfiles.get(req.params.id);
    if (!profile) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    // Get reputation if solver
    let reputation = null;
    if (profile.role === 'solver') {
      try {
        const score = await context.reputationManager.calculateReputationScore(profile.address);
        reputation = { score };
      } catch {
        // Ignore reputation errors
      }
    }

    res.json({
      ...formatAgentProfile(profile),
      reputation,
    });
  });

  // ===========================================================================
  // Stats Endpoints
  // ===========================================================================

  /**
   * GET /api/stats
   * Overall game statistics
   */
  router.get('/stats', (req: Request, res: Response) => {
    const intentStats = context.intentManager.getStats();
    const settlementStats = context.settlementManager.getStats();
    const priceData = context.priceIndexer.getLastPrice();

    res.json({
      intents: intentStats,
      settlements: settlementStats,
      currentSpread: priceData?.spreadBps || 0,
      hasOpportunity: context.priceIndexer.hasOpportunity(),
      timestamp: Date.now(),
    });
  });

  // ===========================================================================
  // Health Check
  // ===========================================================================

  /**
   * GET /api/health
   * Health check endpoint
   */
  router.get('/health', (req: Request, res: Response) => {
    res.json({
      status: 'ok',
      priceIndexer: context.priceIndexer.isRunning(),
      timestamp: Date.now(),
    });
  });

  // ===========================================================================
  // Trader Collateral Endpoints
  // ===========================================================================

  /**
   * GET /api/traders/:traderId/collateral
   * Get 4Mica collateral info for a trader
   */
  router.get('/traders/:traderId/collateral', async (req: Request, res: Response) => {
    const traderId = req.params.traderId;

    // Find trader profile
    const profile = context.agentProfiles.get(traderId);
    if (!profile || profile.role !== 'trader') {
      return res.status(404).json({ error: 'Trader not found' });
    }

    // Try to get collateral from settlement manager's cached data
    const tab = context.settlementManager.getTab(traderId);
    if (tab && tab.fourMicaCollateral) {
      return res.json({
        traderId,
        traderAddress: profile.address,
        deposited: tab.fourMicaCollateral.deposited.toString(),
        available: tab.fourMicaCollateral.available.toString(),
        locked: tab.fourMicaCollateral.locked.toString(),
        hasActiveTab: true,
      });
    }

    // Fetch fresh collateral data from 4Mica
    try {
      const collateral = await context.settlementManager.fetchTraderCollateral(
        profile.address as Address,
        traderId
      );

      if (collateral) {
        return res.json({
          traderId,
          traderAddress: profile.address,
          deposited: collateral.deposited.toString(),
          available: collateral.available.toString(),
          locked: collateral.locked.toString(),
          hasActiveTab: false,
        });
      }

      // Return zeros if no collateral data available
      return res.json({
        traderId,
        traderAddress: profile.address,
        deposited: '0',
        available: '0',
        locked: '0',
        hasActiveTab: false,
      });
    } catch (error) {
      console.error(`[API] Error fetching collateral for ${traderId}:`, error);
      return res.status(500).json({ error: 'Failed to fetch collateral data' });
    }
  });

  return router;
}

// =============================================================================
// Formatters
// =============================================================================

function formatIntent(intent: TradeIntent) {
  return {
    id: intent.id,
    trader: {
      id: intent.traderId,
      address: intent.traderAddress,
    },
    amount: intent.amount.toString(),
    amountFormatted: formatAmount(intent.amount),
    direction: intent.direction,
    spreadBps: intent.spreadBps,
    expectedProfit: intent.expectedProfit.toString(),
    status: intent.status,
    createdAt: intent.createdAt,
    guarantee: {
      tabId: intent.tabId,
      verified: intent.guaranteeVerified,
    },
    solver: intent.solverId ? {
      id: intent.solverId,
      address: intent.solverAddress,
    } : null,
    settlement: intent.settlementDeadline ? {
      deadline: intent.settlementDeadline,
      isHappyPath: intent.isHappyPath,
      txHash: intent.settlementTxHash,
    } : null,
  };
}

function formatBid(bid: SolverBid) {
  return {
    solverId: bid.solverId,
    solverName: bid.solverName,
    solverAddress: bid.solverAddress,
    score: bid.bidScore,
    executionTimeMs: bid.executionTimeEstimateMs,
    profitShareBps: bid.profitShareBps,
    timestamp: bid.timestamp,
  };
}

function formatLeaderboardEntry(entry: LeaderboardEntry) {
  return {
    rank: entry.rank,
    name: entry.agentName,
    address: entry.address,
    score: entry.reputationScore,
    wins: entry.wins,
    losses: entry.losses,
    happyPathRate: entry.happyPathRate,
    totalVolume: entry.totalVolume.toString(),
    streak: entry.streak,
  };
}

function formatAgentProfile(profile: AgentProfile) {
  return {
    id: profile.id,
    name: profile.name,
    address: profile.address,
    role: profile.role,
    registered: profile.registered,
    collateral: profile.collateral.toString(),
    stats: {
      trades: profile.stats.trades,
      wins: profile.stats.wins,
      profit: profile.stats.profit.toString(),
      volume: profile.stats.volume.toString(),
    },
  };
}

function formatAmount(amount: bigint): string {
  return (Number(amount) / 1_000_000).toLocaleString();
}

export default createAPIRoutes;
