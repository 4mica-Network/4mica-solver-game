/**
 * Intent Feed Component
 * Displays active trade intents with their status and 4Mica guarantee info
 */

import type { Intent } from '../types';

interface IntentFeedProps {
  intents: Intent[];
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-500/20 text-yellow-400',
  claimed: 'bg-blue-500/20 text-blue-400',
  executing: 'bg-purple-500/20 text-purple-400',
  settling: 'bg-orange-500/20 text-orange-400',
  completed: 'bg-green-500/20 text-green-400',
  defaulted: 'bg-red-500/20 text-red-400',
  cancelled: 'bg-gray-500/20 text-gray-400',
};

function formatAmount(amount: string): string {
  const num = parseFloat(amount) / 1_000_000; // USDC has 6 decimals
  return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

const MAX_VISIBLE_INTENTS = 10;

export function IntentFeed({ intents }: IntentFeedProps) {
  // Sort by createdAt descending (most recent first)
  const sortedIntents = [...intents].sort((a, b) => b.createdAt - a.createdAt);

  const activeIntents = sortedIntents.filter((i) =>
    ['pending', 'claimed', 'executing', 'settling'].includes(i.status)
  );
  const recentIntents = sortedIntents
    .filter((i) => ['completed', 'defaulted'].includes(i.status));

  const totalCount = activeIntents.length + recentIntents.length;

  return (
    <div className="bg-game-card rounded-xl border border-game-border p-6 flex flex-col" style={{ maxHeight: '600px' }}>
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <h2 className="text-lg font-semibold text-white">Intent Feed</h2>
        <span className="text-sm text-gray-400">
          {activeIntents.length} active{totalCount > MAX_VISIBLE_INTENTS && ` · ${totalCount} total`}
        </span>
      </div>

      {activeIntents.length === 0 && recentIntents.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <div className="text-4xl mb-2">📋</div>
          <p>Waiting for arbitrage opportunities...</p>
        </div>
      ) : (
        <div className="space-y-3 overflow-y-auto flex-1 pr-2" style={{ scrollbarWidth: 'thin' }}>
          {/* Active Intents */}
          {activeIntents.map((intent) => (
            <IntentCard key={intent.id} intent={intent} />
          ))}

          {/* Recent completed */}
          {recentIntents.length > 0 && (
            <>
              <div className="text-xs text-gray-500 uppercase tracking-wide pt-2 sticky top-0 bg-game-card">
                Recent ({recentIntents.length})
              </div>
              {recentIntents.map((intent) => (
                <IntentCard key={intent.id} intent={intent} compact />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface IntentCardProps {
  intent: Intent;
  compact?: boolean;
}

function IntentCard({ intent, compact }: IntentCardProps) {
  const statusClass = STATUS_COLORS[intent.status] || STATUS_COLORS.pending;
  const amountFormatted = formatAmount(intent.amount);

  if (compact) {
    return (
      <div className="flex items-center justify-between p-2 bg-game-bg rounded-lg border border-game-border opacity-60">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusClass}`}>
            {intent.status}
          </span>
          <span className="text-sm text-gray-400">{amountFormatted} USDC</span>
        </div>
        {intent.status === 'completed' && (
          <span className="text-xs text-game-green">✓ Happy</span>
        )}
        {intent.status === 'defaulted' && (
          <span className="text-xs text-game-red">✗ Unhappy</span>
        )}
      </div>
    );
  }

  return (
    <div className="bg-game-bg rounded-lg border border-game-border p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`px-2 py-1 rounded text-xs font-medium ${statusClass}`}>
            {intent.status.toUpperCase()}
          </span>
          <span className="text-xs text-gray-500 font-mono">
            {intent.id.slice(0, 16)}...
          </span>
        </div>
        {intent.hasFourMicaGuarantee && (
          <span className="flex items-center gap-1 text-xs text-game-green">
            <span>🔒</span> 4Mica Verified
          </span>
        )}
      </div>

      {/* Details */}
      <div className="grid grid-cols-2 gap-4 mb-3">
        <div>
          <div className="text-xs text-gray-500">Amount</div>
          <div className="text-lg font-semibold text-white">
            {amountFormatted} <span className="text-sm text-gray-400">USDC</span>
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500">Spread</div>
          <div className="text-lg font-semibold text-game-green">
            {intent.spreadBps} <span className="text-sm text-gray-400">bps</span>
          </div>
        </div>
      </div>

      {/* Direction */}
      <div className="text-xs text-gray-400 mb-3">
        {intent.direction === 'ALPHA_TO_BETA'
          ? '→ Buy Alpha, Sell Beta'
          : '→ Buy Beta, Sell Alpha'}
      </div>

      {/* Solver info */}
      {intent.winningSolver && (
        <div className="flex items-center gap-2 pt-3 border-t border-game-border">
          <span className="text-xs text-gray-500">Solver:</span>
          <span className="text-sm text-game-accent">{intent.winningSolver}</span>
        </div>
      )}

      {/* Bids (if pending) */}
      {intent.status === 'pending' && intent.bids.length > 0 && (
        <div className="mt-3 pt-3 border-t border-game-border">
          <div className="text-xs text-gray-500 mb-2">Bids ({intent.bids.length})</div>
          <div className="space-y-1">
            {intent.bids.slice(0, 3).map((bid) => (
              <div
                key={bid.solverId}
                className="flex items-center justify-between text-xs"
              >
                <span className="text-gray-300">{bid.solverName}</span>
                <span className="text-game-accent">Score: {bid.bidScore}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default IntentFeed;
