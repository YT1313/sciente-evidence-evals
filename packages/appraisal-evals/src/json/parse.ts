/**
 * Recovering JSON from a model response, without a greedy regex.
 *
 * The usual shortcut — `text.match(/\{[\s\S]*\}/)` — takes from the first
 * brace to the *last* brace in the whole response. When a model emits a
 * sentence of preamble, the JSON, and then a closing remark containing a
 * brace, that span is not valid JSON; when it emits two objects, the span
 * silently welds them together. Both failures surface much later, as a
 * confusing schema error or as a wrong field value.
 *
 * Instead: strip a code fence if there is one, try to parse the whole thing,
 * and only then scan for the first *balanced* JSON value, tracking string
 * literals and escapes so a brace inside a quoted rationale is not counted.
 */

export class JsonExtractionError extends Error {
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message);
    this.name = "JsonExtractionError";
  }
}

export function extractJson(text: string): unknown {
  const cleaned = stripCodeFence(text.trim());

  try {
    return JSON.parse(cleaned) as unknown;
  } catch {
    // fall through to the balanced scan
  }

  const candidate = firstBalancedValue(cleaned);
  if (candidate === null) {
    throw new JsonExtractionError(
      "No JSON object or array found in the model response.",
      text,
    );
  }
  try {
    return JSON.parse(candidate) as unknown;
  } catch (cause) {
    throw new JsonExtractionError(
      `Found a balanced JSON span but it did not parse: ${String(cause)}`,
      text,
    );
  }
}

function stripCodeFence(text: string): string {
  if (!text.startsWith("```")) return text;
  const firstNewline = text.indexOf("\n");
  if (firstNewline < 0) return text;
  const withoutOpen = text.slice(firstNewline + 1);
  const closing = withoutOpen.lastIndexOf("```");
  return (closing < 0 ? withoutOpen : withoutOpen.slice(0, closing)).trim();
}

/**
 * Return the first balanced `{...}` or `[...]` span, or null.
 * Braces and brackets inside string literals are ignored.
 */
function firstBalancedValue(text: string): string | null {
  const start = firstIndexOfAny(text, ["{", "["]);
  if (start < 0) return null;

  const openChar = text[start]!;
  const closeChar = openChar === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === openChar) {
      depth++;
    } else if (ch === closeChar) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function firstIndexOfAny(text: string, chars: readonly string[]): number {
  let best = -1;
  for (const ch of chars) {
    const at = text.indexOf(ch);
    if (at >= 0 && (best < 0 || at < best)) best = at;
  }
  return best;
}
