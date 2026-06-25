import { pathToFileURL } from "node:url";
import express from "express";
import type { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildServer } from "./server.js";
import { buildServerCard, type ServerCard } from "./server-card.js";
import { PORT, SERVER_VERSION } from "./config.js";

/**
 * Extract the creditor API key from the incoming request.
 * Accepted (in order): `XApiKey` header (matches the Customer API itself),
 * `X-Api-Key`, or `Authorization: Bearer <key>` for clients that only
 * support bearer-style auth fields.
 */
function extractApiKey(req: Request): string | undefined {
  const direct = req.headers["xapikey"] ?? req.headers["x-api-key"];
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const auth = req.headers.authorization;
  if (auth?.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    if (token) return token;
  }
  return undefined;
}

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
const KEYLESS_METHODS = new Set([
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
const DISCOVERY_SENTINEL_KEY = "discovery-no-auth";

const app = express();
// Base64 file uploads up to 25 MB → ~34 MB JSON payloads.
app.use(express.json({ limit: "40mb" }));

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok", version: SERVER_VERSION });
});

// Static server card for directory scanners (Smithery et al.) that can't complete
// an authenticated tools/list scan. Built once on first request and cached — it's
// derived purely from the registered tool/resource/prompt set, so it never changes
// at runtime. See src/server-card.ts.
let cardPromise: Promise<ServerCard> | undefined;
app.get("/.well-known/mcp/server-card.json", async (_req, res) => {
  try {
    cardPromise ??= buildServerCard();
    res.json(await cardPromise);
  } catch (err) {
    cardPromise = undefined; // let the next request retry
    console.error("Failed to build server card:", err);
    res.status(500).json({ error: "Failed to build server card" });
  }
});

app.post("/mcp", async (req: Request, res: Response) => {
  const apiKey = extractApiKey(req);
  // Allow the unauthenticated discovery/handshake (initialize, tools/list, …) so
  // external directories can health-check the endpoint anonymously. Everything
  // else — notably tools/call — still requires a key.
  if (!apiKey && !isKeylessDiscoveryRequest(req.body)) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: {
        code: -32001,
        message:
          "Missing API key. Send your Debitura API key in the 'XApiKey' header (or 'Authorization: Bearer <key>'). Get your key at https://app.debitura.com/CreditorApiKey",
      },
      id: null,
    });
    return;
  }

  // Stateless mode: fresh server + transport per request, bound to this key.
  // Keyless discovery requests get a sentinel key that never reaches the
  // Customer API (no tool handler runs for discovery methods).
  const server = buildServer(apiKey ?? DISCOVERY_SENTINEL_KEY);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    // Plain JSON responses instead of SSE: this server is stateless and sits
    // behind the Cloudflare proxy, where buffered JSON is the robust choice.
    enableJsonResponse: true,
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP request failed:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// Stateless server: no SSE notification stream, no sessions to terminate.
const methodNotAllowed = (_req: Request, res: Response) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed. This server is stateless — POST /mcp only.",
    },
    id: null,
  });
};
app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

// Only bind the port when run as the entrypoint (node dist/index.js), not when
// imported — e.g. by unit tests that exercise the pure helpers above.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  app.listen(PORT, () => {
    console.log(`Debitura MCP server listening on :${PORT} (POST /mcp)`);
  });
}
