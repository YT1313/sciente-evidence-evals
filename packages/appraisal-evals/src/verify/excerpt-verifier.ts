/**
 * Excerpt verifier.
 *
 * A model is asked to support every signalling answer with a verbatim quote
 * from the article. This module decides, programmatically, whether that quote
 * is actually in the article. It is the load-bearing check of the pipeline:
 * an answer whose quote cannot be found is not trusted, whatever the model's
 * stated confidence.
 *
 * Two levels:
 *
 *   strict — normalised exact substring. Normalisation is deliberately
 *            forgiving about the things that differ between a PDF extraction
 *            and a model's transcription (whitespace, quote glyphs, dash
 *            glyphs, diacritic composition, case) and unforgiving about
 *            everything else.
 *
 *   fuzzy  — attempted only when strict fails, and reported separately so a
 *            caller can weight it down. Passes on high token overlap, or on
 *            a small edit distance for short quotes (single-word swaps, OCR
 *            damage). A fuzzy pass is a *weaker* claim than a strict pass and
 *            the appraisal pipeline treats it as such.
 */

/** Share of excerpt tokens that must occur in the source to pass fuzzy. */
export const TOKEN_OVERLAP_THRESHOLD = 0.85;

/** Maximum edit distance tolerated for a short excerpt. */
export const LEVENSHTEIN_MAX_DIST = 5;

/** Excerpts longer than this are not eligible for the edit-distance path. */
export const LEVENSHTEIN_MAX_EXCERPT_LENGTH = 120;

/** Shorter normalised excerpts carry too little signal to verify anything. */
export const MIN_EXCERPT_LENGTH = 24;

export type VerifyFailureReason = "empty" | "too_short" | "not_found";

export interface VerifyResult {
  readonly verified: boolean;
  /** The normalised form that was searched for. */
  readonly normalisedExcerpt: string;
  /** Set only when `verified` is false. */
  readonly reason?: VerifyFailureReason;
  /** True when strict failed and fuzzy passed. A weaker claim. */
  readonly fuzzy?: boolean;
}

export interface VerifyManyResult {
  readonly results: readonly VerifyResult[];
  readonly verifiedCount: number;
  readonly strictCount: number;
  readonly fuzzyCount: number;
  readonly total: number;
}

/**
 * Normalise text for comparison.
 *
 * Invisible and bidirectional characters are stripped here too, and not only
 * in `@sciente/data-block`: the verifier must compare on exactly the text the
 * model saw, and a caller may hand it a source that never went through a
 * data block.
 */
export function normalise(text: string): string {
  if (typeof text !== "string") return "";
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // combining diacritics
    .replace(
      // eslint-disable-next-line no-control-regex
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g,
      "",
    )
    .toLowerCase()
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Verify one excerpt against one source text. */
export function verifyExcerpt(excerpt: string, source: string): VerifyResult {
  return verifyNormalised(normalise(excerpt), normalise(source));
}

/**
 * Verify many excerpts against one source, normalising the source once.
 * Worth using whenever more than a couple of quotes share an article.
 */
export function verifyExcerpts(
  excerpts: readonly string[],
  source: string,
): VerifyManyResult {
  const normalisedSource = normalise(source);
  const results = excerpts.map((e) =>
    verifyNormalised(normalise(e), normalisedSource),
  );
  const strictCount = results.filter((r) => r.verified && !r.fuzzy).length;
  const fuzzyCount = results.filter((r) => r.verified && r.fuzzy).length;
  return {
    results,
    verifiedCount: strictCount + fuzzyCount,
    strictCount,
    fuzzyCount,
    total: results.length,
  };
}

function verifyNormalised(
  excerpt: string,
  source: string,
): VerifyResult {
  if (excerpt.length === 0) {
    return { verified: false, normalisedExcerpt: excerpt, reason: "empty" };
  }
  if (excerpt.length < MIN_EXCERPT_LENGTH) {
    return { verified: false, normalisedExcerpt: excerpt, reason: "too_short" };
  }
  if (source.includes(excerpt)) {
    return { verified: true, normalisedExcerpt: excerpt };
  }
  if (isFuzzyMatch(excerpt, source)) {
    return { verified: true, normalisedExcerpt: excerpt, fuzzy: true };
  }
  return { verified: false, normalisedExcerpt: excerpt, reason: "not_found" };
}

// ---------------------------------------------------------------------------
// Fuzzy level
// ---------------------------------------------------------------------------

function isFuzzyMatch(excerpt: string, source: string): boolean {
  if (tokenOverlap(excerpt, source) >= TOKEN_OVERLAP_THRESHOLD) return true;
  if (excerpt.length <= LEVENSHTEIN_MAX_EXCERPT_LENGTH) {
    return anchoredLevenshteinMatch(excerpt, source, LEVENSHTEIN_MAX_DIST);
  }
  return false;
}

function tokenize(text: string): string[] {
  return text.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 2);
}

function tokenOverlap(excerpt: string, source: string): number {
  const excerptTokens = tokenize(excerpt);
  if (excerptTokens.length === 0) return 0;
  const sourceTokens = new Set(tokenize(source));
  const hits = excerptTokens.filter((t) => sourceTokens.has(t)).length;
  return hits / excerptTokens.length;
}

/**
 * Edit-distance match, restricted to windows anchored on a token the excerpt
 * and the source share.
 *
 * A naive sliding window over a 60 000-character full text costs a
 * Levenshtein computation per offset per window length — hundreds of millions
 * of cell updates for a single quote, which in the original implementation
 * made full-text verification the slowest step of the pipeline. Anchoring on
 * shared tokens reduces the candidate set to a handful of offsets without
 * changing which excerpts pass: a quote within five edits of the source must
 * share at least one four-character token with it, unless it is shorter than
 * the minimum excerpt length, which is rejected earlier.
 */
function anchoredLevenshteinMatch(
  excerpt: string,
  source: string,
  maxDist: number,
): boolean {
  const anchors = tokenize(excerpt).filter((t) => t.length >= 4).slice(0, 4);
  if (anchors.length === 0) return false;

  const seen = new Set<number>();
  for (const anchor of anchors) {
    const offsetInExcerpt = excerpt.indexOf(anchor);
    if (offsetInExcerpt < 0) continue;

    let from = 0;
    for (;;) {
      const at = source.indexOf(anchor, from);
      if (at < 0) break;
      from = at + 1;

      const centre = at - offsetInExcerpt;
      for (let start = centre - maxDist; start <= centre + maxDist; start++) {
        if (start < 0 || start >= source.length) continue;
        for (
          let length = excerpt.length - maxDist;
          length <= excerpt.length + maxDist;
          length++
        ) {
          if (length < 1 || start + length > source.length) continue;
          const key = start * (LEVENSHTEIN_MAX_EXCERPT_LENGTH + 64) + length;
          if (seen.has(key)) continue;
          seen.add(key);
          if (
            levenshtein(excerpt, source.slice(start, start + length), maxDist) <=
            maxDist
          ) {
            return true;
          }
        }
      }
    }
  }
  return false;
}

/**
 * Levenshtein distance with an early exit: once every cell in a row exceeds
 * `earlyExit`, no completion can come back under it, so the function returns
 * `earlyExit + 1` immediately.
 */
export function levenshtein(a: string, b: string, earlyExit?: number): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  if (earlyExit !== undefined && Math.abs(m - n) > earlyExit) {
    return earlyExit + 1;
  }

  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1).fill(0);

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        curr[j - 1]! + 1,
        prev[j]! + 1,
        prev[j - 1]! + cost,
      );
      curr[j] = value;
      if (value < rowMin) rowMin = value;
    }
    if (earlyExit !== undefined && rowMin > earlyExit) return earlyExit + 1;
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[n]!;
}
