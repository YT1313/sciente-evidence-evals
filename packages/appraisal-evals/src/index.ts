// RoB 2
export {
  DOMAIN_KEYS,
  DOMAIN_QUESTIONS,
  DOMAIN_TITLES,
  QUESTION_IDS,
  SIGNALLING_QUESTIONS,
  questionsForDomain,
  type DomainKey,
  type SignallingQuestion,
} from "./rob2/questions.js";

export {
  computeOverall,
  judgeDomain1,
  judgeDomain2,
  judgeDomain3,
  judgeDomain4,
  judgeDomain5,
  runRob2Algorithm,
  type AlgorithmOptions,
  type AlgorithmResult,
  type DomainResult,
  type Judgement,
  type Response,
  type SignallingAnswers,
} from "./rob2/algorithm.js";

export {
  ROB2_SYSTEM_TEMPLATE,
  buildRob2Prompt,
  buildRob2SystemPrompt,
  formatFocalResult,
  type AssessmentMode,
  type FocalResult,
  type Rob2Prompt,
  type Rob2PromptInput,
} from "./rob2/prompt.js";

export {
  judgementSchema,
  parseRob2ModelResponse,
  responseCodeSchema,
  rob2ModelResponseSchema,
  signallingItemSchema,
  type Rob2ModelResponse,
  type SchemaOutcome,
  type SignallingItem,
} from "./rob2/schema.js";

export {
  DEFAULT_TEXT_BUDGET,
  appraiseRob2,
  assemble,
  inferAssessmentMode,
  type AppraisalResult,
  type AppraisalStatus,
  type AppraiseInput,
  type AppraiseOptions,
  type SupportCheckMode,
  type VerificationCounters,
  type VerifiedSignallingItem,
} from "./rob2/appraise.js";

// Citation verification
export {
  LEVENSHTEIN_MAX_DIST,
  LEVENSHTEIN_MAX_EXCERPT_LENGTH,
  MIN_EXCERPT_LENGTH,
  TOKEN_OVERLAP_THRESHOLD,
  levenshtein,
  normalise,
  verifyExcerpt,
  verifyExcerpts,
  type VerifyResult,
  type VerifyManyResult,
} from "./verify/excerpt-verifier.js";

export {
  DEFAULT_COMPLETENESS_THRESHOLD,
  LEXICON_COVERAGE,
  checkEvidenceSupport,
  isSupported,
  type SupportOptions,
  type SupportResult,
  type SupportVerdict,
} from "./verify/support.js";

export {
  adjudicationSchema,
  createModelAdjudicator,
  type Adjudication,
  type AdjudicationInput,
  type AdjudicationOutcome,
  type EvidenceAdjudicator,
} from "./verify/adjudicator.js";

// Prompt plumbing
export {
  TemplateError,
  fillTemplate,
  placeholdersOf,
  type FillOptions,
} from "./prompt/template.js";

export { JsonExtractionError, extractJson } from "./json/parse.js";

// Providers
export * from "./provider/index.js";

// Metrics
export {
  clusterBootstrapCI,
  cohenKappa,
  compareOnCommonAnswered,
  coverage,
  gwetAC,
  gwetAC1,
  pairsOf,
  percentAgreement,
  weightedKappa,
  type BootstrapOptions,
  type ComparisonResult,
  type Interval,
  type Observation,
  type Pair,
  type SystemMetrics,
  type Weighting,
} from "./metrics/agreement.js";

// Evaluation harness
export {
  DatasetError,
  evalDatasetSchema,
  evalItemSchema,
  loadDatasets,
  type EvalDataset,
  type EvalItem,
} from "./eval/dataset.js";

export {
  DEFAULT_THRESHOLDS,
  JUDGEMENT_CATEGORIES,
  checkThresholds,
  formatReport,
  runDeterministicEval,
  type DeterministicReport,
  type ItemOutcome,
  type Thresholds,
} from "./eval/deterministic.js";

export {
  JUDGE_CRITERIA,
  JUDGE_SCALE,
  buildJudgeSystemPrompt,
  judgeResponseSchema,
  runJudge,
  summariseJudgeOutcomes,
  type JudgeCriterion,
  type JudgeInput,
  type JudgeOutcome,
  type JudgeResponse,
} from "./eval/judge.js";
