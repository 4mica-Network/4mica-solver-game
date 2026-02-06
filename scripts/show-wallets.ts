/**
 * Show All Wallet Addresses for Funding
 */

import { config as dotenvConfig } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { privateKeyToAccount } from 'viem/accounts';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: join(__dirname, '..', '.env.sepolia') });

const WALLETS = [
  // Traders
  { name: 'Trader-SpreadHawk', envKey: 'TRADER_SPREADHAWK_PRIVATE_KEY', role: 'trader' },
  { name: 'Trader-DeepScan', envKey: 'TRADER_DEEPSCAN_PRIVATE_KEY', role: 'trader' },
  { name: 'Trader-QuickFlip', envKey: 'TRADER_QUICKFLIP_PRIVATE_KEY', role: 'trader' },
  { name: 'Trader-SteadyEdge', envKey: 'TRADER_STEADYEDGE_PRIVATE_KEY', role: 'trader' },
  // Solvers
  { name: 'Solver-AlphaStrike', envKey: 'SOLVER_ALPHASTRIKE_PRIVATE_KEY', role: 'solver' },
  { name: 'Solver-ProfitMax', envKey: 'SOLVER_PROFITMAX_PRIVATE_KEY', role: 'solver' },
  { name: 'Solver-Balanced', envKey: 'SOLVER_BALANCED_PRIVATE_KEY', role: 'solver' },
  { name: 'Solver-CoWMatcher', envKey: 'SOLVER_COWMATCHER_PRIVATE_KEY', role: 'solver' },
  { name: 'Solver-GasOptimizer', envKey: 'SOLVER_GASOPTIMIZER_PRIVATE_KEY', role: 'solver' },
];

console.log('📋 Wallet Addresses for 4Mica Demo\n');
console.log('Circle USDC Faucet: https://faucet.circle.com/\n');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('SOLVERS (need USDC for recipient operations)');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

for (const wallet of WALLETS.filter(w => w.role === 'solver')) {
  const key = process.env[wallet.envKey] as `0x${string}`;
  if (key) {
    const account = privateKeyToAccount(key);
    console.log(`${wallet.name.padEnd(20)} ${account.address}`);
  } else {
    console.log(`${wallet.name.padEnd(20)} ❌ Key not found`);
  }
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('TRADERS (already funded - for reference)');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

for (const wallet of WALLETS.filter(w => w.role === 'trader')) {
  const key = process.env[wallet.envKey] as `0x${string}`;
  if (key) {
    const account = privateKeyToAccount(key);
    console.log(`${wallet.name.padEnd(20)} ${account.address}`);
  } else {
    console.log(`${wallet.name.padEnd(20)} ❌ Key not found`);
  }
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('STEPS:');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('1. Get USDC from Circle faucet (20 USDC/hour limit)');
console.log('2. Send ~2-3 USDC to at least ONE solver address above');
console.log('3. Run: npm run deposit:collateral');
console.log('4. Run: npm run start:sepolia');
console.log('5. Run: cd react-demo && npm run dev');
console.log('');
