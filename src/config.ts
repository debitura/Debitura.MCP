import { createRequire } from "node:module";

// Single source of truth for the version: package.json. Imported via createRequire
// so it works under "module": "Node16" without a JSON import assertion, and resolves
// from the package root whether running from src/ (tsx) or dist/.
const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

/** Base URL of the Debitura Customer API this server proxies. */
export const API_BASE_URL =
  process.env.DEBITURA_API_BASE_URL ?? "https://customer-api.debitura.com";

/** Port the streamable-HTTP MCP endpoint listens on. */
export const PORT = Number(process.env.PORT ?? 3000);

export const SERVER_NAME = "debitura";
/** Derived from package.json — the single source of truth for the version. */
export const SERVER_VERSION: string = pkg.version;

/**
 * Base URL of the creditor app the `start_case_link` tool links to (DEB-9129).
 * Test: https://testapp.debitura.com
 */
export const APP_BASE_URL = process.env.DEBITURA_APP_BASE_URL ?? "https://app.debitura.com";

/** Open-tool calls allowed per client IP per minute (DEB-9129). */
export const OPEN_TOOLS_RATE_LIMIT_PER_MINUTE = positiveInt(
  process.env.OPEN_TOOLS_RATE_LIMIT_PER_MINUTE,
  60,
);

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}
