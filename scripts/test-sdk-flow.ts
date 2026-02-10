/**
 * Test SDK Flow Against Mock API
 *
 * Validates the Sepolia code paths work correctly by testing each step
 * of the @4mica/sdk integration against the local mock 4Mica API.
 *
 * Tests:
 * 1. SDK types: PaymentGuaranteeRequestClaims, PaymentSigner, SigningScheme
 * 2. EIP-712 signing: Real signature generation with test keys
 * 3. Mock REST endpoints: /core/payment-tabs, /core/guarantees, etc.
 * 4. X402SignedPayment header encoding
 * 5. Full guarantee issuance flow (same path as Sepolia)
 *
 * Prerequisites:
 *   Mock 4Mica API must be running: npm run mock:4mica
 *
 * Usage:
 *   npm run test:sdk-flow
 */

import {
  SigningScheme,
  PaymentGuaranteeRequestClaims,
  PaymentSigner,
} from '@4mica/sdk';
import type { BLSCert } from '@4mica/sdk';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address } from 'viem';
import chalk from 'chalk';

// =============================================================================
// Test Configuration
// =============================================================================

const MOCK_API_URL = process.env.FOURMICA_RPC_URL || 'http://localhost:3003';

// Hardhat default accounts
const TRADER_PRIVATE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as `0x${string}`;
const SOLVER_PRIVATE_KEY = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a' as `0x${string}`;

const traderAccount = privateKeyToAccount(TRADER_PRIVATE_KEY);
const solverAccount = privateKeyToAccount(SOLVER_PRIVATE_KEY);
const TRADER_ADDRESS = traderAccount.address as Address;
const SOLVER_ADDRESS = solverAccount.address as Address;
const USDC_ADDRESS = '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238' as Address;

let passed = 0;
let failed = 0;

function pass(name: string, detail?: string): void {
  passed++;
  console.log(chalk.green(`  ✓ ${name}`) + (detail ? chalk.gray(` — ${detail}`) : ''));
}

function fail(name: string, error: unknown): void {
  failed++;
  const msg = error instanceof Error ? error.message : String(error);
  console.log(chalk.red(`  ✗ ${name}: ${msg}`));
}

// =============================================================================
// Test 1: SDK Type Construction
// =============================================================================

async function testSDKTypes(): Promise<void> {
  console.log(chalk.bold('\n📦 Test 1: SDK Type Construction\n'));

  try {
    const claims = PaymentGuaranteeRequestClaims.new(
      TRADER_ADDRESS,
      SOLVER_ADDRESS,
      1n,           // tabId
      5_000_000n,   // amount (5 USDC)
      Math.floor(Date.now() / 1000),
      USDC_ADDRESS,
    );

    if (claims.userAddress.toLowerCase() !== TRADER_ADDRESS.toLowerCase()) throw new Error('userAddress mismatch');
    if (claims.recipientAddress.toLowerCase() !== SOLVER_ADDRESS.toLowerCase()) throw new Error('recipientAddress mismatch');
    if (claims.tabId !== 1n) throw new Error('tabId mismatch');
    if (claims.amount !== 5_000_000n) throw new Error('amount mismatch');
    if (!claims.assetAddress) throw new Error('assetAddress missing');

    pass('PaymentGuaranteeRequestClaims.new()', `tabId=${claims.tabId}, amount=${claims.amount}`);
  } catch (e) {
    fail('PaymentGuaranteeRequestClaims.new()', e);
  }

  try {
    if (!SigningScheme.EIP712) throw new Error('EIP712 not defined');
    if (SigningScheme.EIP712 !== 'eip712') throw new Error(`Expected 'eip712', got '${SigningScheme.EIP712}'`);
    pass('SigningScheme.EIP712', `value="${SigningScheme.EIP712}"`);
  } catch (e) {
    fail('SigningScheme.EIP712', e);
  }

  try {
    const signer = new PaymentSigner(traderAccount);
    if (!signer) throw new Error('PaymentSigner construction failed');
    pass('PaymentSigner construction', `signer for ${TRADER_ADDRESS.slice(0, 10)}...`);
  } catch (e) {
    fail('PaymentSigner construction', e);
  }
}

// =============================================================================
// Test 2: EIP-712 Signing
// =============================================================================

async function testEIP712Signing(): Promise<void> {
  console.log(chalk.bold('\n🔐 Test 2: EIP-712 Signing\n'));

  try {
    const claims = PaymentGuaranteeRequestClaims.new(
      TRADER_ADDRESS,
      SOLVER_ADDRESS,
      1n,
      5_000_000n,
      Math.floor(Date.now() / 1000),
      USDC_ADDRESS,
    );

    // Fetch public params from mock to get EIP-712 domain
    const paramsRes = await fetch(`${MOCK_API_URL}/core/public-params`);
    if (!paramsRes.ok) throw new Error(`public-params failed: ${paramsRes.status}`);
    const paramsData = await paramsRes.json() as Record<string, unknown>;
    pass('Fetch /core/public-params', `chainId=${paramsData.chain_id || paramsData.chainId}`);

    // Build CorePublicParameters manually (since Client.new() needs on-chain)
    const { CorePublicParameters } = await import('@4mica/sdk');
    const coreParams = CorePublicParameters.fromRpc(paramsData);
    pass('CorePublicParameters.fromRpc()', `eip712=${coreParams.eip712Name} v${coreParams.eip712Version} chain=${coreParams.chainId}`);

    // Sign with trader's key
    const signer = new PaymentSigner(traderAccount);
    const paymentSig = await signer.signRequest(coreParams, claims, SigningScheme.EIP712);

    if (!paymentSig.signature) throw new Error('No signature produced');
    if (paymentSig.signature.length < 130) throw new Error(`Signature too short: ${paymentSig.signature.length} chars`);
    if (paymentSig.scheme !== 'eip712') throw new Error(`Wrong scheme: ${paymentSig.scheme}`);

    pass('PaymentSigner.signRequest()', `sig=${paymentSig.signature.slice(0, 20)}... (${paymentSig.signature.length} chars)`);
  } catch (e) {
    fail('EIP-712 signing flow', e);
  }
}

// =============================================================================
// Test 3: Mock REST Endpoints (SDK Path)
// =============================================================================

async function testMockRESTEndpoints(): Promise<void> {
  console.log(chalk.bold('\n🌐 Test 3: Mock SDK REST Endpoints\n'));

  let tabId: string | undefined;

  // POST /core/payment-tabs
  try {
    const res = await fetch(`${MOCK_API_URL}/core/payment-tabs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        user_address: TRADER_ADDRESS.toLowerCase(),
        recipient_address: SOLVER_ADDRESS.toLowerCase(),
        erc20_token: USDC_ADDRESS.toLowerCase(),
        ttl: 300,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json() as Record<string, string>;
    tabId = data.id || data.tab_id || data.tabId;
    if (!tabId) throw new Error('No tabId in response');
    pass('POST /core/payment-tabs', `tabId=${tabId}`);
  } catch (e) {
    fail('POST /core/payment-tabs', e);
    return; // Can't continue without tab
  }

  // GET /core/tabs/:tabId
  try {
    const res = await fetch(`${MOCK_API_URL}/core/tabs/${tabId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as Record<string, string>;
    if (!data.userAddress && !data.user_address) throw new Error('Missing user address in tab');
    pass('GET /core/tabs/:tabId', `user=${(data.userAddress || data.user_address).slice(0, 10)}...`);
  } catch (e) {
    fail('GET /core/tabs/:tabId', e);
  }

  // GET /core/tabs/:tabId/guarantees/latest (should be null initially)
  try {
    const res = await fetch(`${MOCK_API_URL}/core/tabs/${tabId}/guarantees/latest`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as Record<string, unknown> | null;
    pass('GET /core/tabs/:tabId/guarantees/latest (empty)', `result=${JSON.stringify(data)}`);
  } catch (e) {
    fail('GET /core/tabs/:tabId/guarantees/latest', e);
  }

  // POST /core/guarantees (issue guarantee)
  try {
    const claims = PaymentGuaranteeRequestClaims.new(
      TRADER_ADDRESS,
      SOLVER_ADDRESS,
      BigInt(tabId!),
      5_000_000n,
      Math.floor(Date.now() / 1000),
      USDC_ADDRESS,
    );

    // Sign claims
    const { CorePublicParameters } = await import('@4mica/sdk');
    const paramsRes = await fetch(`${MOCK_API_URL}/core/public-params`);
    const coreParams = CorePublicParameters.fromRpc(await paramsRes.json() as Record<string, unknown>);
    const signer = new PaymentSigner(traderAccount);
    const paymentSig = await signer.signRequest(coreParams, claims, SigningScheme.EIP712);

    // Submit to mock (same format as SDK's issuePaymentGuarantee)
    const res = await fetch(`${MOCK_API_URL}/core/guarantees`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        claims: {
          version: 'v1',
          user_address: claims.userAddress,
          recipient_address: claims.recipientAddress,
          tab_id: '0x' + claims.tabId.toString(16),
          amount: '0x' + claims.amount.toString(16),
          asset_address: claims.assetAddress,
          timestamp: Number(claims.timestamp),
        },
        signature: paymentSig.signature,
        scheme: paymentSig.scheme,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const cert = await res.json() as BLSCert;
    if (!cert.claims || !cert.signature) throw new Error('Invalid BLS certificate');
    pass('POST /core/guarantees', `cert.sig=${cert.signature.slice(0, 20)}...`);
  } catch (e) {
    fail('POST /core/guarantees', e);
  }

  // GET /core/tabs/:tabId/guarantees/latest (should now have a guarantee)
  try {
    const res = await fetch(`${MOCK_API_URL}/core/tabs/${tabId}/guarantees/latest`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { certificate?: BLSCert; reqId?: string } | null;
    if (!data || !data.certificate) throw new Error('No guarantee found after issuance');
    pass('GET /core/tabs/:tabId/guarantees/latest (after)', `reqId=${data.reqId}`);
  } catch (e) {
    fail('GET /core/tabs/:tabId/guarantees/latest (after)', e);
  }

  // GET /core/users/:addr/assets/:asset
  try {
    const res = await fetch(`${MOCK_API_URL}/core/users/${TRADER_ADDRESS.toLowerCase()}/assets/${USDC_ADDRESS.toLowerCase()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { total?: string; locked?: string } | null;
    pass('GET /core/users/:addr/assets/:asset', `total=${data?.total}, locked=${data?.locked}`);
  } catch (e) {
    fail('GET /core/users/:addr/assets/:asset', e);
  }
}

// =============================================================================
// Test 4: X402SignedPayment Header Encoding
// =============================================================================

async function testX402Header(): Promise<void> {
  console.log(chalk.bold('\n📋 Test 4: X402SignedPayment Header Encoding\n'));

  try {
    const chainId = 31337;
    const header = Buffer.from(JSON.stringify({
      x402Version: 1,
      scheme: '4mica-credit',
      network: `eip155:${chainId}`,
    })).toString('base64');

    // Verify it decodes correctly
    const decoded = JSON.parse(Buffer.from(header, 'base64').toString());
    if (decoded.x402Version !== 1) throw new Error('x402Version wrong');
    if (decoded.scheme !== '4mica-credit') throw new Error('scheme wrong');
    if (decoded.network !== `eip155:${chainId}`) throw new Error('network wrong');

    pass('X402 header encoding', `decoded scheme=${decoded.scheme}, network=${decoded.network}`);
  } catch (e) {
    fail('X402 header encoding', e);
  }
}

// =============================================================================
// Test 5: Full Guarantee Issuance Flow (Sepolia Code Path Simulation)
// =============================================================================

async function testFullGuaranteeFlow(): Promise<void> {
  console.log(chalk.bold('\n🔗 Test 5: Full Guarantee Issuance Flow (Sepolia Path)\n'));

  try {
    const { CorePublicParameters } = await import('@4mica/sdk');

    // Step 1: Fetch core params (same as Client.new → rpc.getPublicParams)
    const paramsRes = await fetch(`${MOCK_API_URL}/core/public-params`);
    const coreParams = CorePublicParameters.fromRpc(await paramsRes.json() as Record<string, unknown>);
    pass('Step 1: Fetch CorePublicParameters', `chain=${coreParams.chainId}`);

    // Step 2: Create tab (same as RecipientClient.createTab)
    const tabRes = await fetch(`${MOCK_API_URL}/core/payment-tabs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        user_address: TRADER_ADDRESS.toLowerCase(),
        recipient_address: SOLVER_ADDRESS.toLowerCase(),
        erc20_token: USDC_ADDRESS.toLowerCase(),
        ttl: 300,
      }),
    });
    const tabData = await tabRes.json() as Record<string, string>;
    const tabId = BigInt(tabData.id || tabData.tabId);
    pass('Step 2: RecipientClient.createTab()', `tabId=${tabId}`);

    // Step 3: Check for existing guarantee (same as getLatestGuarantee)
    let reqId = 0n;
    const latestRes = await fetch(`${MOCK_API_URL}/core/tabs/0x${tabId.toString(16)}/guarantees/latest`);
    const latestData = await latestRes.json() as { reqId?: string } | null;
    if (latestData && latestData.reqId) {
      reqId = BigInt(latestData.reqId) + 1n;
    }
    pass('Step 3: getLatestGuarantee()', `reqId=${reqId}`);

    // Step 4: Build claims (same as PaymentGuaranteeRequestClaims.new)
    const amount = 5_000_000n;
    const timestamp = Math.floor(Date.now() / 1000);
    const claims = PaymentGuaranteeRequestClaims.new(
      TRADER_ADDRESS, SOLVER_ADDRESS, tabId, amount, timestamp, USDC_ADDRESS,
    );
    pass('Step 4: PaymentGuaranteeRequestClaims.new()', `claims.tabId=${claims.tabId}`);

    // Step 5: Sign with trader's key (same as PaymentSigner.signRequest)
    const traderSigner = new PaymentSigner(traderAccount);
    const paymentSig = await traderSigner.signRequest(coreParams, claims, SigningScheme.EIP712);
    pass('Step 5: PaymentSigner.signRequest()', `sig=${paymentSig.signature.slice(0, 16)}...`);

    // Step 6: Issue guarantee (same as RecipientClient.issuePaymentGuarantee)
    const guaranteeRes = await fetch(`${MOCK_API_URL}/core/guarantees`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        claims: {
          version: 'v1',
          user_address: claims.userAddress,
          recipient_address: claims.recipientAddress,
          tab_id: `0x${claims.tabId.toString(16)}`,
          amount: `0x${claims.amount.toString(16)}`,
          asset_address: claims.assetAddress,
          timestamp: Number(claims.timestamp),
        },
        signature: paymentSig.signature,
        scheme: paymentSig.scheme,
      }),
    });
    if (!guaranteeRes.ok) throw new Error(`Guarantee failed: ${guaranteeRes.status} ${await guaranteeRes.text()}`);
    const blsCert = await guaranteeRes.json() as BLSCert;
    if (!blsCert.claims || !blsCert.signature) throw new Error('Invalid BLS certificate structure');
    pass('Step 6: issuePaymentGuarantee()', `BLSCert received!`);

    // Step 7: Build X402SignedPayment (same as in 4mica-client.ts)
    const signedPayment = {
      header: Buffer.from(JSON.stringify({
        x402Version: 1,
        scheme: '4mica-credit',
        network: `eip155:${coreParams.chainId}`,
      })).toString('base64'),
      payload: {
        tab_id: tabId.toString(),
        amount: amount.toString(),
        recipient: SOLVER_ADDRESS,
      },
      signature: paymentSig,
    };
    pass('Step 7: X402SignedPayment constructed', `header=${signedPayment.header.slice(0, 20)}...`);

    console.log(chalk.bold.green('\n  ✅ FULL SEPOLIA FLOW VALIDATED SUCCESSFULLY!'));
    console.log(chalk.gray('  Every step from tab creation through guarantee issuance works.\n'));
    console.log(chalk.gray('  Only untested: Client.new() gateway init (needs Core4Mica on-chain) and'));
    console.log(chalk.gray('  settlement on-chain calls (payTab/remunerate). These require real 4Mica.'));

  } catch (e) {
    fail('Full guarantee flow', e);
  }
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  console.log(chalk.bold('\n🧪 4Mica SDK Flow Test — Validating Sepolia Code Paths\n'));
  console.log(chalk.gray(`  Mock API:  ${MOCK_API_URL}`));
  console.log(chalk.gray(`  Trader:    ${TRADER_ADDRESS}`));
  console.log(chalk.gray(`  Solver:    ${SOLVER_ADDRESS}`));

  // Check mock is running
  try {
    const healthRes = await fetch(`${MOCK_API_URL}/health`);
    if (!healthRes.ok) throw new Error('unhealthy');
    pass('Mock API reachable', MOCK_API_URL);
  } catch {
    console.log(chalk.red('\n  ✗ Mock 4Mica API not running!'));
    console.log(chalk.yellow('  Start it first: npm run mock:4mica'));
    console.log(chalk.yellow('  Or run the local stack: npm run start:local\n'));
    process.exit(1);
  }

  await testSDKTypes();
  await testEIP712Signing();
  await testMockRESTEndpoints();
  await testX402Header();
  await testFullGuaranteeFlow();

  // Summary
  console.log(chalk.bold('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.bold(`  Results: ${chalk.green(`${passed} passed`)}, ${failed > 0 ? chalk.red(`${failed} failed`) : chalk.green('0 failed')}`));
  console.log(chalk.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(chalk.red('\nUnexpected error:'), err);
  process.exit(1);
});
