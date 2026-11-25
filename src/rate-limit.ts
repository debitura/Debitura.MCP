import type { Request } from "express";

/**
 * Per-IP limit on the open (keyless) tools (DEB-9129).
 *
 * Rule: at most `limit` open-tool calls per client IP per fixed 60-second window.
 * Why: the open tools need no key, so nothing else stops one caller from hammering
 *      the Customer API through us. ChatGPT and Claude call from shared servers,
 *      so the limit is generous and set by OPEN_TOOLS_RATE_LIMIT_PER_MINUTE.
 * Breaks if: the counters are not reset each window (memory grows, every caller
 *      ends up limited for good), or the key is not the client IP (one caller
 *      limits everyone, or nobody is limited).
 *
 * In memory: the app runs on one App Service worker.
 */
export class FixedWindowLimiter {
  private windowStart = 0;
  private counts = new Map<string, number>();

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Count `calls` for `key`. Returns 0 when allowed, otherwise the seconds until
   * the window resets (for Retry-After). A refused request is not counted.
   */
  take(key: string, calls = 1): number {
    const t = this.now();
    if (t - this.windowStart >= this.windowMs) {
      this.windowStart = t;
      this.counts.clear();
    }
    const used = this.counts.get(key) ?? 0;
    if (used + calls > this.limit) {
      return Math.max(1, Math.ceil((this.windowStart + this.windowMs - t) / 1000));
    }
    this.counts.set(key, used + calls);
    return 0;
  }
}

/**
 * The caller's IP: Cloudflare's `CF-Connecting-IP` (mcp.debitura.com is proxied
 * by Cloudflare), else the first `X-Forwarded-For` entry without its port (Azure
 * App Service adds one), else the socket address.
 */
export function clientIp(req: Pick<Request, "headers" | "socket">): string {
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf.trim()) return cf.trim();
  const xff = req.headers["x-forwarded-for"];
  const first = (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim();
  if (first) return stripPort(first);
  return req.socket?.remoteAddress ?? "unknown";
}

function stripPort(value: string): string {
  if (value.startsWith("["))
    return value.slice(1, value.indexOf("]") > 0 ? value.indexOf("]") : undefined);
  const colons = value.split(":").length - 1;
  return colons === 1 ? value.split(":")[0] : value; // IPv4:port → IPv4; bare IPv6 stays
}
