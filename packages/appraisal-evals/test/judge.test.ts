import { describe, expect, it } from "vitest";
import {
  JUDGE_CRITERIA,
  buildJudgeSystemPrompt,
  runJudge,
  summariseJudgeOutcomes,
  type JudgeOutcome,
} from "../src/index.js";
import { ARTICLE_TEXT, stubProvider } from "./helpers.js";

const validJudgement = JSON.stringify({
  scores: Object.fromEntries(
    JUDGE_CRITERIA.map((criterion) => [
      criterion.key,
      { score: 4, evidence: "Answer 1.1 quotes the randomisation sentence." },
    ]),
  ),
  overall_comment: "Sound appraisal with one loose reading.",
});

const input = {
  articleText: ARTICLE_TEXT,
  appraisalJson: '{"overall":"Low"}',
};

describe("judge prompt", () => {
  const prompt = buildJudgeSystemPrompt();

  it("states an anchor for every point of the scale", () => {
    for (const criterion of JUDGE_CRITERIA) {
      for (const anchor of criterion.anchors) {
        expect(prompt).toContain(anchor);
      }
    }
  });

  it("names every criterion in the output shape", () => {
    for (const criterion of JUDGE_CRITERIA) {
      expect(prompt).toContain(`"${criterion.key}"`);
    }
  });

  it("carries no article text", () => {
    expect(prompt).not.toContain("Participants were randomly assigned");
  });
});

describe("runJudge", () => {
  it("returns scores for a well-formed judgement", async () => {
    const outcome = await runJudge(stubProvider(validJudgement), input);
    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") {
      expect(outcome.mean).toBeCloseTo(4, 10);
      expect(outcome.scores.evidence_fidelity!.score).toBe(4);
    }
  });

  it("fails rather than defaulting when the response is not JSON", async () => {
    const outcome = await runJudge(stubProvider("I would rather not."), input);
    expect(outcome.status).toBe("judge_failed");
    if (outcome.status === "judge_failed") {
      expect(outcome.reason).toBe("response_not_json");
    }
  });

  it("fails when a criterion is missing, instead of scoring it mid-scale", async () => {
    const partial = JSON.parse(validJudgement) as {
      scores: Record<string, unknown>;
    };
    delete partial.scores.rationale_quality;
    const outcome = await runJudge(
      stubProvider(JSON.stringify(partial)),
      input,
    );
    expect(outcome.status).toBe("judge_failed");
    if (outcome.status === "judge_failed") {
      expect(outcome.reason).toBe("response_schema_invalid");
    }
  });

  it("fails when a score is out of range", async () => {
    const outOfRange = JSON.parse(validJudgement) as {
      scores: Record<string, { score: number; evidence: string }>;
    };
    outOfRange.scores.evidence_fidelity!.score = 9;
    const outcome = await runJudge(
      stubProvider(JSON.stringify(outOfRange)),
      input,
    );
    expect(outcome.status).toBe("judge_failed");
  });

  it("fails when a score arrives with no locus", async () => {
    const noEvidence = JSON.parse(validJudgement) as {
      scores: Record<string, { score: number; evidence: string }>;
    };
    noEvidence.scores.evidence_fidelity!.evidence = "";
    const outcome = await runJudge(
      stubProvider(JSON.stringify(noEvidence)),
      input,
    );
    expect(outcome.status).toBe("judge_failed");
  });

  it("reports a provider error as judge_failed", async () => {
    const outcome = await runJudge(
      stubProvider("", { throws: new Error("HTTP 429") }),
      input,
    );
    expect(outcome.status).toBe("judge_failed");
    if (outcome.status === "judge_failed") {
      expect(outcome.reason).toBe("provider_error");
    }
  });

  it("reports a truncated judgement as judge_failed", async () => {
    const outcome = await runJudge(
      stubProvider(validJudgement, { truncated: true }),
      input,
    );
    expect(outcome.status).toBe("judge_failed");
    if (outcome.status === "judge_failed") {
      expect(outcome.reason).toBe("response_truncated");
    }
  });
});

describe("summariseJudgeOutcomes", () => {
  const ok: JudgeOutcome = {
    status: "ok",
    scores: Object.fromEntries(
      JUDGE_CRITERIA.map((c) => [c.key, { score: 4, evidence: "x" }]),
    ),
    mean: 4,
    comment: "",
    model: "stub",
  };
  const failed: JudgeOutcome = {
    status: "judge_failed",
    reason: "response_not_json",
    detail: [],
    model: "stub",
  };

  it("counts failures instead of scoring them", () => {
    const summary = summariseJudgeOutcomes([ok, failed, ok]);
    expect(summary.scored).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.mean).toBeCloseTo(4, 10);
  });

  it("reports no mean at all when every judgement failed", () => {
    const summary = summariseJudgeOutcomes([failed, failed]);
    expect(summary.mean).toBeNull();
    expect(summary.scored).toBe(0);
  });
});
