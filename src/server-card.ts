import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { buildServer } from "./server.js";
import { SERVER_NAME, SERVER_VERSION } from "./config.js";

/**
 * Static "server card" served at `/.well-known/mcp/server-card.json`.
 *
 * This server requires an API key on every request, so directory scanners
 * (Smithery in particular) cannot complete an automatic `tools/list` scan —
 * they hit the auth wall and fall back to this static card to learn what the
 * server offers. See https://smithery.ai/docs/build/publish (server-card fallback).
 *
 * The card is built by introspecting a throwaway server instance over an
 * in-memory transport, so the advertised tools/resources/prompts can never drift
 * from what the live server actually registers. The placeholder API key is never
 * used to reach the Customer API: listing tools/resources/prompts returns only
 * static metadata and never invokes a tool handler.
 */
export interface ServerCard {
  serverInfo: { name: string; version: string };
  authentication: { required: boolean; schemes: string[] };
  tools: Array<{ name: string; description?: string; inputSchema: unknown }>;
  resources: Array<{ uri: string; name: string; description?: string; mimeType?: string }>;
  prompts: Array<{ name: string; description?: string; arguments?: unknown }>;
}

export async function buildServerCard(): Promise<ServerCard> {
  const server = buildServer("server-card-introspection");
  const client = new Client({ name: "debitura-mcp-server-card", version: SERVER_VERSION });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const caps = client.getServerCapabilities();
    const { tools } = await client.listTools();
    const resources = caps?.resources ? (await client.listResources()).resources : [];
    const prompts = caps?.prompts ? (await client.listPrompts()).prompts : [];
    return {
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      // API-key auth: the load-bearing signal for scanners is `required: true`,
      // which tells them to use this card instead of attempting an unauth scan.
      authentication: { required: true, schemes: ["apiKey"] },
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
      resources: resources.map((r) => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
      })),
      prompts: prompts.map((p) => ({
        name: p.name,
        description: p.description,
        arguments: p.arguments,
      })),
    };
  } finally {
    await client.close();
    await server.close();
  }
}
