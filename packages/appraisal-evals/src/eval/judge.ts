/**
 * LLM-as-judge for appraisal quality.
 *
 * A judge is only worth running if its output can be wrong in a visible way.
 * Three properties make that possible here:
 *
 *  - **Anchors for every point on the scale.** "Rate 1-10 for accuracy" is an
 *    invitation to regress to 7. Each criterion below defines what a 1, a 2,
 *    a 3, a 4 and a 5 look like, in terms of things that can be checked
 *    against the appraisal record.
 *  - **A schema, not a shape.** The response is validated; there is no path
 *    where a missing field becomes a middling score.
 *  - **An explicit failure state.** When the judge cannot be parsed or
 *    validated, the result is `judge_failed`. It is never a default score,
 *    and a failed judge is excluded from aggregates rather than counted as
 *    average. Silently substituting 5 out of 10 for "the judge broke" makes
 *    a broken judge look like a mediocre system.
 */

import { z } from "zod";
import { extractJson } from "../json/parse.js";
import { buildDataBlocks } from "@sciente/data-block";
import { fillTemplate } from "../prompt/template.js";
import type { ModelProvider } from "../provider/types.js";

export const JUDGE_SCALE = [1, 2, 3, 4, 5] as const;

export interface JudgeCriterion {
  readonly key: string;
  readonly title: string;
  /** One anchor per point of the scale, from 1 to 5. */
  readonly anchors: readonly [string, string, string, string, string];
}

export const JUDGE_CRITERIA: readonly JudgeCriterion[] = [
  {
    key: "evidence_fidelity",
    title: "Does the quoted evidence actually support the answer given?",
    anchors: [
      "1 — The quotes are unrelated to the question, or contradict the answer.",
      "2 — The quotes are on topic but do not contain the fact the answer asserts.",
      "3 — The quotes support the answer only with an inferential step the appraiser did not state.",
      "4 — The quotes support the answer, but include material that is not needed or omit a qualifier present in the source.",
      "5 — Each quote states the fact the answer relies on, with its qualifiers intact.",
    ],
  },
  {
    key: "abstention_discipline",
    title: "Is 'no information' used where, and only where, the article is silent?",
    anchors: [
      "1 — Substantive answers are given for several points the article never addresses.",
      "2 — At least one answer is inferred from what is typical for the design rather than from the text.",
      "3 — Abstention is broadly correct but one answer over- or under-claims what the text supports.",
      "4 — Abstention is correct throughout, though one NI could have been answered from the text.",
      "5 — Every NI corresponds to genuine silence, and nothing stated in the text was passed over as NI.",
    ],
  },
  {
    key: "rubric_conformance",
    title: "Are the signalling questions answered as the RoB 2 tool defines them?",
    anchors: [
      "1 — Answers address a different question from the one asked, or invert its polarity.",
      "2 — One or more branch questions are answered as though reached when they were not, or vice versa.",
      "3 — The answers are defensible but at least one reads the question loosely.",
      "4 — The answers follow the tool, with one borderline reading a reviewer might disagree with.",
      "5 — Every answer is the one the tool's guidance calls for on this text.",
    ],
  },
  {
    key: "rationale_quality",
    title: "Does the rationale explain the answer without padding or advice?",
    anchors: [
      "1 — The rationale restates the question, or gives clinical advice, or contradicts the answer.",
      "2 — The rationale is generic and would fit any trial.",
      "3 — The rationale is specific but leaves the decisive step implicit.",
      "4 — The rationale names the decisive fact, with some redundancy.",
      "5 — The rationale names the decisive fact and nothing else.",
    ],
  },
] as const;

const scoreSchema = z.number().int().min(1).max(5);

const criterionKeys = JUDGE_CRITERIA.map((c) => c.key);

/**
 * The judge must say which part of the record drove the score. A number with
 * no locus is not reviewable, so `evidence` is required.
 */
const criterionScoreSchema = z
  .object({
    score: scoreSchema,
    evidence: z.string().min(1).max(600),
  })
  .strict();

const scoresShape: z.ZodRawShape = Object.fromEntries(
  criterionKeys.map((key) => [key, criterionScoreSchema]),
);

export const judgeResponseSchema = z
  .object({
    scores: z.object(scoresShape).strict(),
    overall_comment: z.string().max(1000),
  })
  .strict();

export type CriterionScore = z.infer<typeof criterionScoreSchema>;

export interface JudgeResponse {
  readonly scores: Readonly<Record<string, CriterionScore>>;
  readonly overall_comment: string;
}

export type JudgeOutcome =
  | {
      readonly status: "ok";
      readonly scores: Readonly<
        Record<string, { readonly score: number; readonly evidence: string }>
      >;
      /** Mean of the criterion scores, on the 1-5 scale. */
      readonly mean: number;
      readonly comment: string;
      readonly model: string;
    }
  | {
      readonly status: "judge_failed";
      readonly reason:
        | "provider_error"
        | "response_not_json"
        | "response_schema_invalid"
        | "response_truncated";
      readonly detail: readonly string[];
      readonly model: string;
    };

export const JUDGE_SYSTEM_TEMPLATE = `You are auditing a completed risk-of-bias appraisal of a randomised trial.

You are not redoing the appraisal. You are scoring how well it was done,
against the article text, on the criteria below. Each criterion has an anchor
for every point of its scale: choose the anchor that matches what you see, and
do not average between them. If you cannot tell, choose the lower score and
say why.

## Criteria

{{criteria}}

## Output format

Return a single JSON object and nothing else.

{
  "scores": {
{{scoreKeys}}
  },
  "overall_comment": "at most three sentences"
}

"evidence" must point at the specific answer, quote or omission that drove the
score. A score with no locus is not usable.`;

function renderCriteria(): string {
  return JUDGE_CRITERIA.map(
    (criterion) =>
      `### ${criterion.key} — ${criterion.title}\n` +
      criterion.anchors.map((a) => `  ${a}`).join("\n"),
  ).join("\n\n");
}

function renderScoreKeys(): string {
  return JUDGE_CRITERIA.map(
    (criterion) =>
      `    "${criterion.key}": { "score": 1, "evidence": "..." }`,
  ).join(",\n");
}

export function buildJudgeSystemPrompt(): string {
  return fillTemplate(JUDGE_SYSTEM_TEMPLATE, {
    criteria: renderCriteria(),
    scoreKeys: renderScoreKeys(),
  });
}

export interface JudgeInput {
  readonly articleText: string;
  /** The appraisal record, already serialised for review. */
  readonly appraisalJson: string;
}

export async function runJudge(
  provider: ModelProvider,
  input: JudgeInput,
  options: { readonly maxTokens?: number; readonly signal?: AbortSignal } = {},
): Promise<JudgeOutcome> {
  const { text: blocks } = buildDataBlocks([
    { name: "article_text", content: input.articleText },
    { name: "appraisal_under_review", content: input.appraisalJson },
  ]);

  let raw: string;
  let truncated = false;
  try {
    const completion = await provider.complete({
      system: buildJudgeSystemPrompt(),
      user: `Score the appraisal below against the article.\n\n${blocks}`,
      task: "judge",
      maxTokens: options.maxTokens ?? 2000,
      signal: options.signal,
    });
    raw = completion.text;
    truncated = completion.truncated;
  } catch (cause) {
    return {
      status: "judge_failed",
      reason: "provider_error",
      detail: [cause instanceof Error ? cause.message : String(cause)],
      model: provider.model,
    };
  }

  if (truncated) {
    return {
      status: "judge_failed",
      reason: "response_truncated",
      detail: ["The judge hit the output cap."],
      model: provider.model,
    };
  }

  let json: unknown;
  try {
    json = extractJson(raw);
  } catch (cause) {
    return {
      status: "judge_failed",
      reason: "response_not_json",
      detail: [cause instanceof Error ? cause.message : String(cause)],
      model: provider.model,
    };
  }

  const parsed = judgeResponseSchema.safeParse(json);
  if (!parsed.success) {
    return {
      status: "judge_failed",
      reason: "response_schema_invalid",
      detail: parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
      ),
      model: provider.model,
    };
  }

  const scores = parsed.data.scores as Record<
    string,
    { score: number; evidence: string }
  >;
  const values = criterionKeys.map((key) => scores[key]!.score);
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;

  return {
    status: "ok",
    scores,
    mean,
    comment: parsed.data.overall_comment,
    model: provider.model,
  };
}

/**
 * Aggregate judge outcomes. Failures are counted, never scored: a run where
 * the judge broke on half the items reports `failed: n/2`, not a mean pulled
 * towards the middle of the scale.
 */
export function summariseJudgeOutcomes(outcomes: readonly JudgeOutcome[]): {
  readonly scored: number;
  readonly failed: number;
  readonly mean: number | null;
  readonly perCriterion: Readonly<Record<string, number>>;
} {
  const ok = outcomes.filter(
    (o): o is Extract<JudgeOutcome, { status: "ok" }> => o.status === "ok",
  );
  if (ok.length === 0) {
    return {
      scored: 0,
      failed: outcomes.length,
      mean: null,
      perCriterion: {},
    };
  }
  const perCriterion: Record<string, number> = {};
  for (const key of criterionKeys) {
    perCriterion[key] =
      ok.reduce((sum, o) => sum + o.scores[key]!.score, 0) / ok.length;
  }
  return {
    scored: ok.length,
    failed: outcomes.length - ok.length,
    mean: ok.reduce((sum, o) => sum + o.mean, 0) / ok.length,
    perCriterion,
  };
}
