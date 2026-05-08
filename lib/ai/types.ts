/**
 * Provider-agnostic chat / tool-calling types.
 *
 * The agent loop and the tool layer are written against this small surface;
 * each AI provider (OpenAI, Anthropic, …) ships an adapter that converts
 * to/from its native shapes.
 *
 * Keeping this layer thin is intentional. Prompt engineering, retries, and
 * business logic live in the orchestrator (`lib/ai/agent.ts`), not here.
 */

// JSON Schema subset we actually use. Both OpenAI and Anthropic accept it.
export type JSONSchema = {
  type: "object";
  properties: Record<string, JSONSchemaProp>;
  required?: string[];
  additionalProperties?: boolean;
};

export type JSONSchemaProp =
  | { type: "string"; description?: string; enum?: string[] }
  | { type: "number"; description?: string; minimum?: number; maximum?: number }
  | { type: "integer"; description?: string; minimum?: number; maximum?: number }
  | { type: "boolean"; description?: string }
  | {
      type: "array";
      description?: string;
      items: JSONSchemaProp;
    };

export interface ToolDef {
  name: string;
  description: string;
  parameters: JSONSchema;
}

export interface ToolCall {
  /** Provider-issued id used to match the result back. */
  id: string;
  name: string;
  /** Already JSON-parsed; never a raw string. */
  arguments: Record<string, unknown>;
}

export type ChatMessage =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      /** Plain text reply. May be "" when the assistant only made tool calls. */
      content: string;
      toolCalls?: ToolCall[];
    }
  | {
      role: "tool";
      /** Must match a `ToolCall.id` from the preceding assistant message. */
      toolCallId: string;
      /** JSON-stringified result. */
      content: string;
    };

export interface ChatRequest {
  system: string;
  messages: ChatMessage[];
  tools: ToolDef[];
  /**
   * Hard cap on output tokens. Defaults are provider-specific.
   */
  maxOutputTokens?: number;
}

export interface ChatResult {
  /** Final text content. May be "" when the model only emitted tool calls. */
  text: string;
  toolCalls: ToolCall[];
  /**
   * - "stop"        — natural completion, no further calls expected
   * - "tool_calls"  — model wants tools executed before continuing
   * - "length"      — hit max tokens (treat as soft error)
   * - "other"       — anything else (filter, refusal, …)
   */
  finishReason: "stop" | "tool_calls" | "length" | "other";
  usage?: { inputTokens: number; outputTokens: number };
}

export interface AIProvider {
  /** Stable identifier, e.g. "openai" / "anthropic". Used for logging. */
  readonly name: string;
  /** Concrete model id this instance is bound to (e.g. "gpt-4o-mini"). */
  readonly model: string;
  chat(req: ChatRequest): Promise<ChatResult>;
}
