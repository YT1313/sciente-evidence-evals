/**
 * The whole model-facing surface of this package.
 *
 * Deliberately narrow: one call, one system string, one user string, one text
 * response. Anything richer (streaming, tool use, multi-turn) belongs to the
 * application, not to an appraisal step that must be reproducible.
 */

/**
 * What the call is for. The pipeline sets the temperature from this rather
 * than from a caller-supplied default, because the right temperature is a
 * property of the task: an extraction or a score must be reproducible, a
 * free-text rationale may not need to be.
 */
export type TaskKind = "extract" | "score" | "judge" | "draft";

export const DEFAULT_TEMPERATURE: Record<TaskKind, number> = {
  extract: 0,
  score: 0,
  judge: 0,
  draft: 0.3,
};

export interface CompletionRequest {
  readonly system: string;
  readonly user: string;
  readonly task: TaskKind;
  readonly maxTokens?: number;
  /** Overrides the task default. Use only with a reason. */
  readonly temperature?: number;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface CompletionResult {
  readonly text: string;
  readonly model: string;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly latencyMs: number;
  /** True when the provider stopped because it hit the output cap. */
  readonly truncated: boolean;
}

export interface ModelProvider {
  readonly name: string;
  readonly model: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly detail: {
      readonly provider: string;
      readonly status?: number;
      readonly retryable: boolean;
    },
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export function temperatureFor(request: CompletionRequest): number {
  return request.temperature ?? DEFAULT_TEMPERATURE[request.task];
}
