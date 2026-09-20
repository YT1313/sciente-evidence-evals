import { describe, expect, it } from "vitest";
import {
  clusterBootstrapCI,
  cohenKappa,
  compareOnCommonAnswered,
  coverage,
  gwetAC1,
  pairsOf,
  percentAgreement,
  weightedKappa,
  type Observation,
  type Pair,
} from "../src/index.js";

/**
 * Hand-computed example, two categories, four pairs, three agreements.
 *   p_o = 0.75
 *   Cohen: p_e = 0.75·0.5 + 0.25·0.5 = 0.5  → kappa = 0.5
 *   Gwet:  pi_a = 0.625, pi_b = 0.375, sum pi(1-pi) = 0.46875
 *          p_e = (2 / (4 - 2)) · 0.46875 = 0.46875 → AC1 ≈ 0.5294
 */
const HAND: Pair[] = [
  { cluster: "c1", a: "a", b: "a" },
  { cluster: "c1", a: "a", b: "a" },
  { cluster: "c2", a: "b", b: "b" },
  { cluster: "c2", a: "a", b: "b" },
];

describe("basic statistics", () => {
  it("computes percent agreement", () => {
    expect(percentAgreement(HAND)).toBeCloseTo(0.75, 10);
  });

  it("computes Cohen's kappa", () => {
    expect(cohenKappa(HAND, ["a", "b"])).toBeCloseTo(0.5, 10);
  });

  it("computes Gwet's AC1", () => {
    expect(gwetAC1(HAND, ["a", "b"])).toBeCloseTo(0.5294117647, 8);
  });

  it("returns NaN for an empty sample rather than a misleading 1", () => {
    expect(Number.isNaN(percentAgreement([]))).toBe(true);
    expect(Number.isNaN(cohenKappa([]))).toBe(true);
    expect(Number.isNaN(gwetAC1([]))).toBe(true);
  });
});

describe("the kappa paradox", () => {
  it("AC1 stays high on a skewed sample where kappa collapses", () => {
    // 38 of 40 agreements, but almost everything is category "Low".
    const pairs: Pair[] = [];
    for (let i = 0; i < 38; i++) {
      pairs.push({ cluster: `c${i}`, a: "Low", b: "Low" });
    }
    pairs.push({ cluster: "c38", a: "High", b: "Low" });
    pairs.push({ cluster: "c39", a: "Low", b: "High" });

    const cats = ["Low", "High"];
    expect(percentAgreement(pairs)).toBeCloseTo(0.95, 10);
    expect(cohenKappa(pairs, cats)).toBeLessThan(0.1);
    expect(gwetAC1(pairs, cats)).toBeGreaterThan(0.9);
  });
});

describe("weighted kappa", () => {
  it("treats an adjacent disagreement as less severe than an extreme one", () => {
    const cats = ["Low", "Some concerns", "High"];
    const adjacent: Pair[] = [
      { cluster: "c1", a: "Low", b: "Some concerns" },
      { cluster: "c2", a: "Low", b: "Low" },
      { cluster: "c3", a: "High", b: "High" },
    ];
    const extreme: Pair[] = [
      { cluster: "c1", a: "Low", b: "High" },
      { cluster: "c2", a: "Low", b: "Low" },
      { cluster: "c3", a: "High", b: "High" },
    ];
    expect(weightedKappa(adjacent, "quadratic", cats)).toBeGreaterThan(
      weightedKappa(extreme, "quadratic", cats),
    );
  });

  it("uses the declared category order, not alphabetical order", () => {
    const pairs: Pair[] = [
      { cluster: "c1", a: "Low", b: "Some concerns" },
      { cluster: "c2", a: "High", b: "High" },
      { cluster: "c3", a: "Low", b: "Low" },
    ];
    const ordinal = weightedKappa(pairs, "quadratic", [
      "Low",
      "Some concerns",
      "High",
    ]);
    const alphabetical = weightedKappa(pairs, "quadratic"); // High, Low, Some…
    expect(ordinal).not.toBeCloseTo(alphabetical, 6);
  });
});

describe("cluster bootstrap", () => {
  const clustered: Pair[] = [];
  for (let article = 0; article < 20; article++) {
    // Whole articles agree or disagree together — the dependence that a
    // domain-level bootstrap would ignore.
    const agree = article % 5 !== 0;
    for (let domain = 0; domain < 5; domain++) {
      clustered.push({
        cluster: `article-${article}`,
        a: agree ? "Low" : "High",
        b: "Low",
      });
    }
  }
  const cats = ["Low", "High"];

  it("brackets the point estimate", () => {
    const ci = clusterBootstrapCI(clustered, (s) => gwetAC1(s, cats));
    expect(ci.low).toBeLessThanOrEqual(ci.point);
    expect(ci.high).toBeGreaterThanOrEqual(ci.point);
    expect(ci.iterations).toBeGreaterThan(0);
  });

  it("is reproducible for a given seed", () => {
    const a = clusterBootstrapCI(clustered, (s) => gwetAC1(s, cats));
    const b = clusterBootstrapCI(clustered, (s) => gwetAC1(s, cats));
    expect(a).toEqual(b);
  });

  it("is wider than a bootstrap that ignores clustering", () => {
    const perDomain = clustered.map((p, i) => ({ ...p, cluster: `unit-${i}` }));
    const clusterCI = clusterBootstrapCI(clustered, (s) => gwetAC1(s, cats));
    const naiveCI = clusterBootstrapCI(perDomain, (s) => gwetAC1(s, cats));
    expect(clusterCI.high - clusterCI.low).toBeGreaterThan(
      naiveCI.high - naiveCI.low,
    );
  });

  it("declines to invent an interval from a single cluster", () => {
    const single = clustered.filter((p) => p.cluster === "article-1");
    const ci = clusterBootstrapCI(single, (s) => gwetAC1(s, cats));
    expect(Number.isNaN(ci.low)).toBe(true);
    expect(ci.iterations).toBe(0);
  });
});

describe("coverage and the common answered set", () => {
  const strict: Observation[] = [
    { cluster: "a1", unit: "a1::d1", value: "Low", reference: "Low" },
    { cluster: "a1", unit: "a1::d2", value: null, reference: "High" },
    { cluster: "a2", unit: "a2::d1", value: "High", reference: "High" },
    { cluster: "a2", unit: "a2::d2", value: null, reference: "Low" },
  ];
  const eager: Observation[] = [
    { cluster: "a1", unit: "a1::d1", value: "Low", reference: "Low" },
    { cluster: "a1", unit: "a1::d2", value: "Low", reference: "High" },
    { cluster: "a2", unit: "a2::d1", value: "High", reference: "High" },
    { cluster: "a2", unit: "a2::d2", value: "High", reference: "Low" },
  ];

  it("reports coverage over the full set", () => {
    expect(coverage(strict)).toBeCloseTo(0.5, 10);
    expect(coverage(eager)).toBeCloseTo(1, 10);
  });

  it("drops pairs where either side is missing", () => {
    expect(pairsOf(strict)).toHaveLength(2);
  });

  it("compares systems only on units all of them answered", () => {
    const result = compareOnCommonAnswered(
      { strict, eager },
      { categories: ["Low", "High"] },
    );
    expect(result.commonUnits).toBe(2);
    expect(result.droppedUnits).toBe(2);
    for (const row of result.perSystem) {
      expect(row.n).toBe(2);
      // Both systems are right on the two units they share.
      expect(row.percentAgreement).toBeCloseTo(1, 10);
    }
    // The advantage that abstention bought is visible as coverage, not as
    // a better agreement score.
    const strictRow = result.perSystem.find((r) => r.system === "strict")!;
    const eagerRow = result.perSystem.find((r) => r.system === "eager")!;
    expect(strictRow.coverage).toBeLessThan(eagerRow.coverage);
  });
});
