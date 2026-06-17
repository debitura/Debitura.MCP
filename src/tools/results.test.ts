import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  stripRestSentences,
  translateErrorBody,
  isBusinessErrorResponse,
  renderBusinessErrors,
  apiErrorResult,
} from "./results.js";

/** Extract the single text block from a CallToolResult for assertions. */
function resultText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.map((c) => c.text ?? "").join("");
}

// ---------------------------------------------------------------------------
// stripRestSentences
// ---------------------------------------------------------------------------

describe("stripRestSentences", () => {
  it("removes the REST-hint sentence from the documented happy-path message", () => {
    const msg =
      "No active team member found with email 'bad@example.com'. Use GET /users to retrieve valid user emails.";
    assert.equal(
      stripRestSentences(msg),
      "No active team member found with email 'bad@example.com'.",
    );
  });

  it("returns null when the entire single-sentence message is a REST ref", () => {
    assert.equal(stripRestSentences("Use GET /users to retrieve valid user emails."), null);
    assert.equal(stripRestSentences("Call GET /cases first then retry"), null);
  });

  it("strips a middle sentence without losing surrounding sentences or joining them without a space", () => {
    const msg = "First problem occurred. Use POST /cases to fix. Then contact support.";
    assert.equal(stripRestSentences(msg), "First problem occurred. Then contact support.");
  });

  it("does NOT strip lowercase 'get /path' — no i flag", () => {
    const msg = "You cannot get /this path. Try again.";
    assert.equal(stripRestSentences(msg), msg.replace(/\.\s*$/, "") + ".");
    // The message is returned unchanged (no uppercase REST verb matched)
    assert.equal(stripRestSentences(msg), "You cannot get /this path. Try again.");
  });

  it("preserves email addresses containing dots", () => {
    const msg =
      "No active team member found with email 'user@host.example.com'. Use GET /users for valid emails.";
    assert.equal(
      stripRestSentences(msg),
      "No active team member found with email 'user@host.example.com'.",
    );
  });

  it("handles a message with no REST ref by returning it unchanged", () => {
    const msg = "Something went wrong. Please try again.";
    assert.equal(stripRestSentences(msg), msg);
  });

  it("treats ? and ! as sentence boundaries — preserves surrounding sentences", () => {
    // "Why?" must survive even though it shares no period boundary with the REST sentence
    const msg = "Why? Use GET /users to retry. OK!";
    assert.equal(stripRestSentences(msg), "Why? OK!");
  });

  it("adds a trailing period when the original lacked one but a sentence was stripped", () => {
    // "Bad email." keeps its period; "Use GET /users" had none but the first sentence does
    const msg = "Bad email. Use GET /users";
    assert.equal(stripRestSentences(msg), "Bad email.");
  });
});

// ---------------------------------------------------------------------------
// translateErrorBody — via the full apiErrorResult shape is tested separately;
// here we verify the translation logic directly.
// ---------------------------------------------------------------------------

describe("translateErrorBody", () => {
  it("rewrites InvalidUserEmail to reference list_team_members", () => {
    const body = {
      error: "InvalidUserEmail",
      message:
        "No active team member found with email 'bad@example.com'. Use GET /users to retrieve valid user emails.",
    };
    const result = translateErrorBody(body) as Record<string, string>;
    assert.match(result.message, /list_team_members/);
    assert.doesNotMatch(result.message, /GET \/users/);
    assert.match(result.message, /bad@example\.com/);
  });

  it("passes through non-object bodies unchanged", () => {
    assert.equal(translateErrorBody(null), null);
    assert.equal(translateErrorBody("string error"), "string error");
    assert.equal(translateErrorBody(42), 42);
  });

  it("passes through bodies without error + message fields unchanged", () => {
    const body = { signingUrl: "https://example.com/sign" };
    assert.deepEqual(translateErrorBody(body), body);
  });

  it("returns original message when entire message is REST ref and no hint is known", () => {
    // Unknown error code → no mcpHint; if stripping empties the message, fall back
    const body = { error: "UnknownCode", message: "Call GET /cases to see all cases." };
    const result = translateErrorBody(body) as Record<string, string>;
    assert.equal(result.message, "Call GET /cases to see all cases.");
  });

  it("strips REST ref and falls back to hint when stripping empties the message (known code)", () => {
    // Message is entirely the REST ref sentence — stripped → null → fall back to mcpHint
    const body = {
      error: "InvalidUserEmail",
      message: "Use GET /users to retrieve valid user emails.",
    };
    const result = translateErrorBody(body) as Record<string, string>;
    assert.match(result.message, /list_team_members/);
    assert.doesNotMatch(result.message, /GET \/users/);
  });

  it("does NOT rewrite errors whose message contains only lowercase verbs", () => {
    const body = { error: "SomeError", message: "You cannot get /this path." };
    const result = translateErrorBody(body) as Record<string, string>;
    assert.equal(result.message, "You cannot get /this path.");
  });

  it("appends hint to message when no REST ref present but error code is known", () => {
    // Future-compat: API may drop the GET /users sentence; hint should still appear
    const body = {
      error: "InvalidUserEmail",
      message: "No active team member found with email 'bad@example.com'.",
    };
    const result = translateErrorBody(body) as Record<string, string>;
    assert.match(result.message, /list_team_members/);
    assert.match(result.message, /bad@example\.com/);
  });
});

// ---------------------------------------------------------------------------
// isBusinessErrorResponse
// ---------------------------------------------------------------------------

describe("isBusinessErrorResponse", () => {
  it("detects a non-empty businessErrors array", () => {
    assert.equal(isBusinessErrorResponse({ businessErrors: [{ type: "X" }] }), true);
  });

  it("rejects empty / missing / non-array businessErrors and non-objects", () => {
    assert.equal(isBusinessErrorResponse({ businessErrors: [] }), false);
    assert.equal(isBusinessErrorResponse({ message: "legacy" }), false);
    assert.equal(isBusinessErrorResponse({ businessErrors: "oops" }), false);
    assert.equal(isBusinessErrorResponse(null), false);
    assert.equal(isBusinessErrorResponse("string"), false);
    assert.equal(isBusinessErrorResponse([{ type: "X" }]), false);
  });
});

// ---------------------------------------------------------------------------
// renderBusinessErrors
// ---------------------------------------------------------------------------

describe("renderBusinessErrors", () => {
  it("renders message, stable code, and a mapped recovery hint as next step", () => {
    const out = renderBusinessErrors({
      businessErrors: [{ type: "DuplicateCreditorReference", message: "Already exists." }],
    });
    assert.match(out, /Already exists\./);
    assert.match(out, /\[DuplicateCreditorReference\]/);
    assert.match(out, /Next step:/);
    assert.match(out, /get_case/);
  });

  it("surfaces the combined signing URL prominently at the top", () => {
    const out = renderBusinessErrors({
      businessErrors: [{ type: "MissingDebtCollectionContract", message: "Sign first." }],
      signingHandoff: { combinedSigningUrl: "https://app.debitura.com/sign/abc" },
    });
    const firstLine = out.split("\n")[0];
    assert.match(firstLine, /ACTION REQUIRED/);
    assert.match(out, /https:\/\/app\.debitura\.com\/sign\/abc/);
  });

  it("includes per-error solutionUrl in the next step", () => {
    const out = renderBusinessErrors({
      businessErrors: [
        { type: "MissingPowerOfAttorney", message: "PoA missing.", solutionUrl: "https://x/poa" },
      ],
    });
    assert.match(out, /https:\/\/x\/poa/);
  });

  it("renders unknown codes with message + code and no fabricated hint", () => {
    const out = renderBusinessErrors({
      businessErrors: [{ type: "SomethingNew", message: "Unexpected." }],
    });
    assert.match(out, /Unexpected\. \[SomethingNew\]/);
    assert.doesNotMatch(out, /Next step:/);
  });

  it("maps UnsupportedCountry/Currency to a preview_case eligibility hint", () => {
    const out = renderBusinessErrors({
      businessErrors: [{ type: "UnsupportedCountry", message: "Country not supported." }],
    });
    assert.match(out, /preview_case/);
  });

  it("suppresses the generic hint for codes a caller overlay already handles", () => {
    const body = {
      businessErrors: [
        { type: "DuplicateCreditorReference", message: "Dup.", solutionUrl: "https://x/dup" },
      ],
    };
    const out = renderBusinessErrors(body, new Set(["DuplicateCreditorReference"]));
    // The generic "use get_case" hint is dropped (the overlay restates it)...
    assert.doesNotMatch(out, /get_case/);
    // ...but the solutionUrl is data, not advice — it stays.
    assert.match(out, /https:\/\/x\/dup/);
    // Unsuppressed codes keep their generic hint.
    const out2 = renderBusinessErrors(body);
    assert.match(out2, /get_case/);
  });
});

// ---------------------------------------------------------------------------
// apiErrorResult — structured vs legacy paths
// ---------------------------------------------------------------------------

describe("apiErrorResult", () => {
  it("renders a structured 422 business-error body", () => {
    const result = apiErrorResult(422, {
      businessErrors: [{ type: "DuplicateCreditorReference", message: "Dup." }],
    });
    assert.equal(result.isError, true);
    const text = resultText(result);
    assert.match(text, /HTTP 422/);
    assert.match(text, /business rule violation/);
    assert.match(text, /\[DuplicateCreditorReference\]/);
  });

  it("appends extraGuidance below the rendered business errors", () => {
    const result = apiErrorResult(
      422,
      { businessErrors: [{ type: "DuplicateCreditorReference", message: "Dup." }] },
      "Call get_case with creditorReference \"INV-1\".",
    );
    const text = resultText(result);
    assert.match(text, /INV-1/);
  });

  it("renders legacy/unstructured bodies exactly as before (no businessErrors)", () => {
    const result = apiErrorResult(401, { error: "Unauthorized", message: "Bad key." });
    const text = resultText(result);
    assert.match(text, /Debitura API error \(HTTP 401\)/);
    assert.match(text, /API key was rejected/);
    assert.doesNotMatch(text, /business rule violation/);
  });

  it("keeps the legacy 422 hint when the body has no businessErrors", () => {
    const result = apiErrorResult(422, { message: "Some legacy validation text." });
    const text = resultText(result);
    assert.match(text, /business validation error/);
    assert.match(text, /Some legacy validation text\./);
  });
});
