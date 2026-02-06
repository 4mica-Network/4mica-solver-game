/**
 * Main App Component
 * Dashboard layout integrating all game components
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { PriceMonitor } from './components/PriceMonitor';
import { IntentFeed } from './components/IntentFeed';
import { Traders, type TraderInfo } from './components/Traders';
import { Leaderboard } from './components/Leaderboard';
import { GameStats } from './components/GameStats';
import type {
  PriceData,
  Intent,
  LeaderboardEntry,
  GameStats as GameStatsType,
  WSMessage,
} from './types';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3001';
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

// Trader Tab type for the frontend
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

// Trader collateral from 4Mica API
interface TraderCollateral {
  deposited: string;
  available: string;
  locked: string;
}

// Known traders (configured in backend)
const KNOWN_TRADERS = [
  { id: 'Trader-SpreadHawk', address: '' },
  { id: 'Trader-DeepScan', address: '' },
];

// Calculate profit from an intent (simplified: positive spread = profit)
function calculateIntentProfit(intent: Intent): number {
  if (intent.status !== 'completed') return 0;
  // Profit estimate based on spread and amount
  // Note: intent.amount is in micro-units (1,000,000 = $1 USDC), so divide by 1e6
  const amountInMicroUnits = parseFloat(intent.amount) || 0;
  const amountInDollars = amountInMicroUnits / 1_000_000;
  const spreadPercent = (intent.spreadBps || 0) / 10000;
  return amountInDollars * spreadPercent;
}

export function App() {
  // State
  const [priceData, setPriceData] = useState<PriceData | null>(null);
  const [intents, setIntents] = useState<Map<string, Intent>>(new Map());
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [gameStats, setGameStats] = useState<GameStatsType | null>(null);
  const [traderTabs, setTraderTabs] = useState<Map<string, TraderTab>>(new Map());
  const [traderCollateral, setTraderCollateral] = useState<Map<string, TraderCollateral>>(new Map());
  const [traderAddresses, setTraderAddresses] = useState<Map<string, string>>(new Map());

  // WebSocket connection
  const handleMessage = useCallback((message: WSMessage) => {
    const data = message.data as Record<string, unknown>;

    switch (message.type) {
      case 'price:update':
        setPriceData(message.data as PriceData);
        break;

      case 'intent:created': {
        const intentData = data as {
          intentId: string;
          trader: string;
          traderAddress: string;
          amount: string;
          direction: string;
          spreadBps: number;
          deadline: number;
        };
        const newIntent: Intent = {
          id: intentData.intentId,
          traderId: intentData.trader,
          traderAddress: intentData.traderAddress,
          amount: intentData.amount,
          direction: intentData.direction as 'ALPHA_TO_BETA' | 'BETA_TO_ALPHA',
          spreadBps: intentData.spreadBps,
          status: 'pending',
          bids: [],
          createdAt: Date.now(),
          deadline: intentData.deadline,
          hasFourMicaGuarantee: true,
        };
        setIntents((prev) => {
          const newMap = new Map(prev);
          newMap.set(newIntent.id, newIntent);
          return newMap;
        });
        // Track trader address
        if (intentData.trader && intentData.traderAddress) {
          setTraderAddresses((prev) => {
            const newMap = new Map(prev);
            newMap.set(intentData.trader, intentData.traderAddress);
            return newMap;
          });
        }
        break;
      }

      case 'intent:bid': {
        const bidData = data as {
          intentId: string;
          solverId: string;
          solverName: string;
          bidScore: number;
          timestamp: number;
        };
        setIntents((prev) => {
          const newMap = new Map(prev);
          const intent = newMap.get(bidData.intentId);
          if (intent) {
            const newBid = {
              solverId: bidData.solverId,
              solverName: bidData.solverName,
              bidScore: bidData.bidScore,
              timestamp: bidData.timestamp,
            };
            newMap.set(bidData.intentId, {
              ...intent,
              bids: [...intent.bids, newBid],
            });
          }
          return newMap;
        });
        break;
      }

      case 'intent:claimed': {
        const claimData = data as {
          intentId: string;
          solverId: string;
          solverName: string;
          solverAddress: string;
        };
        setIntents((prev) => {
          const newMap = new Map(prev);
          const intent = newMap.get(claimData.intentId);
          if (intent) {
            newMap.set(claimData.intentId, {
              ...intent,
              status: 'claimed',
              winningSolver: claimData.solverName,
            });
          }
          return newMap;
        });
        break;
      }

      case 'intent:executed': {
        const execData = data as {
          intentId: string;
          txHash?: string;
          deadline?: number;
        };
        setIntents((prev) => {
          const newMap = new Map(prev);
          const intent = newMap.get(execData.intentId);
          if (intent) {
            newMap.set(execData.intentId, {
              ...intent,
              status: 'settling',
              txHash: execData.txHash,
              deadline: execData.deadline,
            });
          }
          return newMap;
        });
        break;
      }

      // Trader Tab events
      case 'tab:updated':
      case 'tab:countdown': {
        const tabData = data as unknown as TraderTab;
        setTraderTabs((prev) => {
          const newMap = new Map(prev);
          newMap.set(tabData.traderId, tabData);
          return newMap;
        });
        break;
      }

      case 'tab:settled': {
        const settledData = data as { traderId: string; intentIds: string[]; isHappyPath: boolean };
        // Remove the settled tab
        setTraderTabs((prev) => {
          const newMap = new Map(prev);
          newMap.delete(settledData.traderId);
          return newMap;
        });
        // Update intents status
        setIntents((prev) => {
          const newMap = new Map(prev);
          for (const intentId of settledData.intentIds) {
            const intent = newMap.get(intentId);
            if (intent) {
              newMap.set(intentId, {
                ...intent,
                status: settledData.isHappyPath ? 'completed' : 'defaulted',
              });
            }
          }
          return newMap;
        });
        break;
      }

      case 'tab:collateralUpdate': {
        const collateralData = data as {
          traderId: string;
          traderAddress?: string;
          deposited: string;
          available: string;
          locked: string;
        };
        console.log('[WS] Received collateral update:', collateralData.traderId, 'locked:', collateralData.locked);
        // Update trader tabs (for active tab display)
        setTraderTabs((prev) => {
          const newMap = new Map(prev);
          const tab = newMap.get(collateralData.traderId);
          if (tab) {
            newMap.set(collateralData.traderId, {
              ...tab,
              fourMicaDeposited: collateralData.deposited,
              fourMicaAvailable: collateralData.available,
              fourMicaLocked: collateralData.locked,
            });
          }
          return newMap;
        });
        // Also update persistent trader collateral state
        setTraderCollateral((prev) => {
          const newMap = new Map(prev);
          newMap.set(collateralData.traderId, {
            deposited: collateralData.deposited,
            available: collateralData.available,
            locked: collateralData.locked,
          });
          return newMap;
        });
        break;
      }

      // Legacy settlement events (for compatibility)
      case 'settlement:happy':
      case 'settlement:unhappy': {
        const settlementData = data as { intentId: string };
        const isHappy = message.type === 'settlement:happy';
        setIntents((prev) => {
          const newMap = new Map(prev);
          const intent = newMap.get(settlementData.intentId);
          if (intent) {
            newMap.set(settlementData.intentId, {
              ...intent,
              status: isHappy ? 'completed' : 'defaulted',
            });
          }
          return newMap;
        });
        break;
      }

      case 'leaderboard:update': {
        const lbData = data as { solvers?: LeaderboardEntry[] };
        if (lbData.solvers) {
          setLeaderboard(lbData.solvers);
        }
        break;
      }

      case 'stats:update':
        setGameStats(message.data as GameStatsType);
        break;
    }
  }, []);

  const { isConnected, error } = useWebSocket({
    url: WS_URL,
    onMessage: handleMessage,
    reconnectAttempts: 10,
    reconnectInterval: 3000,
  });

  // Fetch initial data
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        // Fetch stats
        const statsRes = await fetch(`${API_URL}/api/stats`);
        if (statsRes.ok) {
          const stats = await statsRes.json();
          setGameStats(stats);
        }

        // Fetch leaderboard
        const leaderboardRes = await fetch(`${API_URL}/api/leaderboard`);
        if (leaderboardRes.ok) {
          const lb = await leaderboardRes.json();
          setLeaderboard(lb.data || lb.leaderboard || []);
        }

        // Fetch active intents
        const intentsRes = await fetch(`${API_URL}/api/intents`);
        if (intentsRes.ok) {
          const intentsData = await intentsRes.json();
          const intentMap = new Map<string, Intent>();
          const addressMap = new Map<string, string>();
          for (const apiIntent of intentsData.data || intentsData.intents || []) {
            const intent: Intent = {
              id: apiIntent.id,
              traderId: apiIntent.trader?.id || apiIntent.traderId || '',
              traderAddress: apiIntent.trader?.address || apiIntent.traderAddress || '',
              amount: apiIntent.amount,
              direction: apiIntent.direction,
              spreadBps: apiIntent.spreadBps,
              status: apiIntent.status,
              createdAt: apiIntent.createdAt,
              deadline: apiIntent.settlement?.deadline || apiIntent.deadline,
              hasFourMicaGuarantee: apiIntent.guarantee?.verified ?? true,
              bids: [],
              winningSolver: apiIntent.solver?.id || apiIntent.winningSolver,
              txHash: apiIntent.settlement?.txHash || apiIntent.txHash,
            };
            intentMap.set(intent.id, intent);
            // Track trader addresses
            if (intent.traderId && intent.traderAddress) {
              addressMap.set(intent.traderId, intent.traderAddress);
            }
          }
          setIntents(intentMap);
          setTraderAddresses(addressMap);
        }

        // Fetch trader collateral for each known trader
        for (const trader of KNOWN_TRADERS) {
          try {
            const collateralRes = await fetch(`${API_URL}/api/traders/${trader.id}/collateral`);
            if (collateralRes.ok) {
              const collateralData = await collateralRes.json();
              setTraderCollateral((prev) => {
                const newMap = new Map(prev);
                newMap.set(trader.id, {
                  deposited: collateralData.deposited || '0',
                  available: collateralData.available || '0',
                  locked: collateralData.locked || '0',
                });
                return newMap;
              });
            }
          } catch (collateralErr) {
            console.log(`Could not fetch collateral for ${trader.id}:`, collateralErr);
          }
        }
      } catch (err) {
        console.error('Failed to fetch initial data:', err);
      }
    };

    fetchInitialData();
  }, []);

  // Get all intents as array for IntentFeed
  const allIntents = Array.from(intents.values());


  // Compute trader info for the Traders component
  const tradersData = useMemo((): TraderInfo[] => {
    // Group intents by trader and calculate profit
    const traderStats = new Map<string, { profit: number; completedCount: number }>();

    for (const intent of intents.values()) {
      const traderId = intent.traderId;
      if (!traderId) continue;

      const current = traderStats.get(traderId) || { profit: 0, completedCount: 0 };
      if (intent.status === 'completed') {
        current.profit += calculateIntentProfit(intent);
        current.completedCount += 1;
      }
      traderStats.set(traderId, current);
    }

    // Build TraderInfo for each known trader
    return KNOWN_TRADERS.map((trader) => {
      const stats = traderStats.get(trader.id) || { profit: 0, completedCount: 0 };
      const address = traderAddresses.get(trader.id) || trader.address || '';
      const collateral = traderCollateral.get(trader.id) || null;
      const activeTab = traderTabs.get(trader.id);

      return {
        traderId: trader.id,
        traderAddress: address,
        totalProfit: stats.profit,
        completedIntents: stats.completedCount,
        collateral,
        activeTab: activeTab ? {
          intentCount: activeTab.intentCount,
          secondsRemaining: activeTab.secondsRemaining,
          status: activeTab.status,
        } : undefined,
      };
    });
  }, [intents, traderAddresses, traderCollateral, traderTabs]);

  return (
    <div className="min-h-screen bg-game-bg text-white">
      {/* Header */}
      <header className="border-b border-game-border bg-game-card">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="text-2xl">🎮</div>
              <div>
                <h1 className="text-xl font-bold text-white">
                  4Mica × Agent0 Competitive Solver Game
                </h1>
                <p className="text-sm text-gray-400">Sepolia Testnet</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {error && (
                <span className="text-sm text-game-red">Connection error</span>
              )}
              <div className="flex items-center gap-2">
                <div
                  className={`w-2 h-2 rounded-full ${
                    isConnected ? 'bg-game-green animate-pulse' : 'bg-game-red'
                  }`}
                />
                <span className="text-sm text-gray-400">
                  {isConnected ? 'Connected' : 'Disconnected'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* Top Row: Stats */}
        <div className="mb-6">
          <GameStats stats={gameStats} isConnected={isConnected} />
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Prices + Leaderboard */}
          <div className="space-y-6">
            <PriceMonitor priceData={priceData} />
            <Leaderboard entries={leaderboard} />
          </div>

          {/* Middle Column: Intent Feed */}
          <div className="lg:col-span-1">
            <IntentFeed intents={allIntents} />
          </div>

          {/* Right Column: Traders */}
          <div className="space-y-6">
            <Traders traders={tradersData} />

            {/* Network Info */}
            <div className="bg-game-card rounded-xl border border-game-border p-6">
              <h2 className="text-lg font-semibold text-white mb-4">
                Network Info
              </h2>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Network</span>
                  <span className="text-white">Sepolia</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Settlement Window</span>
                  <span className="text-white">30 seconds</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Spread Threshold</span>
                  <span className="text-white">50 bps</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">4Mica Integration</span>
                  <span className="text-game-green">Active</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">API</span>
                  <a
                    href={API_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-game-blue hover:underline"
                  >
                    {API_URL}
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-game-border mt-8 py-4">
        <div className="max-w-7xl mx-auto px-4 text-center text-sm text-gray-500">
          <p>
            Built with 4Mica SDK + Agent0 ERC-8004 |{' '}
            <a
              href="https://github.com/4mica"
              target="_blank"
              rel="noopener noreferrer"
              className="text-game-blue hover:underline"
            >
              GitHub
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;
