/**
 * Game Server for 4Mica × Agent0 Competitive Solver Game
 *
 * Main server entry point that orchestrates:
 * - Express REST API
 * - WebSocket real-time updates
 * - Price indexing
 * - Intent management
 * - Settlement tracking
 * - Reputation system
 *
 * Usage:
 *   npm run start:sepolia
 */

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import chalk from 'chalk';
import type { Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// Configuration — load BEFORE any other imports that might read process.env
import { config as dotenvConfig } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Determine which env file to load based on how we're started:
// - npm run start:sepolia → loads .env.sepolia (Sepolia testnet)
// - npm run start:local   → loads .env.local (local Hardhat)
// Check for explicit ENV_FILE override, then detect from LOCAL_MODE or default to .env.sepolia
const envFile = process.env.ENV_FILE || (process.env.LOCAL_MODE === 'true' ? '.env.local' : '.env.sepolia');
const envPaths = [
  join(process.cwd(), envFile),
  join(__dirname, '../../', envFile),       // From source: src/sepolia -> project root
  join(__dirname, '../../../', envFile),    // From compiled: dist/src/sepolia -> project root
];
let envLoaded = false;
for (const envPath of envPaths) {
  const result = dotenvConfig({ path: envPath });
  if (!result.error) {
    console.log(`[Config] Loaded environment from: ${envPath}`);
    envLoaded = true;
    break;
  }
}
if (!envLoaded) {
  console.warn(`[Config] Warning: Could not find ${envFile}. Falling back to process.env.`);
}

// Local modules
import { createPriceIndexer, type PriceIndexerConfig, type ArbitrageOpportunity } from './price-indexer.js';
import { createIntentManager, type IntentManagerConfig, type SolverBid } from './intent-manager.js';
import { createSettlementManager, type SettlementManagerConfig } from './settlement-mgr.js';
import { createWSBroadcaster, type BroadcasterConfig } from './ws-broadcaster.js';
import { createAPIRoutes, type APIContext, type AgentProfile } from './api/routes.js';
import { createReputationManager, type SettlementOutcome } from '../lib/reputation.js';
import { FourMicaClient, type PaymentClaims } from '../lib/4mica-client.js';

// =============================================================================
// Configuration Loading
// =============================================================================

interface ServerConfig {
  port: number;
  rpcUrl: string;
  ammAlphaAddress: Address;
  ammBetaAddress: Address;
  usdcAddress: Address;  // AMM USDC (custom deployment)
  usdtAddress: Address;
  fourMicaUsdcAddress: Address;  // Official Circle USDC for 4Mica collateral
  fourMicaRpcUrl: string;  // 4Mica SDK RPC endpoint
  fourMicaFacilitatorUrl: string;  // 4Mica X402 facilitator endpoint
  priceCheckIntervalMs: number;
  spreadThresholdBps: number;
  settlementWindowSeconds: number;
  unhappyPathProbability: number;
  pinataJwt: string;
  demoMode: boolean;  // Use simulated guarantees when 4Mica fails
  localMode: boolean;  // Use local mock 4Mica API
}

function loadConfig(): ServerConfig {
  // Support both local (LOCAL_RPC_URL) and Sepolia (SEPOLIA_RPC_URL) modes
  const rpcUrl = process.env.LOCAL_RPC_URL || process.env.SEPOLIA_RPC_URL;
  if (!rpcUrl) throw new Error('RPC URL not configured (set LOCAL_RPC_URL or SEPOLIA_RPC_URL)');

  const ammAlpha = process.env.AMM_ALPHA_ADDRESS;
  const ammBeta = process.env.AMM_BETA_ADDRESS;
  const usdc = process.env.USDC_ADDRESS;
  const usdt = process.env.USDT_ADDRESS;

  if (!ammAlpha || !ammBeta || !usdc || !usdt) {
    throw new Error('Contract addresses not configured. Run npm run deploy:sepolia first.');
  }

  // Official Circle USDC on Sepolia for 4Mica collateral
  const fourMicaUsdc = process.env.FOURMICA_USDC_ADDRESS || '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';

  // 4Mica API URLs (defaults to Sepolia, can be overridden for local mock)
  const fourMicaRpcUrl = process.env.FOURMICA_RPC_URL || 'https://ethereum.sepolia.api.4mica.xyz/';
  const fourMicaFacilitatorUrl = process.env.FOURMICA_FACILITATOR_URL || 'https://x402.4mica.xyz';

  return {
    port: parseInt(process.env.SERVER_PORT || '3001'),
    rpcUrl,
    ammAlphaAddress: ammAlpha as Address,
    ammBetaAddress: ammBeta as Address,
    usdcAddress: usdc as Address,
    usdtAddress: usdt as Address,
    fourMicaUsdcAddress: fourMicaUsdc as Address,
    fourMicaRpcUrl,
    fourMicaFacilitatorUrl,
    priceCheckIntervalMs: parseInt(process.env.PRICE_CHECK_INTERVAL_MS || '2000'),
    spreadThresholdBps: parseInt(process.env.SPREAD_THRESHOLD_BPS || '50'),
    settlementWindowSeconds: parseInt(process.env.SETTLEMENT_WINDOW_SECONDS || '30'),
    unhappyPathProbability: parseFloat(process.env.UNHAPPY_PATH_PROBABILITY || '0.05'),
    pinataJwt: process.env.PINATA_JWT || '',
    demoMode: process.env.DEMO_MODE === 'true',  // Set DEMO_MODE=true for simulated guarantees
    localMode: process.env.LOCAL_MODE === 'true',  // Set LOCAL_MODE=true for local mock 4Mica
  };
}

// =============================================================================
// Agent Configuration
// =============================================================================

interface AgentWalletConfig {
  name: string;
  envKey: string;
  role: 'trader' | 'solver';
}

const AGENT_CONFIGS: AgentWalletConfig[] = [
  { name: 'Trader-SpreadHawk', envKey: 'TRADER_SPREADHAWK_PRIVATE_KEY', role: 'trader' },
  { name: 'Trader-DeepScan', envKey: 'TRADER_DEEPSCAN_PRIVATE_KEY', role: 'trader' },
  { name: 'Solver-AlphaStrike', envKey: 'SOLVER_ALPHASTRIKE_PRIVATE_KEY', role: 'solver' },
  { name: 'Solver-ProfitMax', envKey: 'SOLVER_PROFITMAX_PRIVATE_KEY', role: 'solver' },
  { name: 'Solver-Balanced', envKey: 'SOLVER_BALANCED_PRIVATE_KEY', role: 'solver' },
  { name: 'Solver-CoWMatcher', envKey: 'SOLVER_COWMATCHER_PRIVATE_KEY', role: 'solver' },
  { name: 'Solver-GasOptimizer', envKey: 'SOLVER_GASOPTIMIZER_PRIVATE_KEY', role: 'solver' },
];

// Store private keys separately (not in profiles to avoid accidental logging)
const agentPrivateKeys: Map<string, `0x${string}`> = new Map();

function loadAgentProfiles(): Map<string, AgentProfile> {
  const profiles = new Map<string, AgentProfile>();

  for (const agentConfig of AGENT_CONFIGS) {
    const privateKey = process.env[agentConfig.envKey];
    if (!privateKey || privateKey === '0x') continue;

    const key = (privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`) as `0x${string}`;
    const account = privateKeyToAccount(key);

    // Store the private key for later use with 4Mica
    agentPrivateKeys.set(agentConfig.name, key);

    const profile: AgentProfile = {
      id: agentConfig.name,
      name: agentConfig.name,
      address: account.address,
      role: agentConfig.role,
      registered: false,
      collateral: 0n,
      stats: {
        trades: 0,
        wins: 0,
        profit: 0n,
        volume: 0n,
      },
    };

    profiles.set(agentConfig.name, profile);
    profiles.set(account.address, profile);
  }

  return profiles;
}

// =============================================================================
// Main Server Class
// =============================================================================

class GameServer {
  private config: ServerConfig;
  private app: express.Application;
  private server: ReturnType<typeof createServer>;

  // Core modules (initialized in constructor)
  private priceIndexer!: ReturnType<typeof createPriceIndexer>;
  private intentManager!: ReturnType<typeof createIntentManager>;
  private settlementManager!: ReturnType<typeof createSettlementManager>;
  private wsBroadcaster!: ReturnType<typeof createWSBroadcaster>;
  private reputationManager!: ReturnType<typeof createReputationManager>;

  // State
  private agentProfiles: Map<string, AgentProfile>;
  private solverAddresses: Address[] = [];
  private isRunning = false;

  // 4Mica Solver client (authenticated as registered recipient)
  // The Solver calls the facilitator - facilitator knows recipient from Solver's auth
  private fourMicaSolverClient: FourMicaClient | null = null;

  // 4Mica clients per trader (for collateral management)
  private fourMicaTraderClients: Map<string, FourMicaClient> = new Map();

  // Trade throttling: max 2 trades per 60 seconds to conserve testnet USDC
  private recentTrades: number[] = [];
  private readonly MAX_TRADES_PER_WINDOW = 2;
  private readonly TRADE_WINDOW_MS = 60_000; // 60 seconds

  constructor() {
    this.config = loadConfig();
    this.agentProfiles = loadAgentProfiles();

    // Extract solver addresses
    for (const profile of this.agentProfiles.values()) {
      if (profile.role === 'solver' && !this.solverAddresses.includes(profile.address)) {
        this.solverAddresses.push(profile.address);
      }
    }

    // Initialize Express
    this.app = express();
    this.app.use(cors());
    this.app.use(express.json());

    // Create HTTP server
    this.server = createServer(this.app);

    // Initialize modules
    this.initializeModules();

    // Setup routes
    this.setupRoutes();

    // Wire up event handlers
    this.wireEvents();
  }

  private initializeModules(): void {
    // Price Indexer
    const priceConfig: PriceIndexerConfig = {
      rpcUrl: this.config.rpcUrl,
      ammAlphaAddress: this.config.ammAlphaAddress,
      ammBetaAddress: this.config.ammBetaAddress,
      usdcAddress: this.config.usdcAddress,
      usdtAddress: this.config.usdtAddress,
      pollIntervalMs: this.config.priceCheckIntervalMs,
      spreadThresholdBps: this.config.spreadThresholdBps,
    };
    this.priceIndexer = createPriceIndexer(priceConfig);

    // Intent Manager
    const intentConfig: IntentManagerConfig = {
      maxPendingIntents: 10,
      bidWindowMs: 5000, // 5 second bidding window
      settlementWindowSeconds: this.config.settlementWindowSeconds,
      unhappyPathProbability: this.config.unhappyPathProbability,
    };
    this.intentManager = createIntentManager(intentConfig);

    // Settlement Manager
    const solverKey = agentPrivateKeys.get('Solver-AlphaStrike');
    const settlementConfig: SettlementManagerConfig = {
      settlementWindowSeconds: this.config.settlementWindowSeconds,
      gracePeriodSeconds: 0, // No grace period - settle during countdown or at deadline
      countdownIntervalMs: 1000,
      unhappyPathProbability: this.config.unhappyPathProbability,
      fourMicaRpcUrl: this.config.fourMicaRpcUrl, // 4Mica API (local mock or Sepolia)
      recipientAddress: this.solverAddresses[0], // First solver as recipient
      tokenAddress: this.config.fourMicaUsdcAddress, // Official Circle USDC for 4Mica
      solverPrivateKey: solverKey, // Solver's private key for SDK operations
      // Provide a function to get private keys for any agent (trader or solver)
      getPrivateKey: (agentId: string) => agentPrivateKeys.get(agentId),
      // Demo mode: fallback to simulated guarantees if 4Mica fails
      demoMode: this.config.demoMode,
    };
    this.settlementManager = createSettlementManager(settlementConfig, this.intentManager);

    // WebSocket Broadcaster
    const wsConfig: BroadcasterConfig = {
      pingIntervalMs: 30000,
      maxClients: 100,
    };
    this.wsBroadcaster = createWSBroadcaster(wsConfig);
    this.wsBroadcaster.initialize(this.server);

    // Reputation Manager
    this.reputationManager = createReputationManager({
      rpcUrl: this.config.rpcUrl,
      pinataJwt: this.config.pinataJwt,
    });

    // Register agent names with reputation manager
    for (const profile of this.agentProfiles.values()) {
      this.reputationManager.registerAgentName(profile.address, profile.name);
    }
  }

  private setupRoutes(): void {
    // API context with createIntentWithGuarantee callback for AI agents
    const apiContext: APIContext = {
      priceIndexer: this.priceIndexer,
      intentManager: this.intentManager,
      settlementManager: this.settlementManager,
      reputationManager: this.reputationManager,
      solverAddresses: this.solverAddresses,
      agentProfiles: this.agentProfiles,
      // Callback for AI agents to create intents with 4Mica guarantee
      createIntentWithGuarantee: this.createIntentWithGuarantee.bind(this),
    };

    // Mount API routes
    const apiRoutes = createAPIRoutes(apiContext);
    this.app.use('/api', apiRoutes);

    // Root endpoint
    this.app.get('/', (req, res) => {
      res.json({
        name: '4Mica × Agent0 Competitive Solver Game',
        version: '1.0.0',
        network: 'sepolia',
        status: this.isRunning ? 'running' : 'stopped',
        endpoints: {
          prices: '/api/prices',
          intents: '/api/intents',
          settlement: '/api/settlement',
          solvers: '/api/solvers',
          leaderboard: '/api/leaderboard',
          agents: '/api/agents',
          stats: '/api/stats',
          health: '/api/health',
        },
        websocket: 'Connect to same port for real-time updates',
        fourMica: '4Mica integration via @4mica/sdk',
      });
    });
  }

  private wireEvents(): void {
    // Price updates -> WebSocket broadcast
    this.priceIndexer.on('price:update', (priceData) => {
      this.wsBroadcaster.broadcastPrice(priceData);
    });

    // Arbitrage opportunity -> Create demo intent
    this.priceIndexer.on('arbitrage:detected', (opportunity: ArbitrageOpportunity) => {
      this.handleArbitrageOpportunity(opportunity);
    });

    // Intent events -> WebSocket broadcast
    this.intentManager.on('intent:created', (intent) => {
      this.wsBroadcaster.broadcastIntentCreated(intent);
      // Update stats (new intent)
      this.broadcastStats();
      // Simulate solver bids
      this.simulateSolverBids(intent.id);
    });

    this.intentManager.on('intent:bid', ({ intentId, bid }) => {
      this.wsBroadcaster.broadcastBid(intentId, bid);
    });

    this.intentManager.on('intent:claimed', ({ intentId, solver }) => {
      this.wsBroadcaster.broadcastIntentClaimed(intentId, solver);
      // Simulate execution after short delay
      setTimeout(() => this.simulateExecution(intentId), 2000);
    });

    this.intentManager.on('intent:executed', ({ intentId, txHash, deadline }) => {
      this.wsBroadcaster.broadcastIntentExecuted(intentId, txHash, deadline);
    });

    // Settlement events -> WebSocket broadcast (legacy, kept for compatibility)
    this.settlementManager.on('settlement:countdown', ({ intentId, secondsRemaining }) => {
      this.wsBroadcaster.broadcastCountdown(intentId, secondsRemaining);
    });

    this.settlementManager.on('settlement:completed', (result) => {
      this.wsBroadcaster.broadcastSettlement(result);

      // Record settlement in reputation manager for solver stats tracking
      const intent = this.intentManager.getIntent(result.intentId);
      if (intent && intent.solverAddress) {
        // Calculate execution time from claimedAt to executedAt, or use estimate
        const executionTimeMs = (intent.claimedAt && intent.executedAt)
          ? intent.executedAt - intent.claimedAt
          : 3000; // Default estimate

        const outcome: SettlementOutcome = {
          intentId: result.intentId,
          solver: intent.solverAddress as Address,
          trader: intent.traderAddress as Address,
          isHappyPath: result.isHappyPath,
          executionTimeMs,
          profit: intent.expectedProfit || 0n,
          volume: intent.amount,
          timestamp: result.settledAt,
        };

        this.reputationManager.recordSettlement(outcome).catch((err) => {
          console.error(chalk.red(`[GameServer] Failed to record settlement: ${err.message}`));
        });

        console.log(chalk.cyan(`[GameServer] Recorded settlement for ${intent.solverId}: ${result.isHappyPath ? '✓ happy' : '✗ unhappy'}`));
      }

      // Update leaderboard and stats
      this.broadcastLeaderboard();
      this.broadcastStats();
    });

    // Trader Tab events -> WebSocket broadcast
    this.settlementManager.on('tab:updated', (tabData) => {
      this.wsBroadcaster.broadcastTabUpdate(tabData);
    });

    this.settlementManager.on('tab:countdown', (tabData) => {
      this.wsBroadcaster.broadcastTabCountdown(tabData);
    });

    this.settlementManager.on('tab:settled', (tabData) => {
      this.wsBroadcaster.broadcastTabSettled(tabData);
      // Update leaderboard and stats after tab settlement
      this.broadcastLeaderboard();
      this.broadcastStats();
    });

    this.settlementManager.on('tab:collateralUpdate', (collateralData) => {
      this.wsBroadcaster.broadcastTabCollateralUpdate(collateralData);
    });
  }

  // ===========================================================================
  // Demo Simulation Logic
  // ===========================================================================

  private async handleArbitrageOpportunity(opportunity: ArbitrageOpportunity): Promise<void> {
    // Throttle trades: max 2 per 60 seconds to conserve testnet USDC
    const now = Date.now();
    this.recentTrades = this.recentTrades.filter(t => now - t < this.TRADE_WINDOW_MS);

    if (this.recentTrades.length >= this.MAX_TRADES_PER_WINDOW) {
      const oldestTrade = this.recentTrades[0];
      const waitTime = Math.ceil((this.TRADE_WINDOW_MS - (now - oldestTrade)) / 1000);
      console.log(chalk.gray(`[GameServer] Trade throttled - max ${this.MAX_TRADES_PER_WINDOW} per ${this.TRADE_WINDOW_MS/1000}s (wait ${waitTime}s)`));
      return;
    }

    // Pick a random trader
    const traders = Array.from(this.agentProfiles.values()).filter(p => p.role === 'trader');
    if (traders.length === 0) return;

    const trader = traders[Math.floor(Math.random() * traders.length)];
    // Very small trade amounts for limited testnet USDC (0.5-1 USDC)
    const amount = BigInt(Math.floor(Math.random() * 500_000 + 500_000)); // 0.5-1 USDC

    // Initialize Solver client if not already done
    // The SOLVER calls the facilitator - facilitator knows recipient from Solver's auth
    if (!this.fourMicaSolverClient) {
      const solverPrivateKey = agentPrivateKeys.get('Solver-AlphaStrike');
      if (!solverPrivateKey) {
        console.log(chalk.yellow(`[GameServer] No private key found for Solver, skipping`));
        return;
      }

      this.fourMicaSolverClient = new FourMicaClient({
        rpcUrl: this.config.fourMicaRpcUrl,
        privateKey: solverPrivateKey,
        accountId: 'Solver-AlphaStrike',
        tokenAddress: this.config.fourMicaUsdcAddress,
        facilitatorUrl: this.config.fourMicaFacilitatorUrl,
      });
      await this.fourMicaSolverClient.initialize();
      console.log(chalk.green(`[GameServer] Solver 4Mica client initialized (${this.config.localMode ? 'LOCAL' : 'SEPOLIA'})`));
    }

    // Request 4Mica guarantee via SDK
    try {
      // Get the TRADER's private key - payment must be signed by the payer
      const traderPrivateKey = agentPrivateKeys.get(trader.id);
      if (!traderPrivateKey) {
        console.log(chalk.yellow(`[GameServer] No private key found for trader ${trader.id}, skipping`));
        return;
      }

      // X402 Flow: Solver client calls facilitator
      // The payment is signed by the TRADER (payer)
      // The Solver is the recipient who receives the payment
      const guarantee = await this.fourMicaSolverClient.issuePaymentGuarantee(
        trader.address,  // Trader address (the payer)
        amount,
        this.config.fourMicaUsdcAddress,
        this.config.settlementWindowSeconds,
        traderPrivateKey  // IMPORTANT: Trader's key for signing the payment
      );

      // BLSCert has { claims, signature } fields
      const certPreview = guarantee.certificate.claims?.slice(0, 20) || 'issued';
      console.log(chalk.cyan(`[GameServer] 4Mica guarantee APPROVED for ${trader.name}: ${this.formatAmount(amount)} USDC (cert: ${certPreview}...)`));

      // Create the intent with the guarantee certificate AND full guarantee object
      // The full guarantee is needed for settlement (tabId, reqId, amount, etc.)
      this.intentManager.createIntent(
        trader.id,
        trader.address,
        opportunity,
        amount,
        JSON.stringify(guarantee.certificate), // Serialize BLSCert for display
        guarantee // Full PaymentGuarantee for settlement
      );

      // Record trade for throttling
      this.recentTrades.push(Date.now());

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // In demo mode, create simulated guarantee when 4Mica fails
      if (this.config.demoMode) {
        console.log(chalk.yellow(`[GameServer] 4Mica failed (${errorMessage.slice(0, 30)}...), using DEMO MODE`));

        // Create a simulated certificate for demo purposes
        const simulatedCert = {
          claims: `DEMO_CERT_${Date.now()}_${trader.id}`,
          signature: `DEMO_SIG_${Math.random().toString(36).slice(2)}`,
        };

        const recipientAddress = this.solverAddresses[0] || trader.address;
        const now = Date.now();
        const deadline = Math.floor(now / 1000) + this.config.settlementWindowSeconds;

        // Create a FULL simulated PaymentGuarantee for settlement manager
        // This allows local demo mode to work without real 4Mica collateral
        const simulatedTabId = BigInt(Math.floor(Math.random() * 1000000) + 1);
        const simulatedReqId = BigInt(Math.floor(Math.random() * 1000000) + 1);

        const simulatedGuarantee = {
          certificate: simulatedCert as any, // BLSCert-like object
          claims: {
            tabId: simulatedTabId,
            amount: amount,
            recipient: recipientAddress as Address,
            deadline,
            nonce: simulatedReqId, // reqId
          },
          signedPayment: {
            header: `DEMO_HEADER_${now}`,
            payload: {},
            signature: { scheme: 'DEMO', signature: simulatedCert.signature },
          } as any,
          issuedAt: now,
          expiresAt: deadline * 1000,
          verified: true, // Mark as verified for demo
        };

        console.log(chalk.magenta(`[GameServer] DEMO guarantee issued for ${trader.name}: ${this.formatAmount(amount)} USDC (tabId=${simulatedTabId})`));

        // Create the intent with BOTH certificate string AND full guarantee object
        this.intentManager.createIntent(
          trader.id,
          trader.address,
          opportunity,
          amount,
          JSON.stringify(simulatedCert),
          simulatedGuarantee // Full guarantee for settlement
        );

        this.recentTrades.push(Date.now());
        return;
      }

      console.log(chalk.yellow(`[GameServer] 4Mica guarantee REJECTED for ${trader.name}: ${errorMessage}`));
      // Don't create intent if guarantee was rejected
      return;
    }
  }

  /**
   * Create an intent with 4Mica guarantee (called by API for AI agents)
   * This is the callback provided to the API context
   */
  private async createIntentWithGuarantee(
    traderId: string,
    amount: bigint
  ): Promise<{ success: boolean; intentId?: string; error?: string }> {
    // Find trader profile
    const trader = this.agentProfiles.get(traderId);
    if (!trader) {
      return { success: false, error: 'Trader not found' };
    }
    if (trader.role !== 'trader') {
      return { success: false, error: 'Agent is not a trader' };
    }

    // Get current price data for the opportunity
    const priceData = this.priceIndexer.getLastPrice();
    if (!priceData) {
      return { success: false, error: 'Price data not available' };
    }

    // Ensure we have a valid arbitrage direction
    if (priceData.direction === 'NONE') {
      return { success: false, error: 'No arbitrage opportunity (direction is NONE)' };
    }

    // Build opportunity from current price data
    const isBuyAlpha = priceData.direction === 'BETA_TO_ALPHA';
    const opportunity: ArbitrageOpportunity = {
      id: `arb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      direction: priceData.direction as 'ALPHA_TO_BETA' | 'BETA_TO_ALPHA',
      spreadBps: priceData.spreadBps,
      buyAmmAddress: isBuyAlpha ? this.config.ammAlphaAddress : this.config.ammBetaAddress,
      sellAmmAddress: isBuyAlpha ? this.config.ammBetaAddress : this.config.ammAlphaAddress,
      expectedProfit: (amount * BigInt(priceData.spreadBps)) / 10000n,
      timestamp: Date.now(),
    };

    // Throttle trades: max 2 per 60 seconds to conserve testnet USDC
    const now = Date.now();
    this.recentTrades = this.recentTrades.filter(t => now - t < this.TRADE_WINDOW_MS);

    if (this.recentTrades.length >= this.MAX_TRADES_PER_WINDOW) {
      const oldestTrade = this.recentTrades[0];
      const waitTime = Math.ceil((this.TRADE_WINDOW_MS - (now - oldestTrade)) / 1000);
      return {
        success: false,
        error: `Trade throttled - max ${this.MAX_TRADES_PER_WINDOW} per ${this.TRADE_WINDOW_MS/1000}s (wait ${waitTime}s)`,
      };
    }

    // Initialize Solver client if not already done
    if (!this.fourMicaSolverClient) {
      const solverPrivateKey = agentPrivateKeys.get('Solver-AlphaStrike');
      if (!solverPrivateKey) {
        return { success: false, error: 'No solver private key configured' };
      }

      this.fourMicaSolverClient = new FourMicaClient({
        rpcUrl: this.config.fourMicaRpcUrl,
        privateKey: solverPrivateKey,
        accountId: 'Solver-AlphaStrike',
        tokenAddress: this.config.fourMicaUsdcAddress,
        facilitatorUrl: this.config.fourMicaFacilitatorUrl,
      });
      await this.fourMicaSolverClient.initialize();
      console.log(chalk.green(`[GameServer] Solver 4Mica client initialized via API (${this.config.localMode ? 'LOCAL' : 'SEPOLIA'})`));
    }

    // Get trader's private key for signing the payment
    const traderPrivateKey = agentPrivateKeys.get(trader.id);
    if (!traderPrivateKey) {
      return { success: false, error: `No private key found for trader ${trader.id}` };
    }

    try {
      // X402 Flow: Request 4Mica guarantee
      const guarantee = await this.fourMicaSolverClient.issuePaymentGuarantee(
        trader.address,
        amount,
        this.config.fourMicaUsdcAddress,
        this.config.settlementWindowSeconds,
        traderPrivateKey
      );

      const certPreview = guarantee.certificate.claims?.slice(0, 20) || 'issued';
      console.log(chalk.cyan(`[GameServer] 4Mica guarantee APPROVED for ${trader.name} (via API): ${this.formatAmount(amount)} USDC (cert: ${certPreview}...)`));

      // Create the intent
      const intent = this.intentManager.createIntent(
        trader.id,
        trader.address,
        opportunity,
        amount,
        JSON.stringify(guarantee.certificate),
        guarantee
      );

      // Record trade for throttling
      this.recentTrades.push(Date.now());

      return { success: true, intentId: intent.id };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // In demo mode, create simulated guarantee
      if (this.config.demoMode) {
        console.log(chalk.yellow(`[GameServer] 4Mica failed (${errorMessage.slice(0, 30)}...), using DEMO MODE (via API)`));

        const simulatedCert = {
          claims: `DEMO_CERT_${Date.now()}_${trader.id}`,
          signature: `DEMO_SIG_${Math.random().toString(36).slice(2)}`,
        };

        const recipientAddress = this.solverAddresses[0] || trader.address;
        const now = Date.now();
        const deadline = Math.floor(now / 1000) + this.config.settlementWindowSeconds;

        // Create a FULL simulated PaymentGuarantee for settlement manager
        const simulatedTabId = BigInt(Math.floor(Math.random() * 1000000) + 1);
        const simulatedReqId = BigInt(Math.floor(Math.random() * 1000000) + 1);

        const simulatedGuarantee = {
          certificate: simulatedCert as any,
          claims: {
            tabId: simulatedTabId,
            amount: amount,
            recipient: recipientAddress as Address,
            deadline,
            nonce: simulatedReqId,
          },
          signedPayment: {
            header: `DEMO_HEADER_${now}`,
            payload: {},
            signature: { scheme: 'DEMO', signature: simulatedCert.signature },
          } as any,
          issuedAt: now,
          expiresAt: deadline * 1000,
          verified: true,
        };

        console.log(chalk.magenta(`[GameServer] DEMO guarantee issued for ${trader.name} (via API): ${this.formatAmount(amount)} USDC (tabId=${simulatedTabId})`));

        const intent = this.intentManager.createIntent(
          trader.id,
          trader.address,
          opportunity,
          amount,
          JSON.stringify(simulatedCert),
          simulatedGuarantee // Full guarantee for settlement
        );

        this.recentTrades.push(Date.now());

        return { success: true, intentId: intent.id };
      }

      console.log(chalk.yellow(`[GameServer] 4Mica guarantee REJECTED for ${trader.name} (via API): ${errorMessage}`));
      return { success: false, error: `4Mica guarantee rejected: ${errorMessage}` };
    }
  }

  private simulateSolverBids(intentId: string): void {
    const solvers = Array.from(this.agentProfiles.values()).filter(p => p.role === 'solver');

    // Each solver bids with some probability
    for (const solver of solvers) {
      if (Math.random() < 0.7) { // 70% chance to bid
        const bid: SolverBid = {
          solverId: solver.id,
          solverAddress: solver.address,
          solverName: solver.name,
          bidScore: Math.floor(Math.random() * 100) + 50, // 50-150 score
          executionTimeEstimateMs: Math.floor(Math.random() * 3000) + 1000,
          profitShareBps: Math.floor(Math.random() * 500) + 100, // 1-6%
          timestamp: Date.now(),
        };

        setTimeout(() => {
          this.intentManager.submitBid(intentId, bid);
        }, Math.random() * 4000); // Random delay up to 4s
      }
    }
  }

  private simulateExecution(intentId: string): void {
    const intent = this.intentManager.getIntent(intentId);
    if (!intent || intent.status !== 'claimed') return;

    console.log(chalk.yellow(`[GameServer] Simulating execution for ${intentId}`));

    // Mark as executing
    this.intentManager.startExecution(intentId);

    // After "execution", mark as executed and start settlement
    setTimeout(() => {
      const txHash = `0x${Math.random().toString(16).slice(2)}${'0'.repeat(40)}`.slice(0, 66);
      this.intentManager.markExecuted(intentId, txHash);
    }, 3000);
  }

  private async broadcastLeaderboard(): Promise<void> {
    try {
      const leaderboard = await this.reputationManager.buildLeaderboard(this.solverAddresses);
      this.wsBroadcaster.broadcastLeaderboard(leaderboard);
    } catch (error) {
      console.error('[GameServer] Error building leaderboard:', error);
    }
  }

  private broadcastStats(): void {
    const intentStats = this.intentManager.getStats();
    const settlementStats = this.settlementManager.getStats();
    const priceData = this.priceIndexer.getLastPrice();

    this.wsBroadcaster.broadcastStats({
      intents: intentStats,
      settlements: settlementStats,
      currentSpread: priceData?.spreadBps || 0,
      hasOpportunity: this.priceIndexer.hasOpportunity(),
      timestamp: Date.now(),
    });
  }

  // ===========================================================================
  // Server Lifecycle
  // ===========================================================================

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.config.port, () => {
        const networkMode = this.config.localMode ? 'LOCAL (Mock 4Mica)' : 'Sepolia';
        console.log(chalk.bold('\n🎮 4Mica × Agent0 Competitive Solver Game\n'));
        console.log(chalk.gray('─'.repeat(50)));
        console.log(chalk.cyan('  Network:      ') + chalk.white(networkMode));
        console.log(chalk.cyan('  Server:       ') + chalk.white(`http://localhost:${this.config.port}`));
        console.log(chalk.cyan('  WebSocket:    ') + chalk.white(`ws://localhost:${this.config.port}`));
        console.log(chalk.gray('─'.repeat(50)));
        console.log(chalk.cyan('  4Mica RPC:    ') + chalk.white(this.config.fourMicaRpcUrl));
        console.log(chalk.cyan('  Facilitator:  ') + chalk.white(this.config.fourMicaFacilitatorUrl));
        console.log(chalk.gray('─'.repeat(50)));
        console.log(chalk.cyan('  AMM-Alpha:    ') + chalk.white(this.config.ammAlphaAddress));
        console.log(chalk.cyan('  AMM-Beta:     ') + chalk.white(this.config.ammBetaAddress));
        console.log(chalk.gray('─'.repeat(50)));
        console.log(chalk.cyan('  Traders:      ') + chalk.white(
          Array.from(this.agentProfiles.values()).filter(p => p.role === 'trader').length
        ));
        console.log(chalk.cyan('  Solvers:      ') + chalk.white(this.solverAddresses.length));
        console.log(chalk.gray('─'.repeat(50)));
        console.log();

        // Start modules
        this.priceIndexer.start();
        this.settlementManager.start();
        this.isRunning = true;

        console.log(chalk.green('✓ Game server started\n'));
        if (this.config.demoMode) {
          console.log(chalk.magenta('🎭 DEMO MODE: Using simulated 4Mica guarantees\n'));
        }
        console.log(chalk.gray('Press Ctrl+C to stop\n'));

        // Broadcast initial leaderboard and stats so dashboard gets data immediately
        this.broadcastLeaderboard();
        this.broadcastStats();

        resolve();
      });
    });
  }

  stop(): void {
    console.log(chalk.yellow('\nShutting down...'));
    this.priceIndexer.stop();
    this.settlementManager.stop();
    this.wsBroadcaster.close();
    this.server.close();
    this.isRunning = false;
    console.log(chalk.green('✓ Server stopped'));
  }

  private formatAmount(amount: bigint): string {
    return (Number(amount) / 1_000_000).toLocaleString();
  }
}

// =============================================================================
// Entry Point
// =============================================================================

const server = new GameServer();

// Handle shutdown
process.on('SIGINT', () => {
  server.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  server.stop();
  process.exit(0);
});

// Start server
server.start().catch((error) => {
  console.error(chalk.red('Failed to start server:'), error);
  process.exit(1);
});
