/**
 * The evaluation dataset format.
 *
 * An item carries the article text, the focal result, the reference (gold)
 * verdicts, and — optionally — a recorded model response. The recording is
 * what lets the whole pipeline run in CI without an API key: prompt assembly,
 * schema validation, quote verification and the algorithm all execute, and
 * only the network call is replaced.
 *
 * `provenance` is required and is not decoration. Every item must state where
 * its text came from and under what licence, because an evaluation set that
 * cannot say that is one nobody else can reuse.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const judgementValueSchema = z.union([
  z.literal("Low"),
  z.literal("Some concerns"),
  z.literal("High"),
  z.null(),
]);

export const provenanceSchema = z
  .object({
    /** "synthetic" or the name of the source work. */
    source: z.string().min(1),
    /** SPDX identifier, or "synthetic" for text written for this repository. */
    license: z.string().min(1),
    url: z.string().url().optional(),
    note: z.string().optional(),
  })
  .strict();

export const focalResultSchema = z
  .object({
    outcomeDomain: z.string().min(1),
    specificMeasure: z.string().min(1),
    timepoint: z.string().min(1),
    effectOfInterest: z.string().min(1),
    analysisPopulation: z.string().min(1),
  })
  .strict();

export const evalItemSchema = z
  .object({
    id: z.string().min(1),
    provenance: provenanceSchema,
    title: z.string().min(1),
    year: z.string().optional(),
    text: z.string().min(1),
    focalResult: focalResultSchema,
    assessmentMode: z.enum(["fulltext", "abstract_only"]).optional(),
    retracted: z.boolean().optional(),
    gold: z
      .object({
        domains: z
          .object({
            d1: judgementValueSchema,
            d2: judgementValueSchema,
            d3: judgementValueSchema,
            d4: judgementValueSchema,
            d5: judgementValueSchema,
          })
          .strict(),
        overall: judgementValueSchema,
        /** Who or what produced the reference verdicts. */
        rater: z.string().min(1),
      })
      .strict(),
    /**
     * A recorded model response, as raw text exactly as a provider returned
     * it. Items without one are skipped by the deterministic runner.
     */
    replay: z.string().optional(),
    /**
     * The reviewer's own answers and the quotes they rested on.
     *
     * These are the *reference* answers, not the model's. They exist so the
     * evaluation can measure what the support check costs: running the
     * lexicon over answers a reviewer considered correctly evidenced gives a
     * false-demotion rate, which turns "the check costs coverage" from a
     * caveat into a number that moves when the lexicon changes.
     */
    referenceAnswers: z
      .record(
        z
          .object({
            response: z.enum(["Y", "PY", "PN", "N", "NI", "NA"]),
            evidence: z.array(z.string()),
          })
          .strict(),
      )
      .optional(),
    /**
     * What this item is here to exercise: a plain case, an abstention case,
     * a fabricated-quote case, an injected-instruction case.
     */
    tags: z.array(z.string()).default([]),
  })
  .strict();

export type EvalItem = z.infer<typeof evalItemSchema>;

export const evalDatasetSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    items: z.array(evalItemSchema).min(1),
  })
  .strict();

export type EvalDataset = z.infer<typeof evalDatasetSchema>;

export class DatasetError extends Error {
  constructor(
    message: string,
    readonly file: string,
  ) {
    super(message);
    this.name = "DatasetError";
  }
}

/** Load and validate every `*.json` file in a directory as a dataset. */
export async function loadDatasets(dir: string): Promise<EvalDataset[]> {
  const entries = await readdir(dir);
  const files = entries.filter((f) => f.endsWith(".json")).sort();
  const datasets: EvalDataset[] = [];

  for (const file of files) {
    const full = path.join(dir, file);
    const text = await readFile(full, "utf8");
    let json: unknown;
    try {
      json = JSON.parse(text) as unknown;
    } catch (cause) {
      throw new DatasetError(`Not valid JSON: ${String(cause)}`, full);
    }
    const parsed = evalDatasetSchema.safeParse(json);
    if (!parsed.success) {
      throw new DatasetError(
        parsed.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; "),
        full,
      );
    }
    datasets.push(parsed.data);
  }

  if (datasets.length === 0) {
    throw new DatasetError("No dataset files found.", dir);
  }
  return datasets;
}
