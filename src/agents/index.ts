/**
 * OpenClaw AI Agents for 4Mica Solver Game
 *
 * Autonomous agents using Groq LLM for decision making:
 * - TraderAgent: Creates trade intents
 * - SolverAgent: Competes to fulfill intents
 *
 * Usage:
 *   import { createTraderAgent, createSolverAgent } from './agents';
 */

export { GroqAgentClient, createGroqClient } from './groq-client.js';
export type { ToolDefinition, ToolCall, AgentMessage, AgentDecision } from './groq-client.js';

export { TraderAgent, createTraderAgent } from './trader-agent.js';
export type { TraderConfig } from './trader-agent.js';

export { SolverAgent, createSolverAgent } from './solver-agent.js';
export type { SolverConfig, SolverStrategy } from './solver-agent.js';
