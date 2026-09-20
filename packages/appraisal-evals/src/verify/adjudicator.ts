/**
 * Optional second opinion on whether a quote supports an answer.
 *
 * The lexicon check in `support.ts` is deterministic and blunt: it cannot
 * recognise a correct answer phrased in vocabulary it does not carry, so it
 * returns `insufficient` and the answer is demoted. That is safe but it costs
 * coverage, and coverage is a real cost.
 *
 * This adjudicator exists to recover those cases, and only those. It is:
 *
 *  - **off unless a caller passes it.** Nothing in the deterministic
 *    evaluation depends on it, and CI never calls a model.
 *  - **only ever run on `insufficient`.** It cannot overturn a `contradicts`
 *    and it is never asked about an answer the lexicon already accepted, so
 *    it can only restore an answer, never approve one that failed a
 *    deterministic check.
 *  - **blind to everything except the question, the answer and the quote.**
 *    It does not see the article, the other answers or the verdict, so it
 *    cannot be talked into anything by the article's author and cannot drift
 *    towards agreeing with the appraisal it is auditing.
 *
 * It is a second signal, not a guarantee. An answer it rescues is recorded as
 * `supports_adjudicated`, which is distinguishable in the output from an
 * answer the deterministic check accepted.
 */

import { z } from "zod";
import { extractJson } from "../json/parse.js";
import { buildDataBlocks } from "@sciente/data-block";
import type { ModelProvider } from "../provider/types.js";
import type { Response } from "../rob2/algorithm.js";

export const adjudicationSchema = z
  .object({
    verdict: z.enum(["supports", "contradicts", "insufficient"]),
    reason: z.string().min(1).max(400),
  })
  .strict();

export type Adjudication = z.infer<typeof adjudicationSchema>;

export type AdjudicationOutcome =
  | { readonly status: "ok"; readonly verdict: Adjudication["verdict"]; readonly reason: string }
  | { readonly status: "failed"; readonly detail: string };

export interface AdjudicationInput {
  readonly questionId: string;
  readonly questionText: string;
  readonly response: Response;
  readonly quotes: readonly string[];
}

/** A function the appraisal pipeline can be given to adjudicate one answer. */
export type EvidenceAdjudicator = (
  input: AdjudicationInput,
) => Promise<AdjudicationOutcome>;

const SYSTEM_PROMPT = `You are checking one claim against one quotation.

You will be given a risk-of-bias signalling question, the answer somebody gave
to it, and the exact sentence or sentences they offered as evidence. You do
not have the article and you must not reason about what it probably says.

Decide, from the quotation alone:

  supports     — the quotation states the fact the answer depends on.
  contradicts  — the quotation states the opposite of what the answer claims.
  insufficient — the quotation is about something else, or is compatible with
                 either answer, or leaves the decisive fact unstated.

"insufficient" is the correct verdict whenever the quotation merely fails to
settle the question. Do not reward a plausible-sounding answer; a quotation
that does not contain the fact is insufficient however reasonable the answer
looks. Answer codes: Y = yes, PY = probably yes, PN = probably no, N = no.

Return a single JSON object and nothing else:

{ "verdict": "supports | contradicts | insufficient", "reason": "one sentence" }`;

/**
 * Build an adjudicator backed by a model provider.
 *
 * The quotation arrives inside a data block: it is text from an article, so
 * it is untrusted, and an instruction embedded in it must not become an
 * instruction to the adjudicator.
 */
export function createModelAdjudicator(
  provider: ModelProvider,
  options: { readonly maxTokens?: number; readonly signal?: AbortSignal } = {},
): EvidenceAdjudicator {
  return async (input: AdjudicationInput): Promise<AdjudicationOutcome> => {
    const { text: block } = buildDataBlocks([
      { name: "quotation", content: input.quotes.join("\n---\n") },
    ]);

    const user = [
      `Question ${input.questionId}: ${input.questionText}`,
      `Answer given: ${input.response}`,
      "",
      block,
    ].join("\n");

    let raw: string;
    try {
      const completion = await provider.complete({
        system: SYSTEM_PROMPT,
        user,
        task: "judge",
        maxTokens: options.maxTokens ?? 300,
        signal: options.signal,
      });
      if (completion.truncated) {
        return { status: "failed", detail: "adjudicator hit the output cap" };
      }
      raw = completion.text;
    } catch (cause) {
      return {
        status: "failed",
        detail: cause instanceof Error ? cause.message : String(cause),
      };
    }

    let json: unknown;
    try {
      json = extractJson(raw);
    } catch (cause) {
      return {
        status: "failed",
        detail: cause instanceof Error ? cause.message : String(cause),
      };
    }

    const parsed = adjudicationSchema.safeParse(json);
    if (!parsed.success) {
      return {
        status: "failed",
        detail: parsed.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; "),
      };
    }

    return {
      status: "ok",
      verdict: parsed.data.verdict,
      reason: parsed.data.reason,
    };
  };
}
