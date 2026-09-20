import { describe, expect, it } from "vitest";
import {
  levenshtein,
  normalise,
  verifyExcerpt,
  verifyExcerpts,
} from "../src/index.js";

const SOURCE =
  "Participants were randomly assigned in a 1:1 ratio using a computer-generated " +
  "sequence. Allocation was concealed with sequentially numbered, opaque, sealed " +
  "envelopes. The primary outcome was the change in HbA1c at week 24 (mean " +
  "difference 0.7 percentage points, 95% CI 0.5 to 0.9, p = 0.0003).";

describe("normalise", () => {
  it("collapses whitespace and lowercases", () => {
    expect(normalise("  Two   Words \n here ")).toBe("two words here");
  });

  it("unifies quote and dash glyphs", () => {
    expect(normalise("“quoted” — dash")).toBe('"quoted" - dash');
  });

  it("strips diacritics so composed and decomposed forms match", () => {
    expect(normalise("café")).toBe(normalise("café"));
  });
});

describe("verifyExcerpt — strict", () => {
  it("accepts an exact quote", () => {
    const result = verifyExcerpt(
      "Allocation was concealed with sequentially numbered, opaque, sealed envelopes.",
      SOURCE,
    );
    expect(result.verified).toBe(true);
    expect(result.fuzzy).toBeUndefined();
  });

  it("accepts a quote that differs only in whitespace and case", () => {
    expect(
      verifyExcerpt("allocation   was  CONCEALED with sequentially", SOURCE)
        .verified,
    ).toBe(true);
  });

  it("rejects a quote that is not in the source", () => {
    const result = verifyExcerpt(
      "Allocation was concealed by a central web-based randomisation service.",
      SOURCE,
    );
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("not_found");
  });

  it("rejects a quote too short to mean anything", () => {
    expect(verifyExcerpt("HbA1c", SOURCE)).toMatchObject({
      verified: false,
      reason: "too_short",
    });
  });

  it("rejects an empty quote", () => {
    expect(verifyExcerpt("   ", SOURCE)).toMatchObject({
      verified: false,
      reason: "empty",
    });
  });

  it("does not let a dropped confidence interval pass as exact", () => {
    // A rounded or trimmed number is exactly the kind of drift the verifier
    // exists to catch, so it must not reach the strict level.
    const result = verifyExcerpt(
      "mean difference 0.7 percentage points, 95% CI 0.5 to 1.9",
      SOURCE,
    );
    expect(result.fuzzy ?? false).toBe(result.verified);
  });
});

describe("verifyExcerpt — fuzzy", () => {
  it("accepts a small edit in a short quote, and flags it", () => {
    // "1:2" where the source says "1:1" — the kind of single-character drift
    // an OCR pass or a careless transcription produces.
    const result = verifyExcerpt(
      "Participants were randomly assigned in a 1:2 ratio using a computer-generated sequence",
      SOURCE,
    );
    expect(result.verified).toBe(true);
    expect(result.fuzzy).toBe(true);
  });

  it("accepts a reordered quote on token overlap, and flags it", () => {
    const result = verifyExcerpt(
      "sequentially numbered opaque sealed envelopes allocation was concealed with",
      SOURCE,
    );
    expect(result.verified).toBe(true);
    expect(result.fuzzy).toBe(true);
  });

  it("still rejects invented text that shares no anchor", () => {
    expect(
      verifyExcerpt(
        "Participants underwent bilateral sympathectomy before enrolment in the study.",
        SOURCE,
      ).verified,
    ).toBe(false);
  });
});

describe("verifyExcerpts", () => {
  it("counts strict and fuzzy passes separately", () => {
    const result = verifyExcerpts(
      [
        "Allocation was concealed with sequentially numbered, opaque, sealed envelopes.",
        "Participants were randomly assigned in a 1:2 ratio using a computer-generated sequence",
        "Allocation was concealed by a central web-based randomisation service.",
      ],
      SOURCE,
    );
    expect(result.total).toBe(3);
    expect(result.strictCount).toBe(1);
    expect(result.fuzzyCount).toBe(1);
    expect(result.verifiedCount).toBe(2);
  });
});

describe("levenshtein", () => {
  it("computes the usual distance", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("same", "same")).toBe(0);
  });

  it("bails out above the early-exit threshold", () => {
    expect(levenshtein("abcdefgh", "zzzzzzzz", 2)).toBe(3);
  });
});
