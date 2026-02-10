/**
 * OpenClaw Trader AI Agent for 4Mica Solver Game
 *
 * This autonomous agent:
 * 1. Monitors price spreads between AMMs
 * 2. Uses Groq LLM to decide when to trade
 * 3. Creates trade intents via game server API
 * 4. Prefers happy path settlement
 *
 * The trader's strategy is conservative:
 * - Only trades when spread exceeds threshold
 * - Keeps trade amounts small (< $1 USDC)
 * - Always aims for settlement (never defaults intentionally)
 */

import chalk from 'chalk';
import { GroqAgentClient, type ToolDefinition, type AgentDecision } from './groq-client.js';

// =============================================================================
// Types
// =============================================================================

export interface TraderConfig {
  agentId: string;
  apiBaseUrl: string;
  groqApiKey?: string;
  pollIntervalMs?: number;
  minSpreadBps?: number;
  maxTradeAmount?: number; // in micro-units (1,000,000 = $1)
}

interface PriceData {
  alpha: { price: string; priceRaw: string };
  beta: { price: string; priceRaw: string };
  spread: { bps: number; percent: string };
  direction: string;
  timestamp: number;
}

interface AgentProfile {
  id: string;
  name: string;
  address: string;
  role: string;
}

// =============================================================================
// Tools for AI Decision Making
// =============================================================================

const TRADER_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'create_trade_intent',
      description: 'Create a new trade intent to capture the arbitrage opportunity. Only call this when you have analyzed the market and determined there is a profitable opportunity.',
      parameters: {
        type: 'object',
        properties: {
          amount: {
            type: 'number',
            description: 'Trade amount in micro-units (e.g., 500000 = $0.50 USDC). Must be between 100000 and 1000000.',
          },
          reasoning: {
            type: 'string',
            description: 'Brief explanation of why you decided to trade now.',
          },
        },
        required: ['amount', 'reasoning'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wait',
      description: 'Decide to wait and not trade. Call this when conditions are not favorable.',
      parameters: {
        type: 'object',
        properties: {
          reasoning: {
            type: 'string',
            description: 'Brief explanation of why you decided to wait.',
          },
        },
        required: ['reasoning'],
      },
    },
  },
];

// =============================================================================
// Trader Agent Class
// =============================================================================

export class TraderAgent {
  private config: TraderConfig;
  private groq: GroqAgentClient;
  private isRunning = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private tradeCount = 0;
  private lastTradeTime = 0;

  constructor(config: TraderConfig) {
    this.config = {
      pollIntervalMs: 10_000, // 10 seconds
      minSpreadBps: 50, // 0.5% minimum spread
      maxTradeAmount: 1_000_000, // $1 max
      ...config,
    };

    this.groq = new GroqAgentClient({
      apiKey: config.groqApiKey,
    });
  }

  // ===========================================================================
  // API Interactions
  // ===========================================================================

  private async fetchPrices(): Promise<PriceData | null> {
    try {
      const response = await fetch(`${this.config.apiBaseUrl}/api/prices`);
      if (!response.ok) {
        console.log(chalk.yellow(`[Trader ${this.config.agentId}] Price fetch failed: ${response.status}`));
        return null;
      }
      return await response.json() as PriceData;
    } catch (error) {
      console.error(chalk.red(`[Trader ${this.config.agentId}] Error fetching prices:`), error);
      return null;
    }
  }

  private async fetchAgentProfile(): Promise<AgentProfile | null> {
    try {
      const response = await fetch(`${this.config.apiBaseUrl}/api/agents/${this.config.agentId}`);
      if (!response.ok) {
        return null;
      }
      return await response.json() as AgentProfile;
    } catch {
      return null;
    }
  }

  private async createIntent(amount: number): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.apiBaseUrl}/api/intents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          traderId: this.config.agentId,
          amount,
        }),
      });

      const result = await response.json() as { success?: boolean; error?: string; intent?: unknown };

      if (response.ok && result.success) {
        console.log(chalk.green(`[Trader ${this.config.agentId}] ✓ Intent created successfully`));
        return true;
      } else {
        console.log(chalk.yellow(`[Trader ${this.config.agentId}] Intent creation failed: ${result.error}`));
        return false;
      }
    } catch (error) {
      console.error(chalk.red(`[Trader ${this.config.agentId}] Error creating intent:`), error);
      return false;
    }
  }

  // ===========================================================================
  // AI Decision Making
  // ===========================================================================

  private buildSystemPrompt(): string {
    return `You are an autonomous trading agent in the 4Mica Solver Game.

Your role:
- Monitor price spreads between two AMMs (Alpha and Beta)
- Identify arbitrage opportunities when spread exceeds ${this.config.minSpreadBps} basis points
- Create trade intents to capture profitable opportunities
- Be conservative: only trade when confident, keep amounts small

Important constraints:
- Maximum trade amount: ${this.config.maxTradeAmount! / 1_000_000} USDC
- Minimum trade amount: 0.10 USDC (100,000 micro-units)
- You have limited collateral, so be selective
- Rate limit: Don't trade more than once every 60 seconds

Your trading style:
- Conservative and methodical
- Focus on consistent small profits rather than big risky trades
- Always aim for "happy path" settlement (fulfilling obligations)

When making decisions:
- Consider the current spread (higher = better opportunity)
- Consider your recent trade history (avoid overtrading)
- Provide clear reasoning for your decisions`;
  }

  private buildUserPrompt(priceData: PriceData, profile: AgentProfile | null): string {
    const timeSinceLastTrade = Date.now() - this.lastTradeTime;
    const canTrade = timeSinceLastTrade > 60_000; // 60 second cooldown

    return `Current Market State:
- Alpha AMM Price: ${priceData.alpha.price}
- Beta AMM Price: ${priceData.beta.price}
- Spread: ${priceData.spread.bps} basis points (${priceData.spread.percent}%)
- Direction: ${priceData.direction}
- Timestamp: ${new Date(priceData.timestamp).toISOString()}

Your Status:
- Agent ID: ${this.config.agentId}
- Name: ${profile?.name || 'Unknown'}
- Total trades this session: ${this.tradeCount}
- Time since last trade: ${Math.floor(timeSinceLastTrade / 1000)} seconds
- Can trade now: ${canTrade ? 'YES' : 'NO (cooldown active)'}
- Minimum spread threshold: ${this.config.minSpreadBps} bps

Analyze the market and decide:
1. Is the spread high enough for a profitable trade?
2. Is now a good time to trade given the cooldown?
3. What amount should you trade (in micro-units, 100000-1000000)?

If conditions are favorable, call create_trade_intent with your chosen amount.
If not, call wait with your reasoning.`;
  }

  private async makeDecision(priceData: PriceData): Promise<AgentDecision | null> {
    const profile = await this.fetchAgentProfile();

    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(priceData, profile);

    try {
      const decision = await this.groq.getDecision(systemPrompt, userPrompt, TRADER_TOOLS);
      return decision;
    } catch (error) {
      console.error(chalk.red(`[Trader ${this.config.agentId}] AI decision error:`), error);
      return null;
    }
  }

  // ===========================================================================
  // Main Loop
  // ===========================================================================

  private async tick(): Promise<void> {
    console.log(chalk.gray(`[Trader ${this.config.agentId}] Checking market...`));

    // Fetch current prices
    const priceData = await this.fetchPrices();
    if (!priceData) {
      return;
    }

    console.log(chalk.cyan(`[Trader ${this.config.agentId}] Spread: ${priceData.spread.bps} bps (${priceData.direction})`));

    // Quick check: if spread is below threshold, don't bother asking AI
    if (priceData.spread.bps < (this.config.minSpreadBps || 50)) {
      console.log(chalk.gray(`[Trader ${this.config.agentId}] Spread below threshold, waiting...`));
      return;
    }

    // Ask AI for decision
    console.log(chalk.blue(`[Trader ${this.config.agentId}] Consulting AI for decision...`));
    const decision = await this.makeDecision(priceData);

    if (!decision) {
      console.log(chalk.yellow(`[Trader ${this.config.agentId}] No decision from AI`));
      return;
    }

    console.log(chalk.magenta(`[Trader ${this.config.agentId}] AI decided: ${decision.action}`));
    if (decision.reasoning) {
      console.log(chalk.gray(`  Reasoning: ${decision.reasoning}`));
    }

    // Execute decision
    if (decision.action === 'create_trade_intent') {
      const amount = decision.params?.amount as number;
      if (!amount || amount < 100_000 || amount > this.config.maxTradeAmount!) {
        console.log(chalk.yellow(`[Trader ${this.config.agentId}] Invalid amount: ${amount}`));
        return;
      }

      console.log(chalk.blue(`[Trader ${this.config.agentId}] Creating intent for ${amount / 1_000_000} USDC...`));
      const success = await this.createIntent(amount);

      if (success) {
        this.tradeCount++;
        this.lastTradeTime = Date.now();
      }
    }
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log(chalk.yellow(`[Trader ${this.config.agentId}] Already running`));
      return;
    }

    // Verify agent exists
    const profile = await this.fetchAgentProfile();
    if (!profile) {
      throw new Error(`Trader agent ${this.config.agentId} not found on server`);
    }
    if (profile.role !== 'trader') {
      throw new Error(`Agent ${this.config.agentId} is not a trader (role: ${profile.role})`);
    }

    console.log(chalk.green(`[Trader ${this.config.agentId}] Starting... (${profile.name})`));
    this.isRunning = true;

    // Initial tick
    await this.tick();

    // Start poll loop
    this.pollTimer = setInterval(() => {
      this.tick().catch(err => {
        console.error(chalk.red(`[Trader ${this.config.agentId}] Tick error:`), err);
      });
    }, this.config.pollIntervalMs);
  }

  stop(): void {
    if (!this.isRunning) return;

    console.log(chalk.yellow(`[Trader ${this.config.agentId}] Stopping...`));
    this.isRunning = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createTraderAgent(config: TraderConfig): TraderAgent {
  return new TraderAgent(config);
}

export default TraderAgent;
