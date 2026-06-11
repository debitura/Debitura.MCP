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

/** Matches an uppercase REST verb followed by a path. No `i` flag — avoids false-positives on natural language ("get /tmp", "put /path"). */
const REST_VERB_PATH = /\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/\S+/;

/**
 * Strip sentences containing REST verb+path references from `message`.
 *
 * Splits on ". " boundaries so dots inside email addresses and decimal numbers
 * are preserved intact. Returns null if all sentences would be stripped — the
 * caller falls back to the original message rather than emitting silence.
 */
export function stripRestSentences(message: string): string | null {
  // Split AFTER sentence-ending punctuation (. ? !) followed by whitespace.
  // Each segment retains its own terminal punctuation so rejoin is clean.
  // Dots inside tokens (emails, decimals) are not followed by whitespace, so they survive.
  const parts = message.split(/(?<=[.?!])\s+/);
  const kept = parts.filter(p => !REST_VERB_PATH.test(p));
  if (kept.length === 0) return null;
  const joined = kept.join(" ");
  // If the original ended with terminal punctuation but the joined result does not
  // (e.g. the only surviving segment lacked its own closing mark), add a period.
  const originalEndsWithPunct = /[.?!]\s*$/.test(message);
  const joinedEndsWithPunct = /[.?!]$/.test(joined);
  return originalEndsWithPunct && !joinedEndsWithPunct ? `${joined}.` : joined;
}

/**
 * Translate a Customer API error body for MCP consumption.
 *
 * If the body is a structured object with a known `error` code, the `message` field
 * is rewritten: any sentence referencing a REST endpoint is removed and replaced with
 * an MCP-appropriate recovery hint (e.g. "Use the `list_team_members` tool…").
 *
 * For unknown error codes the REST-endpoint sentences are still stripped so no raw
 * REST path leaks through to an MCP agent that cannot act on it. If stripping would
 * produce an empty message the original is preserved — failing toward more information.
 */
export function translateErrorBody(body: unknown): unknown {
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
  const hasRestRef = REST_VERB_PATH.test(originalMessage);

  if (!hasRestRef && !mcpHint) {
    return body;
  }

  let translatedMessage: string;
  if (hasRestRef) {
    const stripped = stripRestSentences(originalMessage);
    if (stripped === null) {
      // All sentences referenced REST endpoints — avoid emitting an empty message.
      // Fall back to the MCP hint alone (if known) or the original text.
      translatedMessage = mcpHint ?? originalMessage;
    } else {
      const base = stripped.endsWith(".") ? stripped : `${stripped}.`;
      translatedMessage = mcpHint ? `${base} ${mcpHint}` : stripped;
    }
  } else {
    // No REST ref to strip — append the hint to the existing message
    const base = originalMessage.endsWith(".") ? originalMessage : `${originalMessage}.`;
    translatedMessage = `${base} ${mcpHint}`;
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
