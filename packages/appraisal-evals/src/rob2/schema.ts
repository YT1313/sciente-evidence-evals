/**
 * Schema for the model's RoB 2 response.
 *
 * Everything the model returns is validated here before any of it is used.
 * There is no coercion path: a malformed response is a failed appraisal, not
 * a silently-defaulted one. The pattern this replaces — read a field, and if
 * it is not the expected shape substitute "NI" or 0.5 — turns a broken model
 * call into a plausible-looking verdict, which is worse than no verdict.
 */

import { z } from "zod";
import { QUESTION_IDS, type DomainKey } from "./questions.js";
import type { Judgement } from "./algorithm.js";
import { extractJson } from "../json/parse.js";

export const responseCodeSchema = z.enum(["Y", "PY", "PN", "N", "NI", "NA"]);

export const judgementSchema = z.union([
  z.literal("Low"),
  z.literal("Some concerns"),
  z.literal("High"),
  z.null(),
]);

export const signallingItemSchema = z
  .object({
    response: responseCodeSchema,
    rationale: z.string().min(1).max(2000),
    /**
     * Verbatim quotes from the article. Required for every answer other than
     * NI and NA — an answer with no quote is an answer with no evidence, and
     * the refinement below rejects it rather than letting it through with a
     * lowered confidence score.
     */
    evidence: z.array(z.string().min(1).max(2000)).max(6),
  })
  .strict()
  .refine(
    (item) =>
      item.response === "NI" || item.response === "NA"
        ? true
        : item.evidence.length > 0,
    {
      message:
        "A substantive answer (Y/PY/PN/N) must carry at least one verbatim quote.",
      path: ["evidence"],
    },
  );

const signallingShape: z.ZodRawShape = Object.fromEntries(
  QUESTION_IDS.map((id) => [id, signallingItemSchema]),
);

export const rob2ModelResponseSchema = z
  .object({
    /** All 22 questions, every time. A partial answer set is a failure. */
    signalling: z.object(signallingShape).strict(),
    /**
     * The model's own domain verdicts. Recorded for disagreement analysis
     * only: the reported verdict always comes from the algorithm.
     */
    proposed_by_model: z
      .object({
        domains: z
          .object({
            d1: judgementSchema,
            d2: judgementSchema,
            d3: judgementSchema,
            d4: judgementSchema,
            d5: judgementSchema,
          })
          .strict(),
        overall: judgementSchema,
      })
      .strict(),
    self_confidence: z.number().min(0).max(1),
    /** Set when the article text contained an attempt to steer the appraisal. */
    injection_suspected: z.boolean().default(false),
    injection_note: z.string().max(500).optional(),
    /**
     * RoB 2 as implemented here covers parallel-group trials. A cluster,
     * crossover or stepped-wedge design needs the specialised variant, and
     * the model is asked to say so rather than to score the wrong instrument.
     */
    design_not_parallel_group: z.boolean().default(false),
    design_note: z.string().max(500).optional(),
  })
  .strict();

export type SignallingItem = z.infer<typeof signallingItemSchema>;

/**
 * The validated response, typed by hand.
 *
 * `signalling` is built from a dynamic shape — one entry per signalling
 * question id — so zod can only infer an index signature for it. Declaring
 * the type here keeps the rest of the pipeline strongly typed; the schema
 * above remains the single source of truth about what is accepted.
 */
export interface Rob2ModelResponse {
  readonly signalling: Readonly<Record<string, SignallingItem>>;
  readonly proposed_by_model: {
    readonly domains: Readonly<Record<DomainKey, Judgement>>;
    readonly overall: Judgement;
  };
  readonly self_confidence: number;
  readonly injection_suspected: boolean;
  readonly injection_note?: string;
  readonly design_not_parallel_group: boolean;
  readonly design_note?: string;
}

export interface SchemaSuccess<T> {
  readonly ok: true;
  readonly value: T;
}

export interface SchemaFailure {
  readonly ok: false;
  readonly error: string;
  readonly issues: readonly string[];
}

export type SchemaOutcome<T> = SchemaSuccess<T> | SchemaFailure;

/** Parse and validate a raw model response. Never throws. */
export function parseRob2ModelResponse(
  raw: string,
): SchemaOutcome<Rob2ModelResponse> {
  let json: unknown;
  try {
    json = extractJson(raw);
  } catch (cause) {
    return {
      ok: false,
      error: "response_not_json",
      issues: [String(cause instanceof Error ? cause.message : cause)],
    };
  }

  const parsed = rob2ModelResponseSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      error: "response_schema_invalid",
      issues: parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
      ),
    };
  }
  return { ok: true, value: parsed.data as unknown as Rob2ModelResponse };
}
