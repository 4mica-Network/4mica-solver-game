/**
 * Deposit Collateral into 4Mica for All Trader Wallets
 *
 * This script:
 * 1. Connects to each trader wallet
 * 2. Checks their USDC balance
 * 3. Approves 4Mica to spend USDC
 * 4. Deposits USDC into 4Mica as collateral
 */

import { config as dotenvConfig } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseUnits,
  formatUnits,
  type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { Client, ConfigBuilder } from '@4mica/sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load environment
dotenvConfig({ path: join(__dirname, '..', '.env.sepolia') });

// Configuration
const FOURMICA_RPC_URL = process.env.FOURMICA_RPC_URL || 'https://ethereum.sepolia.api.4mica.xyz/';
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL!;
// Use official Circle USDC for 4Mica (not our custom AMM USDC)
const FOURMICA_USDC_ADDRESS = (process.env.FOURMICA_USDC_ADDRESS || '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238') as Address;

// All wallets that need collateral (traders AND solvers)
const WALLETS = [
  // Traders (need collateral to back their payment guarantees)
  { name: 'Trader-SpreadHawk', key: process.env.TRADER_SPREADHAWK_PRIVATE_KEY as `0x${string}`, role: 'trader' },
  { name: 'Trader-DeepScan', key: process.env.TRADER_DEEPSCAN_PRIVATE_KEY as `0x${string}`, role: 'trader' },
  { name: 'Trader-QuickFlip', key: process.env.TRADER_QUICKFLIP_PRIVATE_KEY as `0x${string}`, role: 'trader' },
  { name: 'Trader-SteadyEdge', key: process.env.TRADER_STEADYEDGE_PRIVATE_KEY as `0x${string}`, role: 'trader' },
  // Solvers (need collateral for recipient operations scope)
  { name: 'Solver-AlphaStrike', key: process.env.SOLVER_ALPHASTRIKE_PRIVATE_KEY as `0x${string}`, role: 'solver' },
  { name: 'Solver-ProfitMax', key: process.env.SOLVER_PROFITMAX_PRIVATE_KEY as `0x${string}`, role: 'solver' },
  { name: 'Solver-Balanced', key: process.env.SOLVER_BALANCED_PRIVATE_KEY as `0x${string}`, role: 'solver' },
  { name: 'Solver-CoWMatcher', key: process.env.SOLVER_COWMATCHER_PRIVATE_KEY as `0x${string}`, role: 'solver' },
  { name: 'Solver-GasOptimizer', key: process.env.SOLVER_GASOPTIMIZER_PRIVATE_KEY as `0x${string}`, role: 'solver' },
].filter(w => w.key); // Only include wallets with keys

// ERC20 ABI for USDC operations
const ERC20_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'decimals',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },
] as const;

// Minimum balance to keep (don't deposit everything)
const MIN_KEEP_BALANCE = parseUnits('1', 6); // Keep 1 USDC as buffer

async function main() {
  console.log('🏦 4Mica Collateral Deposit Script\n');
  console.log(`Circle USDC Address: ${FOURMICA_USDC_ADDRESS}`);
  console.log(`4Mica RPC: ${FOURMICA_RPC_URL}`);
  console.log(`Mode: Deposit available balance (keeping 1 USDC buffer)\n`);

  // Create public client for reading
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(SEPOLIA_RPC_URL),
  });

  // Get USDC decimals
  const decimals = await publicClient.readContract({
    address: FOURMICA_USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'decimals',
  });
  console.log(`USDC Decimals: ${decimals}\n`);

  for (const wallet of WALLETS) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📊 Processing: ${wallet.name} (${wallet.role})`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    try {
      const account = privateKeyToAccount(wallet.key);
      console.log(`   Address: ${account.address}`);

      // Check USDC balance (Circle USDC for 4Mica)
      const usdcBalance = await publicClient.readContract({
        address: FOURMICA_USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [account.address],
      });
      console.log(`   Circle USDC Balance: ${formatUnits(usdcBalance, 6)} USDC`);

      // Calculate deposit amount (balance minus buffer)
      const depositAmount = usdcBalance > MIN_KEEP_BALANCE ? usdcBalance - MIN_KEEP_BALANCE : 0n;

      if (depositAmount <= 0n) {
        console.log(`   ❌ No USDC available to deposit (need more than 1 USDC)`);
        console.log(`   💡 Get testnet USDC from Circle faucet: https://faucet.circle.com/`);
        continue;
      }

      console.log(`   💰 Will deposit: ${formatUnits(depositAmount, 6)} USDC`);

      // Check ETH balance for gas
      const ethBalance = await publicClient.getBalance({ address: account.address });
      console.log(`   ETH Balance: ${formatUnits(ethBalance, 18)} ETH`);

      if (ethBalance < parseUnits('0.01', 18)) {
        console.log(`   ❌ Insufficient ETH for gas. Need at least 0.01 ETH`);
        continue;
      }

      // Initialize 4Mica client
      console.log(`   🔐 Connecting to 4Mica...`);
      const cfg = new ConfigBuilder()
        .rpcUrl(FOURMICA_RPC_URL)
        .walletPrivateKey(wallet.key)
        .enableAuth()
        .build();

      const fourMicaClient = await Client.new(cfg);
      await fourMicaClient.login();
      console.log(`   ✓ Authenticated with 4Mica`);

      // Check current 4Mica collateral
      const userInfos = await fourMicaClient.user.getUser();
      const existingCollateral = userInfos.find(u =>
        u.asset.toLowerCase() === FOURMICA_USDC_ADDRESS.toLowerCase()
      );

      if (existingCollateral && existingCollateral.collateral > 0n) {
        console.log(`   📊 Existing 4Mica collateral: ${formatUnits(existingCollateral.collateral, 6)} USDC`);
      }

      // Approve USDC spending by 4Mica
      console.log(`   📝 Approving USDC for 4Mica...`);
      const approveReceipt = await fourMicaClient.user.approveErc20(FOURMICA_USDC_ADDRESS, depositAmount);
      console.log(`   ✓ Approved - TX: ${approveReceipt.transactionHash}`);

      // Deposit into 4Mica
      console.log(`   💰 Depositing ${formatUnits(depositAmount, 6)} USDC into 4Mica...`);
      const depositReceipt = await fourMicaClient.user.deposit(depositAmount, FOURMICA_USDC_ADDRESS);
      console.log(`   ✓ Deposited - TX: ${depositReceipt.transactionHash}`);

      // Verify new balance
      const newUserInfos = await fourMicaClient.user.getUser();
      const newCollateral = newUserInfos.find(u =>
        u.asset.toLowerCase() === FOURMICA_USDC_ADDRESS.toLowerCase()
      );
      if (newCollateral) {
        console.log(`   📊 New 4Mica collateral: ${formatUnits(newCollateral.collateral, 6)} USDC`);
      }

      console.log(`   ✅ ${wallet.name} setup complete!`);

      await fourMicaClient.aclose();

    } catch (error) {
      console.error(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ Collateral deposit script complete!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch(console.error);
