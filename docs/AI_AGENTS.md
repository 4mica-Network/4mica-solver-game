# AI Agents Guide

This guide explains how to deploy, configure, and customize AI agents for the 4Mica Solver Game.

## Overview

The game includes autonomous AI agents that compete in the solver game:
- **Trader Agent**: Creates trade intents when arbitrage opportunities arise
- **Solver Agents**: Compete to win and fulfill trade intents

All agents use Groq's free LLM tier (Llama-3.3-70B-Versatile) for decision making.

## Prerequisites

1. **Game Server Running**: The game server must be running at `http://localhost:3001`
2. **Groq API Key**: Get a free API key from [console.groq.com](https://console.groq.com)
3. **Agent Wallets**: Agents must be registered in the game server's configuration

## Quick Start

```bash
# 1. Configure your environment
cp .env.example .env.sepolia

# 2. Add your Groq API key to .env.sepolia
GROQ_API_KEY=gsk_your_api_key_here

# 3. Start the game server
npm run start:sepolia

# 4. In another terminal, start the AI agents
npm run start:agents
```

## Configuration

### Environment Variables

```bash
# Groq LLM Configuration
GROQ_API_KEY=gsk_...              # Required: Your Groq API key

# Agent IDs (must match registered agents)
TRADER_AGENT_ID=Trader-SpreadHawk  # Which trader agent to run
SOLVER_1_ID=Solver-AlphaStrike     # Aggressive strategy solver
SOLVER_2_ID=Solver-ProfitMax       # Balanced strategy solver
SOLVER_3_ID=Solver-Balanced        # Conservative strategy solver

# Game Server Location
API_BASE_URL=http://localhost:3001
```

### Registering New Agents

To add a new agent:

1. Generate a wallet: `npm run generate:wallets`
2. Add the private key to `.env.sepolia`:
   ```bash
   MY_CUSTOM_SOLVER_PRIVATE_KEY=0x...
   ```
3. Add the agent to `AGENT_CONFIGS` in `src/sepolia/game-server.ts`
4. Restart the game server

## Agent Strategies

### Trader Agent

The trader agent monitors price spreads and creates intents when opportunities arise.

**Configuration:**
```typescript
{
  pollIntervalMs: 15000,    // Check prices every 15 seconds
  minSpreadBps: 30,         // Only trade when spread > 0.3%
  maxTradeAmount: 1000000,  // Max $1 USDC per trade
}
```

**Decision Process:**
1. Fetch current prices from both AMMs
2. Check if spread exceeds threshold
3. Consult Groq LLM for trading decision
4. If approved, call POST /api/intents to create intent

### Solver Agents

Solvers monitor pending intents and submit competitive bids.

**Strategies:**

| Strategy | Bid Score | Execution | Profit Share | Bid Probability |
|----------|-----------|-----------|--------------|-----------------|
| Aggressive | 100-150 | 1-2s | 1-2% | 90% |
| Balanced | 70-100 | 2-3s | 2-3.5% | 70% |
| Conservative | 50-80 | 2.5-4s | 3-5% | 50% |

**Decision Process:**
1. Fetch pending intents from API
2. For each new intent, consult Groq LLM
3. Decide whether to bid based on strategy
4. If bidding, submit via POST /api/intents/:id/bid

## Creating Custom Agents

### Custom Trader

```typescript
import { createTraderAgent } from './src/agents/trader-agent';

const customTrader = createTraderAgent({
  agentId: 'My-Custom-Trader',
  apiBaseUrl: 'http://localhost:3001',
  groqApiKey: process.env.GROQ_API_KEY,
  pollIntervalMs: 10000,   // More frequent checks
  minSpreadBps: 20,        // Lower threshold
  maxTradeAmount: 500000,  // Max $0.50
});

await customTrader.start();
```

### Custom Solver

```typescript
import { createSolverAgent } from './src/agents/solver-agent';

const customSolver = createSolverAgent({
  agentId: 'My-Custom-Solver',
  apiBaseUrl: 'http://localhost:3001',
  strategy: 'aggressive',  // or 'balanced' or 'conservative'
  groqApiKey: process.env.GROQ_API_KEY,
  pollIntervalMs: 3000,    // Check every 3 seconds
});

await customSolver.start();
```

### Custom Strategy

To create a completely custom strategy, extend the solver agent:

```typescript
// In src/agents/solver-agent.ts, add to STRATEGY_PARAMS:
const STRATEGY_PARAMS = {
  // ... existing strategies

  sniper: {
    bidScoreRange: [140, 160],    // Very high bids
    executionTimeRange: [500, 1000],  // Very fast
    profitShareRange: [50, 100],  // Low profit share
    bidProbability: 0.3,          // Only bid on best opportunities
    personality: 'a sniper. You rarely bid but when you do, you win.',
  },
};
```

## API Reference

### POST /api/intents

Create a new trade intent (for Trader agents).

**Request:**
```json
{
  "traderId": "Trader-SpreadHawk",
  "amount": 500000
}
```

**Response:**
```json
{
  "success": true,
  "intent": {
    "id": "intent_1_1707123456789",
    "amount": "500000",
    "status": "pending",
    "guarantee": { "verified": true }
  },
  "message": "4Mica guarantee approved, intent created"
}
```

### POST /api/intents/:id/bid

Submit a bid on a pending intent (for Solver agents).

**Request:**
```json
{
  "solverId": "Solver-AlphaStrike",
  "bidScore": 120,
  "executionTimeEstimateMs": 1500,
  "profitShareBps": 150
}
```

**Response:**
```json
{
  "success": true,
  "bid": {
    "solverId": "Solver-AlphaStrike",
    "score": 120
  },
  "message": "Bid submitted successfully"
}
```

## Groq Rate Limits

Groq's free tier has rate limits:
- ~30 requests per minute
- Daily token limits

The agent implementation includes:
- Automatic retry with exponential backoff
- Rate limit handling
- Delays between requests

## Troubleshooting

### "GROQ_API_KEY not found"
Set the environment variable:
```bash
export GROQ_API_KEY=gsk_your_key_here
```

### "Trader/Solver not found on server"
The agent ID must match a registered agent in the game server. Check:
1. `.env.sepolia` has the agent's private key
2. Agent is in `AGENT_CONFIGS` in `game-server.ts`
3. Game server is running

### "Rate limited"
The agent will automatically retry. If persistent:
- Increase `pollIntervalMs`
- Reduce the number of concurrent agents
- Upgrade to Groq paid tier

### "No arbitrage opportunity"
The trader only creates intents when spread exceeds threshold. Wait for price divergence or:
- Lower `minSpreadBps` in trader config
- Manually create price divergence in AMMs

## Architecture

```
┌─────────────────┐     HTTP API     ┌────────────────────┐
│  Trader Agent   │ ◄──────────────► │                    │
│  (Groq LLM)     │                  │    Game Server     │
└─────────────────┘                  │                    │
                                     │  ┌──────────────┐  │
┌─────────────────┐     HTTP API     │  │ 4Mica SDK    │  │
│ Solver Agent 1  │ ◄──────────────► │  │ X402 Flow    │  │
│ (Aggressive)    │                  │  └──────────────┘  │
└─────────────────┘                  │                    │
                                     │  ┌──────────────┐  │
┌─────────────────┐     HTTP API     │  │ Agent0 SDK   │  │
│ Solver Agent 2  │ ◄──────────────► │  │ Reputation   │  │
│ (Balanced)      │                  │  └──────────────┘  │
└─────────────────┘                  │                    │
                                     └────────────────────┘
┌─────────────────┐
│ Solver Agent 3  │
│ (Conservative)  │
└─────────────────┘
```

The key principle: **AI agents call the Game Server API, which internally uses 4Mica SDK**.

This ensures:
1. 4Mica SDK is used correctly (no workarounds)
2. Proper X402 flow for payment guarantees
3. Consistent reputation tracking
4. Anyone can deploy their own agent

## License

MIT
