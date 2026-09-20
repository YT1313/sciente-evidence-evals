#!/usr/bin/env node
/**
 * Download a reference evaluation dataset from its original source.
 *
 *   node scripts/fetch-reference-datasets.mjs --list
 *   node scripts/fetch-reference-datasets.mjs roboto2
 *
 * Nothing is vendored into this repository. Each set stays under its own
 * licence, and the download lands in `data/`, which is git-ignored. Read the
 * licence before you redistribute anything derived from one of these.
 */

import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(here, "../data");

/**
 * Registry of reference sets.
 *
 * `url` is left null where the maintainers distribute the data through a
 * request form, a data-use agreement or a repository whose download link is
 * not stable. Guessing a URL in those cases produces a script that silently
 * fetches the wrong file, which is worse than printing an instruction.
 */
const DATASETS = {
  roboto2: {
    title: "ROBoto2",
    what: "Risk-of-bias assessments of randomised trials, used to evaluate automated RoB 2 tools.",
    home: null,
    license: "Set by its authors. Read it before redistributing anything derived from it.",
    url: null,
    instructions: [
      "This script does not hard-code a location for ROBoto2: the authors",
      "distribute it themselves, and a guessed URL would silently fetch the",
      "wrong file. Find the current location in the data-availability statement",
      "of the paper that introduces it, place the files under",
      "packages/appraisal-evals/data/roboto2/, and record the exact source, the",
      "licence and the retrieval date in data/PROVENANCE.md.",
    ],
  },
  "cochrane-rob2-guidance": {
    title: "RoB 2 guidance and templates",
    what: "The official RoB 2 tool, guidance document and Excel templates.",
    home: "https://www.riskofbias.info/welcome/rob-2-0-tool/current-version-of-rob-2",
    license: "Cochrane / RoB 2 development group. Check the site's terms.",
    url: null,
    instructions: [
      "Download the current guidance and templates from the page above.",
      "They are documentation, not evaluation data: this repository implements",
      "the published algorithm and does not redistribute the forms.",
    ],
  },
};

function list() {
  console.log("Reference datasets known to this script:\n");
  for (const [key, entry] of Object.entries(DATASETS)) {
    console.log(`  ${key}`);
    console.log(`    ${entry.title} — ${entry.what}`);
    if (entry.home) console.log(`    home:    ${entry.home}`);
    console.log(`    licence: ${entry.license}`);
    console.log("");
  }
  console.log(
    "None of these are vendored here. Downloads land in data/, which is git-ignored.",
  );
}

async function fetchDataset(key) {
  const entry = DATASETS[key];
  if (!entry) {
    console.error(`Unknown dataset ${JSON.stringify(key)}.`);
    list();
    process.exitCode = 1;
    return;
  }

  console.log(`${entry.title}`);
  console.log(`licence: ${entry.license}`);
  if (entry.home) console.log(`home:    ${entry.home}`);
  console.log("");

  if (!entry.url) {
    for (const line of entry.instructions) console.log(line);
    return;
  }

  const target = path.join(DATA_DIR, key, path.basename(new URL(entry.url).pathname));
  await mkdir(path.dirname(target), { recursive: true });

  const response = await fetch(entry.url);
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status} fetching ${entry.url}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(target));
  console.log(`wrote ${target}`);
  console.log(
    "Record the retrieval date and the licence in data/PROVENANCE.md before using it.",
  );
}

const arg = process.argv[2];
if (!arg || arg === "--list" || arg === "-l") {
  list();
} else {
  await fetchDataset(arg);
}
