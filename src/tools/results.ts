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
 * Wrap an API error as a tool error the agent can act on.
 * 422 business errors from the Customer API carry actionable payloads
 * (e.g. unsigned-contract signing URLs), so the body is passed through.
 */
export function apiErrorResult(status: number, body: unknown): CallToolResult {
  const detail =
    body === undefined || body === null || body === ""
      ? ""
      : `\n${typeof body === "string" ? body : JSON.stringify(body, null, 2)}`;
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
