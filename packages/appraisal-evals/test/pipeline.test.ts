import { describe, expect, it } from "vitest";
import {
  appraiseRob2,
  buildRob2Prompt,
  parseRob2ModelResponse,
} from "../src/index.js";
import {
  ARTICLE_TEXT,
  FOCAL_RESULT,
  modelResponse,
  stubProvider,
} from "./helpers.js";

const input = {
  id: "test-trial",
  title: "A synthetic trial",
  year: "2024",
  text: ARTICLE_TEXT,
  focalResult: FOCAL_RESULT,
};

describe("prompt assembly", () => {
  const prompt = buildRob2Prompt({
    title: input.title,
    year: input.year,
    articleText: ARTICLE_TEXT,
    focalResult: FOCAL_RESULT,
    assessmentMode: "fulltext",
  });

  it("keeps untrusted text out of the system message", () => {
    expect(prompt.system).not.toContain("Participants were randomly assigned");
    expect(prompt.system).not.toContain(input.title);
  });

  it("puts the article in the user message, inside the fence", () => {
    expect(prompt.user).toContain("Participants were randomly assigned");
    expect(prompt.user).toContain(`<data_block_${prompt.nonce}`);
    expect(prompt.user).toContain(`</data_block_${prompt.nonce}>`);
  });

  it("states the rubric, the abstention rule and the schema in the system message", () => {
    expect(prompt.system).toContain("1.1");
    expect(prompt.system).toContain("NI is a correct answer");
    expect(prompt.system).toContain('"self_confidence"');
  });
});

describe("schema validation", () => {
  it("accepts a well-formed response", () => {
    const result = parseRob2ModelResponse(modelResponse());
    expect(result.ok).toBe(true);
  });

  it("rejects a response missing a signalling question", () => {
    const raw = JSON.parse(modelResponse()) as Record<string, unknown>;
    delete (raw.signalling as Record<string, unknown>)["3.4"];
    const result = parseRob2ModelResponse(JSON.stringify(raw));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("response_schema_invalid");
  });

  it("rejects a substantive answer with no quote", () => {
    const result = parseRob2ModelResponse(
      modelResponse({
        signalling: { "1.1": { response: "Y", evidence: [] } },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.join(" ")).toContain("verbatim quote");
    }
  });

  it("rejects an invented response code instead of coercing it to NI", () => {
    const result = parseRob2ModelResponse(
      modelResponse({
        signalling: {
          "1.1": { response: "probably", evidence: ["something long enough"] },
        },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects an unrecognised top-level field", () => {
    const raw = JSON.parse(modelResponse()) as Record<string, unknown>;
    raw.overall_verdict = "Low";
    expect(parseRob2ModelResponse(JSON.stringify(raw)).ok).toBe(false);
  });

  it("reports a non-JSON response as such", () => {
    const result = parseRob2ModelResponse("I was unable to appraise this.");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("response_not_json");
  });
});

describe("appraisal", () => {
  it("produces a verdict from verified answers", async () => {
    const result = await appraiseRob2(input, {
      provider: stubProvider(modelResponse()),
    });
    expect(result.status).toBe("complete");
    expect(result.overall).toBe("Low");
    expect(result.verification.failed).toBe(0);
    expect(result.finalConfidence).toBeCloseTo(0.8, 10);
  });

  it("demotes an answer whose quote is not in the article", async () => {
    const result = await appraiseRob2(input, {
      provider: stubProvider(
        modelResponse({
          signalling: {
            "1.2": {
              response: "Y",
              evidence: [
                "Allocation was concealed by a central web-based randomisation service.",
              ],
            },
          },
        }),
      ),
    });
    expect(result.signalling["1.2"]!.evidenceVerified).toBe(false);
    expect(result.signalling["1.2"]!.response).toBe("Y");
    expect(result.signalling["1.2"]!.effectiveResponse).toBe("NI");
    // Domain 1 can no longer be Low; soft-fail reports it as Some concerns.
    expect(result.domains.d1.judgement).toBe("Some concerns");
    expect(result.overall).toBe("Some concerns");
    expect(result.verification.failed).toBe(1);
  });

  it("caps confidence at the verification rate", async () => {
    const result = await appraiseRob2(input, {
      provider: stubProvider(
        modelResponse({
          selfConfidence: 1,
          signalling: {
            "1.2": { response: "Y", evidence: ["Not a sentence in this paper at all."] },
          },
        }),
      ),
    });
    expect(result.selfConfidence).toBe(1);
    expect(result.finalConfidence).toBeLessThan(1);
    expect(result.finalConfidence).toBeLessThanOrEqual(
      result.verification.rate,
    );
  });

  it("records where the model's own verdict differs from the algorithm", async () => {
    const result = await appraiseRob2(input, {
      provider: stubProvider(
        modelResponse({ selfConfidence: 1, proposed: { d3: "High" } }),
      ),
    });
    expect(result.domains.d3.judgement).toBe("Low");
    expect(result.disagreements.d3).toEqual({
      proposed: "High",
      algorithm: "Low",
    });
    // A disagreement costs confidence rather than changing the verdict:
    // one disagreement caps confidence at 0.9 however sure the model was.
    expect(result.finalConfidence).toBeCloseTo(0.9, 10);
  });

  it("withholds the verdict when the model reports a non-parallel design", async () => {
    const result = await appraiseRob2(input, {
      provider: stubProvider(
        modelResponse({
          designNotParallelGroup: true,
          designNote: "This is a stepped-wedge cluster trial.",
        }),
      ),
    });
    expect(result.status).toBe("withheld_design_mismatch");
    expect(result.overall).toBeNull();
    expect(result.errors[0]).toContain("stepped-wedge");
  });

  it("passes a suspected injection through to the result", async () => {
    const result = await appraiseRob2(input, {
      provider: stubProvider(
        modelResponse({
          injectionSuspected: true,
          injectionNote: "The text instructs the reviewer to assign Low risk.",
        }),
      ),
    });
    expect(result.injectionSuspected).toBe(true);
    expect(result.injectionNote).toContain("instructs the reviewer");
  });

  it("demotes an answer whose quote exists but contradicts it", async () => {
    // The quote is a real sentence from the article. Locating it succeeds.
    // Only the support check stands between this answer and a verdict.
    const result = await appraiseRob2(input, {
      provider: stubProvider(
        modelResponse({
          signalling: {
            "2.1": {
              response: "N",
              rationale: "Participants were blinded.",
              evidence: [
                "The primary analysis followed the intention-to-treat principle",
              ],
            },
          },
        }),
      ),
    });
    const item = result.signalling["2.1"]!;
    expect(item.evidenceVerified).toBe(true);
    expect(item.evidenceSupport).toBe("insufficient");
    expect(item.effectiveResponse).toBe("NI");
    expect(result.verification.uninformative).toBe(1);
  });

  it("records a contradiction distinctly from an uninformative quote", async () => {
    const result = await appraiseRob2(input, {
      provider: stubProvider(
        modelResponse({
          signalling: {
            "1.1": {
              response: "N",
              rationale: "The sequence was not random.",
              evidence: [
                "randomly assigned in a 1:1 ratio using a computer-generated random sequence",
              ],
            },
          },
        }),
      ),
    });
    expect(result.signalling["1.1"]!.evidenceSupport).toBe("contradicts");
    expect(result.signalling["1.1"]!.supportCues).toContain("random sequence");
    expect(result.verification.contradicted).toBe(1);
  });

  it("can flag instead of demote, for a caller that wants the answer kept", async () => {
    const response = modelResponse({
      signalling: {
        "2.1": {
          response: "N",
          rationale: "Participants were blinded.",
          evidence: [
            "The primary analysis followed the intention-to-treat principle",
          ],
        },
      },
    });
    const flagged = await appraiseRob2(input, {
      provider: stubProvider(response),
      supportCheck: "flag",
    });
    expect(flagged.signalling["2.1"]!.evidenceSupport).toBe("insufficient");
    expect(flagged.signalling["2.1"]!.effectiveResponse).toBe("N");

    const off = await appraiseRob2(input, {
      provider: stubProvider(response),
      supportCheck: "off",
    });
    expect(off.signalling["2.1"]!.evidenceSupport).toBe("not_checked");
    expect(off.signalling["2.1"]!.effectiveResponse).toBe("N");
  });

  it("caps confidence at the support rate", async () => {
    const result = await appraiseRob2(input, {
      provider: stubProvider(
        modelResponse({
          selfConfidence: 1,
          signalling: {
            "2.1": {
              response: "N",
              rationale: "Participants were blinded.",
              evidence: [
                "The primary analysis followed the intention-to-treat principle",
              ],
            },
          },
        }),
      ),
    });
    expect(result.finalConfidence).toBeLessThanOrEqual(
      result.verification.supportRate,
    );
    expect(result.verification.supportRate).toBeLessThan(1);
  });

  it("lets an adjudicator restore an answer the lexicon could not judge", async () => {
    const unsupported = modelResponse({
      signalling: {
        "2.1": {
          response: "N",
          rationale: "Participants were blinded.",
          evidence: [
            "The primary analysis followed the intention-to-treat principle",
          ],
        },
      },
    });

    const rescued = await appraiseRob2(input, {
      provider: stubProvider(unsupported),
      adjudicator: async () => ({
        status: "ok",
        verdict: "supports",
        reason: "The quotation does state it.",
      }),
    });
    expect(rescued.signalling["2.1"]!.evidenceSupport).toBe(
      "supports_adjudicated",
    );
    expect(rescued.signalling["2.1"]!.effectiveResponse).toBe("N");
    expect(rescued.verification.adjudicated).toBe(1);
  });

  it("never asks an adjudicator about an answer that contradicted its quote", async () => {
    let consulted = 0;
    const result = await appraiseRob2(input, {
      provider: stubProvider(
        modelResponse({
          signalling: {
            "1.1": {
              response: "N",
              rationale: "Not random.",
              evidence: [
                "randomly assigned in a 1:1 ratio using a computer-generated random sequence",
              ],
            },
          },
        }),
      ),
      adjudicator: async () => {
        consulted += 1;
        return { status: "ok", verdict: "supports", reason: "override" };
      },
    });
    expect(consulted).toBe(0);
    expect(result.signalling["1.1"]!.effectiveResponse).toBe("NI");
  });

  it("keeps the deterministic verdict when the adjudicator fails", async () => {
    const result = await appraiseRob2(input, {
      provider: stubProvider(
        modelResponse({
          signalling: {
            "2.1": {
              response: "N",
              rationale: "Participants were blinded.",
              evidence: [
                "The primary analysis followed the intention-to-treat principle",
              ],
            },
          },
        }),
      ),
      adjudicator: async () => ({ status: "failed", detail: "HTTP 500" }),
    });
    expect(result.signalling["2.1"]!.evidenceSupport).toBe("insufficient");
    expect(result.signalling["2.1"]!.effectiveResponse).toBe("NI");
  });

  it("fails loudly on a truncated response rather than scoring a fragment", async () => {
    const result = await appraiseRob2(input, {
      provider: stubProvider(modelResponse(), { truncated: true }),
    });
    expect(result.status).toBe("failed_response_invalid");
    expect(result.overall).toBeNull();
    expect(result.finalConfidence).toBe(0);
  });

  it("reports a provider error as a failed appraisal, not a null verdict", async () => {
    const result = await appraiseRob2(input, {
      provider: stubProvider("", { throws: new Error("HTTP 503") }),
    });
    expect(result.status).toBe("failed_provider_error");
    expect(result.errors[0]).toContain("503");
  });

  it("asks the provider for a deterministic score call", async () => {
    const provider = stubProvider(modelResponse());
    await appraiseRob2(input, { provider });
    expect(provider.lastRequest?.task).toBe("score");
    expect(provider.lastRequest?.temperature).toBeUndefined();
  });

  it("caps confidence for a retracted article", async () => {
    const result = await appraiseRob2(
      { ...input, retracted: true },
      { provider: stubProvider(modelResponse({ selfConfidence: 0.9 })) },
    );
    expect(result.finalConfidence).toBeLessThanOrEqual(0.5);
  });
});
