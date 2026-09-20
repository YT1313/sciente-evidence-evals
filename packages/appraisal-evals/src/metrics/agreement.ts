/**
 * Agreement metrics for categorical appraisal verdicts.
 *
 * Three things this module insists on, because each is a common way to
 * publish an agreement number that does not mean what it appears to.
 *
 *  1. **Report chance-corrected agreement that survives skew.** Cochrane's
 *     Low/Some concerns/High distribution is heavily unbalanced in most
 *     samples. Cohen's kappa punishes that skew — the "kappa paradox", high
 *     observed agreement with a near-zero kappa — so Gwet's AC1 is the
 *     headline statistic and kappa is reported beside it, not instead of it.
 *  2. **Resample by article, not by domain.** Five domains from one trial
 *     are not five independent observations: a model that misreads a paper
 *     tends to misread all of it. A bootstrap over domains produces an
 *     interval that is far too narrow. The cluster bootstrap here resamples
 *     whole articles with replacement.
 *  3. **Separate coverage from accuracy.** A system that abstains on the
 *     hard half of the sample and is right on the easy half is not more
 *     accurate than one that answers everything — it is more selective.
 *     Coverage is reported alongside agreement, and comparisons between
 *     systems are restricted to the units all of them actually answered.
 */

export interface Observation {
  /** Resampling unit. The article, not the domain. */
  readonly cluster: string;
  /** Identity of the thing being judged, e.g. `article-12::d3`. */
  readonly unit: string;
  /** The system's verdict, or null when it abstained. */
  readonly value: string | null;
  /** The reference verdict, or null when the gold standard has no entry. */
  readonly reference: string | null;
}

export interface Pair {
  readonly cluster: string;
  readonly a: string;
  readonly b: string;
}

export type Weighting = "identity" | "linear" | "quadratic";

export interface Interval {
  readonly point: number;
  readonly low: number;
  readonly high: number;
  readonly iterations: number;
}

// ---------------------------------------------------------------------------
// Basic statistics
// ---------------------------------------------------------------------------

export function pairsOf(observations: readonly Observation[]): Pair[] {
  const pairs: Pair[] = [];
  for (const o of observations) {
    if (o.value === null || o.reference === null) continue;
    pairs.push({ cluster: o.cluster, a: o.value, b: o.reference });
  }
  return pairs;
}

/** Share of units where the system produced a verdict at all. */
export function coverage(observations: readonly Observation[]): number {
  if (observations.length === 0) return Number.NaN;
  const answered = observations.filter((o) => o.value !== null).length;
  return answered / observations.length;
}

export function percentAgreement(pairs: readonly Pair[]): number {
  if (pairs.length === 0) return Number.NaN;
  const hits = pairs.filter((p) => p.a === p.b).length;
  return hits / pairs.length;
}

/**
 * Cohen's kappa, optionally weighted.
 *
 * `categories` fixes the category order, which matters for linear and
 * quadratic weights: the distance between "Low" and "High" must reflect the
 * ordinal scale, not alphabetical position.
 */
export function weightedKappa(
  pairs: readonly Pair[],
  weighting: Weighting = "identity",
  categories?: readonly string[],
): number {
  if (pairs.length === 0) return Number.NaN;
  const cats = categories ?? categoriesOf(pairs);
  const { joint, marginalA, marginalB, k } = jointAndMarginals(pairs, cats);
  const w = weightMatrix(k, weighting);

  let observed = 0;
  let expected = 0;
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      observed += w[i]![j]! * joint[i]![j]!;
      expected += w[i]![j]! * marginalA[i]! * marginalB[j]!;
    }
  }
  if (1 - expected === 0) return 1;
  return (observed - expected) / (1 - expected);
}

export const cohenKappa = (
  pairs: readonly Pair[],
  categories?: readonly string[],
): number => weightedKappa(pairs, "identity", categories);

/**
 * Gwet's AC1 (and AC2 under non-identity weights).
 *
 * pe = (Tw / (K² − K)) · Σ π_k (1 − π_k), with π_k the mean of the two
 * raters' marginals for category k. Gwet, Br J Math Stat Psychol 2008;61:29.
 */
export function gwetAC(
  pairs: readonly Pair[],
  weighting: Weighting = "identity",
  categories?: readonly string[],
): number {
  if (pairs.length === 0) return Number.NaN;
  const cats = categories ?? categoriesOf(pairs);
  const { joint, marginalA, marginalB, k } = jointAndMarginals(pairs, cats);
  if (k <= 1) return 1; // degenerate: one category seen, nothing to correct
  const w = weightMatrix(k, weighting);

  let observed = 0;
  let totalWeight = 0;
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      observed += w[i]![j]! * joint[i]![j]!;
      totalWeight += w[i]![j]!;
    }
  }
  let sumPi = 0;
  for (let i = 0; i < k; i++) {
    const pi = (marginalA[i]! + marginalB[i]!) / 2;
    sumPi += pi * (1 - pi);
  }
  const expected = (totalWeight / (k * k - k)) * sumPi;
  if (1 - expected === 0) return 1;
  return (observed - expected) / (1 - expected);
}

export const gwetAC1 = (
  pairs: readonly Pair[],
  categories?: readonly string[],
): number => gwetAC(pairs, "identity", categories);

// ---------------------------------------------------------------------------
// Cluster bootstrap
// ---------------------------------------------------------------------------

export interface BootstrapOptions {
  readonly iterations?: number;
  /** Two-sided level. 0.05 gives a 95% percentile interval. */
  readonly alpha?: number;
  /** Fixed by default, so the reported interval is reproducible. */
  readonly seed?: number;
}

/**
 * Percentile bootstrap confidence interval, resampling whole clusters.
 *
 * Clusters are drawn with replacement until the same number of clusters as
 * the original sample has been drawn; all observations of a drawn cluster
 * enter the replicate together. Replicates where the statistic is not finite
 * — a resample that happens to contain a single category, say — are dropped,
 * and the count of usable replicates is reported.
 */
export function clusterBootstrapCI(
  pairs: readonly Pair[],
  statistic: (sample: readonly Pair[]) => number,
  options: BootstrapOptions = {},
): Interval {
  const iterations = options.iterations ?? 2000;
  const alpha = options.alpha ?? 0.05;
  const point = statistic(pairs);

  const byCluster = new Map<string, Pair[]>();
  for (const pair of pairs) {
    const bucket = byCluster.get(pair.cluster);
    if (bucket) bucket.push(pair);
    else byCluster.set(pair.cluster, [pair]);
  }
  const clusters = [...byCluster.values()];
  if (clusters.length < 2) {
    return { point, low: Number.NaN, high: Number.NaN, iterations: 0 };
  }

  const random = mulberry32(options.seed ?? 20260920);
  const replicates: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const sample: Pair[] = [];
    for (let c = 0; c < clusters.length; c++) {
      const picked = clusters[Math.floor(random() * clusters.length)]!;
      sample.push(...picked);
    }
    const value = statistic(sample);
    if (Number.isFinite(value)) replicates.push(value);
  }
  if (replicates.length === 0) {
    return { point, low: Number.NaN, high: Number.NaN, iterations: 0 };
  }

  replicates.sort((x, y) => x - y);
  return {
    point,
    low: percentile(replicates, alpha / 2),
    high: percentile(replicates, 1 - alpha / 2),
    iterations: replicates.length,
  };
}

// ---------------------------------------------------------------------------
// Comparison on a common answered set
// ---------------------------------------------------------------------------

export interface SystemMetrics {
  readonly system: string;
  readonly n: number;
  readonly coverage: number;
  readonly percentAgreement: number;
  readonly gwetAC1: Interval;
  readonly cohenKappa: Interval;
  readonly weightedKappa: Interval;
}

export interface ComparisonResult {
  /** Units judged by every system and present in the reference. */
  readonly commonUnits: number;
  /** Units dropped because at least one system abstained. */
  readonly droppedUnits: number;
  readonly perSystem: readonly SystemMetrics[];
}

/**
 * Compare several systems on exactly the units that all of them answered.
 *
 * Comparing each system on its own answered subset rewards abstention: the
 * system that skips the hard cases reports the better agreement. Restricting
 * to the intersection removes that incentive, and `coverage` — computed on
 * the full set, not the intersection — carries the information that was
 * removed.
 */
export function compareOnCommonAnswered(
  systems: Readonly<Record<string, readonly Observation[]>>,
  options: {
    readonly categories?: readonly string[];
    readonly bootstrap?: BootstrapOptions;
  } = {},
): ComparisonResult {
  const names = Object.keys(systems);
  if (names.length === 0) {
    return { commonUnits: 0, droppedUnits: 0, perSystem: [] };
  }

  const allUnits = new Set<string>();
  for (const name of names) {
    for (const o of systems[name]!) allUnits.add(o.unit);
  }

  const answeredEverywhere = new Set<string>();
  for (const unit of allUnits) {
    const ok = names.every((name) =>
      systems[name]!.some(
        (o) => o.unit === unit && o.value !== null && o.reference !== null,
      ),
    );
    if (ok) answeredEverywhere.add(unit);
  }

  // The category set is fixed once, over every system's pairs, so that each
  // bootstrap replicate is scored on the same scale. Deriving it per replicate
  // would let a resample that happens to miss a category change the metric.
  const allPairs = names.flatMap((name) =>
    pairsOf(systems[name]!.filter((o) => answeredEverywhere.has(o.unit))),
  );
  const categories = options.categories ?? categoriesOf(allPairs);

  const perSystem = names.map((name) => {
    const observations = systems[name]!;
    const scoped = observations.filter((o) => answeredEverywhere.has(o.unit));
    const pairs = pairsOf(scoped);
    return {
      system: name,
      n: pairs.length,
      // Coverage is deliberately computed over the FULL observation set.
      coverage: coverage(observations),
      percentAgreement: percentAgreement(pairs),
      gwetAC1: clusterBootstrapCI(
        pairs,
        (s) => gwetAC1(s, categories),
        options.bootstrap,
      ),
      cohenKappa: clusterBootstrapCI(
        pairs,
        (s) => cohenKappa(s, categories),
        options.bootstrap,
      ),
      weightedKappa: clusterBootstrapCI(
        pairs,
        (s) => weightedKappa(s, "quadratic", categories),
        options.bootstrap,
      ),
    } satisfies SystemMetrics;
  });

  return {
    commonUnits: answeredEverywhere.size,
    droppedUnits: allUnits.size - answeredEverywhere.size,
    perSystem,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function categoriesOf(pairs: readonly Pair[]): string[] {
  const set = new Set<string>();
  for (const p of pairs) {
    set.add(p.a);
    set.add(p.b);
  }
  return [...set].sort();
}

function jointAndMarginals(pairs: readonly Pair[], cats: readonly string[]) {
  const k = cats.length;
  const index = new Map(cats.map((c, i) => [c, i]));
  const joint: number[][] = Array.from({ length: k }, () =>
    new Array<number>(k).fill(0),
  );
  const n = pairs.length;
  for (const pair of pairs) {
    const i = index.get(pair.a);
    const j = index.get(pair.b);
    if (i === undefined || j === undefined) {
      throw new RangeError(
        `Observed category outside the declared set: ` +
          `${JSON.stringify([pair.a, pair.b])} not in ${JSON.stringify(cats)}`,
      );
    }
    joint[i]![j]! += 1 / n;
  }
  const marginalA = new Array<number>(k).fill(0);
  const marginalB = new Array<number>(k).fill(0);
  for (let i = 0; i < k; i++) {
    for (let j = 0; j < k; j++) {
      marginalA[i]! += joint[i]![j]!;
      marginalB[j]! += joint[i]![j]!;
    }
  }
  return { joint, marginalA, marginalB, k };
}

function weightMatrix(k: number, weighting: Weighting): number[][] {
  const w: number[][] = [];
  for (let i = 0; i < k; i++) {
    const row = new Array<number>(k);
    for (let j = 0; j < k; j++) {
      if (weighting === "identity") row[j] = i === j ? 1 : 0;
      else if (k === 1) row[j] = 1;
      else if (weighting === "linear") row[j] = 1 - Math.abs(i - j) / (k - 1);
      else row[j] = 1 - ((i - j) / (k - 1)) ** 2;
    }
    w.push(row);
  }
  return w;
}

function percentile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const position = q * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const weight = position - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

/** Small, fast, seedable PRNG. Reproducibility matters more than quality. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
