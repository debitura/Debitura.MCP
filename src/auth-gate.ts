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
 * A keyless request is allowed only if EVERY JSON-RPC message in the body is a
 * discovery/handshake method. Batched arrays are required to be fully exempt —
 * if any element is a non-exempt method, the whole request needs a key.
 */
export function isKeylessDiscoveryRequest(body: unknown): boolean {
  const isExempt = (msg: unknown): boolean =>
    typeof msg === "object" &&
    msg !== null &&
    typeof (msg as { method?: unknown }).method === "string" &&
    KEYLESS_METHODS.has((msg as { method: string }).method);
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
