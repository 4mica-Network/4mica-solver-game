#!/usr/bin/env node
/**
 * Start 4Mica × Agent0 Solver Game in Local Mode
 *
 * This script starts all components needed for local testing:
 * 1. Hardhat Network (local Ethereum testnet)
 * 2. Mock 4Mica API (full RPC + Facilitator simulation)
 * 3. Game Server (configured for local mode)
 * 4. AI Agents (optional, requires GROQ_API_KEY)
 *
 * Prerequisites:
 * - Run `forge build` to compile contracts
 * - Set GROQ_API_KEY in .env.local for AI agents
 *
 * Usage:
 *   npm run start:local           # Without AI agents
 *   npm run start:local:agents    # With AI agents
 */

import { spawn, type ChildProcess } from 'child_process';
import chalk from 'chalk';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config as dotenvConfig } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
// When running compiled JS from dist/scripts/, need to go up 2 levels to project root
// When running with tsx from scripts/, only need to go up 1 level
const isCompiledJs = __dirname.includes('/dist/');
const projectRoot = isCompiledJs ? join(__dirname, '..', '..') : join(__dirname, '..');

// Load local environment
dotenvConfig({ path: join(projectRoot, '.env.local') });

// =============================================================================
// Configuration
// =============================================================================

const HARDHAT_PORT = 8545;
const MOCK_4MICA_PORT = parseInt(process.env.MOCK_4MICA_PORT || '3003');
const FACILITATOR_PORT = parseInt(process.env.MOCK_FACILITATOR_PORT || '3002');
const GAME_SERVER_PORT = parseInt(process.env.SERVER_PORT || '3001');
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// Check if --with-agents flag is passed or GROQ_API_KEY is set
const startAgents = process.argv.includes('--with-agents') ||
                    process.argv.includes('--agents') ||
                    (GROQ_API_KEY && GROQ_API_KEY !== 'gsk_your_groq_api_key_here');

// =============================================================================
// Process Management
// =============================================================================

const processes: Map<string, ChildProcess> = new Map();

function startProcess(name: string, command: string, args: string[], env?: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(chalk.cyan(`Starting ${name}...`));

    const proc = spawn(command, args, {
      cwd: projectRoot,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    processes.set(name, proc);

    let started = false;

    proc.stdout?.on('data', (data: Buffer) => {
      const output = data.toString();

      // Detect when process is ready
      if (!started) {
        if (name === 'hardhat' && output.includes('Started HTTP')) {
          started = true;
          console.log(chalk.green(`  ✓ ${name} started on port ${HARDHAT_PORT}`));
          resolve();
        } else if (name === 'mock-4mica' && output.includes('Mock 4Mica API running')) {
          started = true;
          console.log(chalk.green(`  ✓ ${name} started on port ${MOCK_4MICA_PORT}`));
          resolve();
        } else if (name === 'facilitator' && output.includes('Mock 4Mica Facilitator running')) {
          started = true;
          console.log(chalk.green(`  ✓ ${name} started on port ${FACILITATOR_PORT}`));
          resolve();
        } else if (name === 'game-server' && output.includes('Game server started')) {
          started = true;
          console.log(chalk.green(`  ✓ ${name} started on port ${GAME_SERVER_PORT}`));
          resolve();
        } else if (name === 'ai-agents' && output.includes('All agents running')) {
          started = true;
          console.log(chalk.green(`  ✓ ${name} started (Groq LLM)`));
          resolve();
        }
      }

      // Forward output with prefix
      output.split('\n').filter(Boolean).forEach(line => {
        console.log(chalk.gray(`[${name}]`), line);
      });
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const output = data.toString();
      output.split('\n').filter(Boolean).forEach(line => {
        console.log(chalk.red(`[${name}]`), line);
      });
    });

    proc.on('error', (error) => {
      console.error(chalk.red(`[${name}] Error:`), error);
      if (!started) reject(error);
    });

    proc.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.log(chalk.yellow(`[${name}] Exited with code ${code}`));
      }
      processes.delete(name);
    });

    // Timeout if process doesn't start
    setTimeout(() => {
      if (!started) {
        console.log(chalk.yellow(`  ⚠ ${name} may have started (no confirmation received)`));
        resolve();
      }
    }, 10000);
  });
}

function stopAllProcesses(): void {
  console.log(chalk.yellow('\nStopping all processes...'));
  for (const [name, proc] of processes) {
    console.log(chalk.gray(`  Stopping ${name}...`));
    proc.kill('SIGTERM');
  }
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  console.log(chalk.bold('\n🚀 4Mica × Agent0 Solver Game - Local Mode\n'));
  console.log(chalk.gray('─'.repeat(60)));

  // Check if contracts are built
  const mockERC20Path = join(projectRoot, 'out', 'MockERC20.sol', 'MockERC20.json');
  if (!existsSync(mockERC20Path)) {
    console.log(chalk.yellow('\n⚠ Contract artifacts not found.'));
    console.log(chalk.white('  Building contracts with Forge...\n'));

    const forge = spawn('forge', ['build'], { cwd: projectRoot, stdio: 'inherit' });
    await new Promise<void>((resolve, reject) => {
      forge.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Forge build failed with code ${code}`));
      });
    });
    console.log(chalk.green('  ✓ Contracts built\n'));
  }

  // Handle shutdown
  process.on('SIGINT', () => {
    stopAllProcesses();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    stopAllProcesses();
    process.exit(0);
  });

  try {
    // 1. Start Hardhat Network
    console.log(chalk.cyan('\n1. Starting Hardhat Network...\n'));
    await startProcess('hardhat', 'npx', ['hardhat', 'node', '--port', HARDHAT_PORT.toString()]);

    // Wait a moment for Hardhat to fully initialize
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 2. Deploy contracts fresh (Hardhat resets state on every restart)
    const deploymentsPath = join(projectRoot, 'local-deployments.json');
    if (existsSync(deploymentsPath)) {
      console.log(chalk.yellow('\n  Removing stale local-deployments.json (Hardhat node is fresh)...'));
      unlinkSync(deploymentsPath);
    }

    console.log(chalk.white('  Deploying contracts to fresh Hardhat node...\n'));

    const deploy = spawn('node', ['dist/scripts/deploy-local.js'], {
      cwd: projectRoot,
      stdio: 'inherit',
    });

    await new Promise<void>((resolve, reject) => {
      deploy.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Deployment failed with code ${code}`));
      });
    });

    const deployments = JSON.parse(readFileSync(deploymentsPath, 'utf-8'));
    console.log(chalk.green('\n  ✓ Contracts deployed:'));
    console.log(chalk.gray(`    USDC: ${deployments.usdc}`));
    console.log(chalk.gray(`    AMM-Alpha: ${deployments.ammAlpha}`));

    // 3. Start Mock 4Mica API (full RPC + Facilitator simulation)
    console.log(chalk.cyan('\n2. Starting Mock 4Mica API...\n'));
    await startProcess(
      'mock-4mica',
      'node',
      ['dist/src/local/mock-4mica-api.js'],
      { MOCK_4MICA_PORT: MOCK_4MICA_PORT.toString() }
    );

    // Wait for mock 4Mica API to be ready
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 4. Start Game Server (configured for local mock 4Mica)
    console.log(chalk.cyan('\n3. Starting Game Server...\n'));
    await startProcess(
      'game-server',
      'node',
      ['dist/src/sepolia/game-server.js'],
      {
        // Override to use local configuration
        LOCAL_RPC_URL: `http://localhost:${HARDHAT_PORT}`,
        // Point 4Mica SDK to local mock API
        FOURMICA_RPC_URL: `http://localhost:${MOCK_4MICA_PORT}/`,
        FOURMICA_FACILITATOR_URL: `http://localhost:${MOCK_4MICA_PORT}`,
        // Use local mode (SDK connects to mock, not real 4Mica)
        LOCAL_MODE: 'true',
      }
    );

    // 5. Optionally start AI Agents (if GROQ_API_KEY is set)
    if (startAgents) {
      console.log(chalk.cyan('\n4. Starting AI Agents (Groq LLM)...\n'));

      // Wait a bit for game server to be fully ready
      await new Promise(resolve => setTimeout(resolve, 2000));

      await startProcess(
        'ai-agents',
        'node',
        ['dist/src/agents/run-agents.js'],
        {
          API_BASE_URL: `http://localhost:${GAME_SERVER_PORT}`,
          GROQ_API_KEY: GROQ_API_KEY!,
        }
      );
    }

    console.log(chalk.gray('\n' + '─'.repeat(60)));
    console.log(chalk.bold.green('\n✓ All components running!\n'));

    console.log(chalk.cyan('  Endpoints:'));
    console.log(chalk.white(`    Game Server:      http://localhost:${GAME_SERVER_PORT}`));
    console.log(chalk.white(`    Dashboard:        http://localhost:${GAME_SERVER_PORT}`));
    console.log(chalk.white(`    Mock 4Mica API:   http://localhost:${MOCK_4MICA_PORT}`));
    console.log(chalk.white(`    Hardhat Node:     http://localhost:${HARDHAT_PORT}`));
    console.log();

    if (startAgents) {
      console.log(chalk.cyan('  AI Agents:'));
      console.log(chalk.white('    ✓ Trader agent (Groq LLM)'));
      console.log(chalk.white('    ✓ 3 Solver agents (aggressive, balanced, conservative)'));
      console.log();
    } else {
      console.log(chalk.cyan('  To start AI agents:'));
      if (!GROQ_API_KEY || GROQ_API_KEY === 'gsk_your_groq_api_key_here') {
        console.log(chalk.yellow('    1. Get free API key at https://console.groq.com'));
        console.log(chalk.yellow('    2. Set GROQ_API_KEY in .env.local'));
        console.log(chalk.yellow('    3. Restart with: npm run start:local'));
      } else {
        console.log(chalk.gray('    npm run start:local -- --with-agents'));
      }
      console.log();
    }

    console.log(chalk.yellow('Press Ctrl+C to stop all services\n'));

    // Keep process running
    await new Promise(() => {});

  } catch (error) {
    console.error(chalk.red('\n❌ Failed to start:'), error);
    stopAllProcesses();
    process.exit(1);
  }
}

main();
