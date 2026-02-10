/**
 * OpenClaw Solver AI Agent for 4Mica Solver Game
 *
 * This autonomous agent:
 * 1. Monitors pending intents waiting for solver bids
 * 2. Uses Groq LLM to decide bidding strategy
 * 3. Submits competitive bids to win intent execution rights
 * 4. Aims for high reputation through successful settlements
 *
 * Different solver strategies:
 * - Aggressive: Bids high, fast execution, lower profit share
 * - Balanced: Moderate bids, reliable execution
 * - Conservative: Selective bidding, higher profit share
 */

import chalk from 'chalk';
import { GroqAgentClient, type ToolDefinition, type AgentDecision } from './groq-client.js';

// =============================================================================
// Types
// =============================================================================

export type SolverStrategy = 'aggressive' | 'balanced' | 'conservative';

export interface SolverConfig {
  agentId: string;
  apiBaseUrl: string;
  strategy: SolverStrategy;
  groqApiKey?: string;
  pollIntervalMs?: number;
}

interface IntentData {
  id: string;
  trader: { id: string; address: string };
  amount: string;
  amountFormatted: string;
  direction: string;
  spreadBps: number;
  status: string;
  guarantee: { tabId: string; verified: boolean };
}

interface IntentsResponse {
  count: number;
  data: IntentData[];
}

interface AgentProfile {
  id: string;
  name: string;
  address: string;
  role: string;
}

interface LeaderboardEntry {
  rank: number;
  name: string;
  score: number;
  wins: number;
  losses: number;
}

// =============================================================================
// Strategy Configurations
// =============================================================================

const STRATEGY_PARAMS: Record<SolverStrategy, {
  bidScoreRange: [number, number];
  executionTimeRange: [number, number];
  profitShareRange: [number, number];
  bidProbability: number;
  personality: string;
}> = {
  aggressive: {
    bidScoreRange: [100, 150],
    executionTimeRange: [1000, 2000],
    profitShareRange: [100, 200],
    bidProbability: 0.9,
    personality: 'aggressive and competitive. You bid often and high to win as many intents as possible.',
  },
  balanced: {
    bidScoreRange: [70, 100],
    executionTimeRange: [2000, 3000],
    profitShareRange: [200, 350],
    bidProbability: 0.7,
    personality: 'balanced and reliable. You bid on good opportunities with fair terms.',
  },
  conservative: {
    bidScoreRange: [50, 80],
    executionTimeRange: [2500, 4000],
    profitShareRange: [300, 500],
    bidProbability: 0.5,
    personality: 'conservative and selective. You only bid on the best opportunities with favorable terms.',
  },
};

// =============================================================================
// Tools for AI Decision Making
// =============================================================================

const SOLVER_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'submit_bid',
      description: 'Submit a bid to compete for an intent. Higher bidScore increases win chance but commits you to execution.',
      parameters: {
        type: 'object',
        properties: {
          intentId: {
            type: 'string',
            description: 'The ID of the intent to bid on.',
          },
          bidScore: {
            type: 'number',
            description: 'Your bid score (50-150). Higher = more likely to win.',
          },
          executionTimeMs: {
            type: 'number',
            description: 'Estimated execution time in milliseconds (1000-5000).',
          },
          profitShareBps: {
            type: 'number',
            description: 'Profit share offered to trader in basis points (100-500 = 1-5%).',
          },
          reasoning: {
            type: 'string',
            description: 'Brief explanation of your bidding strategy.',
          },
        },
        required: ['intentId', 'bidScore', 'executionTimeMs', 'profitShareBps', 'reasoning'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'skip_intent',
      description: 'Decide not to bid on this intent.',
      parameters: {
        type: 'object',
        properties: {
          intentId: {
            type: 'string',
            description: 'The ID of the intent you are skipping.',
          },
          reasoning: {
            type: 'string',
            description: 'Brief explanation of why you are not bidding.',
          },
        },
        required: ['intentId', 'reasoning'],
      },
    },
  },
];

// =============================================================================
// Solver Agent Class
// =============================================================================

export class SolverAgent {
  private config: SolverConfig;
  private groq: GroqAgentClient;
  private strategyParams: typeof STRATEGY_PARAMS.balanced;
  private isRunning = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private bidsSubmitted = 0;
  private winsCount = 0;
  private processedIntents = new Set<string>();

  constructor(config: SolverConfig) {
    this.config = {
      pollIntervalMs: 5_000, // 5 seconds - faster than trader to catch intents
      ...config,
    };

    this.groq = new GroqAgentClient({
      apiKey: config.groqApiKey,
    });

    this.strategyParams = STRATEGY_PARAMS[config.strategy];
  }

  // ===========================================================================
  // API Interactions
  // ===========================================================================

  private async fetchPendingIntents(): Promise<IntentData[]> {
    try {
      const response = await fetch(`${this.config.apiBaseUrl}/api/intents?status=pending`);
      if (!response.ok) {
        return [];
      }
      const data = await response.json() as IntentsResponse;
      return data.data || [];
    } catch {
      return [];
    }
  }

  private async fetchAgentProfile(): Promise<AgentProfile | null> {
    try {
      const response = await fetch(`${this.config.apiBaseUrl}/api/agents/${this.config.agentId}`);
      if (!response.ok) return null;
      return await response.json() as AgentProfile;
    } catch {
      return null;
    }
  }

  private async fetchLeaderboard(): Promise<LeaderboardEntry[]> {
    try {
      const response = await fetch(`${this.config.apiBaseUrl}/api/leaderboard?limit=10`);
      if (!response.ok) return [];
      const data = await response.json() as { data: LeaderboardEntry[] };
      return data.data || [];
    } catch {
      return [];
    }
  }

  private async submitBid(
    intentId: string,
    bidScore: number,
    executionTimeMs: number,
    profitShareBps: number
  ): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.apiBaseUrl}/api/intents/${intentId}/bid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          solverId: this.config.agentId,
          bidScore,
          executionTimeEstimateMs: executionTimeMs,
          profitShareBps,
        }),
      });

      const result = await response.json() as { success?: boolean; error?: string };

      if (response.ok && result.success) {
        console.log(chalk.green(`[Solver ${this.config.agentId}] ✓ Bid submitted on ${intentId}`));
        return true;
      } else {
        console.log(chalk.yellow(`[Solver ${this.config.agentId}] Bid rejected: ${result.error}`));
        return false;
      }
    } catch (error) {
      console.error(chalk.red(`[Solver ${this.config.agentId}] Error submitting bid:`), error);
      return false;
    }
  }

  // ===========================================================================
  // AI Decision Making
  // ===========================================================================

  private buildSystemPrompt(): string {
    const params = this.strategyParams;

    return `You are an autonomous solver agent in the 4Mica Solver Game.

Your strategy: ${this.config.strategy.toUpperCase()}
Your personality: You are ${params.personality}

Your role:
- Compete with other solvers to win intent execution rights
- Submit competitive bids on pending intents
- Execute trades and earn profits through successful settlements

Bidding parameters for your strategy:
- Bid score range: ${params.bidScoreRange[0]}-${params.bidScoreRange[1]}
- Execution time: ${params.executionTimeRange[0]}-${params.executionTimeRange[1]}ms
- Profit share: ${params.profitShareRange[0]}-${params.profitShareRange[1]} bps (${params.profitShareRange[0]/100}-${params.profitShareRange[1]/100}%)
- Typical bid probability: ${params.bidProbability * 100}%

Important considerations:
- Only bid on intents with verified 4Mica guarantees
- Higher spread = more profitable opportunity
- Consider competition from other solvers
- Maintain good reputation through consistent execution

When deciding to bid:
- Analyze the intent's profitability (spread, amount)
- Consider your strategy and personality
- Provide bid parameters within your strategy's ranges`;
  }

  private buildUserPrompt(
    intent: IntentData,
    profile: AgentProfile | null,
    leaderboard: LeaderboardEntry[]
  ): string {
    const myRanking = leaderboard.find(e => e.name === profile?.name);

    return `New Pending Intent to Evaluate:

Intent Details:
- ID: ${intent.id}
- Amount: ${intent.amountFormatted} USDC
- Spread: ${intent.spreadBps} basis points
- Direction: ${intent.direction}
- Has 4Mica Guarantee: ${intent.guarantee.verified ? 'YES ✓' : 'NO ✗'}
- Tab ID: ${intent.guarantee.tabId || 'N/A'}

Your Status:
- Agent: ${profile?.name || this.config.agentId}
- Strategy: ${this.config.strategy}
- Bids submitted this session: ${this.bidsSubmitted}
- Wins: ${this.winsCount}
- Current ranking: ${myRanking ? `#${myRanking.rank}` : 'Not ranked'}

Competition (Top Solvers):
${leaderboard.slice(0, 5).map(e => `  #${e.rank} ${e.name}: score=${e.score}, wins=${e.wins}`).join('\n') || '  No leaderboard data'}

Decision Required:
Should you bid on this intent? If yes, what parameters?

Remember your ${this.config.strategy} strategy:
- Bid score: ${this.strategyParams.bidScoreRange[0]}-${this.strategyParams.bidScoreRange[1]}
- Execution time: ${this.strategyParams.executionTimeRange[0]}-${this.strategyParams.executionTimeRange[1]}ms
- Profit share: ${this.strategyParams.profitShareRange[0]}-${this.strategyParams.profitShareRange[1]} bps

Call submit_bid if you want to compete, or skip_intent if not.`;
  }

  private async makeDecision(intent: IntentData): Promise<AgentDecision | null> {
    // Quick checks before asking AI
    if (!intent.guarantee.verified) {
      console.log(chalk.gray(`[Solver ${this.config.agentId}] Skipping ${intent.id}: no verified guarantee`));
      return { action: 'skip_intent', params: { intentId: intent.id }, reasoning: 'No verified 4Mica guarantee' };
    }

    const profile = await this.fetchAgentProfile();
    const leaderboard = await this.fetchLeaderboard();

    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(intent, profile, leaderboard);

    try {
      const decision = await this.groq.getDecision(systemPrompt, userPrompt, SOLVER_TOOLS);
      return decision;
    } catch (error) {
      console.error(chalk.red(`[Solver ${this.config.agentId}] AI decision error:`), error);
      return null;
    }
  }

  // ===========================================================================
  // Main Loop
  // ===========================================================================

  private async tick(): Promise<void> {
    // Fetch pending intents
    const intents = await this.fetchPendingIntents();

    if (intents.length === 0) {
      return; // No pending intents
    }

    console.log(chalk.gray(`[Solver ${this.config.agentId}] Found ${intents.length} pending intent(s)`));

    // Process each intent we haven't seen
    for (const intent of intents) {
      if (this.processedIntents.has(intent.id)) {
        continue; // Already processed this intent
      }

      console.log(chalk.cyan(`[Solver ${this.config.agentId}] Evaluating intent ${intent.id} (${intent.amountFormatted} USDC, ${intent.spreadBps} bps)`));

      // Mark as processed to avoid re-processing
      this.processedIntents.add(intent.id);

      // Clean up old processed intents (keep last 100)
      if (this.processedIntents.size > 100) {
        const arr = Array.from(this.processedIntents);
        arr.slice(0, arr.length - 100).forEach(id => this.processedIntents.delete(id));
      }

      // Ask AI for decision
      const decision = await this.makeDecision(intent);

      if (!decision) {
        console.log(chalk.yellow(`[Solver ${this.config.agentId}] No decision from AI for ${intent.id}`));
        continue;
      }

      console.log(chalk.magenta(`[Solver ${this.config.agentId}] AI decided: ${decision.action}`));
      if (decision.reasoning) {
        console.log(chalk.gray(`  Reasoning: ${decision.reasoning}`));
      }

      // Execute decision
      if (decision.action === 'submit_bid') {
        const { bidScore, executionTimeMs, profitShareBps } = decision.params as {
          bidScore: number;
          executionTimeMs: number;
          profitShareBps: number;
        };

        // Validate parameters are within strategy ranges
        const params = this.strategyParams;
        const validScore = Math.max(params.bidScoreRange[0], Math.min(params.bidScoreRange[1], bidScore));
        const validTime = Math.max(params.executionTimeRange[0], Math.min(params.executionTimeRange[1], executionTimeMs));
        const validShare = Math.max(params.profitShareRange[0], Math.min(params.profitShareRange[1], profitShareBps));

        console.log(chalk.blue(`[Solver ${this.config.agentId}] Submitting bid: score=${validScore}, time=${validTime}ms, share=${validShare}bps`));

        const success = await this.submitBid(intent.id, validScore, validTime, validShare);
        if (success) {
          this.bidsSubmitted++;
        }
      }

      // Small delay between processing intents to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log(chalk.yellow(`[Solver ${this.config.agentId}] Already running`));
      return;
    }

    // Verify agent exists
    const profile = await this.fetchAgentProfile();
    if (!profile) {
      throw new Error(`Solver agent ${this.config.agentId} not found on server`);
    }
    if (profile.role !== 'solver') {
      throw new Error(`Agent ${this.config.agentId} is not a solver (role: ${profile.role})`);
    }

    console.log(chalk.green(`[Solver ${this.config.agentId}] Starting... (${profile.name}, strategy: ${this.config.strategy})`));
    this.isRunning = true;

    // Initial tick
    await this.tick();

    // Start poll loop
    this.pollTimer = setInterval(() => {
      this.tick().catch(err => {
        console.error(chalk.red(`[Solver ${this.config.agentId}] Tick error:`), err);
      });
    }, this.config.pollIntervalMs);
  }

  stop(): void {
    if (!this.isRunning) return;

    console.log(chalk.yellow(`[Solver ${this.config.agentId}] Stopping...`));
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

export function createSolverAgent(config: SolverConfig): SolverAgent {
  return new SolverAgent(config);
}

export default SolverAgent;
