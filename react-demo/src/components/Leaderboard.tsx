/**
 * Leaderboard Component
 * Displays solver rankings based on Agent0 reputation scores
 */

import type { LeaderboardEntry } from '../types';

// Extended type to handle backend response format
interface BackendLeaderboardEntry {
  rank: number;
  agentName?: string;
  name?: string;
  address: string;
  reputationScore?: number;
  score?: number;
  wins: number;
  losses?: number;
  happyPathRate?: number;
  totalVolume?: string | bigint;
  streak?: number;
}

interface LeaderboardProps {
  entries: (LeaderboardEntry | BackendLeaderboardEntry)[];
  loading?: boolean;
}

// Helper to normalize entry data from different formats
function normalizeEntry(entry: LeaderboardEntry | BackendLeaderboardEntry): LeaderboardEntry {
  return {
    rank: entry.rank ?? 0,
    name: entry.name || (entry as BackendLeaderboardEntry).agentName || 'Unknown',
    address: entry.address || '0x',
    score: entry.score ?? (entry as BackendLeaderboardEntry).reputationScore ?? 0,
    wins: entry.wins ?? 0,
    losses: entry.losses ?? 0,
    happyPathRate: entry.happyPathRate ?? 0,
    totalVolume: typeof entry.totalVolume === 'bigint'
      ? entry.totalVolume.toString()
      : entry.totalVolume ?? '0',
    streak: entry.streak ?? 0,
  };
}

export function Leaderboard({ entries, loading }: LeaderboardProps) {
  const getMedal = (rank: number) => {
    switch (rank) {
      case 1:
        return '🥇';
      case 2:
        return '🥈';
      case 3:
        return '🥉';
      default:
        return `#${rank}`;
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 90) return 'text-game-green';
    if (score >= 75) return 'text-game-yellow';
    if (score >= 50) return 'text-game-blue';
    return 'text-gray-400';
  };

  const formatVolume = (volume: string) => {
    // volume is in micro-units (1,000,000 = $1), convert to dollars
    const dollars = parseFloat(volume) / 1_000_000;
    if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
    if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(1)}K`;
    if (dollars >= 1) return `$${dollars.toFixed(0)}`;
    return `$${dollars.toFixed(2)}`;
  };

  return (
    <div className="bg-game-card rounded-xl border border-game-border p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Solver Leaderboard</h2>
        <span className="text-xs text-gray-500">Ranked by Reputation</span>
      </div>

      {loading ? (
        <div className="text-center py-8 text-gray-500">
          <div className="animate-spin text-2xl mb-2">⟳</div>
          <p>Loading leaderboard...</p>
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <div className="text-4xl mb-2">🏆</div>
          <p>No solver data yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((rawEntry) => {
            const entry = normalizeEntry(rawEntry);
            return (
            <div
              key={entry.address}
              className={`flex items-center gap-3 p-3 rounded-lg transition-all ${
                entry.rank <= 3
                  ? 'bg-game-accent/10 border border-game-accent/30'
                  : 'bg-game-bg border border-game-border'
              }`}
            >
              {/* Rank */}
              <div className="w-10 text-center text-xl">{getMedal(entry.rank)}</div>

              {/* Name & Address */}
              <div className="flex-1 min-w-0">
                <div className="font-medium text-white truncate">{entry.name}</div>
                <div className="text-xs text-gray-500 font-mono truncate">
                  {entry.address.slice(0, 10)}...{entry.address.slice(-6)}
                </div>
              </div>

              {/* Stats */}
              <div className="hidden sm:flex items-center gap-4 text-xs">
                <div className="text-center">
                  <div className="text-gray-500">Wins</div>
                  <div className="text-white font-medium">{entry.wins}</div>
                </div>
                <div className="text-center">
                  <div className="text-gray-500">Happy %</div>
                  <div className="text-game-green font-medium">
                    {entry.happyPathRate.toFixed(0)}%
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-gray-500">Volume</div>
                  <div className="text-white font-medium">
                    ${formatVolume(entry.totalVolume)}
                  </div>
                </div>
              </div>

              {/* Score */}
              <div className="text-right">
                <div className={`text-xl font-bold ${getScoreColor(entry.score)}`}>
                  {entry.score.toFixed(1)}
                </div>
                <div className="text-xs text-gray-500">score</div>
              </div>

              {/* Streak indicator */}
              {entry.streak > 0 && (
                <div className="flex items-center gap-1 px-2 py-1 bg-game-green/20 rounded text-xs text-game-green">
                  🔥 {entry.streak}
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}

      {/* Scoring explanation */}
      <div className="mt-4 pt-4 border-t border-game-border">
        <div className="text-xs text-gray-500">
          Score = 40% feedback + 30% happy path rate + 20% experience + 10% streak
        </div>
      </div>
    </div>
  );
}

export default Leaderboard;
