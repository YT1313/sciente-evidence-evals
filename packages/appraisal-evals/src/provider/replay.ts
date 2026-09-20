import type {
  CompletionRequest,
  CompletionResult,
  ModelProvider,
} from "./types.js";

/**
 * A provider that returns recorded responses instead of calling a model.
 *
 * This is what makes the deterministic evaluation possible without an API
 * key: the whole pipeline — prompt assembly, schema validation, citation
 * verification, the algorithm — runs exactly as it does in production, and
 * only the network call is replaced. A regression in any of those steps fails
 * CI on every push, with no cost and no variance.
 *
 * Responses are keyed by an arbitrary label, usually the dataset item id.
 */
export function createReplayProvider(
  responses: Readonly<Record<string, string>>,
  options: { model?: string } = {},
): ModelProvider & { withKey(key: string): ModelProvider } {
  const model = options.model ?? "replay";

  const providerFor = (key: string | null): ModelProvider => ({
    name: "replay",
    model,
    async complete(_request: CompletionRequest): Promise<CompletionResult> {
      const resolved = key ?? Object.keys(responses)[0];
      if (resolved === undefined || responses[resolved] === undefined) {
        throw new Error(
          `Replay provider has no recorded response for key ${JSON.stringify(resolved)}.`,
        );
      }
      return {
        text: responses[resolved]!,
        model,
        inputTokens: null,
        outputTokens: null,
        latencyMs: 0,
        truncated: false,
      };
    },
  });

  return Object.assign(providerFor(null), {
    withKey: (key: string) => providerFor(key),
  });
}
