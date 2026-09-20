import {
  ProviderError,
  temperatureFor,
  type CompletionRequest,
  type CompletionResult,
  type ModelProvider,
} from "./types.js";

export interface OpenAICompatibleProviderOptions {
  readonly model: string;
  /** Full chat-completions URL, including `/v1/chat/completions`. */
  readonly endpoint: string;
  /** Read from `OPENAI_API_KEY` when omitted. Never hard-code a key. */
  readonly apiKey?: string;
  readonly apiKeyEnv?: string;
  readonly defaultMaxTokens?: number;
  readonly defaultTimeoutMs?: number;
  /** Ask for `response_format: { type: "json_object" }`. Default true. */
  readonly jsonMode?: boolean;
  readonly fetchImpl?: typeof fetch;
}

interface ChatCompletionResponse {
  model?: string;
  choices?: Array<{
    message?: { content?: string | null };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Any endpoint that speaks the OpenAI chat-completions shape. The endpoint is
 * always explicit: this package never guesses which service a key belongs to.
 */
export function createOpenAICompatibleProvider(
  options: OpenAICompatibleProviderOptions,
): ModelProvider {
  const keyEnv = options.apiKeyEnv ?? "OPENAI_API_KEY";
  const apiKey = options.apiKey ?? process.env[keyEnv] ?? "";
  if (!apiKey) {
    throw new ProviderError(
      `${keyEnv} is not set. Keys are read from the environment only.`,
      { provider: "openai-compatible", retryable: false },
    );
  }
  const doFetch = options.fetchImpl ?? fetch;
  const jsonMode = options.jsonMode ?? true;

  return {
    name: "openai-compatible",
    model: options.model,
    async complete(request: CompletionRequest): Promise<CompletionResult> {
      const started = Date.now();
      const signal =
        request.signal ??
        AbortSignal.timeout(
          request.timeoutMs ?? options.defaultTimeoutMs ?? 240_000,
        );

      let response: Response;
      try {
        response = await doFetch(options.endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: options.model,
            temperature: temperatureFor(request),
            max_tokens: request.maxTokens ?? options.defaultMaxTokens ?? 8000,
            ...(jsonMode
              ? { response_format: { type: "json_object" } }
              : {}),
            messages: [
              { role: "system", content: request.system },
              { role: "user", content: request.user },
            ],
          }),
          signal,
        });
      } catch (cause) {
        throw new ProviderError(
          `OpenAI-compatible request failed: ${String(cause)}`,
          { provider: "openai-compatible", retryable: true },
        );
      }

      if (!response.ok) {
        const body = await safeText(response);
        throw new ProviderError(
          `OpenAI-compatible HTTP ${response.status}: ${body.slice(0, 300)}`,
          {
            provider: "openai-compatible",
            status: response.status,
            retryable: response.status === 429 || response.status >= 500,
          },
        );
      }

      const data = (await response.json()) as ChatCompletionResponse;
      const choice = data.choices?.[0];

      return {
        text: choice?.message?.content ?? "",
        model: data.model ?? options.model,
        inputTokens: data.usage?.prompt_tokens ?? null,
        outputTokens: data.usage?.completion_tokens ?? null,
        latencyMs: Date.now() - started,
        truncated: choice?.finish_reason === "length",
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
