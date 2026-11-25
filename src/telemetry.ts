/**
 * App Insights custom events for tool calls (DEB-9129).
 *
 * Rule: one `McpToolCall` event per tools/call message, with exactly the
 *       properties tool, client, authenticated, rateLimited and (open tools
 *       only) country.
 * Why: we count tool calls per week by tool and client without storing anything
 *      about the person: no IP, no API key, no arguments or amounts.
 * Breaks if: a property is added from the request body or headers.
 *
 * Sent straight to the connection string's ingestion endpoint rather than with
 * the Application Insights SDK, so nothing is collected automatically (no
 * request headers, no IPs). No connection string → no-op.
 */

export interface ToolCallEvent {
  tool: string;
  client: string;
  authenticated: boolean;
  rateLimited: boolean;
  /** Alpha-2 or "unresolved"; only for the open tools. */
  country?: string;
}

interface Target {
  url: string;
  iKey: string;
}

export function parseConnectionString(raw: string | undefined): Target | undefined {
  if (!raw) return undefined;
  const parts = new Map(
    raw.split(";").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim().toLowerCase(), p.slice(i + 1).trim()] as const;
    }),
  );
  const iKey = parts.get("instrumentationkey");
  if (!iKey) return undefined;
  const endpoint = parts.get("ingestionendpoint") || "https://dc.services.visualstudio.com/";
  return {
    url: new URL("v2/track", endpoint.endsWith("/") ? endpoint : endpoint + "/").href,
    iKey,
  };
}

const target = parseConnectionString(process.env.APPLICATIONINSIGHTS_CONNECTION_STRING);

export function trackToolCall(event: ToolCallEvent): void {
  if (!target) return;
  const properties: Record<string, string> = {
    tool: event.tool,
    client: event.client,
    authenticated: String(event.authenticated),
    rateLimited: String(event.rateLimited),
  };
  if (event.country) properties.country = event.country;
  const envelope = {
    name: "Microsoft.ApplicationInsights.Event",
    time: new Date().toISOString(),
    iKey: target.iKey,
    tags: { "ai.cloud.role": "debitura-mcp" },
    data: { baseType: "EventData", baseData: { ver: 2, name: "McpToolCall", properties } },
  };
  void fetch(target.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([envelope]),
    signal: AbortSignal.timeout(5_000),
  }).then(
    (res) => {
      if (!res.ok) console.warn(`App Insights rejected a tool-call event: HTTP ${res.status}`);
    },
    () => console.warn("App Insights tool-call event could not be sent"),
  );
}

/**
 * A short client name from the User-Agent: "claude", "chatgpt", or the first
 * product token (letters, digits, . _ -; at most 40 characters). Used for the
 * event and as the start-case link's utm_source.
 */
export function clientName(userAgent: string | undefined): string {
  const ua = (userAgent ?? "").toLowerCase();
  if (ua.includes("claude") || ua.includes("anthropic")) return "claude";
  if (ua.includes("openai") || ua.includes("chatgpt")) return "chatgpt";
  const token = ua
    .split(/[\s/]/)[0]
    ?.replace(/[^a-z0-9._-]/g, "")
    .slice(0, 40);
  return token || "unknown";
}
