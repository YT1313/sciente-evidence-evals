import { describe, expect, it } from "vitest";
import {
  computeOverall,
  judgeDomain1,
  judgeDomain2,
  judgeDomain3,
  judgeDomain4,
  judgeDomain5,
  runRob2Algorithm,
  type Response,
  type SignallingAnswers,
} from "../src/index.js";

const answers = (pairs: Record<string, Response>): SignallingAnswers => pairs;

describe("domain 1 — randomisation", () => {
  it("is Low when the sequence is random, concealed and baseline is balanced", () => {
    expect(
      judgeDomain1(answers({ "1.1": "Y", "1.2": "Y", "1.3": "N" })).judgement,
    ).toBe("Low");
  });

  it("is High on baseline imbalance regardless of anything else", () => {
    expect(judgeDomain1(answers({ "1.3": "Y" })).judgement).toBe("High");
  });

  it("is High when there was no random sequence", () => {
    expect(judgeDomain1(answers({ "1.1": "N" })).judgement).toBe("High");
  });

  it("is Some concerns when concealment failed but the sequence was random", () => {
    expect(
      judgeDomain1(answers({ "1.1": "Y", "1.2": "N", "1.3": "N" })).judgement,
    ).toBe("Some concerns");
  });

  it("withholds a judgement and names the gap when concealment is unreported", () => {
    const result = judgeDomain1(
      answers({ "1.1": "Y", "1.2": "NI", "1.3": "N" }),
    );
    expect(result.judgement).toBeNull();
    expect(result.missingForJudgement).toEqual(["1.2"]);
  });
});

describe("domain 2 — deviations", () => {
  it("is Low when both sides were blinded and the analysis was ITT", () => {
    expect(
      judgeDomain2(answers({ "2.1": "N", "2.2": "N", "2.6": "Y" })).judgement,
    ).toBe("Low");
  });

  it("is High on an inappropriate analysis with substantial impact", () => {
    expect(judgeDomain2(answers({ "2.6": "N", "2.7": "Y" })).judgement).toBe(
      "High",
    );
  });

  it("is High on outcome-affecting deviations that were not balanced", () => {
    expect(judgeDomain2(answers({ "2.4": "Y", "2.5": "N" })).judgement).toBe(
      "High",
    );
  });

  it("does not demand branch answers that were never reached", () => {
    const result = judgeDomain2(
      answers({
        "2.1": "N",
        "2.2": "N",
        "2.3": "NA",
        "2.4": "NA",
        "2.5": "NA",
        "2.6": "Y",
        "2.7": "NA",
      }),
    );
    expect(result.missingForJudgement).toEqual([]);
  });
});

describe("domain 3 — missing outcome data", () => {
  it("is Low when data are essentially complete", () => {
    expect(judgeDomain3(answers({ "3.1": "Y" })).judgement).toBe("Low");
  });

  it("is Low when missingness is shown not to have biased the result", () => {
    expect(judgeDomain3(answers({ "3.1": "N", "3.2": "Y" })).judgement).toBe(
      "Low",
    );
  });

  it("is High when missingness depends on the true value", () => {
    expect(
      judgeDomain3(answers({ "3.1": "N", "3.2": "N", "3.3": "Y", "3.4": "Y" }))
        .judgement,
    ).toBe("High");
  });
});

describe("domain 4 — measurement", () => {
  it("is High when the measurement method was inappropriate", () => {
    expect(judgeDomain4(answers({ "4.1": "Y" })).judgement).toBe("High");
  });

  it("is Low with blinded assessors and non-differential measurement", () => {
    expect(
      judgeDomain4(answers({ "4.1": "N", "4.2": "N", "4.3": "N" })).judgement,
    ).toBe("Low");
  });

  it("is Low when assessors were aware but could not have been influenced", () => {
    expect(
      judgeDomain4(
        answers({ "4.1": "N", "4.2": "N", "4.3": "Y", "4.4": "N" }),
      ).judgement,
    ).toBe("Low");
  });

  it("is High when the assessment was likely influenced", () => {
    expect(judgeDomain4(answers({ "4.5": "Y" })).judgement).toBe("High");
  });
});

describe("domain 5 — selective reporting", () => {
  it("is Low with a pre-specified plan and no selection", () => {
    expect(
      judgeDomain5(answers({ "5.1": "Y", "5.2": "N", "5.3": "N" })).judgement,
    ).toBe("Low");
  });

  it("is High when the result was selected from several measures", () => {
    expect(judgeDomain5(answers({ "5.2": "Y" })).judgement).toBe("High");
  });
});

describe("overall", () => {
  const domain = (judgement: "Low" | "Some concerns" | "High" | null) => ({
    judgement,
    missingForJudgement: [],
  });

  it("is Low only when every domain is Low", () => {
    expect(
      computeOverall({
        d1: domain("Low"),
        d2: domain("Low"),
        d3: domain("Low"),
        d4: domain("Low"),
        d5: domain("Low"),
      }).overall,
    ).toBe("Low");
  });

  it("is High if any domain is High", () => {
    expect(
      computeOverall({
        d1: domain("Low"),
        d2: domain("High"),
        d3: domain("Low"),
        d4: domain("Low"),
        d5: domain("Low"),
      }).overall,
    ).toBe("High");
  });

  it("is High when three or more domains raise some concerns", () => {
    expect(
      computeOverall({
        d1: domain("Some concerns"),
        d2: domain("Some concerns"),
        d3: domain("Some concerns"),
        d4: domain("Low"),
        d5: domain("Low"),
      }).overall,
    ).toBe("High");
  });

  it("withholds a verdict when a domain could not be judged", () => {
    const result = computeOverall({
      d1: domain(null),
      d2: domain("Low"),
      d3: domain("Low"),
      d4: domain("Low"),
      d5: domain("Low"),
    });
    expect(result.overall).toBeNull();
    expect(result.requireFullText).toBe(true);
  });
});

describe("softFail", () => {
  const nearlyComplete = answers({
    "1.1": "Y",
    "1.2": "NI",
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
  });

  it("is off by default, leaving the domain unjudged", () => {
    expect(runRob2Algorithm(nearlyComplete).domains.d1.judgement).toBeNull();
  });

  it("reports Some concerns when most of the domain was answered", () => {
    const result = runRob2Algorithm(nearlyComplete, { softFail: true });
    expect(result.domains.d1.judgement).toBe("Some concerns");
    expect(result.domains.d1.softFailApplied).toBe(true);
    expect(result.domains.d1.missingForJudgement).toEqual(["1.2"]);
  });

  it("never converts a High or a Low", () => {
    const high = runRob2Algorithm(answers({ "1.3": "Y" }), { softFail: true });
    expect(high.domains.d1.judgement).toBe("High");
    expect(high.domains.d1.softFailApplied).toBeUndefined();
  });

  it("does not fire when too little of the domain was answered", () => {
    const sparse = runRob2Algorithm(answers({ "1.1": "Y" }), {
      softFail: true,
    });
    expect(sparse.domains.d1.judgement).toBeNull();
  });
});
