export {
  DEFAULT_TEMPERATURE,
  ProviderError,
  temperatureFor,
  type CompletionRequest,
  type CompletionResult,
  type ModelProvider,
  type TaskKind,
} from "./types.js";

export {
  createAnthropicProvider,
  type AnthropicProviderOptions,
} from "./anthropic.js";

export {
  createOpenAICompatibleProvider,
  type OpenAICompatibleProviderOptions,
} from "./openai-compatible.js";

export { createReplayProvider } from "./replay.js";

import { createAnthropicProvider } from "./anthropic.js";
import { createOpenAICompatibleProvider } from "./openai-compatible.js";
import { ProviderError, type ModelProvider } from "./types.js";

/**
 * Build a provider from environment variables. Keys are never accepted as
 * arguments here and never written to a file by this package.
 *
 *   APPRAISAL_PROVIDER   "anthropic" (default) | "openai-compatible"
 *   APPRAISAL_MODEL      model identifier, required
 *   ANTHROPIC_API_KEY    for the Anthropic provider
 *   OPENAI_API_KEY       for the OpenAI-compatible provider
 *   OPENAI_BASE_URL      full chat-completions URL, required for that provider
 */
export function createProviderFromEnv(): ModelProvider {
  const kind = process.env.APPRAISAL_PROVIDER ?? "anthropic";
  const model = process.env.APPRAISAL_MODEL;
  if (!model) {
    throw new ProviderError(
      "APPRAISAL_MODEL is not set: name the model explicitly rather than " +
        "relying on a default that will drift.",
      { provider: kind, retryable: false },
    );
  }

  if (kind === "anthropic") {
    return createAnthropicProvider({ model });
  }
  if (kind === "openai-compatible") {
    const endpoint = process.env.OPENAI_BASE_URL;
    if (!endpoint) {
      throw new ProviderError(
        "OPENAI_BASE_URL is not set: the endpoint must be explicit.",
        { provider: kind, retryable: false },
      );
    }
    return createOpenAICompatibleProvider({ model, endpoint });
  }

  throw new ProviderError(
    `Unknown APPRAISAL_PROVIDER ${JSON.stringify(kind)}. ` +
      `Expected "anthropic" or "openai-compatible".`,
    { provider: kind, retryable: false },
  );
}
