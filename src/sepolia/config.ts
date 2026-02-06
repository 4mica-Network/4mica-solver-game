/**
 * Sepolia Configuration for 4Mica Demo
 */

export const SEPOLIA_CONFIG = {
  chainId: 11155111,
  name: 'Sepolia',
  rpcUrl: process.env.SEPOLIA_RPC_URL || 'https://rpc.sepolia.org',

  // 4Mica Sepolia API endpoint
  fourMicaApiUrl: 'https://ethereum.sepolia.api.4mica.xyz/',

  // Demo accounts (use environment variables in production)
  // These are for testing only - never use real funds
  accounts: {
    // Trader accounts
    trader1: {
      name: 'Trader-1',
      privateKey: process.env.TRADER1_PRIVATE_KEY as `0x${string}` | undefined,
    },
    trader2: {
      name: 'Trader-2',
      privateKey: process.env.TRADER2_PRIVATE_KEY as `0x${string}` | undefined,
    },
    // Solver accounts
    solver1: {
      name: 'SpeedBot',
      privateKey: process.env.SOLVER1_PRIVATE_KEY as `0x${string}` | undefined,
    },
    solver2: {
      name: 'VolumeMax',
      privateKey: process.env.SOLVER2_PRIVATE_KEY as `0x${string}` | undefined,
    },
    solver3: {
      name: 'Arbitron',
      privateKey: process.env.SOLVER3_PRIVATE_KEY as `0x${string}` | undefined,
    },
  },
};

// Demo configuration
export const DEMO_CONFIG = {
  // Price simulation settings
  priceUpdateIntervalMs: 2500,
  arbitrageOpportunityChance: 0.30, // 30% chance of arbitrage opportunity
  minSpreadPercent: 2.5,
  maxSpreadPercent: 6.0,

  // Trade settings
  minTradeAmount: 3000n * 10n ** 6n, // 3000 USDC (6 decimals)
  maxTradeAmount: 8000n * 10n ** 6n, // 8000 USDC

  // Settlement method fees (in basis points) - based on real market research
  fees: {
    escrowed: 12,  // 0.12% - escrow overhead + slippage risk + 2hr settlement
    bonded: 6,     // 0.06% - matches Stargate's actual flat fee
    fourMica: 5,   // 0.05% - competitive rate with instant settlement advantage
  },

  // Yield rate (annual)
  yieldRateAnnual: 0.05, // 5% APY

  // Average trades per year (for opportunity cost calculations)
  avgTradesPerYear: 500,

  // Escrowed settlement time
  escrowedSettlementHours: 2,

  // Bonded solver bond multiplier
  bondedBondMultiple: 1.5,

  // Tab TTL in seconds
  tabTtlSeconds: 300,

  // Settlement cycle time in milliseconds
  settlementCycleMs: 30000, // 30 seconds
};

export type AccountKey = keyof typeof SEPOLIA_CONFIG.accounts;
