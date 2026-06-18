import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createApiClient } from "./client.js";
import { registerReadTools } from "./tools/read.js";
import { registerWriteTools } from "./tools/write.js";
import { registerResources, registerPrompts } from "./resources.js";
import { SERVER_NAME, SERVER_VERSION } from "./config.js";

/**
 * Build an MCP server bound to one creditor's API key.
 * The server is stateless — a fresh instance is created per HTTP request,
 * so the key never leaks across tenants.
 */
export function buildServer(apiKey: string): McpServer {
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
      title: "Debitura — Cross-Border Debt Collection",
    },
    {
      instructions:
        "Debitura is a global debt collection platform: submit overdue B2B/B2C claims and local " +
        "collection partners in the debtor's country recover them (no-cure-no-pay). Tools operate on " +
        "the creditor account that owns the API key. Start with `ping` to verify the connection. " +
        "Use `preview_case` for pricing/eligibility before `create_case`, and never submit a case " +
        "without the user's explicit confirmation — it is a legal/financial action.",
    },
  );
  const api = createApiClient(apiKey);
  registerReadTools(server, api);
  registerWriteTools(server, api, apiKey);
  // Static domain knowledge + ready-made prompts (no API key needed — same per-request path).
  registerResources(server);
  registerPrompts(server);
  return server;
}
