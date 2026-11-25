import express from "express";
import type { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildServer } from "./server.js";
import { buildServerCard, type ServerCard } from "./server-card.js";
import {
  isKeylessRequest,
  toolCallName,
  OPEN_TOOL_NAMES,
  DISCOVERY_SENTINEL_KEY,
} from "./auth-gate.js";
import { OPEN_TOOLS_RATE_LIMIT_PER_MINUTE, PORT, SERVER_VERSION } from "./config.js";
import { FixedWindowLimiter, clientIp } from "./rate-limit.js";
import { clientName, trackToolCall } from "./telemetry.js";
import { resolveCountry } from "./countries.js";

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

const openToolLimiter = new FixedWindowLimiter(OPEN_TOOLS_RATE_LIMIT_PER_MINUTE);
const MAX_EVENTS_PER_REQUEST = 20;

app.post("/mcp", async (req: Request, res: Response) => {
  const apiKey = extractApiKey(req);
  const client = clientName(req.headers["user-agent"]);
  const messages: unknown[] = Array.isArray(req.body) ? req.body : [req.body];
  const toolCalls = messages.flatMap((msg) => {
    const tool = toolCallName(msg);
    return tool === undefined ? [] : [{ tool, msg }];
  });
  // Allow the unauthenticated discovery/handshake (initialize, tools/list, …) so
  // external directories can health-check the endpoint anonymously, and the open
  // tools (DEB-9129). Every other tools/call still requires a key. Refused
  // requests are neither counted against the limit nor sent to telemetry.
  if (!apiKey && !isKeylessRequest(req.body)) {
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

  const openCalls = toolCalls.filter((c) => OPEN_TOOL_NAMES.has(c.tool)).length;
  // Rule: every open-tool call in a request counts, and a request over the
  //       limit is refused whole (429), even if it also calls a keyed tool.
  // Why: the server never validates a key, so exempting batches that carry a
  //      keyed tool would let anyone send a dummy key plus thousands of open
  //      calls; no real client mixes the two in one batch.
  // Breaks if: open calls are left uncounted for any request shape.
  const retryAfter = openCalls > 0 ? openToolLimiter.take(clientIp(req), openCalls) : 0;
  // Rule: at most MAX_EVENTS_PER_REQUEST telemetry events per HTTP request.
  // Why: a batch can hold thousands of tools/call messages (40 MB body limit);
  //      one event each would flood App Insights and the single worker's sockets.
  // Breaks if: events are sent per message without the cap, or before the gate.
  for (const { tool, msg } of toolCalls.slice(0, MAX_EVENTS_PER_REQUEST)) {
    const open = OPEN_TOOL_NAMES.has(tool);
    const args = (msg as { params?: { arguments?: { country?: unknown } } }).params?.arguments;
    trackToolCall({
      // Rule: only tool-shaped names (^[a-z0-9_]{1,64}$) reach the event; anything else is "invalid".
      // Why: the caller chooses the name, and events must carry no free text a
      //      person could put personal data in.
      // Breaks if: the raw name is recorded.
      tool: /^[a-z0-9_]{1,64}$/.test(tool) ? tool : "invalid",
      client,
      authenticated: apiKey !== undefined,
      rateLimited: retryAfter > 0 && open,
      country: open
        ? (resolveCountry(typeof args?.country === "string" ? args.country : undefined)?.alpha2 ??
          "unresolved")
        : undefined,
    });
  }

  if (retryAfter > 0) {
    res.setHeader("Retry-After", String(retryAfter));
    res.status(429).json({
      jsonrpc: "2.0",
      error: { code: -32029, message: "Too many requests: try again in a minute." },
      id: null,
    });
    return;
  }

  // Stateless mode: fresh server + transport per request, bound to this key.
  // Keyless requests get a sentinel key that never reaches the Customer API: no
  // keyed tool handler runs for them, and the open tools never use the key.
  const server = buildServer(apiKey ?? DISCOVERY_SENTINEL_KEY, { client });
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

app.listen(PORT, () => {
  console.log(`Debitura MCP server listening on :${PORT} (POST /mcp)`);
});
