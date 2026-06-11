import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stripRestSentences, translateErrorBody } from "./results.js";

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
