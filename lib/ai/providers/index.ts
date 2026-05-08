import type { AIProvider } from "../types";
import { AnthropicProvider } from "./anthropic";
import { OpenAIProvider } from "./openai";

/**
 * Resolve a configured AI provider from environment variables.
 *
 *   AI_PROVIDER       = "openai" | "anthropic"      (default: "openai")
 *
 * Provider-specific:
 *   OPENAI_API_KEY    = sk-...
 *   OPENAI_MODEL      = gpt-4o-mini  (default)
 *   OPENAI_BASE_URL   = override for OpenAI-compatible providers, e.g.
 *                        https://api.groq.com/openai/v1   (Groq)
 *                        https://openrouter.ai/api/v1     (OpenRouter)
 *                        https://generativelanguage.googleapis.com/v1beta/openai
 *                                                          (Gemini)
 *                        http://localhost:11434/v1        (Ollama)
 *
 *   ANTHROPIC_API_KEY = sk-ant-...
 *   ANTHROPIC_MODEL   = claude-3-5-haiku-latest (default)
 *
 * Throws `AIConfigError` if the requested provider isn't configured. The API
 * route catches this and returns a friendly setup hint to the UI.
 */

export class AIConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIConfigError";
  }
}

let cached: AIProvider | null = null;
let cachedKey = "";

export function getProvider(): AIProvider {
  const which = (process.env.AI_PROVIDER || "openai").toLowerCase();
  // Cache key fingerprints all env vars that affect provider construction so
  // dev-time changes to .env are picked up after a server restart.
  const key =
    which === "anthropic"
      ? `anthropic|${process.env.ANTHROPIC_API_KEY ?? ""}|${
          process.env.ANTHROPIC_MODEL ?? ""
        }`
      : `openai|${process.env.OPENAI_API_KEY ?? ""}|${
          process.env.OPENAI_MODEL ?? ""
        }|${process.env.OPENAI_BASE_URL ?? ""}`;

  if (cached && cachedKey === key) return cached;

  if (which === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new AIConfigError(
        "AI_PROVIDER is 'anthropic' but ANTHROPIC_API_KEY is not set in .env."
      );
    }
    cached = new AnthropicProvider({
      apiKey,
      model: process.env.ANTHROPIC_MODEL,
    });
  } else if (which === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    const baseURL = process.env.OPENAI_BASE_URL || undefined;
    if (!apiKey) {
      // Tailor the error message based on whether they set a base URL —
      // someone using Groq/Gemini cares about a different env var name.
      const hint = baseURL
        ? "OPENAI_BASE_URL is set but OPENAI_API_KEY is empty. Paste your API key from the provider into OPENAI_API_KEY."
        : "AI_PROVIDER is 'openai' but OPENAI_API_KEY is not set in .env.";
      throw new AIConfigError(hint);
    }
    cached = new OpenAIProvider({
      apiKey,
      model: process.env.OPENAI_MODEL,
      baseURL,
    });
  } else {
    throw new AIConfigError(
      `Unknown AI_PROVIDER='${which}'. Use 'openai' or 'anthropic'.`
    );
  }

  cachedKey = key;
  return cached;
}
