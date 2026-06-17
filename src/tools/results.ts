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

// ---------------------------------------------------------------------------
// Structured business-error contract (POST /cases 422, etc.)
// ---------------------------------------------------------------------------

/**
 * Minimal local shape of a single business error from the Customer API
 * (`BusinessErrorApiDTO`). The API-side type carries more documentation, but
 * the MCP server only needs these fields to render an actionable line.
 */
export interface BusinessError {
  /** Stable BusinessErrorType code, e.g. "MissingDebtCollectionContract". */
  type?: string | null;
  /** Human-readable description of the error. */
  message?: string | null;
  /** URL resolving this specific error (e.g. sign a single contract). */
  solutionUrl?: string | null;
}

/**
 * Minimal local shape of `BusinessErrorResponseApiDTO`: a list of business
 * errors plus an optional combined signing hand-off URL that chains every
 * pending signing step into one entry point.
 */
export interface BusinessErrorResponse {
  businessErrors?: BusinessError[] | null;
  signingHandoff?: { combinedSigningUrl?: string | null } | null;
}

/**
 * Maps well-known `BusinessErrorType` codes to recovery hints the LLM can act
 * on with the MCP tools it already has. Used when the error itself does not
 * carry a `solutionUrl` (or in addition to it) to point the agent at the right
 * next tool. Codes not listed here fall back to the generic per-error rendering.
 *
 * NOTE: lookup is an exact, case-sensitive string match on the API's `type`
 * field. `MissingDebtCollectionContract`, `MissingPowerOfAttorney`, and
 * `NoPartnerAvailable` are present in the shipped contract; the remaining keys
 * (`DuplicateCreditorReference`, `UnsupportedCountry`, `UnsupportedCurrency`)
 * are forward-provisioned per DEB-4633 item 3 — they take effect once the
 * API-side issue emits these exact PascalCase codes. Any casing/spelling drift
 * silently falls through to the generic per-error line (graceful, not a crash),
 * so keep these strings in sync with the API as that side ships.
 */
const BUSINESS_ERROR_HINTS: Record<string, string> = {
  DuplicateCreditorReference:
    "A case with this creditorReference already exists. Use `get_case` with that creditorReference to retrieve the existing case instead of creating a duplicate.",
  MissingDebtCollectionContract:
    "The debt collection agreement (SDCA) is unsigned. Present the signing URL to the user so they can sign before retrying.",
  MissingPowerOfAttorney:
    "A Power of Attorney is unsigned. Present the signing URL to the user so they can sign before retrying.",
  UnsupportedCountry:
    "This debtor country is not currently supported. Use `preview_case` to check eligibility for the country/currency before retrying.",
  UnsupportedCurrency:
    "This currency is not currently supported. Use `preview_case` to check eligibility for the country/currency before retrying.",
  NoPartnerAvailable:
    "No collection partner is currently available for this case. Use `preview_case` to confirm eligibility before retrying.",
};

/**
 * Detect whether `body` is a structured business-error response — i.e. it
 * carries a non-empty `businessErrors[]` array. Used to decide between the
 * structured rendering path and the legacy passthrough.
 */
export function isBusinessErrorResponse(body: unknown): body is BusinessErrorResponse {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return false;
  const errors = (body as BusinessErrorResponse).businessErrors;
  return Array.isArray(errors) && errors.length > 0;
}

/**
 * Render a structured business-error response into an agent-actionable block.
 *
 * Each business error becomes a line carrying the human message, its stable
 * code, and a "Next step:" recovery hint (the mapped tool-aware hint when the
 * code is known, otherwise the per-error `solutionUrl`). When a combined
 * signing URL is present it is surfaced prominently at the top so the agent can
 * resolve every pending signing step through one link.
 *
 * `suppressHintsFor` lets a tool-specific caller (e.g. create_case) take over
 * the recovery hint for certain codes: when a code is listed, its generic
 * mapped hint is omitted so the caller's overlay is the single instruction for
 * that error. The per-error `solutionUrl` line is still rendered regardless —
 * the URL is data the agent needs, not duplicated advice.
 */
export function renderBusinessErrors(
  body: BusinessErrorResponse,
  suppressHintsFor?: ReadonlySet<string>,
): string {
  const lines: string[] = [];

  const combinedSigningUrl = body.signingHandoff?.combinedSigningUrl;
  if (combinedSigningUrl) {
    lines.push(
      `ACTION REQUIRED — signing: present this single signing link to the user to resolve all pending contracts in one flow:\n${combinedSigningUrl}`,
    );
  }

  const errors = body.businessErrors ?? [];
  for (const err of errors) {
    const code = err.type ?? "UnknownBusinessError";
    const message = err.message ?? "Business rule violation.";
    const hint =
      err.type && !suppressHintsFor?.has(err.type) ? BUSINESS_ERROR_HINTS[err.type] : undefined;

    const nextStepParts: string[] = [];
    if (hint) nextStepParts.push(hint);
    if (err.solutionUrl) nextStepParts.push(`Solution URL: ${err.solutionUrl}`);
    const nextStep = nextStepParts.length > 0 ? ` Next step: ${nextStepParts.join(" ")}` : "";

    lines.push(`- ${message} [${code}]${nextStep}`);
  }

  return lines.join("\n");
}

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
  const kept = parts.filter((p) => !REST_VERB_PATH.test(p));
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
 *
 * Structured business-error responses (a `businessErrors[]` array, e.g. the
 * POST /cases 422) are rendered into agent-actionable lines: human message +
 * stable code + a "Next step:" recovery hint, with any combined signing URL
 * surfaced prominently. `extraGuidance`, when supplied, is appended below the
 * rendered errors — used by tool-specific handlers (e.g. create_case) to add
 * context the generic renderer cannot know; `suppressHintsFor` then lets that
 * handler suppress the generic hint for the codes its overlay already covers,
 * so the agent reads one instruction per error rather than two near-duplicates.
 *
 * Other structured error responses (with `error` + `message` fields) are
 * translated: REST endpoint references are replaced with MCP tool names so
 * agents get actionable guidance rather than dead-end REST paths.
 *
 * Unstructured / legacy bodies render exactly as before — failing toward more
 * information rather than dropping anything the agent might need.
 */
export function apiErrorResult(
  status: number,
  body: unknown,
  extraGuidance?: string,
  suppressHintsFor?: ReadonlySet<string>,
): CallToolResult {
  if (isBusinessErrorResponse(body)) {
    const rendered = renderBusinessErrors(body, suppressHintsFor);
    const guidance = extraGuidance ? `\n\n${extraGuidance}` : "";
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Debitura API error (HTTP ${status}) — business rule violation:\n${rendered}${guidance}`,
        },
      ],
    };
  }

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
  const guidance = extraGuidance ? `\n${extraGuidance}` : "";
  return {
    isError: true,
    content: [
      { type: "text", text: `Debitura API error (HTTP ${status})${detail}${hint}${guidance}` },
    ],
  };
}
