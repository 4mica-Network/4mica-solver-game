/**
 * Generate Wallet Keys for Agent0 Game Participants
 *
 * This script generates fresh Ethereum wallet keypairs for all agents
 * and outputs them in a format ready to paste into .env.sepolia
 *
 * Usage:
 *   npm run generate:wallets
 *
 * WARNING: These are demo keys. Never use generated keys for mainnet funds!
 */

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import chalk from 'chalk';

// =============================================================================
// Agent Definitions
// =============================================================================

interface AgentDef {
  name: string;
  envKey: string;
  role: 'trader' | 'solver';
}

const AGENTS: AgentDef[] = [
  // Trading Agents
  { name: 'Trader-SpreadHawk', envKey: 'TRADER_SPREADHAWK_PRIVATE_KEY', role: 'trader' },
  { name: 'Trader-DeepScan', envKey: 'TRADER_DEEPSCAN_PRIVATE_KEY', role: 'trader' },
  // Solver Agents
  { name: 'Solver-AlphaStrike', envKey: 'SOLVER_ALPHASTRIKE_PRIVATE_KEY', role: 'solver' },
  { name: 'Solver-ProfitMax', envKey: 'SOLVER_PROFITMAX_PRIVATE_KEY', role: 'solver' },
  { name: 'Solver-Balanced', envKey: 'SOLVER_BALANCED_PRIVATE_KEY', role: 'solver' },
  { name: 'Solver-CoWMatcher', envKey: 'SOLVER_COWMATCHER_PRIVATE_KEY', role: 'solver' },
  { name: 'Solver-GasOptimizer', envKey: 'SOLVER_GASOPTIMIZER_PRIVATE_KEY', role: 'solver' },
];

// =============================================================================
// Main Generation
// =============================================================================

function main() {
  console.log(chalk.bold('\n🔑 Generating Wallet Keys for 4Mica × Agent0 Game\n'));
  console.log(chalk.yellow('⚠️  WARNING: These are demo keys. Never use for mainnet funds!\n'));

  const traders: Array<{ name: string; address: string; envKey: string; privateKey: string }> = [];
  const solvers: Array<{ name: string; address: string; envKey: string; privateKey: string }> = [];

  for (const agent of AGENTS) {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);

    const entry = {
      name: agent.name,
      address: account.address,
      envKey: agent.envKey,
      privateKey,
    };

    if (agent.role === 'trader') {
      traders.push(entry);
    } else {
      solvers.push(entry);
    }
  }

  // Print trader wallets
  console.log(chalk.cyan('📊 Trading Agents\n'));
  console.log(chalk.gray('  ' + '-'.repeat(70)));
  for (const trader of traders) {
    console.log(chalk.white(`  ${trader.name}`));
    console.log(chalk.gray(`    Address: ${trader.address}`));
    console.log();
  }

  // Print solver wallets
  console.log(chalk.cyan('\n🏆 Solver Agents\n'));
  console.log(chalk.gray('  ' + '-'.repeat(70)));
  for (const solver of solvers) {
    console.log(chalk.white(`  ${solver.name}`));
    console.log(chalk.gray(`    Address: ${solver.address}`));
    console.log();
  }

  // Print env file format
  console.log(chalk.bold('\n📝 Copy to .env.sepolia:\n'));
  console.log(chalk.gray('# ---- Agent Private Keys ----'));
  console.log(chalk.gray('# Trading Agents'));
  for (const trader of traders) {
    console.log(`${trader.envKey}=${trader.privateKey}`);
  }
  console.log(chalk.gray('\n# Solver Agents'));
  for (const solver of solvers) {
    console.log(`${solver.envKey}=${solver.privateKey}`);
  }

  // Print funding instructions
  console.log(chalk.bold('\n💰 Funding Instructions\n'));
  console.log(chalk.white('  Each wallet needs Sepolia ETH for gas. Use one of these faucets:'));
  console.log(chalk.gray('  • https://sepoliafaucet.com/'));
  console.log(chalk.gray('  • https://www.infura.io/faucet/sepolia'));
  console.log(chalk.gray('  • https://cloud.google.com/application/web3/faucet/ethereum/sepolia\n'));

  console.log(chalk.white('  Recommended amounts:'));
  console.log(chalk.gray('  • Traders: 0.05 ETH each'));
  console.log(chalk.gray('  • Solvers: 0.1 ETH each (more transactions)\n'));

  console.log(chalk.white('  All addresses to fund:\n'));
  for (const trader of traders) {
    console.log(chalk.cyan(`  ${trader.name}: ${trader.address}`));
  }
  for (const solver of solvers) {
    console.log(chalk.green(`  ${solver.name}: ${solver.address}`));
  }

  console.log(chalk.bold('\n✅ Wallet generation complete!\n'));
}

main();
