/**
 * API-key gate policy for the `/mcp` endpoint (DEB-4904).
 *
 * Pure, side-effect-free logic — kept out of index.ts (which binds the HTTP
 * port on import) so unit tests can exercise it without booting the server.
 */

/**
 * MCP discovery/handshake methods that return only static metadata (server info,
 * capabilities, tool/prompt/resource schemas) and never touch the Customer API.
 * These are exempt from the API-key gate so external directories (Glama et al.)
 * can health-check the `/mcp` handshake anonymously. Tool *execution*
 * (`tools/call`) and every data-returning method stay gated. Tool schemas are
 * already public via `/.well-known/mcp/server-card.json`, so nothing new leaks.
 *
 * INVARIANT — only add a method here if it invokes NO tool/resource/prompt
 * handler and makes NO upstream call. The API key only reaches the Customer API
 * via such a handler; adding a fetching method here would leak the sentinel key.
 * The open tools below are the one exception, and they never use the key.
 */
export const KEYLESS_METHODS = new Set([
  "initialize",
  "notifications/initialized",
  "ping",
  "tools/list",
  "prompts/list",
  "resources/list",
  "resources/templates/list",
]);

/**
 * Tools that answer without an API key (DEB-9129): coverage, the collection
 * process and the sign-up link. Their handlers call only the keyless coverage
 * estimate, through a client that never carries the caller's key
 * (src/tools/open.ts).
 */
export const OPEN_TOOL_NAMES = new Set(["check_coverage", "explain_process", "start_case_link"]);

/** The tool name of a `tools/call` message, or undefined for anything else. */
export function toolCallName(msg: unknown): string | undefined {
  if (typeof msg !== "object" || msg === null) return undefined;
  const { method, params } = msg as { method?: unknown; params?: { name?: unknown } };
  if (method !== "tools/call") return undefined;
  const name = typeof params === "object" && params !== null ? params.name : undefined;
  return typeof name === "string" ? name : undefined;
}

/**
 * Rule: a keyless request is allowed only if EVERY JSON-RPC message in the body
 *       is a discovery/handshake method or a tools/call of an open tool (exact
 *       name). A batch with any other element needs a key as a whole.
 * Why: the open tools are what ChatGPT and Claude users may call before they sign
 *      up; the 16 creditor tools stay behind the key (DEB-4904, DEB-9129).
 * Breaks if: the name match is loosened (prefix, case-insensitive) or a batch is
 *      judged by its first element only.
 */
export function isKeylessRequest(body: unknown): boolean {
  const isExempt = (msg: unknown): boolean => {
    if (typeof msg !== "object" || msg === null) return false;
    const method = (msg as { method?: unknown }).method;
    if (typeof method !== "string") return false;
    if (KEYLESS_METHODS.has(method)) return true;
    const tool = toolCallName(msg);
    return tool !== undefined && OPEN_TOOL_NAMES.has(tool);
  };
  if (Array.isArray(body)) return body.length > 0 && body.every(isExempt);
  return isExempt(body);
}

/**
 * Sentinel key used to build a server for keyless discovery requests. It never
 * reaches the Customer API: discovery methods only enumerate static schemas and
 * never invoke a tool handler (the only place the key is used). Mirrors the
 * placeholder key in src/server-card.ts.
 */
export const DISCOVERY_SENTINEL_KEY = "discovery-no-auth";
