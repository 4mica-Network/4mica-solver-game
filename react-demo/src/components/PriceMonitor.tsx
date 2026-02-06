/**
 * Price Monitor Component
 * Displays real-time AMM prices and spread indicator
 */

import { useState, useEffect } from 'react';
import type { PriceData } from '../types';

interface PriceMonitorProps {
  priceData: PriceData | null;
  priceHistory?: PriceData[];
}

export function PriceMonitor({ priceData }: PriceMonitorProps) {
  const [flash, setFlash] = useState<'alpha' | 'beta' | null>(null);

  useEffect(() => {
    if (priceData) {
      // Flash effect on price change
      if (priceData.direction === 'ALPHA_TO_BETA') {
        setFlash('alpha');
      } else if (priceData.direction === 'BETA_TO_ALPHA') {
        setFlash('beta');
      }
      const timer = setTimeout(() => setFlash(null), 500);
      return () => clearTimeout(timer);
    }
  }, [priceData?.timestamp]);

  const spreadColor = priceData
    ? priceData.spreadBps >= 50
      ? 'text-game-green'
      : priceData.spreadBps >= 25
      ? 'text-game-yellow'
      : 'text-gray-400'
    : 'text-gray-500';

  const hasOpportunity = priceData && priceData.direction !== 'NONE';

  return (
    <div className="bg-game-card rounded-xl border border-game-border p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Price Monitor</h2>
        {hasOpportunity && (
          <span className="px-2 py-1 bg-game-green/20 text-game-green text-xs font-medium rounded-full animate-pulse">
            OPPORTUNITY
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        {/* AMM Alpha */}
        <div
          className={`p-4 rounded-lg bg-game-bg border transition-all duration-300 ${
            flash === 'alpha' ? 'border-game-blue' : 'border-game-border'
          }`}
        >
          <div className="text-sm text-gray-400 mb-1">AMM-Alpha</div>
          <div className="text-2xl font-mono font-bold text-white">
            {priceData?.alphaPrice || '-.------'}
          </div>
          <div className="text-xs text-gray-500 mt-1">USDC/USDT</div>
        </div>

        {/* AMM Beta */}
        <div
          className={`p-4 rounded-lg bg-game-bg border transition-all duration-300 ${
            flash === 'beta' ? 'border-game-green' : 'border-game-border'
          }`}
        >
          <div className="text-sm text-gray-400 mb-1">AMM-Beta</div>
          <div className="text-2xl font-mono font-bold text-white">
            {priceData?.betaPrice || '-.------'}
          </div>
          <div className="text-xs text-gray-500 mt-1">USDC/USDT</div>
        </div>
      </div>

      {/* Spread Indicator */}
      <div className="bg-game-bg rounded-lg p-4 border border-game-border">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-400">Spread</span>
          <span className={`text-xl font-mono font-bold ${spreadColor}`}>
            {priceData ? `${priceData.spreadBps} bps` : '-- bps'}
          </span>
        </div>

        {/* Spread bar */}
        <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              priceData && priceData.spreadBps >= 50
                ? 'bg-game-green'
                : priceData && priceData.spreadBps >= 25
                ? 'bg-game-yellow'
                : 'bg-gray-600'
            }`}
            style={{
              width: `${Math.min(100, (priceData?.spreadBps || 0) / 1)}%`,
            }}
          />
        </div>

        <div className="flex justify-between mt-1 text-xs text-gray-500">
          <span>0 bps</span>
          <span className="text-game-yellow">25 bps</span>
          <span className="text-game-green">50+ bps</span>
          <span>100 bps</span>
        </div>
      </div>

      {/* Direction indicator */}
      {hasOpportunity && priceData && (
        <div className="mt-4 p-3 bg-game-green/10 border border-game-green/30 rounded-lg">
          <div className="flex items-center gap-2">
            <span className="text-game-green text-lg">→</span>
            <span className="text-sm text-game-green">
              {priceData.direction === 'ALPHA_TO_BETA'
                ? 'Buy on Alpha, Sell on Beta'
                : 'Buy on Beta, Sell on Alpha'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export default PriceMonitor;
