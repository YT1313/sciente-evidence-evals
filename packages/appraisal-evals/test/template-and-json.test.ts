import { describe, expect, it } from "vitest";
import {
  JsonExtractionError,
  TemplateError,
  extractJson,
  fillTemplate,
  placeholdersOf,
} from "../src/index.js";

describe("fillTemplate", () => {
  const template = "Title: {{title}}\nText: {{text}}";

  it("substitutes every placeholder", () => {
    expect(fillTemplate(template, { title: "T", text: "X" })).toBe(
      "Title: T\nText: X",
    );
  });

  it("throws when a placeholder has no value", () => {
    expect(() => fillTemplate(template, { title: "T" })).toThrow(TemplateError);
  });

  it("throws when a value is empty — the loudest failure is the useful one", () => {
    try {
      fillTemplate(template, { title: "T", text: "   " });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(TemplateError);
      expect((error as TemplateError).details.empty).toEqual(["text"]);
    }
  });

  it("allows an empty value only when the caller says the field is optional", () => {
    expect(
      fillTemplate(template, { title: "T", text: "" }, { allowEmpty: ["text"] }),
    ).toBe("Title: T\nText: ");
  });

  it("throws when a supplied value is never used", () => {
    try {
      fillTemplate(template, { title: "T", text: "X", stale: "?" });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as TemplateError).details.unused).toEqual(["stale"]);
    }
  });

  it("does not rescan substituted values for placeholders", () => {
    expect(fillTemplate("{{a}}", { a: "{{b}}" })).toBe("{{b}}");
  });

  it("lists placeholders, tolerating inner whitespace", () => {
    expect(placeholdersOf("{{ a }} {{b}} {{a}}").sort()).toEqual(["a", "b"]);
  });
});

describe("extractJson", () => {
  it("parses a bare object", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses a fenced object", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("takes the first balanced object when there is a preamble and a postscript", () => {
    // The greedy `/\{[\s\S]*\}/` alternative would span from the first brace
    // to the brace in the closing sentence and fail to parse.
    const raw = 'Here is the result:\n{"a":1}\nHope that helps {see above}.';
    expect(extractJson(raw)).toEqual({ a: 1 });
  });

  it("is not confused by braces inside strings", () => {
    expect(extractJson('{"note":"a } brace","a":1}')).toEqual({
      note: "a } brace",
      a: 1,
    });
  });

  it("is not confused by an escaped quote before a brace", () => {
    expect(extractJson('{"note":"he said \\"} \\" then left","a":2}')).toEqual({
      note: 'he said "} " then left',
      a: 2,
    });
  });

  it("takes the first of two objects rather than welding them together", () => {
    expect(extractJson('{"a":1}\n{"a":2}')).toEqual({ a: 1 });
  });

  it("throws when there is no JSON at all", () => {
    expect(() => extractJson("I could not complete this task.")).toThrow(
      JsonExtractionError,
    );
  });
});
