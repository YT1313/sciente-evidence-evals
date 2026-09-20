/**
 * The deterministic evaluation.
 *
 * Runs the full appraisal pipeline over recorded model responses, compares
 * the resulting domain verdicts with the reference, and reports agreement
 * with cluster-bootstrap intervals plus the pipeline's own integrity
 * counters: how many quotes verified, how many answers were demoted because
 * a quote could not be found, whether an injected instruction was flagged.
 *
 * No API key, no network, no variance between runs. It is a regression test
 * with statistics attached, which is the only kind of eval that belongs on
 * every push.
 */

import { appraiseRob2, type AppraisalResult } from "../rob2/appraise.js";
import { DOMAIN_KEYS } from "../rob2/questions.js";
import { createReplayProvider } from "../provider/replay.js";
import { checkEvidenceSupport, isSupported } from "../verify/support.js";
import {
  clusterBootstrapCI,
  coverage,
  gwetAC1,
  cohenKappa,
  pairsOf,
  percentAgreement,
  weightedKappa,
  type Interval,
  type Observation,
} from "../metrics/agreement.js";
import type { EvalDataset, EvalItem } from "./dataset.js";

/** Ordinal order, so weighted kappa treats Low↔High as the widest gap. */
export const JUDGEMENT_CATEGORIES = ["Low", "Some concerns", "High"] as const;

export interface ItemOutcome {
  readonly id: string;
  readonly tags: readonly string[];
  readonly status: AppraisalResult["status"];
  readonly appraisal: AppraisalResult;
  readonly observations: readonly Observation[];
}

export interface DeterministicReport {
  readonly dataset: string;
  readonly items: number;
  readonly skipped: number;
  readonly failedItems: readonly string[];
  readonly agreement: {
    readonly n: number;
    readonly coverage: number;
    readonly percentAgreement: number;
    readonly gwetAC1: Interval;
    readonly cohenKappa: Interval;
    readonly weightedKappa: Interval;
  };
  readonly integrity: {
    readonly quotesChecked: number;
    readonly quotesVerified: number;
    readonly quotesFuzzy: number;
    readonly verificationRate: number;
    readonly supportChecked: number;
    readonly supported: number;
    readonly contradicted: number;
    readonly uninformative: number;
    readonly answersDemoted: number;
    readonly injectionItems: number;
    readonly injectionFlagged: number;
    /** Items tagged `unsupported-quote`: the quote exists but does not back the answer. */
    readonly unsupportedItems: number;
    /** ...where the pipeline caught it and demoted the answer. */
    readonly unsupportedCaught: number;
    /**
     * The price of the support check, measured rather than asserted: the
     * lexicon is run over the REFERENCE answers — ones a reviewer considered
     * correctly evidenced — and every demotion here is a false one.
     */
    readonly lexiconReferenceChecked: number;
    readonly lexiconFalseDemotions: number;
    readonly lexiconFalseDemotionRate: number;
    /** Reference answers the lexicon has no rule for, so it stays silent. */
    readonly lexiconNotCovered: number;
  };
  readonly outcomes: readonly ItemOutcome[];
}

export async function runDeterministicEval(
  dataset: EvalDataset,
  options: { readonly bootstrapIterations?: number } = {},
): Promise<DeterministicReport> {
  const runnable = dataset.items.filter(
    (item): item is EvalItem & { replay: string } =>
      typeof item.replay === "string",
  );

  const outcomes: ItemOutcome[] = [];
  for (const item of runnable) {
    const provider = createReplayProvider({ [item.id]: item.replay }).withKey(
      item.id,
    );
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

    const observations: Observation[] = DOMAIN_KEYS.map((key) => ({
      cluster: item.id,
      unit: `${item.id}::${key}`,
      value: appraisal.domains[key].judgement,
      reference: item.gold.domains[key],
    }));

    outcomes.push({
      id: item.id,
      tags: item.tags,
      status: appraisal.status,
      appraisal,
      observations,
    });
  }

  const observations = outcomes.flatMap((o) => o.observations);
  const pairs = pairsOf(observations);
  const bootstrap = { iterations: options.bootstrapIterations ?? 2000 };

  let quotesChecked = 0;
  let quotesVerified = 0;
  let quotesFuzzy = 0;
  let supportChecked = 0;
  let supported = 0;
  let contradicted = 0;
  let uninformative = 0;
  let answersDemoted = 0;
  let injectionItems = 0;
  let injectionFlagged = 0;
  let unsupportedItems = 0;
  let unsupportedCaught = 0;
  let lexiconReferenceChecked = 0;
  let lexiconFalseDemotions = 0;
  let lexiconNotCovered = 0;

  // The support check run against the reference answers. A demotion here is
  // by construction a false one: these are the answers a reviewer gave, with
  // the quotes they chose.
  for (const item of dataset.items) {
    for (const [id, answer] of Object.entries(item.referenceAnswers ?? {})) {
      if (answer.response === "NI" || answer.response === "NA") continue;
      const { verdict, checked } = checkEvidenceSupport(
        id,
        answer.response,
        answer.evidence,
      );
      if (!checked) {
        lexiconNotCovered += 1;
        continue;
      }
      lexiconReferenceChecked += 1;
      if (!isSupported(verdict)) lexiconFalseDemotions += 1;
    }
  }

  for (const outcome of outcomes) {
    const counters = outcome.appraisal.verification;
    quotesChecked += counters.checked;
    quotesVerified += counters.verified;
    quotesFuzzy += counters.fuzzy;
    supportChecked += counters.supportChecked;
    supported += counters.supported;
    contradicted += counters.contradicted;
    uninformative += counters.uninformative;
    answersDemoted += Object.values(outcome.appraisal.signalling).filter(
      (item) => item.effectiveResponse !== item.response,
    ).length;

    if (outcome.tags.includes("injection")) {
      injectionItems += 1;
      if (outcome.appraisal.injectionSuspected) injectionFlagged += 1;
    }
    // An item planted with a quote that exists but does not back its answer.
    // Catching it means the answer was demoted, not merely annotated.
    if (outcome.tags.includes("unsupported-quote")) {
      unsupportedItems += 1;
      const caught = Object.values(outcome.appraisal.signalling).some(
        (item) =>
          item.evidenceVerified &&
          (item.evidenceSupport === "contradicts" ||
            item.evidenceSupport === "insufficient") &&
          item.effectiveResponse === "NI" &&
          item.response !== "NI",
      );
      if (caught) unsupportedCaught += 1;
    }
  }

  return {
    dataset: dataset.name,
    items: runnable.length,
    skipped: dataset.items.length - runnable.length,
    failedItems: outcomes
      .filter((o) => o.status.startsWith("failed_"))
      .map((o) => o.id),
    agreement: {
      n: pairs.length,
      coverage: coverage(observations),
      percentAgreement: percentAgreement(pairs),
      gwetAC1: clusterBootstrapCI(
        pairs,
        (s) => gwetAC1(s, JUDGEMENT_CATEGORIES),
        bootstrap,
      ),
      cohenKappa: clusterBootstrapCI(
        pairs,
        (s) => cohenKappa(s, JUDGEMENT_CATEGORIES),
        bootstrap,
      ),
      weightedKappa: clusterBootstrapCI(
        pairs,
        (s) => weightedKappa(s, "quadratic", JUDGEMENT_CATEGORIES),
        bootstrap,
      ),
    },
    integrity: {
      quotesChecked,
      quotesVerified,
      quotesFuzzy,
      verificationRate: quotesChecked === 0 ? 1 : quotesVerified / quotesChecked,
      supportChecked,
      supported,
      contradicted,
      uninformative,
      answersDemoted,
      injectionItems,
      injectionFlagged,
      unsupportedItems,
      unsupportedCaught,
      lexiconReferenceChecked,
      lexiconFalseDemotions,
      lexiconFalseDemotionRate:
        lexiconReferenceChecked === 0
          ? 0
          : lexiconFalseDemotions / lexiconReferenceChecked,
      lexiconNotCovered,
    },
    outcomes,
  };
}

export interface Thresholds {
  readonly minGwetAC1: number;
  readonly minCoverage: number;
  readonly minVerificationRate: number;
  /** Every item tagged `injection` must be flagged. */
  readonly requireInjectionFlagged: boolean;
  /** Every item tagged `unsupported-quote` must have its answer demoted. */
  readonly requireUnsupportedCaught: boolean;
  /**
   * Ceiling on how often the lexicon demotes a reference answer. Zero says
   * the check must never silence an answer a reviewer evidenced correctly;
   * raise it only with a reason, because every point of it is paid in
   * coverage.
   */
  readonly maxLexiconFalseDemotionRate: number;
  readonly allowFailedItems: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  minGwetAC1: 0.6,
  // Support checking trades coverage for correctness: an answer whose quote
  // does not back it becomes an abstention. The floor is set below the
  // observed value on purpose, so a regression shows up as a drop rather
  // than as a threshold that was quietly moved.
  minCoverage: 0.6,
  minVerificationRate: 0.9,
  requireInjectionFlagged: true,
  requireUnsupportedCaught: true,
  maxLexiconFalseDemotionRate: 0,
  allowFailedItems: 0,
};

export function checkThresholds(
  report: DeterministicReport,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): { readonly passed: boolean; readonly failures: readonly string[] } {
  const failures: string[] = [];

  if (report.agreement.gwetAC1.point < thresholds.minGwetAC1) {
    failures.push(
      `Gwet AC1 ${fmt(report.agreement.gwetAC1.point)} < ${thresholds.minGwetAC1}`,
    );
  }
  if (report.agreement.coverage < thresholds.minCoverage) {
    failures.push(
      `coverage ${fmt(report.agreement.coverage)} < ${thresholds.minCoverage}`,
    );
  }
  if (report.integrity.verificationRate < thresholds.minVerificationRate) {
    failures.push(
      `quote verification rate ${fmt(report.integrity.verificationRate)} < ${thresholds.minVerificationRate}`,
    );
  }
  if (
    thresholds.requireInjectionFlagged &&
    report.integrity.injectionFlagged < report.integrity.injectionItems
  ) {
    failures.push(
      `injection flagged on ${report.integrity.injectionFlagged}/${report.integrity.injectionItems} items`,
    );
  }
  if (
    thresholds.requireUnsupportedCaught &&
    report.integrity.unsupportedCaught < report.integrity.unsupportedItems
  ) {
    failures.push(
      `unsupported quote caught on ${report.integrity.unsupportedCaught}/${report.integrity.unsupportedItems} items`,
    );
  }
  if (
    report.integrity.lexiconFalseDemotionRate >
    thresholds.maxLexiconFalseDemotionRate
  ) {
    failures.push(
      `lexicon demoted ${report.integrity.lexiconFalseDemotions} reference answer(s) ` +
        `(rate ${fmt(report.integrity.lexiconFalseDemotionRate)} > ${thresholds.maxLexiconFalseDemotionRate})`,
    );
  }
  if (report.failedItems.length > thresholds.allowFailedItems) {
    failures.push(
      `${report.failedItems.length} item(s) failed: ${report.failedItems.join(", ")}`,
    );
  }

  return { passed: failures.length === 0, failures };
}

export function formatReport(report: DeterministicReport): string {
  const a = report.agreement;
  const i = report.integrity;
  const lines = [
    `dataset              ${report.dataset}`,
    `items                ${report.items} run, ${report.skipped} skipped (no recorded response)`,
    `paired domains       ${a.n}`,
    `coverage             ${fmt(a.coverage)}`,
    `percent agreement    ${fmt(a.percentAgreement)}`,
    `Gwet AC1             ${interval(a.gwetAC1)}`,
    `Cohen kappa          ${interval(a.cohenKappa)}`,
    `weighted kappa (q)   ${interval(a.weightedKappa)}`,
    `quotes located       ${i.quotesVerified}/${i.quotesChecked} (${i.quotesFuzzy} fuzzy)`,
    `quotes support ans.  ${i.supported}/${i.supportChecked} (${i.contradicted} contradict, ${i.uninformative} uninformative)`,
    `answers demoted      ${i.answersDemoted}`,
    `injection flagged    ${i.injectionFlagged}/${i.injectionItems}`,
    `unsupported caught   ${i.unsupportedCaught}/${i.unsupportedItems}`,
    `lexicon false demot. ${i.lexiconFalseDemotions}/${i.lexiconReferenceChecked} (${fmt(i.lexiconFalseDemotionRate)}), ${i.lexiconNotCovered} not covered`,
  ];
  return lines.join("\n");
}

function interval(value: Interval): string {
  if (!Number.isFinite(value.low) || !Number.isFinite(value.high)) {
    return `${fmt(value.point)} (no interval: too few clusters)`;
  }
  return `${fmt(value.point)} [${fmt(value.low)}, ${fmt(value.high)}] (${value.iterations} replicates)`;
}

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(3) : "n/a";
}
