import createClient, { type Client } from "openapi-fetch";
import type { paths } from "./generated/customer-api.js";
import { API_BASE_URL } from "./config.js";

export type CustomerApiClient = Client<paths>;

/**
 * Typed fetch client for the Debitura Customer API, scoped to one creditor.
 * The XApiKey header IS the tenant boundary — every request carries it.
 */
export function createApiClient(apiKey: string): CustomerApiClient {
  return createClient<paths>({
    baseUrl: API_BASE_URL,
    headers: {
      XApiKey: apiKey,
      "User-Agent": "debitura-mcp/0.1.0",
    },
  });
}
