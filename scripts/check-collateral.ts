/**
 * Check 4Mica Collateral Status for All Traders
 */

import { config as dotenvConfig } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createPublicClient, http, formatUnits, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { Client, ConfigBuilder } from '@4mica/sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: join(__dirname, '..', '.env.sepolia') });

const FOURMICA_RPC_URL = 'https://ethereum.sepolia.api.4mica.xyz/';
const FOURMICA_USDC_ADDRESS = (process.env.FOURMICA_USDC_ADDRESS || '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238') as Address;
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL!;

const TRADERS = [
  { name: 'Trader-SpreadHawk', key: process.env.TRADER_SPREADHAWK_PRIVATE_KEY as `0x${string}` },
  { name: 'Trader-DeepScan', key: process.env.TRADER_DEEPSCAN_PRIVATE_KEY as `0x${string}` },
  { name: 'Trader-QuickFlip', key: process.env.TRADER_QUICKFLIP_PRIVATE_KEY as `0x${string}` },
  { name: 'Trader-SteadyEdge', key: process.env.TRADER_STEADYEDGE_PRIVATE_KEY as `0x${string}` },
].filter(t => t.key);

const ERC20_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

async function main() {
  console.log('🔍 4Mica Collateral Status Check\n');
  console.log(`Circle USDC: ${FOURMICA_USDC_ADDRESS}`);
  console.log(`Traders found: ${TRADERS.length}\n`);

  if (TRADERS.length === 0) {
    console.log('❌ No traders found! Check your .env.sepolia file for:');
    console.log('   - TRADER_SPREADHAWK_PRIVATE_KEY');
    console.log('   - TRADER_DEEPSCAN_PRIVATE_KEY');
    console.log('   - TRADER_QUICKFLIP_PRIVATE_KEY');
    console.log('   - TRADER_STEADYEDGE_PRIVATE_KEY');
    return;
  }

  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(SEPOLIA_RPC_URL),
  });

  console.log('┌─────────────────────┬────────────────────────────────────────────┬──────────────────┬──────────────────┐');
  console.log('│ Trader              │ Address                                    │ USDC Balance     │ 4Mica Collateral │');
  console.log('├─────────────────────┼────────────────────────────────────────────┼──────────────────┼──────────────────┤');

  for (const trader of TRADERS) {
    try {
      const account = privateKeyToAccount(trader.key);

      // Check USDC balance
      const usdcBalance = await publicClient.readContract({
        address: FOURMICA_USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [account.address],
      });

      // Check 4Mica collateral
      let collateral = '---';
      try {
        const cfg = new ConfigBuilder()
          .rpcUrl(FOURMICA_RPC_URL)
          .walletPrivateKey(trader.key)
          .enableAuth()
          .build();

        const client = await Client.new(cfg);
        await client.login();

        const userInfos = await client.user.getUser();
        const usdcCollateral = userInfos.find(u =>
          u.asset.toLowerCase() === FOURMICA_USDC_ADDRESS.toLowerCase()
        );

        if (usdcCollateral && usdcCollateral.collateral > 0n) {
          collateral = formatUnits(usdcCollateral.collateral, 6) + ' USDC';
        } else {
          collateral = '0 USDC ⚠️';
        }

        await client.aclose();
      } catch (e) {
        collateral = 'Error checking';
      }

      const name = trader.name.padEnd(19);
      const addr = account.address;
      const balance = formatUnits(usdcBalance, 6).padStart(14) + ' USDC';
      const coll = collateral.padStart(16);

      console.log(`│ ${name} │ ${addr} │ ${balance} │ ${coll} │`);
    } catch (e) {
      console.log(`│ ${trader.name.padEnd(19)} │ Error loading account                      │                  │                  │`);
    }
  }

  console.log('└─────────────────────┴────────────────────────────────────────────┴──────────────────┴──────────────────┘');

  console.log('\n📋 Instructions:');
  console.log('   1. Get Circle USDC from: https://faucet.circle.com/');
  console.log('   2. Send USDC to trader addresses above');
  console.log('   3. Run: npm run deposit:collateral');
}

main().catch(console.error);
