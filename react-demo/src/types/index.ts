/**
 * Type definitions for 4Mica × Agent0 Dashboard
 */

// =============================================================================
// Price Types
// =============================================================================

export interface PriceData {
  alphaPrice: string;
  betaPrice: string;
  spreadBps: number;
  direction: 'ALPHA_TO_BETA' | 'BETA_TO_ALPHA' | 'NONE';
  timestamp: number;
}

// =============================================================================
// Intent Types
// =============================================================================

export type IntentStatus =
  | 'pending'
  | 'claimed'
  | 'executing'
  | 'settling'
  | 'completed'
  | 'defaulted'
  | 'cancelled';

export interface Intent {
  id: string;
  traderId: string;
  traderAddress: string;
  amount: string;
  direction: 'ALPHA_TO_BETA' | 'BETA_TO_ALPHA';
  spreadBps: number;
  status: IntentStatus;
  createdAt: number;
  deadline?: number;
  hasFourMicaGuarantee: boolean;
  bids: SolverBid[];
  winningSolver?: string;
  txHash?: string;
}

export interface SolverBid {
  solverId: string;
  solverName: string;
  bidScore: number;
  timestamp: number;
}

// =============================================================================
// Settlement Types
// =============================================================================

export interface SettlementCountdown {
  intentId: string;
  secondsRemaining: number;
  totalSeconds: number;
  percentComplete: number;
}

// =============================================================================
// Leaderboard Types
// =============================================================================

export interface LeaderboardEntry {
  rank: number;
  name: string;
  address: string;
  score: number;
  wins: number;
  losses: number;
  happyPathRate: number;
  totalVolume: string;
  streak: number;
}

// =============================================================================
// Agent Types
// =============================================================================

export interface Agent {
  id: string;
  name: string;
  address: string;
  role: 'trader' | 'solver';
  registered: boolean;
  collateral: string;
  stats: {
    trades: number;
    wins: number;
    profit: string;
    volume: string;
  };
}

// =============================================================================
// WebSocket Types
// =============================================================================

export type WSEventType =
  | 'price:update'
  | 'intent:created'
  | 'intent:bid'
  | 'intent:claimed'
  | 'intent:executing'
  | 'intent:executed'
  | 'settlement:countdown'
  | 'settlement:happy'
  | 'settlement:unhappy'
  | 'leaderboard:update'
  | 'agent:registered'
  | 'stats:update'
  | 'tab:updated'
  | 'tab:countdown'
  | 'tab:settled'
  | 'tab:collateralUpdate'
  | 'error';

export interface WSMessage<T = unknown> {
  type: WSEventType;
  data: T;
  timestamp: number;
}

// =============================================================================
// Stats Types
// =============================================================================

export interface GameStats {
  intents: {
    total: number;
    pending: number;
    active: number;
    completed: number;
    defaulted: number;
    happyPathRate: number;
  };
  settlements: {
    activeCount: number;
    overdueCount: number;
    avgRemainingSeconds: number;
  };
  currentSpread: number;
  hasOpportunity: boolean;
}
