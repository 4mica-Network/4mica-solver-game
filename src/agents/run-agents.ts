#!/usr/bin/env node
/**
 * OpenClaw AI Agents Runner for 4Mica Solver Game
 *
 * Starts autonomous AI agents that participate in the game:
 * - 1 Trader agent (creates intents)
 * - 3 Solver agents with different strategies (compete for intents)
 *
 * Prerequisites:
 * - Game server running at API_BASE_URL
 * - GROQ_API_KEY environment variable set
 * - Agents registered in game server (via .env.sepolia)
 *
 * Usage:
 *   npx tsx src/agents/run-agents.ts
 *   # or
 *   npm run start:agents
 */

import { config as dotenvConfig } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envFile = process.env.ENV_FILE || (process.env.LOCAL_MODE === 'true' ? '.env.local' : '.env.sepolia');
const envPaths = [
  join(process.cwd(), envFile),
  join(__dirname, '../../', envFile),
  join(__dirname, '../../../', envFile),
];
for (const envPath of envPaths) {
  const result = dotenvConfig({ path: envPath });
  if (!result.error) {
    console.log(`[Config] Loaded environment from: ${envPath}`);
    break;
  }
}

import chalk from 'chalk';
import { createTraderAgent, type TraderConfig } from './trader-agent.js';
import { createSolverAgent, type SolverConfig, type SolverStrategy } from './solver-agent.js';

// =============================================================================
// Configuration
// =============================================================================

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// Agent IDs must match those configured in game server (.env.sepolia)
const TRADER_AGENT_ID = process.env.TRADER_AGENT_ID || 'Trader-SpreadHawk';

// Solver agents with different strategies
const SOLVER_CONFIGS: Array<{ id: string; strategy: SolverStrategy }> = [
  { id: process.env.SOLVER_1_ID || 'Solver-AlphaStrike', strategy: 'aggressive' },
  { id: process.env.SOLVER_2_ID || 'Solver-ProfitMax', strategy: 'balanced' },
  { id: process.env.SOLVER_3_ID || 'Solver-Balanced', strategy: 'conservative' },
];

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  console.log(chalk.bold('\n🤖 OpenClaw AI Agents for 4Mica Solver Game\n'));
  console.log(chalk.gray('─'.repeat(60)));

  // Validate environment
  if (!GROQ_API_KEY) {
    console.error(chalk.red('ERROR: GROQ_API_KEY environment variable not set'));
    console.log(chalk.yellow('\nTo get a free API key:'));
    console.log(chalk.white('  1. Go to https://console.groq.com'));
    console.log(chalk.white('  2. Sign up for free'));
    console.log(chalk.white('  3. Create an API key'));
    console.log(chalk.white('  4. Set GROQ_API_KEY in your environment or .env file'));
    process.exit(1);
  }

  console.log(chalk.cyan('  API Server:    ') + chalk.white(API_BASE_URL));
  console.log(chalk.cyan('  Groq API:      ') + chalk.white('✓ Configured'));
  console.log(chalk.cyan('  LLM Model:     ') + chalk.white('llama-3.3-70b-versatile'));
  console.log(chalk.gray('─'.repeat(60)));

  // Check API server is running
  try {
    const healthCheck = await fetch(`${API_BASE_URL}/api/health`);
    if (!healthCheck.ok) {
      throw new Error(`Server returned ${healthCheck.status}`);
    }
    console.log(chalk.green('  ✓ Game server is running\n'));
  } catch (error) {
    console.error(chalk.red(`  ✗ Cannot connect to game server at ${API_BASE_URL}`));
    console.log(chalk.yellow('\n  Make sure the game server is running:'));
    console.log(chalk.white('    npm run start:sepolia\n'));
    process.exit(1);
  }

  // Create agents
  const agents: Array<{ name: string; agent: { start: () => Promise<void>; stop: () => void } }> = [];

  // Create Trader agent
  const traderConfig: TraderConfig = {
    agentId: TRADER_AGENT_ID,
    apiBaseUrl: API_BASE_URL,
    groqApiKey: GROQ_API_KEY,
    pollIntervalMs: 15_000, // Check every 15 seconds
    minSpreadBps: 30, // Trade when spread > 0.3%
    maxTradeAmount: 1_000_000, // Max $1 USDC
  };

  const traderAgent = createTraderAgent(traderConfig);
  agents.push({ name: `Trader (${TRADER_AGENT_ID})`, agent: traderAgent });

  // Create Solver agents
  for (const solverConfig of SOLVER_CONFIGS) {
    const config: SolverConfig = {
      agentId: solverConfig.id,
      apiBaseUrl: API_BASE_URL,
      strategy: solverConfig.strategy,
      groqApiKey: GROQ_API_KEY,
      pollIntervalMs: 8_000, // Check every 8 seconds (avoid Groq rate limits with 4 agents)
    };

    const solverAgent = createSolverAgent(config);
    agents.push({ name: `Solver (${solverConfig.id}, ${solverConfig.strategy})`, agent: solverAgent });
  }

  // Start all agents
  console.log(chalk.cyan('Starting agents...\n'));

  for (let i = 0; i < agents.length; i++) {
    const { name, agent } = agents[i];
    try {
      await agent.start();
      console.log(chalk.green(`  ✓ ${name} started`));
      // Stagger agent starts to avoid initial Groq rate limit spike
      if (i < agents.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    } catch (error) {
      console.error(chalk.red(`  ✗ ${name} failed to start:`), error);
    }
  }

  console.log(chalk.gray('\n─'.repeat(60)));
  console.log(chalk.bold.green('\n✓ All agents running\n'));
  console.log(chalk.yellow('Press Ctrl+C to stop all agents\n'));

  // Handle shutdown
  const shutdown = (): void => {
    console.log(chalk.yellow('\n\nShutting down agents...'));
    for (const { name, agent } of agents) {
      try {
        agent.stop();
        console.log(chalk.gray(`  Stopped ${name}`));
      } catch {
        // Ignore errors during shutdown
      }
    }
    console.log(chalk.green('✓ All agents stopped\n'));
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep process running
  await new Promise(() => {}); // Never resolves
}

// Run
main().catch((error) => {
  console.error(chalk.red('Fatal error:'), error);
  process.exit(1);
});
