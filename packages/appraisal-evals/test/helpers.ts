import { QUESTION_IDS } from "../src/index.js";
import type {
  CompletionRequest,
  CompletionResult,
  ModelProvider,
} from "../src/index.js";

export const ARTICLE_TEXT = [
  "Methods",
  "",
  "Participants were randomly assigned in a 1:1 ratio using a computer-generated random sequence.",
  "Allocation was concealed with sequentially numbered, opaque, sealed envelopes opened after enrolment.",
  "Baseline characteristics were similar between the two groups in age, sex and disease duration.",
  "Participants and treating clinicians were blinded to group assignment throughout the trial.",
  "The primary analysis followed the intention-to-treat principle and included all randomised participants.",
  "Outcome data at week 24 were available for 236 of the 240 randomised participants.",
  "The outcome was measured in a central laboratory with a standardised assay identical for both groups.",
  "Outcome assessors were unaware of group assignment when the samples were processed.",
  "The analysis plan was registered before any unblinded outcome data were available for analysis.",
  "Only the single pre-specified primary outcome and its pre-specified analysis are reported here.",
].join("\n");

const QUOTES: Record<string, string> = {
  "1.1": "randomly assigned in a 1:1 ratio using a computer-generated random sequence",
  "1.2": "concealed with sequentially numbered, opaque, sealed envelopes opened after enrolment",
  "1.3": "Baseline characteristics were similar between the two groups in age, sex and disease duration",
  "2.1": "Participants and treating clinicians were blinded to group assignment throughout the trial",
  "2.2": "treating clinicians were blinded to group assignment throughout the trial",
  "2.6": "followed the intention-to-treat principle and included all randomised participants",
  "3.1": "Outcome data at week 24 were available for 236 of the 240 randomised participants",
  "4.1": "measured in a central laboratory with a standardised assay identical for both groups",
  "4.2": "a standardised assay identical for both groups",
  "4.3": "Outcome assessors were unaware of group assignment when the samples were processed",
  "5.1": "analysis plan was registered before any unblinded outcome data were available for analysis",
  "5.2": "Only the single pre-specified primary outcome and its pre-specified analysis are reported here",
  "5.3": "its pre-specified analysis are reported here",
};

const RESPONSES: Record<string, string> = {
  "1.1": "Y",
  "1.2": "Y",
  "1.3": "N",
  "2.1": "N",
  "2.2": "N",
  "2.6": "Y",
  "3.1": "Y",
  "4.1": "N",
  "4.2": "N",
  "4.3": "N",
  "5.1": "Y",
  "5.2": "N",
  "5.3": "N",
};

/** A well-formed model response for ARTICLE_TEXT, with overrides applied. */
export function modelResponse(
  overrides: {
    signalling?: Record<
      string,
      { response: string; rationale?: string; evidence?: string[] }
    >;
    proposed?: Record<string, string | null>;
    overall?: string | null;
    selfConfidence?: number;
    injectionSuspected?: boolean;
    injectionNote?: string;
    designNotParallelGroup?: boolean;
    designNote?: string;
  } = {},
): string {
  const signalling: Record<string, unknown> = {};
  for (const id of QUESTION_IDS) {
    const override = overrides.signalling?.[id];
    if (override) {
      signalling[id] = {
        response: override.response,
        rationale: override.rationale ?? "Overridden for this test.",
        evidence: override.evidence ?? [],
      };
      continue;
    }
    const response = RESPONSES[id] ?? "NA";
    signalling[id] = {
      response,
      rationale: "As reported in the methods section.",
      evidence: response === "NA" || response === "NI" ? [] : [QUOTES[id]!],
    };
  }

  return JSON.stringify({
    signalling,
    proposed_by_model: {
      domains: {
        d1: "Low",
        d2: "Low",
        d3: "Low",
        d4: "Low",
        d5: "Low",
        ...overrides.proposed,
      },
      overall: overrides.overall === undefined ? "Low" : overrides.overall,
    },
    self_confidence: overrides.selfConfidence ?? 0.8,
    injection_suspected: overrides.injectionSuspected ?? false,
    ...(overrides.injectionNote ? { injection_note: overrides.injectionNote } : {}),
    design_not_parallel_group: overrides.designNotParallelGroup ?? false,
    ...(overrides.designNote ? { design_note: overrides.designNote } : {}),
  });
}

export const FOCAL_RESULT = {
  outcomeDomain: "Glycaemic control",
  specificMeasure: "Change in glycated haemoglobin",
  timepoint: "Week 24",
  effectOfInterest: "Effect of assignment to intervention",
  analysisPopulation: "Intention-to-treat",
};

/** A provider that always returns `text`, recording what it was asked. */
export function stubProvider(
  text: string,
  options: { truncated?: boolean; throws?: Error } = {},
): ModelProvider & { lastRequest: CompletionRequest | null } {
  const provider = {
    name: "stub",
    model: "stub-model",
    lastRequest: null as CompletionRequest | null,
    async complete(request: CompletionRequest): Promise<CompletionResult> {
      provider.lastRequest = request;
      if (options.throws) throw options.throws;
      return {
        text,
        model: "stub-model",
        inputTokens: null,
        outputTokens: null,
        latencyMs: 0,
        truncated: options.truncated ?? false,
      };
    },
  };
  return provider;
}
