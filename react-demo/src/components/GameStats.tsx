/**
 * Game Stats Component
 * Shows overall game statistics and connection status
 */

import type { GameStats as Stats } from '../types';

interface GameStatsProps {
  stats: Stats | null;
  isConnected: boolean;
}

export function GameStats({ stats, isConnected }: GameStatsProps) {
  return (
    <div className="bg-game-card rounded-xl border border-game-border p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Game Stats</h2>
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              isConnected ? 'bg-game-green animate-pulse' : 'bg-game-red'
            }`}
          />
          <span className="text-xs text-gray-400">
            {isConnected ? 'Live' : 'Disconnected'}
          </span>
        </div>
      </div>

      {stats ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard
            label="Total Intents"
            value={stats.intents.total}
            color="text-white"
          />
          <StatCard
            label="Active"
            value={stats.intents.active}
            color="text-game-blue"
          />
          <StatCard
            label="Completed"
            value={stats.intents.completed}
            color="text-game-green"
          />
          <StatCard
            label="Happy Path Rate"
            value={`${stats.intents.happyPathRate.toFixed(0)}%`}
            color="text-game-green"
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="bg-game-bg rounded-lg p-4 border border-game-border animate-pulse"
            >
              <div className="h-4 bg-gray-700 rounded w-20 mb-2" />
              <div className="h-8 bg-gray-700 rounded w-16" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: number | string;
  color?: string;
}

function StatCard({ label, value, color = 'text-white' }: StatCardProps) {
  return (
    <div className="bg-game-bg rounded-lg p-4 border border-game-border">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
    </div>
  );
}

export default GameStats;
