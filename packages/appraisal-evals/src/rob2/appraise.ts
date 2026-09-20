/**
 * The RoB 2 appraisal pipeline.
 *
 *   article text
 *     -> data block (untrusted, in the user message)
 *     -> model answers 22 signalling questions, each with a verbatim quote
 *     -> schema validation (no coercion, no defaults)
 *     -> every quote located in the article text
 *     -> every located quote checked for vocabulary consistent with its answer
 *     -> an answer whose quote is missing, contradicting or uninformative
 *        becomes NI
 *     -> the deterministic algorithm computes domain and overall verdicts
 *
 * The model never decides a verdict. It supplies answers and evidence; the
 * evidence is checked mechanically; the verdict is a pure function of what
 * survives. That is the whole design, and everything else here is bookkeeping
 * around it.
 */

import {
  runRob2Algorithm,
  type Judgement,
  type Response,
  type SignallingAnswers,
} from "./algorithm.js";
import {
  DOMAIN_KEYS,
  QUESTION_IDS,
  SIGNALLING_QUESTIONS,
  type DomainKey,
} from "./questions.js";
import {
  buildRob2Prompt,
  type AssessmentMode,
  type FocalResult,
} from "./prompt.js";
import { parseRob2ModelResponse, type Rob2ModelResponse } from "./schema.js";
import { verifyExcerpt } from "../verify/excerpt-verifier.js";
import {
  checkEvidenceSupport,
  isSupported,
  type SupportVerdict,
} from "../verify/support.js";
import type { EvidenceAdjudicator } from "../verify/adjudicator.js";
import type { ModelProvider } from "../provider/types.js";

/** Cap on the article text sent to the model, in characters. */
export const DEFAULT_TEXT_BUDGET = 60_000;

/**
 * What to do when a quote is located but its vocabulary does not support the
 * answer it was offered for.
 *
 *   "demote" — treat the answer as NI (default; the answer has no evidence)
 *   "flag"   — record the verdict but leave the answer standing
 *   "off"    — do not check at all
 */
export type SupportCheckMode = "demote" | "flag" | "off";

export interface AppraiseInput {
  readonly id: string;
  readonly title: string;
  readonly year?: string;
  readonly text: string;
  readonly focalResult: FocalResult;
  /** Inferred from the text when omitted. */
  readonly assessmentMode?: AssessmentMode;
  readonly retracted?: boolean;
}

export interface AppraiseOptions {
  readonly provider: ModelProvider;
  readonly textBudget?: number;
  readonly maxTokens?: number;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  /** Passed through to the algorithm. Default: on, at 0.6. */
  readonly softFail?: boolean;
  readonly softFailThreshold?: number;
  /** Default "demote". */
  readonly supportCheck?: SupportCheckMode;
  /**
   * Share of randomised participants with outcome data at or above which
   * "all, or nearly all" is treated as true. A declared choice, not a
   * quotation from the guidance — see `DEFAULT_COMPLETENESS_THRESHOLD`.
   */
  readonly completenessThreshold?: number;
  /**
   * Optional second opinion, consulted ONLY for answers the deterministic
   * check found uninformative. It can restore such an answer; it can never
   * approve one that contradicted its quote. Off when omitted.
   */
  readonly adjudicator?: EvidenceAdjudicator;
}

export interface VerifiedSignallingItem {
  readonly response: Response;
  /** What the algorithm was given: `response`, or NI if the evidence failed. */
  readonly effectiveResponse: Response;
  readonly rationale: string;
  readonly evidence: readonly string[];
  /** The quote was located in the article text. */
  readonly evidenceVerified: boolean;
  /** Located only at the fuzzy level — a weaker claim. */
  readonly evidenceFuzzy: boolean;
  /** Whether the located quote's vocabulary matches the answer. */
  readonly evidenceSupport: SupportVerdict;
  /** Cues that decided `evidenceSupport`, for the audit trail. */
  readonly supportCues: readonly string[];
  /** Present when an adjudicator was consulted. */
  readonly adjudicationReason?: string;
}

export type AppraisalStatus =
  | "complete"
  | "partial_abstract_only"
  | "withheld_design_mismatch"
  | "failed_response_invalid"
  | "failed_provider_error";

export interface VerificationCounters {
  /** Answers that required a quote. */
  readonly checked: number;
  /** ...whose quote was located in the article. */
  readonly verified: number;
  /** ...located only at the fuzzy level. */
  readonly fuzzy: number;
  /** ...whose quote could not be located. */
  readonly failed: number;
  /** verified / checked; 1 when nothing needed checking. */
  readonly rate: number;
  /** Located answers whose question carries a cue lexicon. */
  readonly supportChecked: number;
  /** ...where the quote's vocabulary matched the answer. */
  readonly supported: number;
  /** ...where it matched the opposite answer. */
  readonly contradicted: number;
  /** ...where it matched neither. */
  readonly uninformative: number;
  /** ...restored by an adjudicator. */
  readonly adjudicated: number;
  /** supported / supportChecked; 1 when nothing was checked. */
  readonly supportRate: number;
}

export interface AppraisalResult {
  readonly id: string;
  readonly status: AppraisalStatus;
  readonly assessmentMode: AssessmentMode;
  /** Null whenever the status is not `complete` or `partial_abstract_only`. */
  readonly overall: Judgement;
  readonly domains: Readonly<
    Record<
      DomainKey,
      {
        readonly judgement: Judgement;
        readonly missingForJudgement: readonly string[];
        readonly softFailApplied: boolean;
      }
    >
  >;
  readonly signalling: Readonly<Record<string, VerifiedSignallingItem>>;
  readonly proposedByModel: {
    readonly domains: Readonly<Record<DomainKey, Judgement>>;
    readonly overall: Judgement;
  };
  readonly disagreements: Readonly<
    Record<string, { readonly proposed: string; readonly algorithm: string }>
  >;
  readonly verification: VerificationCounters;
  readonly selfConfidence: number | null;
  readonly finalConfidence: number;
  readonly injectionSuspected: boolean;
  readonly injectionNote?: string;
  readonly payloadModified: boolean;
  readonly retracted: boolean;
  readonly requireFullText: boolean;
  readonly model: string;
  readonly errors: readonly string[];
}

const QUESTION_TEXT = new Map(
  SIGNALLING_QUESTIONS.map((question) => [question.id, question.text]),
);

export async function appraiseRob2(
  input: AppraiseInput,
  options: AppraiseOptions,
): Promise<AppraisalResult> {
  const budget = options.textBudget ?? DEFAULT_TEXT_BUDGET;
  const articleText = input.text.slice(0, budget);
  const assessmentMode =
    input.assessmentMode ?? inferAssessmentMode(articleText);

  const prompt = buildRob2Prompt({
    title: input.title,
    year: input.year ?? "",
    articleText,
    focalResult: input.focalResult,
    assessmentMode,
  });

  let raw: string;
  try {
    const completion = await options.provider.complete({
      system: prompt.system,
      user: prompt.user,
      task: "score",
      maxTokens: options.maxTokens ?? 8000,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
    raw = completion.text;
    if (completion.truncated) {
      return failure(
        input,
        assessmentMode,
        prompt.payloadModified,
        options.provider.model,
        "failed_response_invalid",
        ["The model stopped at the output cap; the response is incomplete."],
      );
    }
  } catch (cause) {
    return failure(
      input,
      assessmentMode,
      prompt.payloadModified,
      options.provider.model,
      "failed_provider_error",
      [cause instanceof Error ? cause.message : String(cause)],
    );
  }

  const parsed = parseRob2ModelResponse(raw);
  if (!parsed.ok) {
    return failure(
      input,
      assessmentMode,
      prompt.payloadModified,
      options.provider.model,
      "failed_response_invalid",
      [parsed.error, ...parsed.issues],
    );
  }

  return assemble({
    input,
    assessmentMode,
    articleText,
    response: parsed.value,
    payloadModified: prompt.payloadModified,
    model: options.provider.model,
    softFail: options.softFail ?? true,
    softFailThreshold: options.softFailThreshold ?? 0.6,
    supportCheck: options.supportCheck ?? "demote",
    completenessThreshold: options.completenessThreshold,
    adjudicator: options.adjudicator,
  });
}

/**
 * The half of the pipeline that does not talk to a model: verification,
 * support checking, demotion, the algorithm, confidence. Separated so it can
 * be exercised directly, and so the only asynchronous part is the optional
 * adjudicator.
 */
export async function assemble(args: {
  input: AppraiseInput;
  assessmentMode: AssessmentMode;
  articleText: string;
  response: Rob2ModelResponse;
  payloadModified: boolean;
  model: string;
  softFail: boolean;
  softFailThreshold: number;
  supportCheck?: SupportCheckMode;
  completenessThreshold?: number;
  adjudicator?: EvidenceAdjudicator;
}): Promise<AppraisalResult> {
  const { input, response, articleText } = args;
  const supportCheck = args.supportCheck ?? "demote";

  const signalling: Record<string, VerifiedSignallingItem> = {};
  const algorithmInput: Record<string, Response> = {};

  let checked = 0;
  let verified = 0;
  let fuzzy = 0;
  let supportChecked = 0;
  let supported = 0;
  let contradicted = 0;
  let uninformative = 0;
  let adjudicated = 0;

  for (const id of QUESTION_IDS) {
    const item = response.signalling[id]!;
    const needsEvidence = item.response !== "NI" && item.response !== "NA";

    let evidenceVerified = true;
    let evidenceFuzzy = false;
    let support: SupportVerdict = "not_checked";
    let supportCues: readonly string[] = [];
    let adjudicationReason: string | undefined;

    if (needsEvidence) {
      checked += 1;
      let allFound = true;
      let anyFuzzy = false;
      for (const quote of item.evidence) {
        const result = verifyExcerpt(quote, articleText);
        if (!result.verified) {
          allFound = false;
          break;
        }
        if (result.fuzzy) anyFuzzy = true;
      }
      evidenceVerified = allFound;
      evidenceFuzzy = allFound && anyFuzzy;
      if (allFound) {
        verified += 1;
        if (anyFuzzy) fuzzy += 1;
      }

      // Support is only meaningful for a quote that exists. A fabricated
      // quote is already disqualified and does not also need a verdict.
      if (allFound && supportCheck !== "off") {
        const outcome = checkEvidenceSupport(id, item.response, item.evidence, {
          ...(args.completenessThreshold !== undefined
            ? { completenessThreshold: args.completenessThreshold }
            : {}),
        });
        support = outcome.verdict;
        supportCues = outcome.matchedCues;

        if (support === "insufficient" && args.adjudicator) {
          const second = await args.adjudicator({
            questionId: id,
            questionText: QUESTION_TEXT.get(id) ?? id,
            response: item.response,
            quotes: item.evidence,
          });
          if (second.status === "ok") {
            adjudicationReason = second.reason;
            if (second.verdict === "supports") {
              support = "supports_adjudicated";
              adjudicated += 1;
            } else if (second.verdict === "contradicts") {
              support = "contradicts";
            }
          }
        }

        if (outcome.checked) {
          supportChecked += 1;
          if (support === "contradicts") contradicted += 1;
          else if (support === "insufficient") uninformative += 1;
          else supported += 1;
        }
      }
    }

    // An answer stands only if its quote was found AND that quote says
    // something consistent with the answer. Anything else is not evidence,
    // and "no evidence" is exactly what NI means.
    const evidenceHolds =
      evidenceVerified && (supportCheck !== "demote" || isSupported(support));
    const effectiveResponse: Response = evidenceHolds ? item.response : "NI";

    signalling[id] = {
      response: item.response,
      effectiveResponse,
      rationale: item.rationale,
      evidence: item.evidence,
      evidenceVerified,
      evidenceFuzzy,
      evidenceSupport: support,
      supportCues,
      ...(adjudicationReason ? { adjudicationReason } : {}),
    };
    algorithmInput[id] = effectiveResponse;
  }

  const algorithm = runRob2Algorithm(algorithmInput as SignallingAnswers, {
    softFail: args.softFail,
    softFailThreshold: args.softFailThreshold,
  });

  const disagreements: Record<
    string,
    { proposed: string; algorithm: string }
  > = {};
  let disagreementCount = 0;
  for (const key of DOMAIN_KEYS) {
    const proposed = response.proposed_by_model.domains[key];
    const computed = algorithm.domains[key].judgement;
    if (proposed !== null && proposed !== computed) {
      disagreements[key] = {
        proposed: String(proposed),
        algorithm: String(computed ?? "null"),
      };
      disagreementCount += 1;
    }
  }
  if (
    response.proposed_by_model.overall !== null &&
    response.proposed_by_model.overall !== algorithm.overall
  ) {
    disagreements.overall = {
      proposed: String(response.proposed_by_model.overall),
      algorithm: String(algorithm.overall ?? "null"),
    };
  }

  const rate = checked === 0 ? 1 : verified / checked;
  const supportRate = supportChecked === 0 ? 1 : supported / supportChecked;

  // Confidence is the weakest of four independent signals, never their
  // average: a high self-report cannot compensate for a quote that is absent
  // from the article or that says the opposite of the answer.
  let finalConfidence = Math.min(
    response.self_confidence,
    rate,
    supportRate,
    1 - 0.1 * disagreementCount,
  );
  if (input.retracted) finalConfidence = Math.min(finalConfidence, 0.5);
  finalConfidence = clamp01(finalConfidence);

  const designMismatch = response.design_not_parallel_group;
  const status: AppraisalStatus = designMismatch
    ? "withheld_design_mismatch"
    : args.assessmentMode === "abstract_only"
      ? "partial_abstract_only"
      : "complete";

  return {
    id: input.id,
    status,
    assessmentMode: args.assessmentMode,
    overall: designMismatch ? null : algorithm.overall,
    domains: Object.fromEntries(
      DOMAIN_KEYS.map((key) => [
        key,
        {
          judgement: designMismatch ? null : algorithm.domains[key].judgement,
          missingForJudgement: algorithm.domains[key].missingForJudgement,
          softFailApplied: algorithm.domains[key].softFailApplied === true,
        },
      ]),
    ) as unknown as AppraisalResult["domains"],
    signalling,
    proposedByModel: {
      domains: response.proposed_by_model.domains,
      overall: response.proposed_by_model.overall,
    },
    disagreements,
    verification: {
      checked,
      verified,
      fuzzy,
      failed: checked - verified,
      rate,
      supportChecked,
      supported,
      contradicted,
      uninformative,
      adjudicated,
      supportRate,
    },
    selfConfidence: response.self_confidence,
    finalConfidence,
    injectionSuspected: response.injection_suspected,
    ...(response.injection_note
      ? { injectionNote: response.injection_note }
      : {}),
    payloadModified: args.payloadModified,
    retracted: input.retracted === true,
    requireFullText: algorithm.requireFullText,
    model: args.model,
    errors: designMismatch
      ? [response.design_note ?? "Model flagged a non-parallel-group design."]
      : [],
  };
}

export function inferAssessmentMode(text: string): AssessmentMode {
  const hasMethodsSection = /^\s*(methods|materials and methods)\b/im.test(text);
  return text.length > 8_000 || hasMethodsSection
    ? "fulltext"
    : "abstract_only";
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function failure(
  input: AppraiseInput,
  assessmentMode: AssessmentMode,
  payloadModified: boolean,
  model: string,
  status: AppraisalStatus,
  errors: string[],
): AppraisalResult {
  const emptyDomains = Object.fromEntries(
    DOMAIN_KEYS.map((key) => [
      key,
      { judgement: null, missingForJudgement: [], softFailApplied: false },
    ]),
  ) as unknown as AppraisalResult["domains"];

  return {
    id: input.id,
    status,
    assessmentMode,
    overall: null,
    domains: emptyDomains,
    signalling: {},
    proposedByModel: {
      domains: { d1: null, d2: null, d3: null, d4: null, d5: null },
      overall: null,
    },
    disagreements: {},
    verification: {
      checked: 0,
      verified: 0,
      fuzzy: 0,
      failed: 0,
      rate: 0,
      supportChecked: 0,
      supported: 0,
      contradicted: 0,
      uninformative: 0,
      adjudicated: 0,
      supportRate: 0,
    },
    selfConfidence: null,
    finalConfidence: 0,
    injectionSuspected: false,
    payloadModified,
    retracted: input.retracted === true,
    requireFullText: true,
    model,
    errors,
  };
}
