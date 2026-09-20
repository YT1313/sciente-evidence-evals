/**
 * RoB 2 judgement algorithm — pure functions. No I/O, no model, no clock.
 *
 * Implements the Cochrane RoB 2 decision tables (Sterne et al.,
 * BMJ 2019;366:l4898; RoB 2 guidance of 22 August 2019, Boxes 4-8) for the
 * effect of assignment to intervention.
 *
 * Two deliberate departures from a human reviewer's use of the tool:
 *
 *  1. "No information" is not silently upgraded. A human reviewer is allowed
 *     to answer PY/PN from judgement where the paper is silent; an automated
 *     reviewer that did the same would be inventing evidence. Here a needed
 *     NI leaves the domain `null` and records which questions were missing.
 *  2. `softFail` offers a bounded relaxation of (1): when most of a domain's
 *     questions *were* answered and none of them triggered a High path, a
 *     null domain may be reported as "Some concerns" rather than as no
 *     judgement at all. It never converts a High or a Low. It is opt-in, and
 *     every domain it touches is flagged with `softFailApplied`.
 */

import { DOMAIN_KEYS, DOMAIN_QUESTIONS, type DomainKey } from "./questions.js";

export type Response = "Y" | "PY" | "PN" | "N" | "NI" | "NA";
export type Judgement = "Low" | "Some concerns" | "High" | null;

export type SignallingAnswers = Readonly<Record<string, Response>>;

export interface DomainResult {
  readonly judgement: Judgement;
  /** Signalling questions that were NI or absent and blocked a judgement. */
  readonly missingForJudgement: readonly string[];
  /** Present and true only when softFail turned a null into "Some concerns". */
  readonly softFailApplied?: boolean;
}

export interface AlgorithmResult {
  readonly domains: Readonly<Record<DomainKey, DomainResult>>;
  readonly overall: Judgement;
  /** True when at least one domain could not be judged from what was answered. */
  readonly requireFullText: boolean;
}

export interface AlgorithmOptions {
  /** Allow a null domain to be reported as "Some concerns". Default false. */
  readonly softFail?: boolean;
  /**
   * Minimum share of a domain's questions that must carry a real answer
   * (anything other than NI or absent) before softFail applies. Default 0.6.
   */
  readonly softFailThreshold?: number;
}

const POSITIVE: ReadonlySet<Response> = new Set<Response>(["Y", "PY"]);
const NEGATIVE: ReadonlySet<Response> = new Set<Response>(["N", "PN"]);

const isPositive = (r: Response | undefined): boolean =>
  r !== undefined && POSITIVE.has(r);
const isNegative = (r: Response | undefined): boolean =>
  r !== undefined && NEGATIVE.has(r);
/** NA means "branch not reached", which is information, not a gap. */
const isMissing = (r: Response | undefined): boolean =>
  r === undefined || r === "NI";

const decided = (judgement: Exclude<Judgement, null>): DomainResult => ({
  judgement,
  missingForJudgement: [],
});

const blocked = (missing: string[]): DomainResult => ({
  judgement: null,
  missingForJudgement: missing,
});

// ---------------------------------------------------------------------------
// Domain 1 — randomisation process
// ---------------------------------------------------------------------------

export function judgeDomain1(a: SignallingAnswers): DomainResult {
  const q11 = a["1.1"];
  const q12 = a["1.2"];
  const q13 = a["1.3"];

  // Baseline imbalance suggesting a broken randomisation, or no random
  // sequence at all, is High regardless of what else is known.
  if (isPositive(q13)) return decided("High");
  if (isNegative(q11)) return decided("High");

  const missing: string[] = [];
  if (isMissing(q11)) missing.push("1.1");
  if (isMissing(q12)) missing.push("1.2");
  if (isMissing(q13)) missing.push("1.3");
  if (missing.length > 0) return blocked(missing);

  if (isPositive(q11) && isPositive(q12) && isNegative(q13)) {
    return decided("Low");
  }
  // Random sequence, but concealment failed or is doubtful.
  return decided("Some concerns");
}

// ---------------------------------------------------------------------------
// Domain 2 — deviations from intended interventions
// ---------------------------------------------------------------------------

export function judgeDomain2(a: SignallingAnswers): DomainResult {
  const q21 = a["2.1"];
  const q22 = a["2.2"];
  const q23 = a["2.3"];
  const q24 = a["2.4"];
  const q25 = a["2.5"];
  const q26 = a["2.6"];
  const q27 = a["2.7"];

  // Inappropriate analysis with substantial potential impact.
  if (isNegative(q26) && isPositive(q27)) return decided("High");
  // Deviations that affected the outcome and were not balanced between arms.
  if (isPositive(q24) && isNegative(q25)) return decided("High");

  // Blinded participants and carers, appropriate analysis.
  if (isNegative(q21) && isNegative(q22) && isPositive(q26)) {
    return decided("Low");
  }

  const missing: string[] = [];
  if (isMissing(q26)) missing.push("2.6");
  if (isMissing(q21)) missing.push("2.1");
  if (isMissing(q22)) missing.push("2.2");
  if (isNegative(q26) && isMissing(q27)) missing.push("2.7");

  // Branch questions only matter once awareness is established or unknown.
  const branchTriggered =
    isPositive(q21) || isPositive(q22) || q21 === "NI" || q22 === "NI";
  if (branchTriggered) {
    if (isMissing(q23) && q23 !== "NA") missing.push("2.3");
    if (isPositive(q23)) {
      if (isMissing(q24) && q24 !== "NA") missing.push("2.4");
      if (isPositive(q24) && isMissing(q25) && q25 !== "NA") missing.push("2.5");
    }
  }

  if (missing.length > 0) return blocked(dedupe(missing));
  return decided("Some concerns");
}

// ---------------------------------------------------------------------------
// Domain 3 — missing outcome data
// ---------------------------------------------------------------------------

export function judgeDomain3(a: SignallingAnswers): DomainResult {
  const q31 = a["3.1"];
  const q32 = a["3.2"];
  const q33 = a["3.3"];
  const q34 = a["3.4"];

  // Missingness likely to depend on the true value of the outcome.
  if (isPositive(q33) && isPositive(q34)) return decided("High");

  // Data essentially complete, or evidence that the result is unbiased.
  if (isPositive(q31)) return decided("Low");
  if (isPositive(q32)) return decided("Low");

  const missing: string[] = [];
  if (isMissing(q31)) missing.push("3.1");
  if (isNegative(q31) && isMissing(q32)) missing.push("3.2");
  if (isNegative(q32) && isMissing(q33)) missing.push("3.3");
  if (isPositive(q33) && isMissing(q34)) missing.push("3.4");

  if (missing.length > 0) return blocked(dedupe(missing));
  return decided("Some concerns");
}

// ---------------------------------------------------------------------------
// Domain 4 — measurement of the outcome
// ---------------------------------------------------------------------------

export function judgeDomain4(a: SignallingAnswers): DomainResult {
  const q41 = a["4.1"];
  const q42 = a["4.2"];
  const q43 = a["4.3"];
  const q44 = a["4.4"];
  const q45 = a["4.5"];

  if (isPositive(q41)) return decided("High"); // inappropriate measurement
  if (isPositive(q45)) return decided("High"); // assessment likely influenced

  // Appropriate, non-differential measurement by blinded assessors.
  if (isNegative(q41) && isNegative(q42) && isNegative(q43)) {
    return decided("Low");
  }
  // Assessors aware, but knowledge could not have influenced the assessment.
  if (
    isNegative(q41) &&
    isNegative(q42) &&
    (isPositive(q43) || q43 === "NI") &&
    isNegative(q44)
  ) {
    return decided("Low");
  }

  const missing: string[] = [];
  if (isMissing(q41)) missing.push("4.1");
  if (isMissing(q42)) missing.push("4.2");
  if (isMissing(q43)) missing.push("4.3");
  if ((isPositive(q43) || q43 === "NI") && isMissing(q44)) missing.push("4.4");
  if (isPositive(q44) && isMissing(q45)) missing.push("4.5");

  if (missing.length > 0) return blocked(dedupe(missing));
  return decided("Some concerns");
}

// ---------------------------------------------------------------------------
// Domain 5 — selection of the reported result
// ---------------------------------------------------------------------------

export function judgeDomain5(a: SignallingAnswers): DomainResult {
  const q51 = a["5.1"];
  const q52 = a["5.2"];
  const q53 = a["5.3"];

  if (isPositive(q52) || isPositive(q53)) return decided("High");

  const missing: string[] = [];
  if (isMissing(q51)) missing.push("5.1");
  if (isMissing(q52)) missing.push("5.2");
  if (isMissing(q53)) missing.push("5.3");
  if (missing.length > 0) return blocked(missing);

  if (isPositive(q51) && isNegative(q52) && isNegative(q53)) {
    return decided("Low");
  }
  return decided("Some concerns");
}

// ---------------------------------------------------------------------------
// Overall
// ---------------------------------------------------------------------------

/**
 * Cochrane's overall rule: High if any domain is High or if the study raises
 * some concerns in multiple domains; Low only if every domain is Low.
 *
 * "Multiple domains" is operationalised as three or more, which is the
 * threshold used in the Sciente pipeline. It is a documented choice, not a
 * quotation from the guidance — see the README's Known limitations.
 */
export function computeOverall(
  domains: Readonly<Record<DomainKey, DomainResult>>,
): { overall: Judgement; requireFullText: boolean } {
  const judgements = DOMAIN_KEYS.map((k) => domains[k].judgement);

  if (judgements.some((j) => j === "High")) {
    return { overall: "High", requireFullText: false };
  }
  const someConcerns = judgements.filter((j) => j === "Some concerns").length;
  if (someConcerns >= 3) return { overall: "High", requireFullText: false };

  // A domain that could not be judged cannot be assumed benign: if anything
  // is still null, the overall verdict is withheld rather than guessed. The
  // one exception is "some concerns" already established elsewhere, which
  // cannot be improved by resolving the missing domain.
  const hasNull = judgements.some((j) => j === null);
  if (someConcerns >= 1) {
    return { overall: "Some concerns", requireFullText: hasNull };
  }
  if (hasNull) return { overall: null, requireFullText: true };

  return { overall: "Low", requireFullText: false };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function runRob2Algorithm(
  answers: SignallingAnswers,
  options: AlgorithmOptions = {},
): AlgorithmResult {
  const { softFail = false, softFailThreshold = 0.6 } = options;

  const domains: Record<DomainKey, DomainResult> = {
    d1: judgeDomain1(answers),
    d2: judgeDomain2(answers),
    d3: judgeDomain3(answers),
    d4: judgeDomain4(answers),
    d5: judgeDomain5(answers),
  };

  if (softFail) {
    for (const key of DOMAIN_KEYS) {
      const current = domains[key];
      if (current.judgement !== null) continue;
      const questions = DOMAIN_QUESTIONS[key];
      const answered = questions.filter((q) => !isMissing(answers[q])).length;
      if (answered / questions.length >= softFailThreshold) {
        domains[key] = {
          judgement: "Some concerns",
          missingForJudgement: current.missingForJudgement,
          softFailApplied: true,
        };
      }
    }
  }

  const { overall, requireFullText } = computeOverall(domains);
  return { domains, overall, requireFullText };
}

function dedupe(ids: string[]): string[] {
  return [...new Set(ids)].sort();
}
