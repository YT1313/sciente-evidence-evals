/**
 * Guards on the committed fixture set.
 *
 * The eval is only as trustworthy as its data, so these checks are part of
 * the test suite rather than a note in a README: every item must declare its
 * provenance and licence, and the set must keep exercising the failure modes
 * it was built to exercise.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkThresholds,
  loadDatasets,
  runDeterministicEval,
} from "../src/index.js";

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../fixtures",
);

const datasets = await loadDatasets(FIXTURES);

describe("fixture set", () => {
  it("loads and validates", () => {
    expect(datasets.length).toBeGreaterThan(0);
    for (const dataset of datasets) {
      expect(dataset.items.length).toBeGreaterThan(0);
    }
  });

  it("declares provenance and a licence for every item", () => {
    for (const dataset of datasets) {
      for (const item of dataset.items) {
        expect(item.provenance.source.length).toBeGreaterThan(0);
        expect(item.provenance.license.length).toBeGreaterThan(0);
      }
    }
  });

  it("carries only synthetic or openly licensed text", () => {
    const allowed = new Set(["synthetic", "CC-BY-4.0", "CC-BY-SA-4.0", "CC0-1.0"]);
    for (const dataset of datasets) {
      for (const item of dataset.items) {
        expect(allowed.has(item.provenance.license)).toBe(true);
      }
    }
  });

  it("still exercises abstention, fabrication and injection", () => {
    const tags = new Set(
      datasets.flatMap((d) => d.items.flatMap((i) => i.tags)),
    );
    expect(tags.has("abstention")).toBe(true);
    expect(tags.has("fabricated-quote")).toBe(true);
    expect(tags.has("injection")).toBe(true);
    expect(tags.has("unsupported-quote")).toBe(true);
    expect(tags.has("contradicting-quote")).toBe(true);
    expect(tags.has("residual-disagreement")).toBe(true);
    expect(tags.has("numeric-check")).toBe(true);
  });
});

describe("deterministic evaluation", () => {
  it("runs the whole pipeline with no API key and meets its thresholds", async () => {
    for (const dataset of datasets) {
      const report = await runDeterministicEval(dataset, {
        bootstrapIterations: 500,
      });
      const verdict = checkThresholds(report);
      expect(verdict.failures).toEqual([]);
      expect(verdict.passed).toBe(true);
      expect(report.failedItems).toEqual([]);
    }
  });

  it("catches the fabricated quote and demotes the answer", async () => {
    const report = await runDeterministicEval(datasets[0]!, {
      bootstrapIterations: 100,
    });
    const item = report.outcomes.find((o) =>
      o.tags.includes("fabricated-quote"),
    );
    expect(item).toBeDefined();
    expect(report.integrity.answersDemoted).toBeGreaterThan(0);
    expect(item!.appraisal.verification.failed).toBeGreaterThan(0);
  });

  it("catches every planted unsupported quote and demotes the answer", async () => {
    const report = await runDeterministicEval(datasets[0]!, {
      bootstrapIterations: 100,
    });
    expect(report.integrity.unsupportedItems).toBeGreaterThan(0);
    expect(report.integrity.unsupportedCaught).toBe(
      report.integrity.unsupportedItems,
    );
    expect(report.integrity.contradicted).toBeGreaterThan(0);
    expect(report.integrity.uninformative).toBeGreaterThan(0);
  });

  it("measures what the support check costs on reference answers", async () => {
    // The price of the check, measured instead of asserted: running the
    // lexicon over answers a reviewer evidenced correctly must cost nothing.
    // Every false demotion here would be coverage lost for free.
    const report = await runDeterministicEval(datasets[0]!, {
      bootstrapIterations: 100,
    });
    expect(report.integrity.lexiconReferenceChecked).toBeGreaterThan(50);
    expect(report.integrity.lexiconFalseDemotions).toBe(0);
    expect(report.integrity.lexiconNotCovered).toBe(0);
  });

  it("keeps a residual disagreement no mechanical check can settle", async () => {
    // Guards against the fixture set drifting into a degenerate perfect
    // score, which would hide a regression rather than reveal one.
    const report = await runDeterministicEval(datasets[0]!, {
      bootstrapIterations: 100,
    });
    expect(report.agreement.percentAgreement).toBeLessThan(1);
    const residual = report.outcomes.find((o) =>
      o.tags.includes("residual-disagreement"),
    )!;
    // Its quote is real and its vocabulary matches the answer, so nothing
    // deterministic has grounds to intervene.
    expect(residual.appraisal.verification.failed).toBe(0);
    expect(residual.appraisal.verification.contradicted).toBe(0);
    expect(residual.appraisal.verification.uninformative).toBe(0);
  });

  it("abstains rather than guessing on the abstract-only item", async () => {
    const report = await runDeterministicEval(datasets[0]!, {
      bootstrapIterations: 100,
    });
    const item = report.outcomes.find((o) => o.tags.includes("abstention"))!;
    expect(item.appraisal.overall).toBeNull();
    expect(item.appraisal.requireFullText).toBe(true);
  });

  it("is reproducible, interval included", async () => {
    const a = await runDeterministicEval(datasets[0]!, {
      bootstrapIterations: 300,
    });
    const b = await runDeterministicEval(datasets[0]!, {
      bootstrapIterations: 300,
    });
    expect(a.agreement).toEqual(b.agreement);
    expect(a.integrity).toEqual(b.integrity);
  });
});
