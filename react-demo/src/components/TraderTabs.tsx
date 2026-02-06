import React from 'react';

interface TraderTab {
  traderId: string;
  traderAddress: string;
  traderName: string;
  intentIds: string[];
  intentCount: number;
  lockedCollateral: string;
  lockedCollateralFormatted: string;
  fourMicaDeposited?: string;
  fourMicaAvailable?: string;
  fourMicaLocked?: string;
  fourMicaTabId?: string;
  deadline: number;
  secondsRemaining: number;
  status: 'open' | 'settling' | 'settled';
}

interface TraderTabsProps {
  tabs: TraderTab[];
  totalSettlementWindow?: number;
}

const TOTAL_SETTLEMENT_SECONDS = 30;

export const TraderTabs: React.FC<TraderTabsProps> = ({
  tabs,
  totalSettlementWindow = TOTAL_SETTLEMENT_SECONDS,
}) => {
  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  const formatAmount = (amount: string) => {
    const num = Number(amount) / 1_000_000;
    return `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const getProgressPercent = (secondsRemaining: number) => {
    const elapsed = totalSettlementWindow - secondsRemaining;
    return Math.min(100, Math.max(0, (elapsed / totalSettlementWindow) * 100));
  };

  const getProgressColor = (secondsRemaining: number) => {
    const percent = getProgressPercent(secondsRemaining);
    if (percent < 50) return 'bg-green-500';
    if (percent < 75) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'open':
        return <span className="px-2 py-1 text-xs rounded-full bg-blue-500/20 text-blue-400">Open</span>;
      case 'settling':
        return <span className="px-2 py-1 text-xs rounded-full bg-yellow-500/20 text-yellow-400">Settling...</span>;
      case 'settled':
        return <span className="px-2 py-1 text-xs rounded-full bg-green-500/20 text-green-400">Settled</span>;
      default:
        return null;
    }
  };

  if (tabs.length === 0) {
    return (
      <div className="bg-gray-800 rounded-lg p-4">
        <h3 className="text-lg font-semibold mb-3 text-white flex items-center gap-2">
          <span>💰</span> Trader Tabs
        </h3>
        <p className="text-gray-400 text-sm text-center py-4">No open tabs</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <h3 className="text-lg font-semibold mb-3 text-white flex items-center gap-2">
        <span>💰</span> Trader Tabs
        <span className="text-sm font-normal text-gray-400">({tabs.length} open)</span>
      </h3>

      <div className="space-y-3 max-h-[500px] overflow-y-auto">
        {tabs.map((tab) => (
          <div
            key={tab.traderId}
            className="bg-gray-700/50 rounded-lg p-4 border border-gray-600"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">👤</span>
                <div>
                  <div className="font-medium text-white">{tab.traderName}</div>
                  <div className="text-xs text-gray-400">{formatAddress(tab.traderAddress)}</div>
                </div>
              </div>
              {getStatusBadge(tab.status)}
            </div>

            {/* Collateral Info */}
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="bg-gray-800/50 rounded p-2">
                <div className="text-xs text-gray-400">Locked Collateral</div>
                <div className="text-lg font-bold text-white">{tab.lockedCollateralFormatted}</div>
              </div>
              <div className="bg-gray-800/50 rounded p-2">
                <div className="text-xs text-gray-400">Open Intents</div>
                <div className="text-lg font-bold text-white">{tab.intentCount}</div>
              </div>
            </div>

            {/* 4Mica Data (if available) */}
            {tab.fourMicaDeposited && (
              <div className="bg-purple-900/20 border border-purple-500/30 rounded p-2 mb-3">
                <div className="text-xs text-purple-400 mb-1 flex items-center gap-1">
                  <span>⚡</span> 4Mica Account
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <span className="text-gray-400">Deposited:</span>
                    <span className="text-white ml-1">{formatAmount(tab.fourMicaDeposited)}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">Available:</span>
                    <span className="text-green-400 ml-1">{formatAmount(tab.fourMicaAvailable || '0')}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">Locked:</span>
                    <span className="text-yellow-400 ml-1">{formatAmount(tab.fourMicaLocked || '0')}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Countdown Timer */}
            <div className="mt-2">
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-400">Time to settle</span>
                <span className={`font-mono font-bold ${
                  tab.secondsRemaining <= 10 ? 'text-red-400' :
                  tab.secondsRemaining <= 30 ? 'text-yellow-400' : 'text-green-400'
                }`}>
                  {tab.secondsRemaining}s
                </span>
              </div>
              <div className="h-2 bg-gray-600 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 ${getProgressColor(tab.secondsRemaining)}`}
                  style={{ width: `${getProgressPercent(tab.secondsRemaining)}%` }}
                />
              </div>
            </div>

            {/* Intent IDs (expandable) */}
            {tab.intentIds.length > 0 && (
              <details className="mt-2">
                <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-300">
                  View {tab.intentCount} intent{tab.intentCount > 1 ? 's' : ''} in tab
                </summary>
                <div className="mt-1 pl-2 text-xs text-gray-500 max-h-20 overflow-y-auto">
                  {tab.intentIds.map((id) => (
                    <div key={id} className="font-mono truncate">{id}</div>
                  ))}
                </div>
              </details>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default TraderTabs;
