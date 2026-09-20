# @sciente/appraisal-evals

Cochrane RoB 2 appraisal where the model answers questions and supplies
quotes, the quotes are checked against the article mechanically, and the
verdict is computed by the published algorithm — plus the harness that
measures how well that works.

```ts
import { appraiseRob2, createAnthropicProvider } from "@sciente/appraisal-evals";

const result = await appraiseRob2(
  {
    id: "trial-1",
    title: "A randomised trial of ...",
    text: articleFullText,
    focalResult: {
      outcomeDomain: "Glycaemic control",
      specificMeasure: "Change in glycated haemoglobin",
      timepoint: "Week 24",
      effectOfInterest: "Effect of assignment to intervention",
      analysisPopulation: "Intention-to-treat",
    },
  },
  { provider: createAnthropicProvider({ model: process.env.APPRAISAL_MODEL! }) },
);

result.overall;              // "Low" | "Some concerns" | "High" | null
result.verification.rate;    // share of answers whose quotes were found
result.disagreements;        // where the model's own verdict differed
```

## The pipeline

```
article text
  → data block in the USER message (never the system message)
  → model answers 22 signalling questions, each with a verbatim quote
  → zod validation: all 22 present, every substantive answer carries a quote
  → each quote located in the article text
  → each located quote checked for vocabulary matching its answer
  → an answer whose quote is missing, contradicting or silent becomes NI
  → RoB 2 algorithm computes the domain and overall verdicts
```

The model never returns the verdict. It returns answers and evidence; what
survives verification is what the algorithm sees. Its own proposed verdicts are
recorded in `disagreements` for analysis and cost confidence, but never change
the result.

### Abstention

"No information" is a first-class answer and costs the model nothing. The
algorithm will withhold a domain verdict rather than guess, and record which
signalling questions blocked it (`domains.d1.missingForJudgement`). `softFail`
— on by default in the pipeline, off by default in the bare algorithm — allows
a domain where most questions were answered and nothing triggered a High path
to be reported as "Some concerns" rather than as nothing at all; every domain
it touches is flagged with `softFailApplied`.

### Quote verification

Two levels. **Strict** is a normalised exact substring: forgiving about
whitespace, case, quote and dash glyphs and diacritic composition, unforgiving
about everything else. **Fuzzy** is attempted only when strict fails, passes on
high token overlap or a small edit distance for short quotes, and is reported
separately so it can be weighted down.

What verification proves is narrow and worth stating: **the sentence exists in
the article.** It does not prove the sentence supports the answer. That is the
next check's job.

### Evidence support

Four deterministic layers, applied to a quote that has already been located.

1. **Cue lexicons.** Each signalling question carries the vocabulary trials
   actually use on each side of it — "computer-generated" and "permuted block"
   against "alternating" and "date of birth"; "blinded", "masked", "placebo"
   against "open-label", "were aware", "knew". Nineteen of the 22 questions
   are decided this way; the other three are covered by layer 4.
2. **Negation scope.** A cue is read with the five words in front of it, cut
   at the nearest clause boundary, so "participants were **not** blinded"
   counts as evidence that they were aware. Without this the lexicon inverts
   on exactly the sentences that matter most. The window is deliberately
   narrow: reaching across clauses inverts cues that were never negated, which
   is the worse failure.
3. **Morphological tolerance.** Cues match the ordinary forms of their own
   word — blind / blinds / blinded / blinding, conceal / concealment — so a
   lexicon does not fail on grammar. Word boundaries are enforced, so "mask"
   does not match "unmasked", which is a cue in its own right on the other
   side.
4. **Numeric rules.** Where a question turns on a proportion, the numbers are
   read instead of ignored. For 3.1, "available for 150 of the 180" is 83.3%
   against a declared 95% threshold, so an answer of "yes, nearly all" is a
   contradiction whatever the surrounding phrasing suggests; "missing for 61
   of the 180" is recognised as its complement, 66.1% complete. For 2.4 and
   2.7, which ask whether something was *substantial*, there is no reliable
   vocabulary — but there is a checkable discipline: an answer about magnitude
   must point at a stated quantity rather than at an impression.

For a located quote:

| Outcome | Meaning | Effect |
| --- | --- | --- |
| `supports` | the quote carries vocabulary for the answer given | answer stands |
| `contradicts` | it carries only the opposite side's vocabulary | demoted to NI |
| `insufficient` | it carries neither | demoted to NI |
| `not_checked` | the answer was NI/NA, or the id has no rule (no signalling question is in that state today) | answer stands |

The cue rule is asymmetric on purpose. Finding vocabulary for the answered
side ends the check even when opposite vocabulary is also present, because one
sentence routinely carries both — "no analysis plan was registered" contains
"registered". That keeps false demotions rare at the cost of letting some
unsupported answers through, which is the right direction for a check whose
output silences an answer. A numeric rule is the exception: a counted
proportion overrides the cues, because it is not a matter of phrasing.

`supportCheck` selects what happens: `"demote"` (default), `"flag"` (record
but keep the answer), `"off"`. `completenessThreshold` moves the 95% line;
`DEFAULT_COMPLETENESS_THRESHOLD` documents that it is a declared choice, not a
quotation from the RoB 2 guidance.

**This reads vocabulary, not meaning.** It will not recognise a correct answer
paraphrased into words the lexicon has never seen, and outside the questions
with numeric rules it says nothing about whether the figures in a quote mean
what the answer claims. `LEXICON_COVERAGE` names what is covered and a test
pins it to the full question set.

**What it costs is measured, not asserted.** The evaluation runs the lexicon
over the reference answers — ones a reviewer evidenced correctly — and reports
the false-demotion rate. `maxLexiconFalseDemotionRate` defaults to zero and
the CI workflow passes `--max-false-demotion 0` explicitly, so a lexicon
change that starts silencing correct answers fails the build, and raising the
ceiling is a visible edit rather than a changed default.

**Zero on this fixture set is not zero on the literature.** Eight synthetic
trials cannot show that a lexicon is harmless; they can show that it stopped
being harmless. It is a regression guard, not a proof.

### Adjudication (optional, off by default)

A lexicon returns `insufficient` for a correct answer phrased in vocabulary it
does not carry, and that costs coverage. Pass an `adjudicator` and the
pipeline will ask a model for a second opinion — but **only** on answers the
deterministic check found uninformative, and only with the question, the
answer and the quote in view, never the article. It can restore an answer; it
cannot overturn a `contradicts` and it is never asked about an answer the
lexicon already accepted. A restored answer is recorded as
`supports_adjudicated`, distinguishable from one the deterministic check
accepted. Nothing in CI calls it.

```ts
import { createModelAdjudicator } from "@sciente/appraisal-evals";

await appraiseRob2(input, {
  provider,
  adjudicator: createModelAdjudicator(provider),
});
```

## Metrics

| Function | Why it is there |
| --- | --- |
| `gwetAC1` | Headline agreement. Survives the skewed Low/Some concerns/High distribution that collapses kappa. |
| `cohenKappa`, `weightedKappa` | Reported beside AC1, not instead of it. Quadratic weights on the declared ordinal order. |
| `clusterBootstrapCI` | Resamples **articles**, not domains. Five domains from one trial are not five independent observations. |
| `coverage` | Share of units the system answered at all. Reported on the full set. |
| `compareOnCommonAnswered` | Compares systems only on units all of them answered, so abstention cannot buy a better score. |

The bootstrap is seeded, so an interval is reproducible between runs.

## Evaluation

Two runners, with different jobs.

**Deterministic** — every push, no API key, no variance:

```bash
pnpm build
node packages/appraisal-evals/dist/eval/run-deterministic.js
```

It runs the whole pipeline against recorded model responses (`replay` on each
dataset item), so prompt assembly, schema validation, quote verification and
the algorithm are all exercised; only the network call is replaced. It reports
agreement with intervals plus integrity counters, and exits non-zero when a
threshold is missed.

**Judged** — manual dispatch, calls a model:

```bash
APPRAISAL_MODEL=... ANTHROPIC_API_KEY=... \
  node packages/appraisal-evals/dist/eval/run-judge.js
```

The judge scores four criteria on an anchored 1–5 scale, with an anchor
written for every point and a required locus for every score. A judgement that
cannot be parsed or validated returns `judge_failed` and is **excluded** from
the aggregate rather than counted as average.

## Providers

One method, two implementations, plus a replay provider for tests and CI.

```ts
createAnthropicProvider({ model })                     // ANTHROPIC_API_KEY
createOpenAICompatibleProvider({ model, endpoint })    // OPENAI_API_KEY
createProviderFromEnv()                                // APPRAISAL_PROVIDER / APPRAISAL_MODEL
createReplayProvider({ "item-id": recordedJson })      // no network
```

Keys are read from the environment and from nowhere else. The endpoint of an
OpenAI-compatible provider is always explicit — this package never infers
which service a key belongs to. Temperature comes from the task
(`extract` and `score` are 0), not from a caller-supplied default.

## What was changed from the private original

This package was extracted from the Sciente research assistant. The extraction
fixed known weaknesses rather than copying them:

| Original | Here |
| --- | --- |
| `parseJsonResponse` with `/\{[\s\S]*\}/` | Balanced-span scanner that respects string literals; takes the *first* value, not first-brace-to-last-brace. |
| `coerceResponse` / `coerceJudgement` turning anything unexpected into `NI` or `null` | zod schema, `.strict()`, no coercion. A malformed response is a failed appraisal. |
| Missing evidence lowered a score | Missing evidence for a substantive answer is a schema violation. |
| A located quote was accepted as evidence whatever it said | Support check: the quote must carry vocabulary matching its answer, or the answer is demoted. |
| `fillPromptTemplate` substituting `""` for an absent variable | `fillTemplate` throws on a missing, empty or unused variable. |
| Judge with an unanchored 1–10 scale, `?? 5` on every field | Anchors per scale point, a schema, a required locus, and an explicit `judge_failed`. |
| Temperature passed per call site | `DEFAULT_TEMPERATURE` by task kind. |
| Article text interpolated into the system prompt | Article text only ever in the user message, inside a nonce-delimited data block. |
| `gwetAC1` with no interval | Cluster bootstrap by article, plus coverage and a common-answered comparison. |
| Sliding-window Levenshtein over the whole text | Windows anchored on shared tokens. |

Not carried over at all: database access, billing and usage metering, the
prompt registry, provider routing and fallback cascades, caching breakpoints,
persistence, and every deployment-specific detail.

## Sources

Sterne JAC, Savović J, Page MJ, et al. RoB 2: a revised tool for assessing risk
of bias in randomised trials. *BMJ* 2019;366:l4898.
doi:[10.1136/bmj.l4898](https://doi.org/10.1136/bmj.l4898)

Gwet KL. Computing inter-rater reliability and its variance in the presence of
high agreement. *Br J Math Stat Psychol* 2008;61:29–48.

This is not an official Cochrane product and is not endorsed by Cochrane.
