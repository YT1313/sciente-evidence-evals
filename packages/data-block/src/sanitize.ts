/**
 * Unicode sanitisation for untrusted text that is about to be placed in an
 * LLM prompt.
 *
 * Two distinct jobs, deliberately kept separate:
 *
 *  - `sanitizeUnicodeForPrompt` removes characters that are invisible to a
 *    human reviewer but meaningful to a tokenizer. These carry no legitimate
 *    signal in scientific prose and are the standard carrier for "hidden
 *    instruction" attacks.
 *  - `neutralizeBoundaryForgeries` defuses text that imitates the structural
 *    markers this package emits, so the model cannot be told that the data
 *    section has ended.
 *
 * Neither function removes visible text. An attacker's instructions stay in
 * the payload verbatim; they simply stay inside the fence and stay visible to
 * anyone auditing the prompt.
 */

/**
 * Invisible and direction-controlling code points stripped from untrusted text.
 *
 * - U+0000–U+0008, U+000B, U+000C, U+000E–U+001F, U+007F–U+009F — C0/C1
 *   controls, except tab (U+0009), LF (U+000A) and CR (U+000D).
 * - U+00AD — soft hyphen.
 * - U+200B–U+200F — zero-width space/non-joiner/joiner and LRM/RLM.
 * - U+202A–U+202E — bidirectional embedding and override controls
 *   ("Trojan Source", Boucher & Anderson 2021).
 * - U+2066–U+2069 — bidirectional isolates.
 * - U+2060–U+2064 — word joiner and invisible maths operators.
 * - U+FEFF — byte-order mark / zero-width no-break space.
 * - U+FFF9–U+FFFB — interlinear annotation controls.
 * - U+E0000–U+E007F — Unicode Tags block: a full invisible ASCII alphabet,
 *   the carrier for "ASCII smuggling" prompt injection.
 */
const INVISIBLE_AND_BIDI =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\uFFF9-\uFFFB]|[\u{E0000}-\u{E007F}]/gu;

/**
 * Structural-marker imitation. Matches any opening or closing tag whose name
 * starts with `data_block`, regardless of the nonce suffix or attributes, so
 * a payload cannot forge a boundary by guessing the tag shape.
 *
 * Deliberately broader than the tags this package actually emits: matching
 * only the exact emitted tag would let `</data_block_beef>` through whenever
 * the real nonce happened to be something else, and a model reading a prompt
 * does not parse tags as strictly as a regex does.
 */
const BOUNDARY_FORGERY = /<\s*\/?\s*data_block[A-Za-z0-9_-]*/gi;

/**
 * Remove invisible and bidirectional control characters, and normalise to
 * NFKC so that compatibility variants (fullwidth, circled, ligature forms)
 * collapse onto the characters a reviewer would read.
 *
 * NFKC is applied first: normalisation can itself produce characters from the
 * stripped set (for example U+FEFF survives NFKC unchanged, but some
 * compatibility decompositions introduce spaces), so stripping afterwards is
 * the order that leaves nothing behind.
 */
export function sanitizeUnicodeForPrompt(input: string): string {
  if (typeof input !== "string" || input.length === 0) return "";
  return input.normalize("NFKC").replace(INVISIBLE_AND_BIDI, "");
}

/**
 * Defuse literal occurrences of the structural markers by inserting a space
 * after the angle bracket. The model still reads the text — which matters,
 * because an injection attempt inside an article is itself evidence worth
 * reporting — but it no longer looks like a boundary this prompt emitted.
 */
export function neutralizeBoundaryForgeries(input: string): string {
  if (typeof input !== "string" || input.length === 0) return "";
  return input.replace(BOUNDARY_FORGERY, (match) =>
    match.replace(/^</, "&lt; "),
  );
}

/**
 * Full treatment for text that will be placed inside a data block:
 * strip invisible Unicode, then neutralise boundary forgeries.
 *
 * Order matters. Stripping first prevents `<\u200B/data_block>` — which a
 * model reads as a closing tag but which the boundary regex would not match —
 * from surviving the second pass.
 */
export function safeForDataBlock(input: string): string {
  return neutralizeBoundaryForgeries(sanitizeUnicodeForPrompt(input));
}

/**
 * True when the input contains invisible/bidi characters or imitates a block
 * boundary. Callers can use this to log or surface a suspected injection
 * attempt rather than silently cleaning it.
 */
export function detectSuspiciousContent(input: string): {
  invisibleCharacters: boolean;
  boundaryForgery: boolean;
} {
  if (typeof input !== "string" || input.length === 0) {
    return { invisibleCharacters: false, boundaryForgery: false };
  }
  // Fresh lastIndex on every call: both regexes are /g and therefore stateful.
  INVISIBLE_AND_BIDI.lastIndex = 0;
  BOUNDARY_FORGERY.lastIndex = 0;
  const invisibleCharacters = INVISIBLE_AND_BIDI.test(input);
  INVISIBLE_AND_BIDI.lastIndex = 0;
  const boundaryForgery = BOUNDARY_FORGERY.test(
    sanitizeUnicodeForPrompt(input),
  );
  BOUNDARY_FORGERY.lastIndex = 0;
  return { invisibleCharacters, boundaryForgery };
}
