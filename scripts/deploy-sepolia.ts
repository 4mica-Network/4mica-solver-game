/**
 * Deploy contracts to Ethereum Sepolia for 4Mica × Agent0 Competitive Solver Game
 *
 * This script deploys:
 * - MockUSDC and MockUSDT tokens
 * - Two SimpleAMM instances (AMM-Alpha and AMM-Beta) with different price ratios
 * - Seeds liquidity pools
 * - Mints test tokens to all agent wallets
 *
 * Prerequisites:
 * - Run `forge build` to compile contracts
 * - Set up .env.sepolia with valid RPC URL and deployer private key
 * - Fund deployer wallet with Sepolia ETH (~0.1 ETH recommended)
 *
 * Usage:
 *   npm run deploy:sepolia
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  formatEther,
  type Address,
  type Hash,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { MockERC20ABI, SimpleAMMABI } from '../src/lib/abis';
import chalk from 'chalk';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config as dotenvConfig } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load Sepolia environment
dotenvConfig({ path: join(__dirname, '..', '.env.sepolia') });

// =============================================================================
// Configuration
// =============================================================================

interface SepoliaDeployConfig {
  rpcUrl: string;
  deployerPrivateKey: `0x${string}`;
  chainId: number;
}

function loadConfig(): SepoliaDeployConfig {
  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.TRADER_SPREADHAWK_PRIVATE_KEY;

  if (!rpcUrl) {
    throw new Error('SEPOLIA_RPC_URL not set in .env.sepolia');
  }
  if (!deployerKey || deployerKey === '0x') {
    throw new Error('DEPLOYER_PRIVATE_KEY (or TRADER_SPREADHAWK_PRIVATE_KEY) not set in .env.sepolia');
  }

  return {
    rpcUrl,
    deployerPrivateKey: deployerKey.startsWith('0x') ? deployerKey as `0x${string}` : `0x${deployerKey}`,
    chainId: parseInt(process.env.SEPOLIA_CHAIN_ID || '11155111'),
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
  const artifactPath = join(__dirname, '..', 'out', `${contractName}.sol`, `${contractName}.json`);

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
  deployedAt: string;
  deployer: Address;
  chainId: number;
  network: string;
}

// =============================================================================
// Helper Functions
// =============================================================================

function formatTokenAmount(amount: bigint, decimals: number = 6): string {
  const divisor = BigInt(10 ** decimals);
  return (Number(amount) / Number(divisor)).toLocaleString();
}

async function waitWithSpinner(promise: Promise<any>, message: string): Promise<any> {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;

  const interval = setInterval(() => {
    process.stdout.write(`\r${chalk.cyan(frames[i++ % frames.length])} ${message}`);
  }, 100);

  try {
    const result = await promise;
    clearInterval(interval);
    process.stdout.write('\r' + ' '.repeat(message.length + 10) + '\r');
    return result;
  } catch (error) {
    clearInterval(interval);
    process.stdout.write('\r');
    throw error;
  }
}

// =============================================================================
// Agent Wallet Configuration
// =============================================================================

interface AgentWallet {
  name: string;
  envKey: string;
  fundAmount: bigint;
}

const AGENT_WALLETS: AgentWallet[] = [
  // Trading Agents
  { name: 'Trader-SpreadHawk', envKey: 'TRADER_SPREADHAWK_PRIVATE_KEY', fundAmount: 10_000_000000n },
  { name: 'Trader-DeepScan', envKey: 'TRADER_DEEPSCAN_PRIVATE_KEY', fundAmount: 10_000_000000n },
  // Solver Agents
  { name: 'Solver-AlphaStrike', envKey: 'SOLVER_ALPHASTRIKE_PRIVATE_KEY', fundAmount: 50_000_000000n },
  { name: 'Solver-ProfitMax', envKey: 'SOLVER_PROFITMAX_PRIVATE_KEY', fundAmount: 50_000_000000n },
  { name: 'Solver-Balanced', envKey: 'SOLVER_BALANCED_PRIVATE_KEY', fundAmount: 50_000_000000n },
  { name: 'Solver-CoWMatcher', envKey: 'SOLVER_COWMATCHER_PRIVATE_KEY', fundAmount: 50_000_000000n },
  { name: 'Solver-GasOptimizer', envKey: 'SOLVER_GASOPTIMIZER_PRIVATE_KEY', fundAmount: 50_000_000000n },
];

// =============================================================================
// Main Deployment Function
// =============================================================================

async function deploy(): Promise<DeployedContracts> {
  console.log(chalk.bold('\n🚀 4Mica × Agent0 - Sepolia Deployment\n'));

  // Load configuration
  const config = loadConfig();
  console.log(chalk.gray(`  Network: Sepolia (Chain ID: ${config.chainId})`));
  console.log(chalk.gray(`  RPC URL: ${config.rpcUrl.substring(0, 50)}...`));

  // Create account and clients
  const account = privateKeyToAccount(config.deployerPrivateKey);
  console.log(chalk.gray(`  Deployer: ${account.address}\n`));

  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(config.rpcUrl),
  });

  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(config.rpcUrl),
  });

  // Check deployer balance
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(chalk.cyan(`  Deployer balance: ${formatEther(balance)} ETH`));

  if (balance < BigInt(0.01 * 10 ** 18)) {
    console.log(chalk.red('\n❌ Insufficient ETH balance. Need at least 0.01 ETH for deployment.'));
    console.log(chalk.yellow('  Get Sepolia ETH from: https://sepoliafaucet.com/\n'));
    process.exit(1);
  }

  // Load bytecodes
  console.log(chalk.cyan('\n📦 Loading contract bytecodes...'));
  const mockERC20Bytecode = loadContractBytecode('MockERC20');
  const simpleAMMBytecode = loadContractBytecode('SimpleAMM');
  console.log(chalk.green('  ✓ Bytecodes loaded'));

  // Deploy USDC
  console.log(chalk.cyan('\n🪙 Deploying MockUSDC...'));
  const usdcHash = await walletClient.deployContract({
    abi: MockERC20ABI,
    bytecode: mockERC20Bytecode,
    args: ['USD Coin (Test)', 'USDC'],
  });
  console.log(chalk.gray(`  Tx: ${usdcHash}`));
  const usdcReceipt = await waitWithSpinner(
    publicClient.waitForTransactionReceipt({ hash: usdcHash }),
    'Waiting for confirmation...'
  );
  const usdcAddress = usdcReceipt.contractAddress!;
  console.log(chalk.green(`  ✓ USDC deployed: ${usdcAddress}`));

  // Deploy USDT
  console.log(chalk.cyan('\n🪙 Deploying MockUSDT...'));
  const usdtHash = await walletClient.deployContract({
    abi: MockERC20ABI,
    bytecode: mockERC20Bytecode,
    args: ['Tether USD (Test)', 'USDT'],
  });
  console.log(chalk.gray(`  Tx: ${usdtHash}`));
  const usdtReceipt = await waitWithSpinner(
    publicClient.waitForTransactionReceipt({ hash: usdtHash }),
    'Waiting for confirmation...'
  );
  const usdtAddress = usdtReceipt.contractAddress!;
  console.log(chalk.green(`  ✓ USDT deployed: ${usdtAddress}`));

  // Deploy AMM-Alpha
  console.log(chalk.cyan('\n🔄 Deploying AMM-Alpha...'));
  const ammAlphaHash = await walletClient.deployContract({
    abi: SimpleAMMABI,
    bytecode: simpleAMMBytecode,
    args: [usdcAddress, usdtAddress],
  });
  console.log(chalk.gray(`  Tx: ${ammAlphaHash}`));
  const ammAlphaReceipt = await waitWithSpinner(
    publicClient.waitForTransactionReceipt({ hash: ammAlphaHash }),
    'Waiting for confirmation...'
  );
  const ammAlphaAddress = ammAlphaReceipt.contractAddress!;
  console.log(chalk.green(`  ✓ AMM-Alpha deployed: ${ammAlphaAddress}`));

  // Deploy AMM-Beta
  console.log(chalk.cyan('\n🔄 Deploying AMM-Beta...'));
  const ammBetaHash = await walletClient.deployContract({
    abi: SimpleAMMABI,
    bytecode: simpleAMMBytecode,
    args: [usdcAddress, usdtAddress],
  });
  console.log(chalk.gray(`  Tx: ${ammBetaHash}`));
  const ammBetaReceipt = await waitWithSpinner(
    publicClient.waitForTransactionReceipt({ hash: ammBetaHash }),
    'Waiting for confirmation...'
  );
  const ammBetaAddress = ammBetaReceipt.contractAddress!;
  console.log(chalk.green(`  ✓ AMM-Beta deployed: ${ammBetaAddress}`));

  // ==========================================================================
  // Setup: Mint tokens and add liquidity
  // ==========================================================================

  console.log(chalk.cyan('\n💰 Minting tokens for liquidity...'));
  const totalMintAmount = 1_000_000_000000n; // 1M tokens for liquidity + agent funding

  const mint1Hash = await walletClient.writeContract({
    address: usdcAddress,
    abi: MockERC20ABI,
    functionName: 'mint',
    args: [account.address, totalMintAmount],
  });
  await publicClient.waitForTransactionReceipt({ hash: mint1Hash });

  const mint2Hash = await walletClient.writeContract({
    address: usdtAddress,
    abi: MockERC20ABI,
    functionName: 'mint',
    args: [account.address, totalMintAmount],
  });
  await publicClient.waitForTransactionReceipt({ hash: mint2Hash });
  console.log(chalk.green(`  ✓ Minted ${formatTokenAmount(totalMintAmount)} USDC and USDT`));

  // Approve AMMs
  console.log(chalk.cyan('\n🔓 Approving AMMs to spend tokens...'));
  const approveHash1 = await walletClient.writeContract({
    address: usdcAddress,
    abi: MockERC20ABI,
    functionName: 'approve',
    args: [ammAlphaAddress, totalMintAmount],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash1 });

  const approveHash2 = await walletClient.writeContract({
    address: usdtAddress,
    abi: MockERC20ABI,
    functionName: 'approve',
    args: [ammAlphaAddress, totalMintAmount],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash2 });

  const approveHash3 = await walletClient.writeContract({
    address: usdcAddress,
    abi: MockERC20ABI,
    functionName: 'approve',
    args: [ammBetaAddress, totalMintAmount],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash3 });

  const approveHash4 = await walletClient.writeContract({
    address: usdtAddress,
    abi: MockERC20ABI,
    functionName: 'approve',
    args: [ammBetaAddress, totalMintAmount],
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash4 });
  console.log(chalk.green('  ✓ AMMs approved'));

  // Add liquidity to AMM-Alpha (1:1 ratio)
  console.log(chalk.cyan('\n💧 Adding liquidity to AMM-Alpha (1:1 ratio)...'));
  const liquidityAlpha = 100_000_000000n; // 100k each
  const liqAlphaHash = await walletClient.writeContract({
    address: ammAlphaAddress,
    abi: SimpleAMMABI,
    functionName: 'addLiquidity',
    args: [liquidityAlpha, liquidityAlpha],
  });
  await publicClient.waitForTransactionReceipt({ hash: liqAlphaHash });
  console.log(chalk.green(`  ✓ Added ${formatTokenAmount(liquidityAlpha)} USDC + ${formatTokenAmount(liquidityAlpha)} USDT`));

  // Add liquidity to AMM-Beta (slightly different ratio to create initial spread)
  console.log(chalk.cyan('\n💧 Adding liquidity to AMM-Beta (1:1.005 ratio for initial spread)...'));
  const liquidityBetaUsdc = 100_000_000000n;
  const liquidityBetaUsdt = 100_500_000000n; // 0.5% more USDT for initial spread
  const liqBetaHash = await walletClient.writeContract({
    address: ammBetaAddress,
    abi: SimpleAMMABI,
    functionName: 'addLiquidity',
    args: [liquidityBetaUsdc, liquidityBetaUsdt],
  });
  await publicClient.waitForTransactionReceipt({ hash: liqBetaHash });
  console.log(chalk.green(`  ✓ Added ${formatTokenAmount(liquidityBetaUsdc)} USDC + ${formatTokenAmount(liquidityBetaUsdt)} USDT`));

  // ==========================================================================
  // Fund agent wallets
  // ==========================================================================

  console.log(chalk.cyan('\n👥 Funding agent wallets with test tokens...'));

  let fundedCount = 0;
  for (const agent of AGENT_WALLETS) {
    const privateKey = process.env[agent.envKey];
    if (!privateKey || privateKey === '0x') {
      console.log(chalk.yellow(`  ⚠ Skipping ${agent.name} (no private key set)`));
      continue;
    }

    const agentAccount = privateKeyToAccount(
      privateKey.startsWith('0x') ? privateKey as `0x${string}` : `0x${privateKey}`
    );

    try {
      // Mint USDC to agent
      const mintUsdcHash = await walletClient.writeContract({
        address: usdcAddress,
        abi: MockERC20ABI,
        functionName: 'mint',
        args: [agentAccount.address, agent.fundAmount],
      });
      await publicClient.waitForTransactionReceipt({ hash: mintUsdcHash });

      // Mint USDT to agent
      const mintUsdtHash = await walletClient.writeContract({
        address: usdtAddress,
        abi: MockERC20ABI,
        functionName: 'mint',
        args: [agentAccount.address, agent.fundAmount],
      });
      await publicClient.waitForTransactionReceipt({ hash: mintUsdtHash });

      console.log(chalk.green(`  ✓ ${agent.name}: ${agentAccount.address} (${formatTokenAmount(agent.fundAmount)} each)`));
      fundedCount++;
    } catch (error) {
      console.log(chalk.red(`  ✗ Failed to fund ${agent.name}: ${error}`));
    }
  }

  console.log(chalk.green(`\n  ✓ Funded ${fundedCount}/${AGENT_WALLETS.length} agent wallets`));

  // ==========================================================================
  // Return deployment result
  // ==========================================================================

  return {
    usdc: usdcAddress,
    usdt: usdtAddress,
    ammAlpha: ammAlphaAddress,
    ammBeta: ammBetaAddress,
    deployedAt: new Date().toISOString(),
    deployer: account.address,
    chainId: config.chainId,
    network: 'sepolia',
  };
}

// =============================================================================
// Main Entry Point
// =============================================================================

async function main() {
  try {
    const deployment = await deploy();

    // Save deployment addresses
    const deploymentsPath = join(__dirname, '..', 'sepolia-deployments.json');
    writeFileSync(deploymentsPath, JSON.stringify(deployment, null, 2));
    console.log(chalk.green(`\n✓ Deployment addresses saved to sepolia-deployments.json`));

    // Print summary
    console.log(chalk.bold('\n📋 Deployment Summary\n'));
    console.log(chalk.cyan('  Network:    ') + chalk.white('Sepolia'));
    console.log(chalk.cyan('  Chain ID:   ') + chalk.white(deployment.chainId));
    console.log(chalk.cyan('  Deployer:   ') + chalk.white(deployment.deployer));
    console.log(chalk.cyan('  Deployed:   ') + chalk.white(deployment.deployedAt));
    console.log();
    console.log(chalk.cyan('  Contracts:'));
    console.log(`    USDC:      ${deployment.usdc}`);
    console.log(`    USDT:      ${deployment.usdt}`);
    console.log(`    AMM-Alpha: ${deployment.ammAlpha}`);
    console.log(`    AMM-Beta:  ${deployment.ammBeta}`);
    console.log();

    // Print verification commands
    console.log(chalk.bold('📝 Verification Commands (optional)\n'));
    console.log(chalk.gray('  forge verify-contract --chain sepolia \\'));
    console.log(chalk.gray(`    ${deployment.usdc} MockERC20 \\`));
    console.log(chalk.gray(`    --constructor-args \$(cast abi-encode "constructor(string,string)" "USD Coin (Test)" "USDC")`));
    console.log();

    // Print next steps
    console.log(chalk.bold('🎯 Next Steps\n'));
    console.log(chalk.white('  1. Update .env.sepolia with contract addresses:'));
    console.log(chalk.gray(`     USDC_ADDRESS=${deployment.usdc}`));
    console.log(chalk.gray(`     USDT_ADDRESS=${deployment.usdt}`));
    console.log(chalk.gray(`     AMM_ALPHA_ADDRESS=${deployment.ammAlpha}`));
    console.log(chalk.gray(`     AMM_BETA_ADDRESS=${deployment.ammBeta}`));
    console.log();
    console.log(chalk.white('  2. Generate and fund agent wallets:'));
    console.log(chalk.gray('     npm run generate:wallets'));
    console.log(chalk.gray('     Fund each wallet with ~0.05 ETH for gas'));
    console.log();
    console.log(chalk.white('  3. Register agents with Agent0:'));
    console.log(chalk.gray('     npm run register:agents'));
    console.log();

    console.log(chalk.green.bold('✓ Sepolia deployment complete!\n'));

  } catch (error) {
    console.error(chalk.red('\n❌ Deployment failed:'), error);
    process.exit(1);
  }
}

main();
