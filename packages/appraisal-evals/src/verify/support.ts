/**
 * Evidence-support checking.
 *
 * Locating a quote proves the sentence exists. It does not prove the sentence
 * supports the answer it was offered for. That gap is what this module
 * narrows: a model that answers "outcome assessors were unaware of the
 * assignment" and quotes "symptom severity was rated by the treating
 * clinician" passes quote verification and is wrong.
 *
 * Not entailment, and not another model call. Four deterministic layers:
 *
 *  1. **Cue lexicons.** Each signalling question carries the vocabulary
 *     trials actually use on each side of it.
 *  2. **Negation scope.** A cue is read with the words in front of it, so
 *     "participants were NOT blinded" counts as evidence that they were
 *     aware, not as evidence that they were blinded. Without this the
 *     lexicon inverts on exactly the sentences that matter most.
 *  3. **Morphological tolerance.** Cues match across the ordinary suffixes
 *     of the same word — blind / blinded / blinding, conceal / concealed /
 *     concealment — so a lexicon does not fail on grammar.
 *  4. **Numeric rules.** Where a question turns on a proportion, the numbers
 *     in the quote are read and compared with a declared threshold, instead
 *     of being ignored.
 *
 * The cue rule is asymmetric on purpose: vocabulary for the ANSWERED side
 * ends the check even when opposite vocabulary is also present, because one
 * sentence routinely carries both. That keeps false demotions rare at the
 * cost of letting some unsupported answers through — the right direction for
 * a check whose output silences an answer. A numeric rule is the exception:
 * an explicit contradiction in the numbers overrides the cues, because a
 * counted proportion is not a matter of phrasing.
 *
 * What it still cannot do is in the README, not buried: it does not cover
 * paraphrase into vocabulary the lexicon has never seen, and outside the
 * questions with numeric rules it says nothing about whether the figures in
 * a quote mean what the answer claims.
 */

import { normalise } from "./excerpt-verifier.js";
import type { Response } from "../rob2/algorithm.js";

export type SupportVerdict =
  | "supports"
  | "supports_adjudicated"
  | "contradicts"
  | "insufficient"
  | "not_checked";

export interface SupportResult {
  readonly verdict: SupportVerdict;
  /** Cues, quantities or ratios that decided the verdict. */
  readonly matchedCues: readonly string[];
  /** False when this question has no rule, so nothing was checked. */
  readonly checked: boolean;
  /** Which layer decided. Useful when auditing a demotion. */
  readonly basis?: "cues" | "negated_cues" | "quantity" | "proportion";
}

interface CueSet {
  /** Vocabulary that supports a Y / PY answer. */
  readonly affirmative: readonly string[];
  /** Vocabulary that supports an N / PN answer. */
  readonly negative: readonly string[];
  /**
   * The question asks whether something was substantial. There is no
   * vocabulary for "substantial" that a trial reliably uses, but there is a
   * checkable discipline: an answer about magnitude must point at a stated
   * quantity rather than at an impression. When set, a quote carrying a
   * quantity and no opposing vocabulary counts as support.
   */
  readonly quantityIsEvidence?: boolean;
  /**
   * The question turns on how complete the outcome data are. The quote's
   * "N of M" is read and compared with `minShare`.
   */
  readonly completeness?: { readonly minShare: number };
}

/**
 * Share of participants with outcome data at or above which "all, or nearly
 * all" is treated as true.
 *
 * RoB 2 says "all, or nearly all" and does not put a number on it, so this is
 * a declared choice of this implementation — like the "three or more domains"
 * rule in the overall algorithm — not a quotation from the guidance. It is
 * configurable per call, and every verdict it produces names the ratio it
 * read, so a reviewer can disagree with the threshold rather than with an
 * unexplained demotion.
 */
export const DEFAULT_COMPLETENESS_THRESHOLD = 0.95;

export interface SupportOptions {
  readonly completenessThreshold?: number;
}

/**
 * Cue lexicons and numeric rules, by signalling question id.
 *
 * All 22 questions are covered. The three that resisted a vocabulary — 2.4,
 * 2.5 and 2.7, which ask about magnitude and balance rather than about facts
 * a trial states in conventional words — are covered by a quantity rule and a
 * balance vocabulary instead.
 */
const CUES: Readonly<Record<string, CueSet>> = {
  "1.1": {
    affirmative: [
      "random sequence",
      "random allocation sequence",
      "computer-generated",
      "computer generated",
      "random number",
      "randomisation list",
      "randomization list",
      "permuted block",
      "block randomisation",
      "block randomization",
      "minimisation",
      "minimization",
      "randomly assigned",
      "randomly allocated",
      "random allocation",
      "drawing lots",
      "coin toss",
    ],
    negative: [
      "alternating",
      "alternate",
      "alternation",
      "date of birth",
      "hospital number",
      "record number",
      "odd and even",
      "quasi-random",
      "non-random",
      "at the discretion of",
      "by the investigator",
      "order of presentation",
      "day of the week",
    ],
  },
  "1.2": {
    affirmative: [
      "sealed envelope",
      "opaque",
      "sequentially numbered",
      "central randomisation",
      "central randomization",
      "central allocation",
      "centrally allocated",
      "conceal",
      "pharmacy-controlled",
      "web-based randomisation",
      "web-based randomization",
      "telephone randomisation",
      "interactive voice",
    ],
    negative: [
      "open list",
      "was known to",
      "were known to",
      "could consult",
      "available to the investigator",
      "unsealed",
      "open allocation",
      "visible to",
      "posted on",
    ],
  },
  "1.3": {
    affirmative: [
      "imbalance",
      "imbalanced",
      "differed at baseline",
      "differed between the groups",
      "different at baseline",
      "markedly lower",
      "markedly higher",
      "did not explain",
      "unexplained",
      "significantly different",
    ],
    negative: [
      "similar",
      "comparable",
      "balanced",
      "no significant difference",
      "no differences of clinical importance",
      "well matched",
      "evenly distributed",
    ],
  },
  "2.1": {
    affirmative: [
      "open-label",
      "open label",
      "unblinded",
      "were aware",
      "was aware",
      "knew",
      "unmasked",
    ],
    negative: [
      "blind",
      "double-blind",
      "double blind",
      "mask",
      "placebo",
      "identical in appearance",
      "unaware",
      "sham",
    ],
  },
  "2.2": {
    affirmative: [
      "open-label",
      "open label",
      "unblinded",
      "were aware",
      "was aware",
      "knew",
      "unmasked",
    ],
    negative: [
      "blind",
      "double-blind",
      "double blind",
      "mask",
      "placebo",
      "identical in appearance",
      "unaware",
    ],
  },
  "2.3": {
    affirmative: [
      "crossed over",
      "crossover",
      "switched",
      "deviation",
      "deviated",
      "did not receive",
      "received the other",
      "after complaining",
      "non-adherence",
      "discontinued",
      "stopped treatment",
    ],
    negative: [
      "no deviations",
      "no deviation",
      "as intended",
      "as planned",
      "all participants received",
      "protocol was followed",
    ],
  },
  "2.4": {
    // "Were the deviations likely to have affected the outcome?" is a
    // magnitude question. The discipline that can be checked is that the
    // answer points at a counted quantity.
    quantityIsEvidence: true,
    affirmative: [
      "affected the outcome",
      "influenced the outcome",
      "clinically important",
      "substantial",
      "considerable",
      "large proportion",
    ],
    negative: [
      "unlikely to have affected",
      "did not affect",
      "minor",
      "negligible",
      "no effect on the outcome",
    ],
  },
  "2.5": {
    affirmative: [
      "balanced between",
      "similar in both",
      "comparable numbers",
      "in both groups",
      "in both arms",
      "in each group",
      "in either group",
      "equally distributed",
    ],
    negative: [
      "only in the",
      "all of these were",
      "rather than in the group",
      "one direction",
      "more frequently in",
      "concentrated in",
      "only the control",
      "only the intervention",
    ],
  },
  "2.6": {
    affirmative: [
      "intention-to-treat",
      "intention to treat",
      "intent-to-treat",
      "full analysis set",
      "as randomised",
      "as randomized",
      "all randomised participants",
      "all randomized participants",
      "in the group to which they were assigned",
    ],
    negative: [
      "per-protocol",
      "per protocol",
      "as treated",
      "as-treated",
      "excluded from the analysis",
      "rather than in the group to which",
      "only participants who completed",
      "according to the treatment received",
    ],
  },
  "2.7": {
    // Same reasoning as 2.4: "potential for a substantial impact" is a
    // magnitude claim and must rest on a stated quantity.
    quantityIsEvidence: true,
    affirmative: [
      "substantial",
      "considerable",
      "large proportion",
      "materially",
      "would have changed",
    ],
    negative: [
      "small number",
      "few participants",
      "unlikely to have",
      "negligible",
      "minimal",
    ],
  },
  "3.1": {
    completeness: { minShare: DEFAULT_COMPLETENESS_THRESHOLD },
    affirmative: [
      "available for",
      "data were complete",
      "complete data",
      "no loss to follow-up",
      "all participants completed",
      "none were lost",
    ],
    negative: [
      "missing",
      "lost to follow-up",
      "withdrew",
      "withdrawal",
      "dropout",
      "dropped out",
      "did not complete",
      "not available for",
    ],
  },
  "3.2": {
    affirmative: [
      "sensitivity analysis",
      "multiple imputation",
      "no difference between completers",
      "similar in those with and without",
      "results were unchanged",
      "did not alter the conclusion",
    ],
    negative: [
      "no sensitivity analysis",
      "not reported",
      "not recorded",
      "concentrated among",
      "differential",
      "differed between",
      "related to the outcome",
    ],
  },
  "3.3": {
    affirmative: [
      "concentrated among",
      "depended on",
      "depend on",
      "related to the outcome",
      "differential",
      "had not improved",
      "because of lack of efficacy",
      "adverse event",
    ],
    negative: [
      "unrelated to",
      "administrative reason",
      "relocation",
      "at random",
      "similar reasons in both",
    ],
  },
  "3.4": {
    affirmative: [
      "concentrated among",
      "depended on",
      "related to the outcome",
      "differential",
      "had not improved",
      "because of lack of efficacy",
    ],
    negative: ["unrelated to", "administrative reason", "at random"],
  },
  "4.1": {
    affirmative: [
      "not validated",
      "unvalidated",
      "inappropriate",
      "ad hoc",
      "non-standard",
      "self-devised",
      "unspecified instrument",
    ],
    negative: [
      "validated",
      "standardised",
      "standardized",
      "central laboratory",
      "core laboratory",
      "assay",
      "established scale",
      "certified",
      "accepted measure",
      "questionnaire",
    ],
  },
  "4.2": {
    affirmative: [
      "differed between",
      "different method",
      "more frequently in",
      "only in the intervention",
      "only in the control",
      "additional visit",
    ],
    negative: [
      "identical for both groups",
      "identical in both groups",
      "the same method",
      "same in both groups",
      "in all participants",
      "both groups",
      "all groups",
      "each group",
    ],
  },
  "4.3": {
    affirmative: [
      "were aware",
      "was aware",
      "who knew",
      "knew which",
      "unblinded",
      "open-label",
      "open label",
      "self-reported",
    ],
    negative: [
      "unaware",
      "blind",
      "mask",
      "independent assessor",
      "independent of the",
      "anonymised",
      "anonymized",
      "did not know",
      "central adjudication",
    ],
  },
  "4.4": {
    affirmative: [
      "subjective",
      "who knew",
      "knew which",
      "were aware",
      "recommend",
      "treating clinician",
      "investigator-assessed",
      "unblinded",
    ],
    negative: [
      "objective",
      "all-cause mortality",
      "laboratory",
      "automated",
      "independent assessor",
      "blind",
    ],
  },
  "4.5": {
    affirmative: [
      "recommend",
      "had an interest",
      "who knew",
      "subjective",
      "were aware",
      "unblinded",
    ],
    negative: ["objective", "automated", "blind", "independent assessor"],
  },
  "5.1": {
    affirmative: [
      "pre-specified",
      "prespecified",
      "pre-registered",
      "registered",
      "protocol",
      "analysis plan",
      "finalised before",
      "finalized before",
      "statistical analysis plan",
    ],
    negative: [
      "no analysis plan",
      "not registered",
      "no protocol",
      "was not pre-specified",
      "post hoc",
      "post-hoc",
      "no pre-specified",
    ],
  },
  "5.2": {
    affirmative: [
      "reached statistical significance",
      "statistically significant",
      "out of the",
      "multiple outcome",
      "several outcome",
      "selected",
      "were collected",
    ],
    negative: [
      "only the",
      "single pre-specified",
      "single prespecified",
      "pre-specified",
      "prespecified",
      "all outcomes",
      "all pre-specified outcomes",
    ],
  },
  "5.3": {
    affirmative: [
      "reached statistical significance",
      "statistically significant",
      "multiple analyses",
      "several analyses",
      "out of the",
      "selected",
      "were collected",
    ],
    negative: [
      "only the",
      "pre-specified analysis",
      "prespecified analysis",
      "single analysis",
      "as planned",
    ],
  },
};

/** Signalling questions that carry a rule, sorted. */
export const LEXICON_COVERAGE: readonly string[] = Object.keys(CUES).sort();

const POSITIVE: ReadonlySet<Response> = new Set<Response>(["Y", "PY"]);

const NOT_CHECKED: SupportResult = {
  verdict: "not_checked",
  matchedCues: [],
  checked: false,
};

/**
 * Decide whether the quotes offered for an answer carry evidence consistent
 * with that answer. `quotes` must already have been located in the article —
 * this check says nothing about whether they exist.
 */
export function checkEvidenceSupport(
  questionId: string,
  response: Response,
  quotes: readonly string[],
  options: SupportOptions = {},
): SupportResult {
  if (response === "NI" || response === "NA") return NOT_CHECKED;
  const rules = CUES[questionId];
  if (!rules) return NOT_CHECKED;
  if (quotes.length === 0) {
    return { verdict: "insufficient", matchedCues: [], checked: true };
  }

  const haystack = normalise(quotes.join(" "));
  const answeredIsPositive = POSITIVE.has(response);

  // Layer 4 first, and only when it reaches a verdict: a counted proportion
  // settles the question whatever the surrounding phrasing suggests.
  if (rules.completeness) {
    const threshold =
      options.completenessThreshold ?? rules.completeness.minShare;
    const reading = readCompleteness(haystack);
    if (reading) {
      const claimsComplete = answeredIsPositive;
      const isComplete = reading.share >= threshold;
      const label = `${formatPercent(reading.share)} complete (${reading.source}), threshold ${formatPercent(threshold)}`;
      return claimsComplete === isComplete
        ? { verdict: "supports", matchedCues: [label], checked: true, basis: "proportion" }
        : { verdict: "contradicts", matchedCues: [label], checked: true, basis: "proportion" };
    }
  }

  // Layers 1-3.
  const affirmative = findCues(haystack, rules.affirmative);
  const negative = findCues(haystack, rules.negative);

  // A negated cue is evidence for the other side: "not blinded" says the
  // participants were aware.
  const forAffirmative = [...affirmative.plain, ...negative.negated];
  const forNegative = [...negative.plain, ...affirmative.negated];

  const answeredEvidence = answeredIsPositive ? forAffirmative : forNegative;
  const oppositeEvidence = answeredIsPositive ? forNegative : forAffirmative;

  if (answeredEvidence.length > 0) {
    const fromNegation = answeredIsPositive
      ? negative.negated.length > 0 && affirmative.plain.length === 0
      : affirmative.negated.length > 0 && negative.plain.length === 0;
    return {
      verdict: "supports",
      matchedCues: answeredEvidence,
      checked: true,
      basis: fromNegation ? "negated_cues" : "cues",
    };
  }

  if (oppositeEvidence.length > 0) {
    return {
      verdict: "contradicts",
      matchedCues: oppositeEvidence,
      checked: true,
      basis: "cues",
    };
  }

  // A magnitude question with no opposing vocabulary: a stated quantity is
  // what distinguishes a judgement from an impression.
  if (rules.quantityIsEvidence) {
    const quantity = findQuantity(haystack);
    if (quantity) {
      return {
        verdict: "supports",
        matchedCues: [`quantity: ${quantity}`],
        checked: true,
        basis: "quantity",
      };
    }
  }

  return { verdict: "insufficient", matchedCues: [], checked: true };
}

/** True for the verdicts that leave an answer standing. */
export function isSupported(verdict: SupportVerdict): boolean {
  return (
    verdict === "supports" ||
    verdict === "supports_adjudicated" ||
    verdict === "not_checked"
  );
}

// ---------------------------------------------------------------------------
// Cue matching with morphology and negation scope
// ---------------------------------------------------------------------------

/**
 * Ordinary English suffixes, so a lexicon entry matches the forms of its own
 * word: blind / blinds / blinded / blinding, conceal / concealment,
 * recommend / recommended, deviation / deviations.
 */
const SUFFIXES = "(?:e?s|e?d|ing|ment|ments|ed)?";

const NEGATORS =
  /(^|[^a-z])(no|not|never|without|nor|neither|lack|lacked|lacking|absence|failed|unable|rather than|instead of)([^a-z]|$)/;

const patternCache = new Map<string, RegExp>();

function cuePattern(cue: string): RegExp {
  const cached = patternCache.get(cue);
  if (cached) return cached;
  const words = normalise(cue).split(/\s+/).map(escapeRegExp);
  const last = words.pop() ?? "";
  const body = [...words, `${last}${SUFFIXES}`].join("\\s+");
  const pattern = new RegExp(`(^|[^a-z0-9])(${body})(?![a-z0-9])`, "g");
  patternCache.set(cue, pattern);
  return pattern;
}

interface CueMatches {
  readonly plain: string[];
  readonly negated: string[];
}

function findCues(haystack: string, cues: readonly string[]): CueMatches {
  const plain: string[] = [];
  const negated: string[] = [];

  for (const cue of cues) {
    const pattern = cuePattern(cue);
    pattern.lastIndex = 0;
    let negatedHere = false;
    let plainHere = false;

    for (const match of haystack.matchAll(pattern)) {
      const start = (match.index ?? 0) + (match[1]?.length ?? 0);
      if (isNegated(haystack, start)) negatedHere = true;
      else plainHere = true;
    }

    // An unnegated occurrence anywhere outweighs a negated one: a sentence
    // that says the thing plainly once has said it.
    if (plainHere) plain.push(cue);
    else if (negatedHere) negated.push(cue);
  }

  return { plain, negated };
}

/**
 * Is the cue at `start` inside the scope of a negator?
 *
 * The window is the five words before the cue, cut at the nearest clause
 * boundary. Wider windows reach across clauses and invert cues that were
 * never negated ("no deviations were recorded; participants were blinded"),
 * which is a worse failure than missing a negation.
 */
function isNegated(haystack: string, start: number): boolean {
  const before = haystack.slice(Math.max(0, start - 80), start);
  const clause = before.slice(
    Math.max(
      before.lastIndexOf("."),
      before.lastIndexOf(";"),
      before.lastIndexOf(":"),
    ) + 1,
  );
  const words = clause.trim().split(/\s+/).slice(-5).join(" ");
  return NEGATORS.test(` ${words} `);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Numeric rules
// ---------------------------------------------------------------------------

const NUMBER_WORDS =
  /(^|[^a-z])(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)([^a-z]|$)/;

/**
 * A stated quantity: a figure, a percentage, or a number word.
 *
 * "one" is excluded deliberately — it is a pronoun as often as a count, and a
 * quantity rule that fires on "one of the reasons" is not a check.
 */
function findQuantity(haystack: string): string | null {
  const digits = /\d+(?:[.,]\d+)?\s*%?/.exec(haystack);
  if (digits) return digits[0].trim();
  const word = NUMBER_WORDS.exec(haystack);
  return word ? word[2]! : null;
}

interface CompletenessReading {
  /** Share of randomised participants with outcome data, in [0, 1]. */
  readonly share: number;
  /** The text the ratio was read from. */
  readonly source: string;
}

const RATIO = /(\d[\d,]*)\s*(?:of|\/|out of)\s*(?:the\s*)?(\d[\d,]*)/g;
const PERCENT = /(\d+(?:\.\d+)?)\s*%/;

/**
 * Words that mean the counted figure is the participants WITHOUT data, so
 * the share with data is its complement.
 */
const ABSENCE_WORDS =
  /(^|[^a-z])(missing|lost|withdrew|withdrawn|dropout|dropped|excluded|did not complete|unavailable)([^a-z]|$)/;

/**
 * Read "N of M" (or a percentage) out of a quote and convert it into the
 * share of randomised participants who have outcome data.
 *
 * Returns null when the quote states no ratio, in which case the cue layers
 * decide as before. Being unable to read a number is not evidence of
 * anything.
 */
function readCompleteness(haystack: string): CompletenessReading | null {
  const counted = ABSENCE_WORDS.test(haystack);

  RATIO.lastIndex = 0;
  const ratio = RATIO.exec(haystack);
  if (ratio) {
    const numerator = Number(ratio[1]!.replace(/,/g, ""));
    const denominator = Number(ratio[2]!.replace(/,/g, ""));
    if (
      Number.isFinite(numerator) &&
      Number.isFinite(denominator) &&
      denominator > 0 &&
      numerator <= denominator
    ) {
      const share = counted
        ? 1 - numerator / denominator
        : numerator / denominator;
      return { share, source: ratio[0] };
    }
  }

  const percent = PERCENT.exec(haystack);
  if (percent) {
    const value = Number(percent[1]!) / 100;
    if (Number.isFinite(value) && value >= 0 && value <= 1) {
      return { share: counted ? 1 - value : value, source: percent[0] };
    }
  }

  return null;
}

function formatPercent(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}
