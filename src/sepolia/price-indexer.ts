/**
 * Price Indexer for 4Mica × Agent0 Competitive Solver Game
 *
 * Polls prices from both AMMs (Alpha and Beta) and detects arbitrage opportunities.
 * Emits events when price spreads exceed the configured threshold.
 */

import { createPublicClient, http, type Address, formatUnits } from 'viem';
import { sepolia } from 'viem/chains';
import { EventEmitter } from 'events';

// =============================================================================
// Types
// =============================================================================

export interface PriceData {
  alphaPrice: bigint;
  betaPrice: bigint;
  alphaPriceFormatted: string;
  betaPriceFormatted: string;
  spreadBps: number;
  direction: 'ALPHA_TO_BETA' | 'BETA_TO_ALPHA' | 'NONE';
  timestamp: number;
}

export interface ArbitrageOpportunity {
  id: string;
  direction: 'ALPHA_TO_BETA' | 'BETA_TO_ALPHA';
  spreadBps: number;
  buyAmmAddress: Address;
  sellAmmAddress: Address;
  expectedProfit: bigint;
  timestamp: number;
}

export interface PriceIndexerConfig {
  rpcUrl: string;
  ammAlphaAddress: Address;
  ammBetaAddress: Address;
  usdcAddress: Address;
  usdtAddress: Address;
  pollIntervalMs: number;
  spreadThresholdBps: number;
}

// =============================================================================
// SimpleAMM ABI (minimal for price queries)
// =============================================================================

const SIMPLE_AMM_ABI = [
  {
    type: 'function',
    name: 'getPrice',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'reserveA',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'reserveB',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getAmountOut',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'reserveIn', type: 'uint256' },
      { name: 'reserveOut', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'pure',
  },
] as const;

// =============================================================================
// Price Indexer Class
// =============================================================================

export class PriceIndexer extends EventEmitter {
  private config: PriceIndexerConfig;
  private publicClient: ReturnType<typeof createPublicClient>;
  private pollInterval: NodeJS.Timeout | null = null;
  private lastPriceData: PriceData | null = null;
  private priceHistory: PriceData[] = [];
  private readonly maxHistoryLength = 300; // 5 minutes at 1s intervals

  constructor(config: PriceIndexerConfig) {
    super();
    this.config = config;
    this.publicClient = createPublicClient({
      chain: sepolia,
      transport: http(config.rpcUrl),
    });
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Start polling prices
   */
  start(): void {
    if (this.pollInterval) {
      console.log('[PriceIndexer] Already running');
      return;
    }

    console.log(`[PriceIndexer] Starting price polling (every ${this.config.pollIntervalMs}ms)`);
    console.log(`[PriceIndexer] AMM-Alpha: ${this.config.ammAlphaAddress}`);
    console.log(`[PriceIndexer] AMM-Beta: ${this.config.ammBetaAddress}`);
    console.log(`[PriceIndexer] Spread threshold: ${this.config.spreadThresholdBps} bps`);

    // Initial poll
    this.pollPrices();

    // Start interval
    this.pollInterval = setInterval(() => {
      this.pollPrices();
    }, this.config.pollIntervalMs);
  }

  /**
   * Stop polling prices
   */
  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
      console.log('[PriceIndexer] Stopped');
    }
  }

  /**
   * Check if indexer is running
   */
  isRunning(): boolean {
    return this.pollInterval !== null;
  }

  // ===========================================================================
  // Price Queries
  // ===========================================================================

  /**
   * Poll prices from both AMMs
   */
  private async pollPrices(): Promise<void> {
    try {
      // Fetch prices from both AMMs in parallel
      const [alphaPrice, betaPrice] = await Promise.all([
        this.getAmmPrice(this.config.ammAlphaAddress),
        this.getAmmPrice(this.config.ammBetaAddress),
      ]);

      // Calculate spread in basis points
      const spreadBps = this.calculateSpreadBps(alphaPrice, betaPrice);

      // Determine direction
      let direction: PriceData['direction'] = 'NONE';
      if (spreadBps >= this.config.spreadThresholdBps) {
        direction = alphaPrice > betaPrice ? 'BETA_TO_ALPHA' : 'ALPHA_TO_BETA';
      }

      const priceData: PriceData = {
        alphaPrice,
        betaPrice,
        alphaPriceFormatted: this.formatPrice(alphaPrice),
        betaPriceFormatted: this.formatPrice(betaPrice),
        spreadBps,
        direction,
        timestamp: Date.now(),
      };

      this.lastPriceData = priceData;
      this.addToHistory(priceData);

      // Emit price update event
      this.emit('price:update', priceData);

      // Check for arbitrage opportunity
      if (direction !== 'NONE') {
        const opportunity = this.createOpportunity(priceData);
        this.emit('arbitrage:detected', opportunity);
      }

    } catch (error) {
      console.error('[PriceIndexer] Error polling prices:', error);
      this.emit('error', error);
    }
  }

  /**
   * Get price from a single AMM
   */
  private async getAmmPrice(ammAddress: Address): Promise<bigint> {
    try {
      const price = await this.publicClient.readContract({
        address: ammAddress,
        abi: SIMPLE_AMM_ABI,
        functionName: 'getPrice',
      });
      return price as bigint;
    } catch (error) {
      // If getPrice fails, calculate from reserves
      const [reserveA, reserveB] = await Promise.all([
        this.publicClient.readContract({
          address: ammAddress,
          abi: SIMPLE_AMM_ABI,
          functionName: 'reserveA',
        }),
        this.publicClient.readContract({
          address: ammAddress,
          abi: SIMPLE_AMM_ABI,
          functionName: 'reserveB',
        }),
      ]);

      // Price = reserveB / reserveA (in 6 decimal precision)
      const rA = reserveA as bigint;
      const rB = reserveB as bigint;
      if (rA === 0n) return 1_000000n; // Default 1:1
      return (rB * 1_000000n) / rA;
    }
  }

  /**
   * Get AMM reserves
   */
  async getReserves(ammAddress: Address): Promise<{ reserveA: bigint; reserveB: bigint }> {
    const [reserveA, reserveB] = await Promise.all([
      this.publicClient.readContract({
        address: ammAddress,
        abi: SIMPLE_AMM_ABI,
        functionName: 'reserveA',
      }),
      this.publicClient.readContract({
        address: ammAddress,
        abi: SIMPLE_AMM_ABI,
        functionName: 'reserveB',
      }),
    ]);

    return {
      reserveA: reserveA as bigint,
      reserveB: reserveB as bigint,
    };
  }

  // ===========================================================================
  // Calculations
  // ===========================================================================

  /**
   * Calculate spread in basis points
   */
  private calculateSpreadBps(priceA: bigint, priceB: bigint): number {
    if (priceA === 0n || priceB === 0n) return 0;

    const higher = priceA > priceB ? priceA : priceB;
    const lower = priceA > priceB ? priceB : priceA;

    // spreadBps = ((higher - lower) / lower) * 10000
    const spreadBps = Number(((higher - lower) * 10000n) / lower);
    return spreadBps;
  }

  /**
   * Format price for display (6 decimals)
   */
  private formatPrice(price: bigint): string {
    return formatUnits(price, 6);
  }

  /**
   * Create arbitrage opportunity object
   */
  private createOpportunity(priceData: PriceData): ArbitrageOpportunity {
    const isBuyAlpha = priceData.direction === 'BETA_TO_ALPHA';

    return {
      id: `arb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      direction: priceData.direction as 'ALPHA_TO_BETA' | 'BETA_TO_ALPHA',
      spreadBps: priceData.spreadBps,
      buyAmmAddress: isBuyAlpha ? this.config.ammAlphaAddress : this.config.ammBetaAddress,
      sellAmmAddress: isBuyAlpha ? this.config.ammBetaAddress : this.config.ammAlphaAddress,
      expectedProfit: this.estimateProfit(priceData),
      timestamp: priceData.timestamp,
    };
  }

  /**
   * Estimate potential profit from arbitrage
   */
  private estimateProfit(priceData: PriceData): bigint {
    // Simple estimate: 1000 USDC trade * spread - fees
    const tradeSize = 1000_000000n; // 1000 USDC
    const grossProfit = (tradeSize * BigInt(priceData.spreadBps)) / 10000n;
    const fees = (tradeSize * 60n) / 10000n; // ~0.6% total fees (2 swaps)
    return grossProfit > fees ? grossProfit - fees : 0n;
  }

  // ===========================================================================
  // History Management
  // ===========================================================================

  private addToHistory(priceData: PriceData): void {
    this.priceHistory.push(priceData);
    if (this.priceHistory.length > this.maxHistoryLength) {
      this.priceHistory.shift();
    }
  }

  // ===========================================================================
  // Public Getters
  // ===========================================================================

  /**
   * Get last price data
   */
  getLastPrice(): PriceData | null {
    return this.lastPriceData;
  }

  /**
   * Get price history
   */
  getPriceHistory(limit?: number): PriceData[] {
    if (limit) {
      return this.priceHistory.slice(-limit);
    }
    return [...this.priceHistory];
  }

  /**
   * Get current spread
   */
  getCurrentSpread(): number {
    return this.lastPriceData?.spreadBps || 0;
  }

  /**
   * Check if there's an active arbitrage opportunity
   */
  hasOpportunity(): boolean {
    return this.lastPriceData?.direction !== 'NONE';
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createPriceIndexer(config: PriceIndexerConfig): PriceIndexer {
  return new PriceIndexer(config);
}

export default PriceIndexer;
