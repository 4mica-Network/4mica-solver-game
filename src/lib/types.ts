/**
 * Type definitions for the 4Mica Arbitrage Demo
 */

import type { Address, Hash } from 'viem';

// Token types
export interface TokenInfo {
  address: Address;
  symbol: string;
  decimals: number;
}

// AMM types
export interface AMMState {
  tokenA: Address;
  tokenB: Address;
  reserveA: bigint;
  reserveB: bigint;
  price: bigint; // Price of tokenA in terms of tokenB (scaled by 1e18)
}

export interface SwapQuote {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  amountOut: bigint;
  priceImpact: number; // Percentage
}

// 4Mica types
export interface UserCollateral {
  total: bigint;
  locked: bigint;
  available: bigint;
  withdrawalRequestAmount: bigint;
  withdrawalRequestTimestamp: bigint;
}

export interface Tab {
  tabId: bigint;
  user: Address;
  recipient: Address;
  asset: Address;
  startTimestamp: bigint;
  ttlSeconds: bigint;
  totalPaid: bigint;
  settled: boolean;
  active: boolean;
}

export interface Guarantee {
  tabId: bigint;
  reqId: bigint;
  user: Address;
  recipient: Address;
  asset: Address;
  amount: bigint;
  timestamp: bigint;
  signature: `0x${string}`;
  claimed: boolean;
}

// Arbitrage types
export interface ArbitrageOpportunity {
  id: string;
  timestamp: number;
  sourceChain: string;
  targetChain: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  expectedProfit: bigint;
  spreadBps: number; // Basis points
  sourcePriceUsd: number;
  targetPriceUsd: number;
}

export interface TradeIntent {
  id: string;
  traderId: string;
  opportunity: ArbitrageOpportunity;
  maxSlippageBps: number;
  deadline: number;
  status: 'pending' | 'matched' | 'executing' | 'completed' | 'failed';
  createdAt: number;
}

export interface SolverBid {
  solverId: string;
  intentId: string;
  executionPrice: bigint;
  gasEstimate: bigint;
  expectedSettlementTime: number;
  reputation: number;
}

export interface ExecutionResult {
  intentId: string;
  solverId: string;
  solverAddress: string;  // For trading agent to pay settlement
  success: boolean;
  actualProfit: bigint;
  gasUsed: bigint;
  executionTime: number;
  txHashes: {
    sourceChain: Hash;
    targetChain: Hash;
    settlement?: Hash;
  };
  error?: string;
}

// Agent types
export interface TradingAgentState {
  id: string;
  address: Address;
  balances: {
    'l2-alpha': { usdc: bigint; usdt: bigint };
    'l2-beta': { usdc: bigint; usdt: bigint };
  };
  activeIntents: TradeIntent[];
  completedTrades: number;
  totalProfit: bigint;
}

export interface SolverAgentState {
  id: string;
  address: Address;
  liquidity: {
    'l2-alpha': { usdc: bigint; usdt: bigint };
    'l2-beta': { usdc: bigint; usdt: bigint };
  };
  collateral: {
    'l2-alpha': UserCollateral;
    'l2-beta': UserCollateral;
  };
  activeTabs: Tab[];
  reputation: number;
  executedTrades: number;
  successRate: number;
}

// Event types
export type DemoEvent =
  | { type: 'price_update'; chain: string; price: bigint; reserveA: bigint; reserveB: bigint }
  | { type: 'opportunity_detected'; opportunity: ArbitrageOpportunity }
  | { type: 'intent_created'; intent: TradeIntent }
  | { type: 'solver_bid'; bid: SolverBid }
  | { type: 'execution_started'; intentId: string; solverId: string }
  | { type: 'execution_completed'; result: ExecutionResult }
  | { type: 'collateral_deposited'; user: Address; asset: Address; amount: bigint }
  | { type: 'tab_created'; tab: Tab }
  | { type: 'guarantee_issued'; tabId: bigint; reqId: bigint; amount: bigint }
  | { type: 'guarantee_claimed'; tabId: bigint; reqId: bigint; amount: bigint }
  | { type: 'solver_liquidity_rebalanced'; solverId: string; chain: string; amount: bigint };

// Configuration types
export interface DeployedContracts {
  usdc: Address;
  usdt: Address;
  amm: Address;
  core4Mica: Address;
}

export interface Deployments {
  'l2-alpha': DeployedContracts;
  'l2-beta': DeployedContracts;
}
