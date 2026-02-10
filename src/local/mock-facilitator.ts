/**
 * Mock 4Mica Facilitator for Local Testing
 *
 * This server simulates the 4Mica X402 facilitator for local development:
 * - Tab creation (POST /tabs)
 * - BLS certificate issuance (simulated)
 * - Remuneration endpoint (POST /remunerate)
 *
 * The mock preserves the exact same API contract as the real facilitator
 * so the 4Mica SDK works identically in local and Sepolia modes.
 *
 * Usage:
 *   npx tsx src/local/mock-facilitator.ts
 */

import express, { type Request, type Response } from 'express';
import cors from 'cors';
import chalk from 'chalk';
import { randomBytes } from 'crypto';

// =============================================================================
// Types (matching 4Mica facilitator API)
// =============================================================================

interface TabCreateRequest {
  userAddress: string;      // Payer (trader)
  recipientAddress: string; // Recipient (solver)
  amount: string;           // Amount in wei-like string
  asset: string;            // Token address
  maxTimeoutSeconds: number;
}

interface TabResponse {
  tabId: string;        // Hex string tab ID
  reqId: string;        // Hex string request ID
  timestamp: number;    // Unix timestamp
  deadline: number;     // Unix timestamp deadline
  userAddress: string;
  recipientAddress: string;
  amount: string;
  asset: string;
}

interface Tab {
  id: bigint;
  reqId: bigint;
  userAddress: string;
  recipientAddress: string;
  amount: bigint;
  asset: string;
  timestamp: number;
  deadline: number;
  settled: boolean;
  guaranteeIssued: boolean;
}

interface PaymentGuarantee {
  tabId: bigint;
  certificate: {
    claims: string;
    signature: string;
    scheme: string;
  };
  issuedAt: number;
}

// =============================================================================
// Mock Facilitator Server
// =============================================================================

export class MockFacilitator {
  private app: express.Application;
  private port: number;
  private tabs: Map<string, Tab> = new Map();
  private guarantees: Map<string, PaymentGuarantee> = new Map();
  private nextTabId = 1n;
  private nextReqId = 1n;

  constructor(port: number = 3002) {
    this.port = port;
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(cors());
    this.app.use(express.json());

    // Request logging
    this.app.use((req, res, next) => {
      console.log(chalk.gray(`[MockFacilitator] ${req.method} ${req.path}`));
      next();
    });
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', mock: true, tabs: this.tabs.size });
    });

    // Create tab (main endpoint called by 4Mica SDK)
    this.app.post('/tabs', this.createTab.bind(this));

    // Get tab by ID
    this.app.get('/tabs/:tabId', this.getTab.bind(this));

    // Issue guarantee (called after payment signing)
    this.app.post('/tabs/:tabId/guarantee', this.issueGuarantee.bind(this));

    // Remuneration (unhappy path)
    this.app.post('/remunerate', this.remunerate.bind(this));

    // Settlement notification (happy path)
    this.app.post('/tabs/:tabId/settle', this.settle.bind(this));

    // List all tabs (for debugging)
    this.app.get('/tabs', (_req: Request, res: Response) => {
      const tabList = Array.from(this.tabs.values()).map(tab => ({
        id: '0x' + tab.id.toString(16),
        userAddress: tab.userAddress,
        recipientAddress: tab.recipientAddress,
        amount: tab.amount.toString(),
        settled: tab.settled,
        guaranteeIssued: tab.guaranteeIssued,
      }));
      res.json({ tabs: tabList });
    });
  }

  // ===========================================================================
  // Tab Creation (POST /tabs)
  // ===========================================================================

  private createTab(req: Request, res: Response): void {
    try {
      const body = req.body as TabCreateRequest;

      // Validate request
      if (!body.userAddress || !body.recipientAddress || !body.amount) {
        res.status(400).json({ error: 'Missing required fields' });
        return;
      }

      const tabId = this.nextTabId++;
      const reqId = this.nextReqId++;
      const timestamp = Math.floor(Date.now() / 1000);
      const deadline = timestamp + (body.maxTimeoutSeconds || 300);

      const tab: Tab = {
        id: tabId,
        reqId,
        userAddress: body.userAddress.toLowerCase(),
        recipientAddress: body.recipientAddress.toLowerCase(),
        amount: BigInt(body.amount),
        asset: body.asset?.toLowerCase() || '0x',
        timestamp,
        deadline,
        settled: false,
        guaranteeIssued: false,
      };

      // Store tab
      const tabKey = tabId.toString();
      this.tabs.set(tabKey, tab);

      console.log(chalk.green(`[MockFacilitator] Tab created: id=${tabId}, amount=${body.amount}, user=${body.userAddress.slice(0, 10)}...`));

      // Return response matching 4Mica facilitator format
      const response: TabResponse = {
        tabId: '0x' + tabId.toString(16).padStart(64, '0'),
        reqId: '0x' + reqId.toString(16).padStart(64, '0'),
        timestamp,
        deadline,
        userAddress: tab.userAddress,
        recipientAddress: tab.recipientAddress,
        amount: tab.amount.toString(),
        asset: tab.asset,
      };

      res.status(201).json(response);
    } catch (error) {
      console.error(chalk.red('[MockFacilitator] Tab creation error:'), error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // ===========================================================================
  // Get Tab (GET /tabs/:tabId)
  // ===========================================================================

  private getTab(req: Request, res: Response): void {
    try {
      const tabIdStr = req.params.tabId;
      let tabId: bigint;

      // Parse tab ID (can be hex or decimal)
      if (tabIdStr.startsWith('0x')) {
        tabId = BigInt(tabIdStr);
      } else {
        tabId = BigInt(tabIdStr);
      }

      const tab = this.tabs.get(tabId.toString());
      if (!tab) {
        res.status(404).json({ error: 'Tab not found' });
        return;
      }

      res.json({
        tabId: '0x' + tab.id.toString(16).padStart(64, '0'),
        reqId: '0x' + tab.reqId.toString(16).padStart(64, '0'),
        timestamp: tab.timestamp,
        deadline: tab.deadline,
        userAddress: tab.userAddress,
        recipientAddress: tab.recipientAddress,
        amount: tab.amount.toString(),
        asset: tab.asset,
        settled: tab.settled,
        guaranteeIssued: tab.guaranteeIssued,
      });
    } catch (error) {
      res.status(400).json({ error: 'Invalid tab ID' });
    }
  }

  // ===========================================================================
  // Issue Guarantee (POST /tabs/:tabId/guarantee)
  // ===========================================================================

  private issueGuarantee(req: Request, res: Response): void {
    try {
      const tabIdStr = req.params.tabId;
      let tabId: bigint;

      if (tabIdStr.startsWith('0x')) {
        tabId = BigInt(tabIdStr);
      } else {
        tabId = BigInt(tabIdStr);
      }

      const tab = this.tabs.get(tabId.toString());
      if (!tab) {
        res.status(404).json({ error: 'Tab not found' });
        return;
      }

      if (tab.guaranteeIssued) {
        res.status(400).json({ error: 'Guarantee already issued for this tab' });
        return;
      }

      // Generate mock BLS certificate
      const certificate = {
        claims: `MOCK_CERT_${tabId}_${Date.now()}`,
        signature: '0x' + randomBytes(64).toString('hex'),
        scheme: 'BLS12-381',
      };

      // Store guarantee
      const guarantee: PaymentGuarantee = {
        tabId,
        certificate,
        issuedAt: Date.now(),
      };
      this.guarantees.set(tabId.toString(), guarantee);

      // Mark tab as having guarantee
      tab.guaranteeIssued = true;

      console.log(chalk.cyan(`[MockFacilitator] Guarantee issued for tab ${tabId}`));

      res.status(201).json({
        tabId: '0x' + tabId.toString(16).padStart(64, '0'),
        certificate,
        issuedAt: guarantee.issuedAt,
      });
    } catch (error) {
      console.error(chalk.red('[MockFacilitator] Guarantee issuance error:'), error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // ===========================================================================
  // Remuneration (POST /remunerate) - Unhappy path
  // ===========================================================================

  private remunerate(req: Request, res: Response): void {
    try {
      const { paymentHeader } = req.body as { paymentHeader?: string };

      if (!paymentHeader) {
        res.status(400).json({ error: 'Missing paymentHeader' });
        return;
      }

      // In mock mode, we simulate remuneration success
      // In real 4Mica, this would trigger on-chain collateral slashing
      console.log(chalk.yellow(`[MockFacilitator] Remuneration requested (mock - simulating success)`));

      // Generate mock transaction hash
      const mockTxHash = '0x' + randomBytes(32).toString('hex');

      res.json({
        success: true,
        txHash: mockTxHash,
        gasUsed: '50000',
        message: 'Mock remuneration processed',
      });
    } catch (error) {
      console.error(chalk.red('[MockFacilitator] Remuneration error:'), error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // ===========================================================================
  // Settlement (POST /tabs/:tabId/settle) - Happy path notification
  // ===========================================================================

  private settle(req: Request, res: Response): void {
    try {
      const tabIdStr = req.params.tabId;
      let tabId: bigint;

      if (tabIdStr.startsWith('0x')) {
        tabId = BigInt(tabIdStr);
      } else {
        tabId = BigInt(tabIdStr);
      }

      const tab = this.tabs.get(tabId.toString());
      if (!tab) {
        res.status(404).json({ error: 'Tab not found' });
        return;
      }

      if (tab.settled) {
        res.status(400).json({ error: 'Tab already settled' });
        return;
      }

      // Mark as settled
      tab.settled = true;

      console.log(chalk.green(`[MockFacilitator] Tab ${tabId} marked as settled`));

      res.json({
        success: true,
        tabId: '0x' + tabId.toString(16).padStart(64, '0'),
        message: 'Tab settled',
      });
    } catch (error) {
      console.error(chalk.red('[MockFacilitator] Settlement error:'), error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.app.listen(this.port, () => {
        console.log(chalk.bold(`\n🔧 Mock 4Mica Facilitator running on http://localhost:${this.port}\n`));
        console.log(chalk.gray('  Endpoints:'));
        console.log(chalk.gray('    POST /tabs           - Create a new tab'));
        console.log(chalk.gray('    GET  /tabs/:id       - Get tab details'));
        console.log(chalk.gray('    POST /tabs/:id/guarantee - Issue guarantee'));
        console.log(chalk.gray('    POST /remunerate     - Unhappy path settlement'));
        console.log(chalk.gray('    POST /tabs/:id/settle - Happy path notification'));
        console.log(chalk.gray('    GET  /health         - Health check\n'));
        resolve();
      });
    });
  }

  getStats(): { tabCount: number; guaranteeCount: number } {
    return {
      tabCount: this.tabs.size,
      guaranteeCount: this.guarantees.size,
    };
  }
}

// =============================================================================
// Main Entry Point
// =============================================================================

async function main(): Promise<void> {
  const port = parseInt(process.env.MOCK_FACILITATOR_PORT || '3002');
  const facilitator = new MockFacilitator(port);
  await facilitator.start();

  // Handle shutdown
  process.on('SIGINT', () => {
    console.log(chalk.yellow('\n\nShutting down mock facilitator...'));
    process.exit(0);
  });
}

// Run if executed directly
const isMainModule = process.argv[1]?.endsWith('mock-facilitator.ts') ||
                      process.argv[1]?.endsWith('mock-facilitator.js');
if (isMainModule) {
  main().catch(console.error);
}

export default MockFacilitator;
