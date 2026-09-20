#!/usr/bin/env node
/**
 * Forbidden-content scan.
 *
 * This repository was extracted from a private codebase. This script is the
 * mechanical half of making sure nothing came along that should not have:
 * internal hostnames, infrastructure references, credentials, or text in the
 * language the private repository is written in.
 *
 * It is not a substitute for a secret scanner — gitleaks runs separately in
 * CI — and it is not clever. It is a list of things that must not appear,
 * checked on every push, so that a slip fails a build instead of reaching a
 * reader.
 *
 *   node scripts/scan-forbidden.mjs [--verbose]
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERBOSE = process.argv.includes("--verbose");

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  "reports",
  ".pnpm-store",
]);

const SKIP_FILES = new Set(["pnpm-lock.yaml", "LICENSE"]);

/** Patterns that must not appear anywhere. */
const FORBIDDEN = [
  // Internal hosts and infrastructure of the private deployment.
  { name: "internal domain (sciente.ru)", re: /sciente\.ru/gi },
  { name: "internal domain (scientiaiter)", re: /scientiaiter/gi },
  { name: "internal domain (medas)", re: /medas\.(pro|tech|space)/gi },
  { name: "hosting provider reference", re: /selectel/gi },
  { name: "GitLab reference", re: /gitlab/gi },
  { name: "k3s / kubernetes manifest reference", re: /\bk3s\b|kubectl|kube-system/gi },
  { name: "nginx config reference", re: /nginx\.conf|proxy_pass/gi },
  { name: "OpenBao / vault reference", re: /openbao/gi },

  // Model contours that are specific to the private deployment.
  { name: "Yandex contour", re: /yandex/gi },
  { name: "state-contour reference", re: /\bgos[-_](kontur|contour)\b/gi },
  { name: "FZ-152 reference", re: /fz[-_ ]?152/gi },

  // Credentials and key material.
  { name: "private key block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: "Anthropic-style key", re: /sk-ant-[A-Za-z0-9_-]{10,}/g },
  { name: "OpenAI-style key", re: /\bsk-[A-Za-z0-9]{32,}/g },
  { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}/g },
  { name: "bearer token literal", re: /Bearer\s+[A-Za-z0-9._-]{24,}/g },

  // Private network addresses.
  { name: "private IPv4", re: /\b(?:10|127)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g },
  { name: "private IPv4 (192.168)", re: /\b192\.168\.\d{1,3}\.\d{1,3}\b/g },
  { name: "private IPv4 (172.16/12)", re: /\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/g },
];

/**
 * Exceptions, by pattern name and matched text. Narrow on purpose: an
 * exception that swallows a whole rule defeats the rule.
 */
const ALLOWED = new Map([
  ["private IPv4", new Set(["127.0.0.1"])],
]);

/** Cyrillic, in any file. The public repository is English-only. */
const CYRILLIC_START = 0x0400;
const CYRILLIC_END = 0x04ff;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      yield* walk(full);
    } else if (stats.isFile() && !SKIP_FILES.has(entry)) {
      yield full;
    }
  }
}

function isProbablyText(buffer) {
  // Anything with a NUL byte in the first kilobyte is treated as binary.
  const limit = Math.min(buffer.length, 1024);
  for (let i = 0; i < limit; i++) {
    if (buffer[i] === 0) return false;
  }
  return true;
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

function findCyrillic(text) {
  const hits = [];
  for (let i = 0; i < text.length; i++) {
    const cp = text.codePointAt(i);
    if (cp >= CYRILLIC_START && cp <= CYRILLIC_END) {
      hits.push(i);
      // One report per line is enough.
      const nextNewline = text.indexOf("\n", i);
      if (nextNewline < 0) break;
      i = nextNewline;
    }
  }
  return hits;
}

const findings = [];
let scanned = 0;

for (const file of walk(ROOT)) {
  const buffer = readFileSync(file);
  if (!isProbablyText(buffer)) continue;
  const text = buffer.toString("utf8");
  const relative = path.relative(ROOT, file).split(path.sep).join("/");
  scanned++;

  // This script necessarily contains the patterns it looks for.
  if (relative === "scripts/scan-forbidden.mjs") continue;

  for (const rule of FORBIDDEN) {
    rule.re.lastIndex = 0;
    for (const match of text.matchAll(rule.re)) {
      const allowed = ALLOWED.get(rule.name);
      if (allowed?.has(match[0])) continue;
      findings.push({
        file: relative,
        line: lineOf(text, match.index ?? 0),
        rule: rule.name,
        text: match[0].slice(0, 80),
      });
    }
  }

  for (const index of findCyrillic(text)) {
    findings.push({
      file: relative,
      line: lineOf(text, index),
      rule: "Cyrillic text",
      text: text.slice(index, index + 40).split("\n")[0],
    });
  }
}

console.log(`scanned ${scanned} text files under ${ROOT}`);

if (findings.length === 0) {
  console.log("no forbidden content found");
} else {
  console.error(`\n${findings.length} finding(s):\n`);
  for (const finding of findings) {
    console.error(`  ${finding.file}:${finding.line}  [${finding.rule}]  ${finding.text}`);
  }
  process.exitCode = 1;
}

if (VERBOSE) {
  console.log("\nrules applied:");
  for (const rule of FORBIDDEN) console.log(`  - ${rule.name}`);
  console.log("  - Cyrillic text");
}
