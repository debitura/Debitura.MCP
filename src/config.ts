/** Base URL of the Debitura Customer API this server proxies. */
export const API_BASE_URL =
  process.env.DEBITURA_API_BASE_URL ?? "https://customer-api.debitura.com";

/** Port the streamable-HTTP MCP endpoint listens on. */
export const PORT = Number(process.env.PORT ?? 3000);

export const SERVER_NAME = "debitura";
export const SERVER_VERSION = "0.1.0";
