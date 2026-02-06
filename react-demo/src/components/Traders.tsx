/**
 * Traders Component
 * Shows all traders with their profit and 4Mica collateral info
 * Traders are always visible, not just when tabs are open
 */

import React from 'react';

export interface TraderInfo {
  traderId: string;
  traderAddress: string;
  // Profit from executed intents
  totalProfit: number;
  completedIntents: number;
  // 4Mica Collateral (from API)
  collateral: {
    deposited: string;
    available: string;
    locked: string;
  } | null;
  // Active tab info (if any)
  activeTab?: {
    intentCount: number;
    secondsRemaining: number;
    status: 'open' | 'settling' | 'settled';
  };
}

interface TradersProps {
  traders: TraderInfo[];
}

export const Traders: React.FC<TradersProps> = ({ traders }) => {
  const formatAddress = (address: string) => {
    if (!address || address.length < 10) return address;
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const formatAmount = (amount: string | undefined) => {
    if (!amount) return '$0.00';
    const num = Number(amount) / 1_000_000;
    return `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatProfit = (profit: number) => {
    const prefix = profit >= 0 ? '+' : '';
    return `${prefix}$${Math.abs(profit).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  return (
    <div className="bg-game-card rounded-xl border border-game-border p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <span>👥</span> Traders
        </h2>
        <span className="text-xs text-gray-500">{traders.length} registered</span>
      </div>

      {traders.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <div className="text-4xl mb-2">👤</div>
          <p>No traders registered</p>
        </div>
      ) : (
        <div className="space-y-4">
          {traders.map((trader) => (
            <div
              key={trader.traderId}
              className="bg-game-bg rounded-lg p-4 border border-game-border"
            >
              {/* Header: Name & Address */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xl">👤</span>
                  <div>
                    <div className="font-medium text-white">{trader.traderId}</div>
                    <div className="text-xs text-gray-500 font-mono">
                      {formatAddress(trader.traderAddress)}
                    </div>
                  </div>
                </div>
                {/* Active Tab Badge */}
                {trader.activeTab && (
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-1 text-xs rounded-full bg-yellow-500/20 text-yellow-400">
                      {trader.activeTab.secondsRemaining}s
                    </span>
                    <span className="px-2 py-1 text-xs rounded-full bg-blue-500/20 text-blue-400">
                      {trader.activeTab.intentCount} intents
                    </span>
                  </div>
                )}
              </div>

              {/* Profit & Stats */}
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="bg-game-card rounded-lg p-3">
                  <div className="text-xs text-gray-400 mb-1">Profit</div>
                  <div className={`text-lg font-bold ${trader.totalProfit >= 0 ? 'text-game-green' : 'text-game-red'}`}>
                    {formatProfit(trader.totalProfit)}
                  </div>
                </div>
                <div className="bg-game-card rounded-lg p-3">
                  <div className="text-xs text-gray-400 mb-1">Completed</div>
                  <div className="text-lg font-bold text-white">
                    {trader.completedIntents} intents
                  </div>
                </div>
              </div>

              {/* 4Mica Collateral - Clean Display */}
              <div className="bg-purple-900/20 border border-purple-500/30 rounded-lg p-3">
                <div className="text-xs text-purple-400 mb-2 flex items-center gap-1">
                  <span>⚡</span> 4Mica Collateral
                </div>
                {trader.collateral ? (
                  <div className="grid grid-cols-3 gap-2">
                    <div className="text-center">
                      <div className="text-xs text-gray-400 mb-1">Total</div>
                      <div className="text-sm font-bold text-white">
                        {formatAmount(trader.collateral.deposited)}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-gray-400 mb-1">Available</div>
                      <div className="text-sm font-bold text-game-green">
                        {formatAmount(trader.collateral.available)}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-xs text-gray-400 mb-1">Locked</div>
                      <div className="text-sm font-bold text-yellow-400">
                        {formatAmount(trader.collateral.locked)}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-gray-500 text-sm py-2">
                    Loading collateral data...
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Traders;
