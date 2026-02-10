/**
 * WebSocket Broadcaster for 4Mica × Agent0 Competitive Solver Game
 *
 * Manages WebSocket connections and broadcasts real-time events to clients:
 * - Price updates
 * - Intent lifecycle events
 * - Settlement countdowns
 * - Leaderboard updates
 * - Agent status changes
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { PriceData } from './price-indexer.js';
import type { TradeIntent, SolverBid } from './intent-manager.js';
import type { SettlementStatus, SettlementResult } from './settlement-mgr.js';

// =============================================================================
// Types
// =============================================================================

export type WSEventType =
  | 'price:update'
  | 'intent:created'
  | 'intent:bid'
  | 'intent:claimed'
  | 'intent:executing'
  | 'intent:executed'
  | 'intent:completed'
  | 'intent:defaulted'
  | 'intent:cancelled'
  | 'settlement:started'
  | 'settlement:countdown'
  | 'settlement:overdue'
  | 'settlement:happy'
  | 'settlement:unhappy'
  | 'tab:updated'
  | 'tab:countdown'
  | 'tab:settled'
  | 'tab:collateralUpdate'
  | 'leaderboard:update'
  | 'stats:update'
  | 'agent:registered'
  | 'agent:deposited'
  | 'agent:status'
  | 'game:started'
  | 'game:stopped'
  | 'error';

export interface WSMessage<T = unknown> {
  type: WSEventType;
  data: T;
  timestamp: number;
}

export interface ClientInfo {
  id: string;
  connectedAt: number;
  lastPing: number;
  subscriptions: Set<WSEventType>;
}

export interface BroadcasterConfig {
  pingIntervalMs: number;
  maxClients: number;
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * JSON replacer function that handles BigInt serialization
 * Converts BigInt values to strings to avoid JSON.stringify errors
 */
function bigIntReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value;
}

// =============================================================================
// WebSocket Broadcaster Class
// =============================================================================

export class WSBroadcaster {
  private wss: WebSocketServer | null = null;
  private clients: Map<WebSocket, ClientInfo> = new Map();
  private config: BroadcasterConfig;
  private pingInterval: NodeJS.Timeout | null = null;
  private clientCounter = 0;

  constructor(config: BroadcasterConfig) {
    this.config = config;
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  /**
   * Initialize WebSocket server
   */
  initialize(server: Server): void {
    this.wss = new WebSocketServer({ server });

    this.wss.on('connection', (ws: WebSocket) => {
      this.handleConnection(ws);
    });

    // Start ping interval
    this.pingInterval = setInterval(() => {
      this.pingClients();
    }, this.config.pingIntervalMs);

    console.log('[WSBroadcaster] WebSocket server initialized');
  }

  /**
   * Handle new client connection
   */
  private handleConnection(ws: WebSocket): void {
    // Check max clients
    if (this.clients.size >= this.config.maxClients) {
      console.log('[WSBroadcaster] Max clients reached, rejecting connection');
      ws.close(1013, 'Max clients reached');
      return;
    }

    const clientId = `client_${++this.clientCounter}`;
    const clientInfo: ClientInfo = {
      id: clientId,
      connectedAt: Date.now(),
      lastPing: Date.now(),
      subscriptions: new Set([
        'price:update',
        'intent:created',
        'intent:bid',
        'intent:claimed',
        'intent:executed',
        'settlement:countdown',
        'settlement:happy',
        'settlement:unhappy',
        'tab:updated',
        'tab:countdown',
        'tab:settled',
        'tab:collateralUpdate',
        'leaderboard:update',
        'stats:update',
      ]),
    };

    this.clients.set(ws, clientInfo);
    console.log(`[WSBroadcaster] Client connected: ${clientId} (total: ${this.clients.size})`);

    // Handle messages from client
    ws.on('message', (data) => {
      this.handleMessage(ws, data.toString());
    });

    // Handle disconnect
    ws.on('close', () => {
      this.clients.delete(ws);
      console.log(`[WSBroadcaster] Client disconnected: ${clientId} (total: ${this.clients.size})`);
    });

    // Handle errors
    ws.on('error', (error) => {
      console.error(`[WSBroadcaster] Client error ${clientId}:`, error.message);
    });

    // Send welcome message
    this.send(ws, 'game:started', { clientId, timestamp: Date.now() });
  }

  /**
   * Handle message from client
   */
  private handleMessage(ws: WebSocket, message: string): void {
    try {
      const parsed = JSON.parse(message);
      const clientInfo = this.clients.get(ws);
      if (!clientInfo) return;

      switch (parsed.type) {
        case 'ping':
          clientInfo.lastPing = Date.now();
          this.send(ws, 'pong' as WSEventType, { timestamp: Date.now() });
          break;

        case 'subscribe':
          if (Array.isArray(parsed.events)) {
            parsed.events.forEach((e: WSEventType) => clientInfo.subscriptions.add(e));
          }
          break;

        case 'unsubscribe':
          if (Array.isArray(parsed.events)) {
            parsed.events.forEach((e: WSEventType) => clientInfo.subscriptions.delete(e));
          }
          break;

        default:
          console.log(`[WSBroadcaster] Unknown message type: ${parsed.type}`);
      }
    } catch (error) {
      console.error('[WSBroadcaster] Error parsing message:', error);
    }
  }

  /**
   * Ping all clients to check connection
   */
  private pingClients(): void {
    const now = Date.now();
    const timeout = this.config.pingIntervalMs * 3; // 3 missed pings = disconnect

    for (const [ws, info] of this.clients) {
      if (now - info.lastPing > timeout) {
        console.log(`[WSBroadcaster] Client ${info.id} timed out, disconnecting`);
        ws.terminate();
        this.clients.delete(ws);
      }
    }
  }

  // ===========================================================================
  // Broadcasting
  // ===========================================================================

  /**
   * Send message to specific client
   */
  private send<T>(ws: WebSocket, type: WSEventType, data: T): void {
    if (ws.readyState !== WebSocket.OPEN) return;

    const message: WSMessage<T> = {
      type,
      data,
      timestamp: Date.now(),
    };

    ws.send(JSON.stringify(message, bigIntReplacer));
  }

  /**
   * Broadcast to all subscribed clients
   */
  broadcast<T>(type: WSEventType, data: T): void {
    const message: WSMessage<T> = {
      type,
      data,
      timestamp: Date.now(),
    };

    // Use BigInt-safe serializer
    const json = JSON.stringify(message, bigIntReplacer);
    let sentCount = 0;

    for (const [ws, info] of this.clients) {
      if (ws.readyState === WebSocket.OPEN && info.subscriptions.has(type)) {
        ws.send(json);
        sentCount++;
      }
    }

    // Log for certain event types
    if (!['price:update', 'settlement:countdown'].includes(type)) {
      console.log(`[WSBroadcaster] Broadcast ${type} to ${sentCount} clients`);
    }
  }

  // ===========================================================================
  // Event-Specific Broadcasts
  // ===========================================================================

  /**
   * Broadcast price update
   */
  broadcastPrice(priceData: PriceData): void {
    this.broadcast('price:update', {
      alphaPrice: priceData.alphaPriceFormatted,
      betaPrice: priceData.betaPriceFormatted,
      spreadBps: priceData.spreadBps,
      direction: priceData.direction,
      timestamp: priceData.timestamp,
    });
  }

  /**
   * Broadcast intent creation
   */
  broadcastIntentCreated(intent: TradeIntent): void {
    this.broadcast('intent:created', {
      intentId: intent.id,
      trader: intent.traderId,
      traderAddress: intent.traderAddress,
      amount: intent.amount.toString(),
      direction: intent.direction,
      spreadBps: intent.spreadBps,
      deadline: intent.createdAt + 30000, // 30s bidding window
    });
  }

  /**
   * Broadcast solver bid
   */
  broadcastBid(intentId: string, bid: SolverBid): void {
    this.broadcast('intent:bid', {
      intentId,
      solverId: bid.solverId,
      solverName: bid.solverName,
      bidScore: bid.bidScore,
      timestamp: bid.timestamp,
    });
  }

  /**
   * Broadcast intent claimed
   */
  broadcastIntentClaimed(intentId: string, solver: SolverBid): void {
    this.broadcast('intent:claimed', {
      intentId,
      solverId: solver.solverId,
      solverName: solver.solverName,
      solverAddress: solver.solverAddress,
    });
  }

  /**
   * Broadcast intent executed
   */
  broadcastIntentExecuted(intentId: string, txHash?: string, deadline?: number): void {
    this.broadcast('intent:executed', {
      intentId,
      txHash,
      deadline,
    });
  }

  /**
   * Broadcast settlement countdown
   */
  broadcastCountdown(intentId: string, secondsRemaining: number): void {
    this.broadcast('settlement:countdown', {
      intentId,
      secondsRemaining,
    });
  }

  /**
   * Broadcast settlement result
   */
  broadcastSettlement(result: SettlementResult): void {
    const eventType: WSEventType = result.isHappyPath ? 'settlement:happy' : 'settlement:unhappy';
    this.broadcast(eventType, {
      intentId: result.intentId,
      txHash: result.txHash,
      settledAt: result.settledAt,
    });
  }

  /**
   * Broadcast leaderboard update
   */
  broadcastLeaderboard(leaderboard: unknown[]): void {
    this.broadcast('leaderboard:update', { solvers: leaderboard });
  }

  /**
   * Broadcast game stats update
   */
  broadcastStats(stats: unknown): void {
    this.broadcast('stats:update', stats);
  }

  /**
   * Broadcast trader tab update
   */
  broadcastTabUpdate(tabData: unknown): void {
    this.broadcast('tab:updated', tabData);
  }

  /**
   * Broadcast trader tab countdown
   */
  broadcastTabCountdown(tabData: unknown): void {
    this.broadcast('tab:countdown', tabData);
  }

  /**
   * Broadcast trader tab settled
   */
  broadcastTabSettled(tabData: unknown): void {
    this.broadcast('tab:settled', tabData);
  }

  /**
   * Broadcast trader collateral update from 4Mica
   */
  broadcastTabCollateralUpdate(collateralData: unknown): void {
    this.broadcast('tab:collateralUpdate', collateralData);
  }

  /**
   * Broadcast agent registration
   */
  broadcastAgentRegistered(agentId: string, name: string, address: string): void {
    this.broadcast('agent:registered', { agentId, name, address });
  }

  /**
   * Broadcast agent deposit
   */
  broadcastAgentDeposited(agentId: string, amount: string): void {
    this.broadcast('agent:deposited', { agentId, amount });
  }

  /**
   * Broadcast error
   */
  broadcastError(error: string): void {
    this.broadcast('error', { message: error });
  }

  // ===========================================================================
  // Status & Cleanup
  // ===========================================================================

  /**
   * Get connection stats
   */
  getStats(): {
    totalClients: number;
    readyClients: number;
  } {
    let ready = 0;
    for (const [ws] of this.clients) {
      if (ws.readyState === WebSocket.OPEN) ready++;
    }

    return {
      totalClients: this.clients.size,
      readyClients: ready,
    };
  }

  /**
   * Close all connections
   */
  close(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    for (const [ws] of this.clients) {
      ws.close(1001, 'Server shutting down');
    }
    this.clients.clear();

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    console.log('[WSBroadcaster] Closed');
  }
}

// =============================================================================
// Factory Function
// =============================================================================

export function createWSBroadcaster(config: BroadcasterConfig): WSBroadcaster {
  return new WSBroadcaster(config);
}

export default WSBroadcaster;
