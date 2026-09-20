#!/usr/bin/env node
/**
 * Deterministic evaluation runner.
 *
 *   node dist/eval/run-deterministic.js [--fixtures <dir>] [--json <file>]
 *                                       [--min-ac1 0.6] [--min-coverage 0.8]
 *                                       [--min-verification 0.9]
 *
 * Exits non-zero when a threshold is not met. No API key is used or required.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDatasets } from "./dataset.js";
import {
  DEFAULT_THRESHOLDS,
  checkThresholds,
  formatReport,
  runDeterministicEval,
  type Thresholds,
} from "./deterministic.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURES = path.resolve(here, "../../fixtures");

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

function num(name: string, fallback: number): number {
  const raw = arg(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`--${name} expects a number, got ${JSON.stringify(raw)}`);
  }
  return value;
}

async function main(): Promise<void> {
  const fixturesDir = arg("fixtures") ?? DEFAULT_FIXTURES;
  const thresholds: Thresholds = {
    minGwetAC1: num("min-ac1", DEFAULT_THRESHOLDS.minGwetAC1),
    minCoverage: num("min-coverage", DEFAULT_THRESHOLDS.minCoverage),
    minVerificationRate: num(
      "min-verification",
      DEFAULT_THRESHOLDS.minVerificationRate,
    ),
    requireInjectionFlagged: !process.argv.includes("--allow-missed-injection"),
    requireUnsupportedCaught: !process.argv.includes("--allow-missed-unsupported"),
    maxLexiconFalseDemotionRate: num(
      "max-false-demotion",
      DEFAULT_THRESHOLDS.maxLexiconFalseDemotionRate,
    ),
    allowFailedItems: num("allow-failed", DEFAULT_THRESHOLDS.allowFailedItems),
  };

  const datasets = await loadDatasets(fixturesDir);
  let allPassed = true;
  const serialisable: unknown[] = [];

  for (const dataset of datasets) {
    const report = await runDeterministicEval(dataset);
    const verdict = checkThresholds(report, thresholds);
    allPassed = allPassed && verdict.passed;

    console.log(`\n${formatReport(report)}`);
    if (verdict.passed) {
      console.log("thresholds           PASS");
    } else {
      console.log("thresholds           FAIL");
      for (const failure of verdict.failures) console.log(`  - ${failure}`);
    }

    serialisable.push({
      dataset: report.dataset,
      items: report.items,
      agreement: report.agreement,
      integrity: report.integrity,
      passed: verdict.passed,
      failures: verdict.failures,
      perItem: report.outcomes.map((o) => ({
        id: o.id,
        status: o.status,
        overall: o.appraisal.overall,
        domains: o.appraisal.domains,
        verification: o.appraisal.verification,
        finalConfidence: o.appraisal.finalConfidence,
        injectionSuspected: o.appraisal.injectionSuspected,
      })),
    });
  }

  const jsonOut = arg("json");
  if (jsonOut) {
    await mkdir(path.dirname(path.resolve(jsonOut)), { recursive: true });
    await writeFile(
      path.resolve(jsonOut),
      JSON.stringify(
        { generatedAt: new Date().toISOString(), thresholds, reports: serialisable },
        null,
        2,
      ),
      "utf8",
    );
    console.log(`\nwrote ${jsonOut}`);
  }

  if (!allPassed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
