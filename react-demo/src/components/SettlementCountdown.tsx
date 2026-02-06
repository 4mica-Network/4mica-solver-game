/**
 * Settlement Countdown Component
 * Visual timer showing the 2-minute settlement window
 */

import { useEffect, useState } from 'react';
import type { Intent } from '../types';

const TOTAL_SETTLEMENT_SECONDS = 60; // 1-minute settlement window

interface SettlementCountdownProps {
  intent: Intent;
  secondsRemaining: number;
}

export function SettlementCountdown({ intent, secondsRemaining }: SettlementCountdownProps) {
  return <CountdownCard intent={intent} secondsRemaining={secondsRemaining} />;
}

interface CountdownCardProps {
  intent: Intent;
  secondsRemaining: number;
}

function CountdownCard({ intent, secondsRemaining }: CountdownCardProps) {
  const [displayTime, setDisplayTime] = useState(secondsRemaining);

  useEffect(() => {
    setDisplayTime(secondsRemaining);
  }, [secondsRemaining]);

  const isOverdue = displayTime <= 0;
  const isCritical = displayTime > 0 && displayTime <= 10;
  const isWarning = displayTime > 10 && displayTime <= 30;

  const barColor = isOverdue
    ? 'bg-game-red'
    : isCritical
    ? 'bg-game-red'
    : isWarning
    ? 'bg-game-yellow'
    : 'bg-game-green';

  const textColor = isOverdue
    ? 'text-game-red'
    : isCritical
    ? 'text-game-red'
    : isWarning
    ? 'text-game-yellow'
    : 'text-game-green';

  const percentComplete = Math.max(0, Math.min(100, ((TOTAL_SETTLEMENT_SECONDS - displayTime) / TOTAL_SETTLEMENT_SECONDS) * 100));

  const formatTime = (seconds: number): string => {
    if (seconds < 0) return 'OVERDUE';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div
      className={`bg-game-bg rounded-lg border p-4 transition-all ${
        isCritical || isOverdue
          ? 'border-game-red animate-pulse'
          : isWarning
          ? 'border-game-yellow'
          : 'border-game-border'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Intent:</span>
          <span className="text-xs text-gray-400 font-mono">
            {intent.id.slice(0, 16)}...
          </span>
        </div>
        <span className={`text-xl font-mono font-bold ${textColor}`}>
          {formatTime(displayTime)}
        </span>
      </div>

      {/* Solver info */}
      {intent.winningSolver && (
        <div className="text-xs text-gray-400 mb-2">
          Solver: <span className="text-game-accent">{intent.winningSolver}</span>
        </div>
      )}

      {/* Progress bar */}
      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-1000 ease-linear ${barColor}`}
          style={{
            width: `${100 - percentComplete}%`,
          }}
        />
      </div>

      {isOverdue && (
        <div className="mt-2 p-2 bg-game-red/10 border border-game-red/30 rounded text-center">
          <span className="text-xs text-game-red font-medium">
            ⚠️ Unhappy path may be enforced
          </span>
        </div>
      )}
    </div>
  );
}

export default SettlementCountdown;
