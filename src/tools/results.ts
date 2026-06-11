import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Wrap successful API data as a JSON text result. */
export function jsonResult(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

/** Wrap a plain text message as a result. */
export function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

/**
 * Maps structured API error codes to MCP-appropriate recovery hints.
 * These replace any REST endpoint references in the upstream error message
 * so that MCP agents receive actionable guidance for this protocol.
 *
 * Key: `error` field from the Customer API error response (stable code, not message text).
 * Value: replacement hint appended after the scrubbed error message.
 */
const MCP_RECOVERY_HINTS: Record<string, string> = {
  InvalidUserEmail: "Use the `list_team_members` tool to retrieve valid team member emails.",
};

/**
 * Matches a sentence (or sentence fragment) containing a REST verb + path reference,
 * e.g. "Use GET /users to retrieve valid user emails." or "See POST /cases for details."
 * The sentence boundary is a period, end-of-string, or the start of the next sentence
 * (capital letter following whitespace).
 */
const REST_SENTENCE_PATTERN = /[^.]*\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/\S+[^.]*\.?\s*/gi;

/**
 * Translate a Customer API error body for MCP consumption.
 *
 * If the body is a structured object with a known `error` code, the `message` field
 * is rewritten: any sentence referencing a REST endpoint is removed and replaced with
 * an MCP-appropriate recovery hint (e.g. "Use the `list_team_members` tool…").
 *
 * For unknown error codes the REST-endpoint sentences are still stripped so no raw
 * REST path leaks through to an MCP agent that cannot act on it.
 */
function translateErrorBody(body: unknown): unknown {
  if (body === null || body === undefined || typeof body !== "object" || Array.isArray(body)) {
    return body;
  }

  const errorObj = body as Record<string, unknown>;
  const errorCode = typeof errorObj.error === "string" ? errorObj.error : null;
  const originalMessage = typeof errorObj.message === "string" ? errorObj.message : null;

  if (!errorCode || !originalMessage) {
    return body;
  }

  const mcpHint = MCP_RECOVERY_HINTS[errorCode];

  // Strip sentences that contain REST verb+path references.
  // Reset the regex lastIndex before each use (global flag retains state across calls).
  REST_SENTENCE_PATTERN.lastIndex = 0;
  const hasRestRef = REST_SENTENCE_PATTERN.test(originalMessage);
  REST_SENTENCE_PATTERN.lastIndex = 0;

  if (!hasRestRef && !mcpHint) {
    // Nothing to rewrite — return the original body unchanged
    return body;
  }

  // Build the translated message:
  // • If there are REST references, strip them and reconstruct around the MCP hint.
  // • If there's only a hint (API message changed but error code is stable), append it.
  let translatedMessage: string;
  if (hasRestRef) {
    // Remove REST-referencing sentences, clean up trailing whitespace/period
    const afterStrip = originalMessage.replace(REST_SENTENCE_PATTERN, "").trim().replace(/\.\s*$/, "").trim();
    const base = afterStrip ? (afterStrip.endsWith(".") ? afterStrip : `${afterStrip}.`) : "";
    const parts = [base, mcpHint].filter(Boolean);
    translatedMessage = parts.join(" ");
  } else {
    // No REST ref to strip — just append the hint
    const base = originalMessage.endsWith(".") ? originalMessage : `${originalMessage}.`;
    translatedMessage = mcpHint ? `${base} ${mcpHint}` : originalMessage;
  }

  return { ...errorObj, message: translatedMessage };
}

/**
 * Wrap an API error as a tool error the agent can act on.
 * 422 business errors from the Customer API carry actionable payloads
 * (e.g. unsigned-contract signing URLs), so the body is passed through.
 *
 * Structured error responses (with `error` + `message` fields) are translated:
 * REST endpoint references are replaced with MCP tool names so agents get
 * actionable guidance rather than dead-end REST paths.
 */
export function apiErrorResult(status: number, body: unknown): CallToolResult {
  const translatedBody = translateErrorBody(body);
  const detail =
    translatedBody === undefined || translatedBody === null || translatedBody === ""
      ? ""
      : `\n${typeof translatedBody === "string" ? translatedBody : JSON.stringify(translatedBody, null, 2)}`;
  const hint =
    status === 401
      ? "\nThe API key was rejected. Verify the XApiKey from app.debitura.com/CreditorApiKey."
      : status === 422
        ? "\nThis is a business validation error — read the payload above; it may contain required signing URLs or duplicate-reference details."
        : "";
  return {
    isError: true,
    content: [
      { type: "text", text: `Debitura API error (HTTP ${status})${detail}${hint}` },
    ],
  };
}
