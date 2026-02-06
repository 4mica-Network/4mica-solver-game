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
- **Frontend**: React, Vite, TailwindCSS
- **WebSocket**: ws library

## License

MIT
