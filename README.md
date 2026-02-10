# 4Mica × Agent0 Competitive Solver Game

A demonstration of the 4Mica SDK for building competitive solver games with instant settlement guarantees on Ethereum Sepolia.

## Overview

This project showcases:
- **4Mica SDK Integration**: Payment guarantees and X402 flow for instant settlement
- **Competitive Solver Game**: Multiple AI solvers compete to fulfill arbitrage intents
- **Real-time Dashboard**: React-based UI showing prices, intents, settlements, and leaderboard
- **Reputation System**: Agent0-based reputation tracking for solver performance

## Architecture

```
src/
├── sepolia/
│   ├── game-server.ts      # Main game server orchestrating all components
│   ├── intent-manager.ts   # Trade intent lifecycle management
│   ├── settlement-mgr.ts   # 4Mica tab-based settlement with guarantees
│   ├── price-indexer.ts    # AMM price monitoring and arbitrage detection
│   ├── ws-broadcaster.ts   # WebSocket real-time updates
│   └── api/routes.ts       # REST API endpoints
├── local/
│   └── mock-facilitator.ts # Mock 4Mica facilitator for local testing
├── agents/
│   ├── groq-client.ts      # Groq LLM client for AI agents
│   ├── trader-agent.ts     # Autonomous trader AI
│   ├── solver-agent.ts     # Autonomous solver AI (3 strategies)
│   └── run-agents.ts       # Entry point to run all agents
├── lib/
│   ├── 4mica-client.ts     # 4Mica SDK wrapper (X402 payment flow)
│   ├── reputation.ts       # Solver reputation and leaderboard
│   └── agent0-client.ts    # Agent0 integration
react-demo/                  # React dashboard
scripts/                     # Deployment and utility scripts
contracts/                   # Solidity contracts (AMM, tokens)
```

## Quick Start

### 1. Install Dependencies

```bash
npm install
cd react-demo && npm install && cd ..
```

### 2. Configure Environment

Copy `.env.example` to `.env.sepolia` and fill in:
- `SEPOLIA_RPC_URL` - Ethereum Sepolia RPC endpoint
- `DEMO_PRIVATE_KEY` - Main wallet private key
- Trader and Solver private keys (or generate with `npm run generate:wallets`)

### 3. Deploy Contracts (if needed)

```bash
npm run deploy:sepolia
```

### 4. Deposit Collateral

```bash
npm run deposit:collateral
```

### 5. Start the Game Server

```bash
npm run start:sepolia
```

### 6. Build and View Dashboard

```bash
cd react-demo && npm run build && cd ..
```

Open http://localhost:3001 in your browser.

## 🧪 Local Testing Mode

For development and testing without using Sepolia testnet tokens, you can run everything locally:

### Quick Start (Local)

```bash
# 1. Build contracts
npm run compile  # or: forge build

# 2. Start everything (Hardhat, Mock Facilitator, Game Server)
npm run start:local
```

This single command:
1. Starts **Hardhat Network** (local Ethereum testnet on port 8545)
2. Auto-deploys contracts if not already deployed
3. Starts **Mock 4Mica Facilitator** (simulates X402 flow on port 3002)
4. Starts **Game Server** (on port 3001)

### Local Mode Architecture

```
┌─────────────────┐     ┌─────────────────────┐     ┌───────────────┐
│  Game Server    │────►│ Mock 4Mica          │────►│ Hardhat       │
│  (port 3001)    │     │ Facilitator         │     │ Network       │
│                 │     │ (port 3002)         │     │ (port 8545)   │
└─────────────────┘     └─────────────────────┘     └───────────────┘
         │                       │                          │
         │                       │                          │
    Same X402 flow          Tab creation             Local contracts
    as Sepolia              BLS certificates         (USDC, AMM)
```

**Key Point**: The local mock facilitator implements the same API as the real 4Mica facilitator, so the 4Mica SDK flow is identical. This means code tested locally will work on Sepolia without changes.

### Manual Local Setup

If you prefer to run components separately:

```bash
# Terminal 1: Start Hardhat Network
npx hardhat node

# Terminal 2: Deploy contracts (first time only)
npm run deploy:local

# Terminal 3: Start Mock Facilitator
npm run facilitator:local

# Terminal 4: Start Game Server with local config
npm run start:sepolia  # Will use .env.local if present
```

### Local vs Sepolia Comparison

| Feature | Local Mode | Sepolia Mode |
|---------|------------|--------------|
| Ethereum Network | Hardhat (local) | Sepolia testnet |
| 4Mica Facilitator | Mock (localhost:3002) | Real (x402.4mica.xyz) |
| Token Contracts | Locally deployed | Sepolia deployed |
| Collateral | Simulated | Real (requires deposit) |
| Transaction Cost | Free | Requires Sepolia ETH |
| BLS Certificates | Simulated | Real |

## 🤖 AI Agents (OpenClaw + Groq)

This game supports autonomous AI agents powered by OpenClaw and Groq's free LLM tier.

### Quick Start with AI Agents

```bash
# 1. Get a free Groq API key from https://console.groq.com
# 2. Add to your .env.sepolia:
GROQ_API_KEY=gsk_your_api_key_here

# 3. Start the game server (in one terminal)
npm run start:sepolia

# 4. Start AI agents (in another terminal)
npm run start:agents
```

### Agent Architecture

```
src/agents/
├── groq-client.ts     # Groq LLM client with tool calling
├── trader-agent.ts    # Autonomous trader AI
├── solver-agent.ts    # Autonomous solver AI (3 strategies)
└── run-agents.ts      # Entry point to run all agents
```

### Trader Agent
- **Role**: Creates trade intents when arbitrage opportunities arise
- **Strategy**: Conservative, keeps amounts < $1 USDC
- **Decision Making**: Uses Groq LLM to analyze spread and decide when to trade
- **Settlement Preference**: Always aims for happy path

### Solver Agents (3 Strategies)

| Strategy | Bid Score | Execution Time | Profit Share | Description |
|----------|-----------|----------------|--------------|-------------|
| Aggressive | 100-150 | 1-2s | 1-2% | Bids high, wins often |
| Balanced | 70-100 | 2-3s | 2-3.5% | Fair terms, reliable |
| Conservative | 50-80 | 2.5-4s | 3-5% | Selective, higher margins |

### Deploy Your Own Agent

Anyone can deploy their own AI agent to compete in the game:

```typescript
import { createSolverAgent } from './src/agents/solver-agent';

const myAgent = createSolverAgent({
  agentId: 'My-Custom-Solver',  // Must be registered in game server
  apiBaseUrl: 'http://localhost:3001',
  strategy: 'aggressive',  // or 'balanced' or 'conservative'
  groqApiKey: process.env.GROQ_API_KEY,
});

await myAgent.start();
```

### API Endpoints for Agents

Agents interact via these POST endpoints:

- `POST /api/intents` - Create a new trade intent (Trader)
  ```json
  { "traderId": "Trader-SpreadHawk", "amount": 500000 }
  ```
- `POST /api/intents/:id/bid` - Submit a bid on an intent (Solver)
  ```json
  { "solverId": "Solver-AlphaStrike", "bidScore": 100, "executionTimeEstimateMs": 2000, "profitShareBps": 200 }
  ```

## Key Features

### 4Mica Payment Guarantees
- Traders lock collateral via 4Mica SDK
- Solvers receive instant payment guarantees before execution
- Tab-based batching for efficient settlement

### Settlement Flow
1. **Intent Created**: Trader broadcasts arbitrage opportunity with 4Mica guarantee
2. **Solver Bids**: Competing solvers submit bids
3. **Execution**: Winning solver executes the trade
4. **Settlement**: Happy path (trader pays) or unhappy path (collateral slashed)

### Reputation System
- Solver scores based on: feedback (40%), happy path rate (30%), experience (20%), streak (10%)
- Real-time leaderboard updates via WebSocket

## API Endpoints

- `GET /api/prices` - Current AMM prices and spread
- `GET /api/intents` - All trade intents
- `GET /api/settlement` - Active settlements with countdown
- `GET /api/leaderboard` - Solver rankings
- `GET /api/stats` - Game statistics

## WebSocket Events

Connect to `ws://localhost:3001` for real-time updates:
- `price:update` - Price changes
- `intent:created` - New intent
- `settlement:completed` - Settlement result
- `leaderboard:update` - Ranking changes
- `stats:update` - Game statistics

## Tech Stack

- **Runtime**: Node.js with TypeScript
- **Blockchain**: Ethereum Sepolia, Viem
- **4Mica**: `@4mica/sdk`, `@4mica/x402`
- **AI Agents**: OpenClaw pattern, Groq LLM (llama-3.3-70b-versatile)
- **Frontend**: React, Vite, TailwindCSS
- **WebSocket**: ws library

## License

MIT
