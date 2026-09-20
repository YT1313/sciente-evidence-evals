import {
  ProviderError,
  temperatureFor,
  type CompletionRequest,
  type CompletionResult,
  type ModelProvider,
} from "./types.js";

const DEFAULT_ENDPOINT = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

export interface AnthropicProviderOptions {
  readonly model: string;
  /** Read from `ANTHROPIC_API_KEY` when omitted. Never hard-code a key. */
  readonly apiKey?: string;
  readonly endpoint?: string;
  readonly defaultMaxTokens?: number;
  readonly defaultTimeoutMs?: number;
  /** Injected in tests. Defaults to the global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>;
  model?: string;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export function createAnthropicProvider(
  options: AnthropicProviderOptions,
): ModelProvider {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
  if (!apiKey) {
    throw new ProviderError(
      "ANTHROPIC_API_KEY is not set. Keys are read from the environment only.",
      { provider: "anthropic", retryable: false },
    );
  }
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const doFetch = options.fetchImpl ?? fetch;

  return {
    name: "anthropic",
    model: options.model,
    async complete(request: CompletionRequest): Promise<CompletionResult> {
      const started = Date.now();
      const maxTokens =
        request.maxTokens ?? options.defaultMaxTokens ?? 8000;
      const signal =
        request.signal ??
        AbortSignal.timeout(
          request.timeoutMs ?? options.defaultTimeoutMs ?? 240_000,
        );

      let response: Response;
      try {
        response = await doFetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": API_VERSION,
          },
          body: JSON.stringify({
            model: options.model,
            max_tokens: maxTokens,
            temperature: temperatureFor(request),
            system: request.system,
            messages: [{ role: "user", content: request.user }],
          }),
          signal,
        });
      } catch (cause) {
        throw new ProviderError(
          `Anthropic request failed: ${String(cause)}`,
          { provider: "anthropic", retryable: true },
        );
      }

      if (!response.ok) {
        const body = await safeText(response);
        throw new ProviderError(
          `Anthropic HTTP ${response.status}: ${body.slice(0, 300)}`,
          {
            provider: "anthropic",
            status: response.status,
            retryable: response.status === 429 || response.status >= 500,
          },
        );
      }

      const data = (await response.json()) as AnthropicResponse;
      const text = (data.content ?? [])
        .filter((part) => part.type === "text")
        .map((part) => part.text ?? "")
        .join("");

      return {
        text,
        model: data.model ?? options.model,
        inputTokens: data.usage?.input_tokens ?? null,
        outputTokens: data.usage?.output_tokens ?? null,
        latencyMs: Date.now() - started,
        truncated: data.stop_reason === "max_tokens",
      };
    },
  };
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "(no body)";
  }
}
