import Anthropic from "@anthropic-ai/sdk";
import type {
  AIProvider,
  ChatMessage,
  ChatRequest,
  ChatResult,
  ToolCall,
} from "../types";

/**
 * Anthropic Messages API adapter.
 *
 * Mapping notes:
 *  - System prompt is a top-level `system` param (not a message).
 *  - Tool calls appear as `content` blocks of type "tool_use".
 *  - Tool results appear as a USER message with `content` = [tool_result blocks]
 *    (Anthropic doesn't have a "tool" role).
 *  - `stop_reason === "tool_use"` is our `tool_calls` finish reason.
 */

type AnthropicMessageParam = Anthropic.Messages.MessageParam;
type AnthropicTool = Anthropic.Messages.Tool;
type AnthropicContentBlock = Anthropic.Messages.ContentBlock;

export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";
  readonly model: string;
  private client: Anthropic;

  constructor(opts: { apiKey: string; model?: string }) {
    this.client = new Anthropic({ apiKey: opts.apiKey });
    // Haiku is the cost-friendly default; bump to sonnet for harder reasoning.
    this.model = opts.model ?? "claude-3-5-haiku-latest";
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const messages = mergeForAnthropic(req.messages);

    const tools: AnthropicTool[] = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as AnthropicTool["input_schema"],
    }));

    const completion = await this.client.messages.create({
      model: this.model,
      system: req.system,
      messages,
      tools: tools.length ? tools : undefined,
      max_tokens: req.maxOutputTokens ?? 1024,
      temperature: 0.2,
    });

    const text = completion.content
      .filter((b): b is Extract<AnthropicContentBlock, { type: "text" }> =>
        b.type === "text"
      )
      .map((b) => b.text)
      .join("\n")
      .trim();

    const calls: ToolCall[] = completion.content
      .filter(
        (b): b is Extract<AnthropicContentBlock, { type: "tool_use" }> =>
          b.type === "tool_use"
      )
      .map((b) => ({
        id: b.id,
        name: b.name,
        arguments:
          (b.input ?? {}) && typeof b.input === "object" && !Array.isArray(b.input)
            ? (b.input as Record<string, unknown>)
            : {},
      }));

    const finishReason: ChatResult["finishReason"] =
      completion.stop_reason === "tool_use"
        ? "tool_calls"
        : completion.stop_reason === "end_turn"
        ? "stop"
        : completion.stop_reason === "max_tokens"
        ? "length"
        : "other";

    return {
      text,
      toolCalls: calls,
      finishReason,
      usage: completion.usage
        ? {
            inputTokens: completion.usage.input_tokens,
            outputTokens: completion.usage.output_tokens,
          }
        : undefined,
    };
  }
}

/**
 * Anthropic requires:
 *  - alternating user/assistant messages
 *  - tool results delivered as a USER message containing tool_result blocks
 *
 * Our internal representation uses a flat list of {user, assistant, tool}
 * messages. We collapse contiguous tool messages into a single user message
 * with tool_result blocks, and re-emit assistant tool_calls as tool_use blocks.
 */
function mergeForAnthropic(messages: ChatMessage[]): AnthropicMessageParam[] {
  const out: AnthropicMessageParam[] = [];
  let pendingToolResults: AnthropicMessageParam | null = null;

  const flushToolResults = () => {
    if (pendingToolResults) {
      out.push(pendingToolResults);
      pendingToolResults = null;
    }
  };

  for (const m of messages) {
    if (m.role === "tool") {
      const block = {
        type: "tool_result" as const,
        tool_use_id: m.toolCallId,
        content: m.content,
      };
      if (
        pendingToolResults &&
        Array.isArray(pendingToolResults.content)
      ) {
        (pendingToolResults.content as unknown[]).push(block);
      } else {
        pendingToolResults = { role: "user", content: [block] };
      }
      continue;
    }

    flushToolResults();

    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
      continue;
    }

    // assistant
    if (m.toolCalls?.length) {
      const blocks: unknown[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const tc of m.toolCalls) {
        blocks.push({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: tc.arguments,
        });
      }
      out.push({
        role: "assistant",
        content: blocks as AnthropicMessageParam["content"],
      });
    } else {
      out.push({ role: "assistant", content: m.content });
    }
  }

  flushToolResults();
  return out;
}
