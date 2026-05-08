import OpenAI from "openai";
import type {
  AIProvider,
  ChatMessage,
  ChatRequest,
  ChatResult,
  ToolCall,
  ToolDef,
} from "../types";

/**
 * OpenAI-compatible Chat Completions adapter.
 *
 * Works against any provider that speaks the OpenAI Chat Completions wire
 * format — OpenAI itself, Groq, Together, OpenRouter, Gemini's OpenAI
 * endpoint, a local Ollama, etc. The provider URL is configurable via
 * `baseURL` (env: OPENAI_BASE_URL).
 *
 * We deliberately use Chat Completions (not the newer Responses API) because
 * tool-calling semantics are simpler, well-documented, and supported across
 * the OpenAI-compatible ecosystem.
 */

type ChatCompletionMessageParam =
  OpenAI.Chat.Completions.ChatCompletionMessageParam;
type ChatCompletionTool = OpenAI.Chat.Completions.ChatCompletionTool;

export class OpenAIProvider implements AIProvider {
  readonly name: string;
  readonly model: string;
  private client: OpenAI;

  constructor(opts: {
    apiKey: string;
    model?: string;
    /** Custom OpenAI-compatible endpoint (Groq, Gemini, Ollama, …). */
    baseURL?: string;
    /** Display name for logs/UI; defaults to "openai" or a base-URL hint. */
    name?: string;
  }) {
    this.client = new OpenAI({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL,
    });
    this.model = opts.model ?? "gpt-4o-mini";
    this.name = opts.name ?? guessProviderName(opts.baseURL);
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: req.system },
      ...req.messages.map(toOpenAIMessage),
    ];

    const tools: ChatCompletionTool[] = req.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters as Record<string, unknown>,
      },
    }));

    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages,
      tools: tools.length ? tools : undefined,
      // Let the model decide when to call tools.
      tool_choice: tools.length ? "auto" : undefined,
      max_tokens: req.maxOutputTokens ?? 1024,
      // Slight bias toward determinism — good for ops responses.
      temperature: 0.2,
    });

    const choice = completion.choices[0];
    const msg = choice.message;
    const calls: ToolCall[] = (msg.tool_calls ?? [])
      .filter((tc) => tc.type === "function")
      .map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: safeParseJson(tc.function.arguments),
      }));

    const finishReason: ChatResult["finishReason"] =
      choice.finish_reason === "tool_calls"
        ? "tool_calls"
        : choice.finish_reason === "stop"
        ? "stop"
        : choice.finish_reason === "length"
        ? "length"
        : "other";

    return {
      text: msg.content ?? "",
      toolCalls: calls,
      finishReason,
      usage: completion.usage
        ? {
            inputTokens: completion.usage.prompt_tokens,
            outputTokens: completion.usage.completion_tokens,
          }
        : undefined,
    };
  }
}

function toOpenAIMessage(m: ChatMessage): ChatCompletionMessageParam {
  if (m.role === "user") return { role: "user", content: m.content };
  if (m.role === "tool") {
    return { role: "tool", content: m.content, tool_call_id: m.toolCallId };
  }
  // assistant
  if (m.toolCalls?.length) {
    return {
      role: "assistant",
      content: m.content || null,
      tool_calls: m.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        },
      })),
    };
  }
  return { role: "assistant", content: m.content };
}

function safeParseJson(s: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(s);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function guessProviderName(baseURL?: string): string {
  if (!baseURL) return "openai";
  const u = baseURL.toLowerCase();
  if (u.includes("groq.com")) return "groq";
  if (u.includes("openrouter.ai")) return "openrouter";
  if (u.includes("together")) return "together";
  if (u.includes("googleapis.com")) return "gemini";
  if (u.includes("localhost") || u.includes("127.0.0.1")) return "local";
  return "openai-compatible";
}

// Re-export the ToolDef type so callers don't have to import from "../types"
// just to reference it alongside this adapter.
export type { ToolDef };
