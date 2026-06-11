import express from "express";
import type { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildServer } from "./server.js";
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

const app = express();
// Base64 file uploads up to 25 MB → ~34 MB JSON payloads.
app.use(express.json({ limit: "40mb" }));

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok", version: SERVER_VERSION });
});

app.post("/mcp", async (req: Request, res: Response) => {
  const apiKey = extractApiKey(req);
  if (!apiKey) {
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
  const server = buildServer(apiKey);
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
    error: { code: -32000, message: "Method not allowed. This server is stateless — POST /mcp only." },
    id: null,
  });
};
app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

app.listen(PORT, () => {
  console.log(`Debitura MCP server listening on :${PORT} (POST /mcp)`);
});
