/**
 * Groq LLM Client for OpenClaw AI Agents
 *
 * Uses Groq's free tier API with Llama-3.3-70B-Versatile model
 * for fast, cost-free AI agent decision making.
 *
 * Features:
 * - Tool/function calling support
 * - Rate limiting for free tier
 * - Structured output parsing
 */

import Groq from 'groq-sdk';

// =============================================================================
// Types
// =============================================================================

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, {
        type: string;
        description: string;
        enum?: string[];
      }>;
      required: string[];
    };
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface AgentDecision {
  action: string;
  params?: Record<string, unknown>;
  reasoning?: string;
}

// =============================================================================
// Groq Client
// =============================================================================

export class GroqAgentClient {
  private client: Groq;
  private model: string;
  private maxRetries: number;
  private rateLimitDelay: number;

  constructor(config: {
    apiKey?: string;
    model?: string;
    maxRetries?: number;
    rateLimitDelay?: number;
  } = {}) {
    const apiKey = config.apiKey || process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error('GROQ_API_KEY not found. Set it in environment or pass to constructor.');
    }

    this.client = new Groq({ apiKey });
    this.model = config.model || 'llama-3.3-70b-versatile';
    this.maxRetries = config.maxRetries || 5;
    this.rateLimitDelay = config.rateLimitDelay || 3000; // 3s between requests for free tier
  }

  /**
   * Chat completion with optional tool calling
   */
  async chat(
    messages: AgentMessage[],
    tools?: ToolDefinition[],
    temperature: number = 0.7
  ): Promise<{
    content: string | null;
    toolCalls: ToolCall[];
    finishReason: string;
  }> {
    let attempt = 0;

    while (attempt < this.maxRetries) {
      try {
        const response = await this.client.chat.completions.create({
          model: this.model,
          messages: messages as Groq.Chat.ChatCompletionMessageParam[],
          tools: tools as Groq.Chat.ChatCompletionTool[],
          temperature,
          max_tokens: 1024,
        });

        const choice = response.choices[0];
        return {
          content: choice.message.content,
          toolCalls: (choice.message.tool_calls || []) as ToolCall[],
          finishReason: choice.finish_reason || 'stop',
        };
      } catch (error: unknown) {
        attempt++;
        const err = error as { status?: number; message?: string };

        // Rate limit error - wait and retry
        if (err.status === 429) {
          console.log(`[Groq] Rate limited, waiting ${this.rateLimitDelay}ms (attempt ${attempt}/${this.maxRetries})`);
          await this.sleep(this.rateLimitDelay * attempt);
          continue;
        }

        // Other error - throw
        if (attempt >= this.maxRetries) {
          throw new Error(`Groq API error after ${this.maxRetries} attempts: ${err.message}`);
        }

        await this.sleep(1000);
      }
    }

    throw new Error('Max retries exceeded');
  }

  /**
   * Get a structured decision from the AI
   */
  async getDecision(
    systemPrompt: string,
    userPrompt: string,
    tools: ToolDefinition[]
  ): Promise<AgentDecision | null> {
    const messages: AgentMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const response = await this.chat(messages, tools, 0.3);

    // If tool was called, parse it as the decision
    if (response.toolCalls.length > 0) {
      const toolCall = response.toolCalls[0];
      try {
        const params = JSON.parse(toolCall.function.arguments);
        return {
          action: toolCall.function.name,
          params,
          reasoning: response.content || undefined,
        };
      } catch {
        console.error('[Groq] Failed to parse tool call arguments');
        return null;
      }
    }

    // No tool call - AI decided not to act
    return {
      action: 'no_action',
      reasoning: response.content || 'No action taken',
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createGroqClient(config?: {
  apiKey?: string;
  model?: string;
}): GroqAgentClient {
  return new GroqAgentClient(config);
}

export default GroqAgentClient;
