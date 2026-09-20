#!/usr/bin/env node
/**
 * Judged evaluation runner. Calls a model, so it is manual-dispatch only.
 *
 *   APPRAISAL_MODEL=... ANTHROPIC_API_KEY=... \
 *     node dist/eval/run-judge.js [--fixtures <dir>] [--live] [--json <file>]
 *
 * By default the appraisal itself is replayed from the recorded responses and
 * only the judge calls a model, which keeps the variable under study to one.
 * `--live` re-runs the appraisal against the model as well.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadDatasets } from "./dataset.js";
import { appraiseRob2 } from "../rob2/appraise.js";
import { createProviderFromEnv } from "../provider/index.js";
import { createReplayProvider } from "../provider/replay.js";
import { runJudge, summariseJudgeOutcomes, type JudgeOutcome } from "./judge.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURES = path.resolve(here, "../../fixtures");

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

async function main(): Promise<void> {
  const fixturesDir = arg("fixtures") ?? DEFAULT_FIXTURES;
  const live = process.argv.includes("--live");
  const modelProvider = createProviderFromEnv();

  const datasets = await loadDatasets(fixturesDir);
  const rows: Array<{
    dataset: string;
    id: string;
    status: string;
    judge: JudgeOutcome;
  }> = [];

  for (const dataset of datasets) {
    for (const item of dataset.items) {
      if (!live && item.replay === undefined) continue;

      const provider = live
        ? modelProvider
        : createReplayProvider({ [item.id]: item.replay! }).withKey(item.id);

      const appraisal = await appraiseRob2(
        {
          id: item.id,
          title: item.title,
          year: item.year ?? "",
          text: item.text,
          focalResult: item.focalResult,
          assessmentMode: item.assessmentMode,
          retracted: item.retracted,
        },
        { provider },
      );

      const judge = await runJudge(modelProvider, {
        articleText: item.text,
        appraisalJson: JSON.stringify(
          {
            status: appraisal.status,
            overall: appraisal.overall,
            domains: appraisal.domains,
            signalling: appraisal.signalling,
          },
          null,
          2,
        ),
      });

      rows.push({
        dataset: dataset.name,
        id: item.id,
        status: appraisal.status,
        judge,
      });

      const label = judge.status === "ok" ? judge.mean.toFixed(2) : "FAILED";
      console.log(`${dataset.name}/${item.id}  appraisal=${appraisal.status}  judge=${label}`);
    }
  }

  const summary = summariseJudgeOutcomes(rows.map((r) => r.judge));
  console.log("\njudge summary");
  console.log(`  scored   ${summary.scored}`);
  console.log(`  failed   ${summary.failed}`);
  console.log(
    `  mean     ${summary.mean === null ? "n/a (no usable judgements)" : summary.mean.toFixed(3)} of 5`,
  );
  for (const [key, value] of Object.entries(summary.perCriterion)) {
    console.log(`  ${key.padEnd(22)} ${value.toFixed(3)}`);
  }

  const jsonOut = arg("json");
  if (jsonOut) {
    await mkdir(path.dirname(path.resolve(jsonOut)), { recursive: true });
    await writeFile(
      path.resolve(jsonOut),
      JSON.stringify(
        { generatedAt: new Date().toISOString(), summary, rows },
        null,
        2,
      ),
      "utf8",
    );
    console.log(`\nwrote ${jsonOut}`);
  }

  // A run where the judge broke everywhere is a failed run, not a zero score.
  if (summary.scored === 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
