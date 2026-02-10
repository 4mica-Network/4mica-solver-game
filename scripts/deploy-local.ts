/**
 * Deploy contracts to local Hardhat Network for 4Mica × Agent0 Competitive Solver Game
 *
 * This script:
 * 1. Deploys MockUSDC and MockUSDT tokens
 * 2. Deploys two SimpleAMM instances with different price ratios
 * 3. Seeds liquidity and mints tokens to test accounts
 *
 * Uses Hardhat's built-in accounts (deterministic from mnemonic)
 *
 * Prerequisites:
 * - Run `forge build` to compile contracts
 * - Start local testnet: `npx hardhat node`
 *
 * Usage:
 *   npm run deploy:local
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  formatEther,
  type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hardhat } from 'viem/chains';
import { MockERC20ABI, SimpleAMMABI, Core4MicaABI } from '../src/lib/abis.js';
import chalk from 'chalk';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// When running compiled JS from dist/scripts/, need to go up 2 levels to project root
// When running with tsx from scripts/, only need to go up 1 level
const isCompiledJs = __dirname.includes('/dist/');
const projectRoot = isCompiledJs ? join(__dirname, '..', '..') : join(__dirname, '..');

// =============================================================================
// Hardhat Default Accounts (from default mnemonic)
// "test test test test test test test test test test test junk"
// =============================================================================

// These are the default Hardhat accounts - DO NOT use in production!
const HARDHAT_ACCOUNTS = {
  deployer: {
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as `0x${string}`,
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address,
  },
  trader1: {
    privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as `0x${string}`,
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address,
  },
  trader2: {
    privateKey: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' as `0x${string}`,
    address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as Address,
  },
  solver1: {
    privateKey: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6' as `0x${string}`,
    address: '0x90F79bf6EB2c4f870365E785982E1f101E93b906' as Address,
  },
  solver2: {
    privateKey: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a' as `0x${string}`,
    address: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65' as Address,
  },
  solver3: {
    privateKey: '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba' as `0x${string}`,
    address: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc' as Address,
  },
};

// =============================================================================
// Configuration
// =============================================================================

interface LocalDeployConfig {
  rpcUrl: string;
  chainId: number;
}

function loadConfig(): LocalDeployConfig {
  return {
    rpcUrl: process.env.LOCAL_RPC_URL || 'http://127.0.0.1:8545',
    chainId: 31337, // Hardhat Network chain ID
  };
}

// =============================================================================
// Contract Loading
// =============================================================================

interface ContractArtifact {
  bytecode: { object: string };
  abi: unknown[];
}

function loadContractBytecode(contractName: string): `0x${string}` {
  const artifactPath = join(projectRoot, 'out', `${contractName}.sol`, `${contractName}.json`);

  if (!existsSync(artifactPath)) {
    throw new Error(`Contract artifact not found: ${artifactPath}. Run 'forge build' first.`);
  }

  const artifact: ContractArtifact = JSON.parse(readFileSync(artifactPath, 'utf-8'));
  const bytecode = artifact.bytecode.object;

  if (bytecode.startsWith('0x')) {
    return bytecode as `0x${string}`;
  }
  return `0x${bytecode}` as `0x${string}`;
}

// =============================================================================
// Deployment Result Types
// =============================================================================

interface DeployedContracts {
  usdc: Address;
  usdt: Address;
  ammAlpha: Address;
  ammBeta: Address;
  core4Mica: Address;
  deployedAt: string;
  deployer: Address;
  chainId: number;
  network: string;
  accounts: {
    deployer: Address;
    trader1: Address;
    trader2: Address;
    solver1: Address;
    solver2: Address;
    solver3: Address;
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

function formatTokenAmount(amount: bigint, decimals: number = 6): string {
  const divisor = BigInt(10 ** decimals);
  return (Number(amount) / Number(divisor)).toLocaleString();
}

// =============================================================================
// Main Deployment Function
// =============================================================================

async function deploy(): Promise<DeployedContracts> {
  console.log(chalk.bold('\n🚀 4Mica × Agent0 - Local Deployment\n'));

  const config = loadConfig();
  console.log(chalk.gray(`  Network: Hardhat Local (Chain ID: ${config.chainId})`));
  console.log(chalk.gray(`  RPC URL: ${config.rpcUrl}`));

  // Create account and clients using Hardhat's first account
  const account = privateKeyToAccount(HARDHAT_ACCOUNTS.deployer.privateKey);
  console.log(chalk.gray(`  Deployer: ${account.address}\n`));

  const walletClient = createWalletClient({
    account,
    chain: hardhat,
    transport: http(config.rpcUrl),
  });

  const publicClient = createPublicClient({
    chain: hardhat,
    transport: http(config.rpcUrl),
  });

  // Check deployer balance
  try {
    const balance = await publicClient.getBalance({ address: account.address });
    console.log(chalk.cyan(`  Deployer balance: ${formatEther(balance)} ETH`));
  } catch (error) {
    console.log(chalk.red('\n❌ Cannot connect to local node. Make sure Hardhat Network is running:'));
    console.log(chalk.yellow('  npx hardhat node\n'));
    process.exit(1);
  }

  // Load bytecodes
  console.log(chalk.cyan('\n📦 Loading contract bytecodes...'));
  let mockERC20Bytecode: `0x${string}`;
  let simpleAMMBytecode: `0x${string}`;
  let core4MicaBytecode: `0x${string}`;

  try {
    mockERC20Bytecode = loadContractBytecode('MockERC20');
    simpleAMMBytecode = loadContractBytecode('SimpleAMM');
    core4MicaBytecode = loadContractBytecode('Core4Mica');
    console.log(chalk.green('  ✓ Bytecodes loaded'));
  } catch (error) {
    console.log(chalk.red('\n❌ Contract artifacts not found. Compile contracts first:'));
    console.log(chalk.yellow('  forge build\n'));
    process.exit(1);
  }

  // Deploy USDC
  console.log(chalk.cyan('\n🪙 Deploying MockUSDC...'));
  const usdcHash = await walletClient.deployContract({
    abi: MockERC20ABI,
    bytecode: mockERC20Bytecode,
    args: ['USD Coin (Local)', 'USDC'],
  });
  const usdcReceipt = await publicClient.waitForTransactionReceipt({ hash: usdcHash });
  const usdcAddress = usdcReceipt.contractAddress!;
  console.log(chalk.green(`  ✓ USDC deployed: ${usdcAddress}`));

  // Deploy USDT
  console.log(chalk.cyan('\n🪙 Deploying MockUSDT...'));
  const usdtHash = await walletClient.deployContract({
    abi: MockERC20ABI,
    bytecode: mockERC20Bytecode,
    args: ['Tether USD (Local)', 'USDT'],
  });
  const usdtReceipt = await publicClient.waitForTransactionReceipt({ hash: usdtHash });
  const usdtAddress = usdtReceipt.contractAddress!;
  console.log(chalk.green(`  ✓ USDT deployed: ${usdtAddress}`));

  // Deploy AMM-Alpha
  console.log(chalk.cyan('\n🔄 Deploying AMM-Alpha...'));
  const ammAlphaHash = await walletClient.deployContract({
    abi: SimpleAMMABI,
    bytecode: simpleAMMBytecode,
    args: [usdcAddress, usdtAddress],
  });
  const ammAlphaReceipt = await publicClient.waitForTransactionReceipt({ hash: ammAlphaHash });
  const ammAlphaAddress = ammAlphaReceipt.contractAddress!;
  console.log(chalk.green(`  ✓ AMM-Alpha deployed: ${ammAlphaAddress}`));

  // Deploy AMM-Beta
  console.log(chalk.cyan('\n🔄 Deploying AMM-Beta...'));
  const ammBetaHash = await walletClient.deployContract({
    abi: SimpleAMMABI,
    bytecode: simpleAMMBytecode,
    args: [usdcAddress, usdtAddress],
  });
  const ammBetaReceipt = await publicClient.waitForTransactionReceipt({ hash: ammBetaHash });
  const ammBetaAddress = ammBetaReceipt.contractAddress!;
  console.log(chalk.green(`  ✓ AMM-Beta deployed: ${ammBetaAddress}`));

  // ==========================================================================
  // Setup: Mint tokens and add liquidity
  // ==========================================================================

  console.log(chalk.cyan('\n💰 Minting tokens...'));
  const totalMintAmount = 10_000_000_000000n; // 10M tokens

  await walletClient.writeContract({
    address: usdcAddress,
    abi: MockERC20ABI,
    functionName: 'mint',
    args: [account.address, totalMintAmount],
  });

  await walletClient.writeContract({
    address: usdtAddress,
    abi: MockERC20ABI,
    functionName: 'mint',
    args: [account.address, totalMintAmount],
  });
  console.log(chalk.green(`  ✓ Minted ${formatTokenAmount(totalMintAmount)} USDC and USDT`));

  // Approve AMMs
  console.log(chalk.cyan('\n🔓 Approving AMMs...'));
  const maxApproval = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

  await walletClient.writeContract({
    address: usdcAddress,
    abi: MockERC20ABI,
    functionName: 'approve',
    args: [ammAlphaAddress, maxApproval],
  });
  await walletClient.writeContract({
    address: usdtAddress,
    abi: MockERC20ABI,
    functionName: 'approve',
    args: [ammAlphaAddress, maxApproval],
  });
  await walletClient.writeContract({
    address: usdcAddress,
    abi: MockERC20ABI,
    functionName: 'approve',
    args: [ammBetaAddress, maxApproval],
  });
  await walletClient.writeContract({
    address: usdtAddress,
    abi: MockERC20ABI,
    functionName: 'approve',
    args: [ammBetaAddress, maxApproval],
  });
  console.log(chalk.green('  ✓ AMMs approved'));

  // Add liquidity to AMM-Alpha (1:1 ratio)
  console.log(chalk.cyan('\n💧 Adding liquidity to AMM-Alpha (1:1 ratio)...'));
  const liquidityAlpha = 1_000_000_000000n; // 1M each
  await walletClient.writeContract({
    address: ammAlphaAddress,
    abi: SimpleAMMABI,
    functionName: 'addLiquidity',
    args: [liquidityAlpha, liquidityAlpha],
  });
  console.log(chalk.green(`  ✓ Added ${formatTokenAmount(liquidityAlpha)} USDC + USDT`));

  // Add liquidity to AMM-Beta (1:1.01 ratio for spread)
  console.log(chalk.cyan('\n💧 Adding liquidity to AMM-Beta (1:1.01 ratio)...'));
  const liquidityBetaUsdc = 1_000_000_000000n;
  const liquidityBetaUsdt = 1_010_000_000000n; // 1% more USDT
  await walletClient.writeContract({
    address: ammBetaAddress,
    abi: SimpleAMMABI,
    functionName: 'addLiquidity',
    args: [liquidityBetaUsdc, liquidityBetaUsdt],
  });
  console.log(chalk.green(`  ✓ Added ${formatTokenAmount(liquidityBetaUsdc)} USDC + ${formatTokenAmount(liquidityBetaUsdt)} USDT`));

  // ==========================================================================
  // Deploy Core4Mica contract
  // ==========================================================================

  console.log(chalk.cyan('\n🏛️  Deploying Core4Mica...'));
  const core4MicaHash = await walletClient.deployContract({
    abi: Core4MicaABI,
    bytecode: core4MicaBytecode,
    args: [],
  });
  const core4MicaReceipt = await publicClient.waitForTransactionReceipt({ hash: core4MicaHash });
  const core4MicaAddress = core4MicaReceipt.contractAddress!;
  console.log(chalk.green(`  ✓ Core4Mica deployed: ${core4MicaAddress}`));

  // Add supported assets
  console.log(chalk.cyan('\n🔧 Configuring Core4Mica...'));
  await walletClient.writeContract({
    address: core4MicaAddress,
    abi: Core4MicaABI,
    functionName: 'addSupportedAsset',
    args: [usdcAddress],
  });
  await walletClient.writeContract({
    address: core4MicaAddress,
    abi: Core4MicaABI,
    functionName: 'addSupportedAsset',
    args: [usdtAddress],
  });
  console.log(chalk.green('  ✓ USDC and USDT added as supported assets'));

  // ==========================================================================
  // Fund test accounts
  // ==========================================================================

  console.log(chalk.cyan('\n👥 Funding test accounts...'));
  const fundAmount = 100_000_000000n; // 100k each

  const testAccounts = [
    { name: 'Trader-1', address: HARDHAT_ACCOUNTS.trader1.address },
    { name: 'Trader-2', address: HARDHAT_ACCOUNTS.trader2.address },
    { name: 'Solver-1', address: HARDHAT_ACCOUNTS.solver1.address },
    { name: 'Solver-2', address: HARDHAT_ACCOUNTS.solver2.address },
    { name: 'Solver-3', address: HARDHAT_ACCOUNTS.solver3.address },
  ];

  for (const acc of testAccounts) {
    await walletClient.writeContract({
      address: usdcAddress,
      abi: MockERC20ABI,
      functionName: 'mint',
      args: [acc.address, fundAmount],
    });
    await walletClient.writeContract({
      address: usdtAddress,
      abi: MockERC20ABI,
      functionName: 'mint',
      args: [acc.address, fundAmount],
    });
    console.log(chalk.green(`  ✓ ${acc.name}: ${acc.address.slice(0, 10)}... (${formatTokenAmount(fundAmount)} each)`));
  }

  // ==========================================================================
  // Deposit collateral for traders into Core4Mica
  // ==========================================================================

  console.log(chalk.cyan('\n🔐 Depositing trader collateral into Core4Mica...'));
  const collateralAmount = 50_000_000000n; // 50k USDC each

  const traderAccounts = [
    { name: 'Trader-1', key: HARDHAT_ACCOUNTS.trader1.privateKey, address: HARDHAT_ACCOUNTS.trader1.address },
    { name: 'Trader-2', key: HARDHAT_ACCOUNTS.trader2.privateKey, address: HARDHAT_ACCOUNTS.trader2.address },
  ];

  for (const trader of traderAccounts) {
    const traderAccount = privateKeyToAccount(trader.key);
    const traderWallet = createWalletClient({
      account: traderAccount,
      chain: hardhat,
      transport: http(config.rpcUrl),
    });

    // Approve Core4Mica to pull USDC
    await traderWallet.writeContract({
      address: usdcAddress,
      abi: MockERC20ABI,
      functionName: 'approve',
      args: [core4MicaAddress, collateralAmount],
    });

    // Deposit collateral
    await traderWallet.writeContract({
      address: core4MicaAddress,
      abi: Core4MicaABI,
      functionName: 'deposit',
      args: [usdcAddress, collateralAmount],
    });

    console.log(chalk.green(`  ✓ ${trader.name}: deposited ${formatTokenAmount(collateralAmount)} USDC as collateral`));
  }

  return {
    usdc: usdcAddress,
    usdt: usdtAddress,
    ammAlpha: ammAlphaAddress,
    ammBeta: ammBetaAddress,
    core4Mica: core4MicaAddress,
    deployedAt: new Date().toISOString(),
    deployer: account.address,
    chainId: config.chainId,
    network: 'local',
    accounts: {
      deployer: HARDHAT_ACCOUNTS.deployer.address,
      trader1: HARDHAT_ACCOUNTS.trader1.address,
      trader2: HARDHAT_ACCOUNTS.trader2.address,
      solver1: HARDHAT_ACCOUNTS.solver1.address,
      solver2: HARDHAT_ACCOUNTS.solver2.address,
      solver3: HARDHAT_ACCOUNTS.solver3.address,
    },
  };
}

// =============================================================================
// Main Entry Point
// =============================================================================

async function main() {
  try {
    const deployment = await deploy();

    // Save deployment addresses
    const deploymentsPath = join(projectRoot, 'local-deployments.json');
    writeFileSync(deploymentsPath, JSON.stringify(deployment, null, 2));
    console.log(chalk.green(`\n✓ Deployment saved to local-deployments.json`));

    // Generate .env.local file
    const envContent = `# 4Mica × Agent0 - Local Environment Configuration
# Generated at ${deployment.deployedAt}

# =============================================================================
# LOCAL NETWORK
# =============================================================================

LOCAL_RPC_URL=http://127.0.0.1:8545
LOCAL_CHAIN_ID=31337

# =============================================================================
# CONTRACT ADDRESSES
# =============================================================================

USDC_ADDRESS=${deployment.usdc}
USDT_ADDRESS=${deployment.usdt}
AMM_ALPHA_ADDRESS=${deployment.ammAlpha}
AMM_BETA_ADDRESS=${deployment.ammBeta}
CORE_4MICA_ADDRESS=${deployment.core4Mica}

# =============================================================================
# TEST ACCOUNTS (Hardhat default accounts - DO NOT USE IN PRODUCTION)
# =============================================================================

# Traders
TRADER_SPREADHAWK_PRIVATE_KEY=${HARDHAT_ACCOUNTS.trader1.privateKey}
TRADER_DEEPSCAN_PRIVATE_KEY=${HARDHAT_ACCOUNTS.trader2.privateKey}

# Solvers
SOLVER_ALPHASTRIKE_PRIVATE_KEY=${HARDHAT_ACCOUNTS.solver1.privateKey}
SOLVER_PROFITMAX_PRIVATE_KEY=${HARDHAT_ACCOUNTS.solver2.privateKey}
SOLVER_BALANCED_PRIVATE_KEY=${HARDHAT_ACCOUNTS.solver3.privateKey}

# =============================================================================
# SERVER CONFIGURATION
# =============================================================================

SERVER_PORT=3001
PRICE_CHECK_INTERVAL_MS=2000
SPREAD_THRESHOLD_BPS=30
SETTLEMENT_WINDOW_SECONDS=30

# Local mode uses mock SDK against Hardhat (same code paths as Sepolia)
FOURMICA_RPC_URL=http://127.0.0.1:8545
FOURMICA_FACILITATOR_URL=http://127.0.0.1:8545
FOURMICA_USDC_ADDRESS=${deployment.usdc}
LOCAL_MODE=true

# =============================================================================
# AI AGENTS (Groq LLM for autonomous trading)
# =============================================================================

# Get your free API key at https://console.groq.com
GROQ_API_KEY=${process.env.GROQ_API_KEY || 'gsk_your_groq_api_key_here'}
TRADER_AGENT_ID=Trader-SpreadHawk
SOLVER_1_ID=Solver-AlphaStrike
SOLVER_2_ID=Solver-ProfitMax
SOLVER_3_ID=Solver-Balanced
API_BASE_URL=http://localhost:3001
`;

    const envPath = join(projectRoot, '.env.local');
    writeFileSync(envPath, envContent);
    console.log(chalk.green(`✓ Environment saved to .env.local`));

    // Print summary
    console.log(chalk.bold('\n📋 Local Deployment Summary\n'));
    console.log(chalk.cyan('  Network:    ') + chalk.white('Hardhat Local'));
    console.log(chalk.cyan('  Chain ID:   ') + chalk.white(deployment.chainId));
    console.log();
    console.log(chalk.cyan('  Contracts:'));
    console.log(`    USDC:      ${deployment.usdc}`);
    console.log(`    USDT:      ${deployment.usdt}`);
    console.log(`    AMM-Alpha: ${deployment.ammAlpha}`);
    console.log(`    AMM-Beta:  ${deployment.ammBeta}`);
    console.log(`    Core4Mica: ${deployment.core4Mica}`);
    console.log();
    console.log(chalk.cyan('  Test Accounts:'));
    console.log(`    Trader-1:  ${deployment.accounts.trader1}`);
    console.log(`    Trader-2:  ${deployment.accounts.trader2}`);
    console.log(`    Solver-1:  ${deployment.accounts.solver1}`);
    console.log(`    Solver-2:  ${deployment.accounts.solver2}`);
    console.log(`    Solver-3:  ${deployment.accounts.solver3}`);
    console.log();

    console.log(chalk.bold('🎯 Next Steps\n'));
    console.log(chalk.white('  Start the local game server:'));
    console.log(chalk.gray('    npm run start:local\n'));

    console.log(chalk.green.bold('✓ Local deployment complete!\n'));

  } catch (error) {
    console.error(chalk.red('\n❌ Deployment failed:'), error);
    process.exit(1);
  }
}

main();
