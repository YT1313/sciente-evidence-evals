/**
 * Strict prompt-template substitution.
 *
 * The permissive version of this function — substitute an empty string for
 * anything the caller forgot — is how a prompt silently loses its article
 * text, its focal result or its rubric and still produces a confident-looking
 * verdict about nothing. Every failure mode here is loud:
 *
 *  - a placeholder with no value throws;
 *  - a value that is empty or whitespace-only throws;
 *  - a value supplied but never referenced throws, because it means the
 *    template and the caller have drifted apart.
 */

export class TemplateError extends Error {
  constructor(
    message: string,
    readonly details: {
      readonly missing: readonly string[];
      readonly empty: readonly string[];
      readonly unused: readonly string[];
    },
  ) {
    super(message);
    this.name = "TemplateError";
  }
}

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

export function placeholdersOf(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER)) {
    found.add(match[1]!);
  }
  return [...found];
}

export interface FillOptions {
  /**
   * Placeholders that are allowed to receive an empty string, because the
   * field is genuinely optional (an absent publication year, for instance).
   * They must still be supplied by the caller, explicitly.
   */
  readonly allowEmpty?: readonly string[];
}

export function fillTemplate(
  template: string,
  values: Readonly<Record<string, string>>,
  options: FillOptions = {},
): string {
  const allowEmpty = new Set(options.allowEmpty ?? []);
  const required = placeholdersOf(template);

  const missing: string[] = [];
  const empty: string[] = [];
  for (const key of required) {
    const value = values[key];
    if (value === undefined || value === null) {
      missing.push(key);
      continue;
    }
    if (typeof value !== "string") {
      missing.push(key);
      continue;
    }
    if (value.trim().length === 0 && !allowEmpty.has(key)) {
      empty.push(key);
    }
  }

  const unused = Object.keys(values).filter((k) => !required.includes(k));

  if (missing.length > 0 || empty.length > 0 || unused.length > 0) {
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`missing: ${missing.join(", ")}`);
    if (empty.length > 0) parts.push(`empty: ${empty.join(", ")}`);
    if (unused.length > 0) parts.push(`unused: ${unused.join(", ")}`);
    throw new TemplateError(
      `Prompt template substitution refused (${parts.join("; ")}). ` +
        `A prompt that is silently missing its inputs still produces a ` +
        `confident answer, so this is a hard failure.`,
      { missing, empty, unused },
    );
  }

  return template.replace(PLACEHOLDER, (_match, key: string) => values[key]!);
}
