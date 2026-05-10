import { getProvider } from "./providers";
import { systemPrompt } from "./prompts";
import { executeTool, TOOL_DEFS } from "./tools";
import type { ChatMessage, ToolCall } from "./types";

/**
 * Single-turn agent runner.
 *
 * Given the prior conversation `history` and a fresh user `userMessage`, this
 * runs the orchestrator loop:
 *
 *   1. Send everything to the model with our tool catalog.
 *   2. If the model emits tool calls, execute each one server-side and feed
 *      the JSON results back as tool messages.
 *   3. Repeat until the model returns a non-tool response, or we hit the
 *      step limit.
 *
 * The agent itself is stateless. The caller is responsible for persisting
 * `messages` (typically in client React state) and passing it back next turn.
 */

const MAX_STEPS = 6;
const MAX_TOOL_CALLS_PER_STEP = 6;

export interface AgentInput {
  userMessage: string;
  history?: ChatMessage[];
  /** Optional override; defaults to "now" for date-aware system prompt. */
  now?: Date;
  /**
   * Override the system prompt entirely. Used by non-chat surfaces (email
   * processing, briefing composer) to give the model a different mission
   * while still using the same tools and provider.
   */
  systemOverride?: string;
}

export interface AgentTrace {
  /** Each tool we actually executed during this turn, oldest first. */
  toolCalls: Array<{
    name: string;
    arguments: Record<string, unknown>;
    result: unknown;
  }>;
  /** Steps actually used (1 per model round-trip). */
  steps: number;
  /** Aggregated token usage across all model calls in this turn. */
  usage?: { inputTokens: number; outputTokens: number };
  provider: string;
  model: string;
}

export interface AgentOutput {
  reply: string;
  /** Updated conversation including the assistant's final message. */
  messages: ChatMessage[];
  trace: AgentTrace;
}

export async function runAgent(input: AgentInput): Promise<AgentOutput> {
  const provider = getProvider();
  const messages: ChatMessage[] = [
    ...(input.history ?? []),
    { role: "user", content: input.userMessage },
  ];

  const trace: AgentTrace = {
    toolCalls: [],
    steps: 0,
    provider: provider.name,
    model: provider.model,
  };

  let totalIn = 0;
  let totalOut = 0;

  for (let step = 0; step < MAX_STEPS; step++) {
    trace.steps = step + 1;

    const result = await provider.chat({
      system: input.systemOverride ?? systemPrompt(input.now),
      messages,
      tools: TOOL_DEFS,
    });

    if (result.usage) {
      totalIn += result.usage.inputTokens;
      totalOut += result.usage.outputTokens;
    }

    // Always record the assistant turn — even when there are tool calls,
    // the next round needs to see them.
    messages.push({
      role: "assistant",
      content: result.text,
      toolCalls: result.toolCalls.length ? result.toolCalls : undefined,
    });

    if (!result.toolCalls.length) {
      // Done. Final reply is in result.text.
      trace.usage = { inputTokens: totalIn, outputTokens: totalOut };
      return {
        reply: result.text || "(no reply)",
        messages,
        trace,
      };
    }

    if (result.toolCalls.length > MAX_TOOL_CALLS_PER_STEP) {
      // Defensive: cap so a runaway model can't hammer the DB in one step.
      result.toolCalls = result.toolCalls.slice(0, MAX_TOOL_CALLS_PER_STEP);
    }

    for (const call of result.toolCalls) {
      const out = await executeOne(call);
      trace.toolCalls.push({
        name: call.name,
        arguments: call.arguments,
        result: out,
      });
      messages.push({
        role: "tool",
        toolCallId: call.id,
        content: JSON.stringify(out),
      });
    }
  }

  // Hit step limit — return whatever we have with a safety message.
  trace.usage = { inputTokens: totalIn, outputTokens: totalOut };
  const fallback =
    "I hit my internal step limit while working on this. Please simplify the request or try again.";
  messages.push({ role: "assistant", content: fallback });
  return { reply: fallback, messages, trace };
}

async function executeOne(call: ToolCall): Promise<unknown> {
  return await executeTool(call.name, call.arguments);
}
