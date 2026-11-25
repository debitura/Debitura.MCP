import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FixedWindowLimiter, clientIp } from "./rate-limit.js";

// RISK (DEB-9129): a change to the window or the IP key makes the open-tool
// limit either refuse everyone for good or refuse nobody.
describe("open-tool rate limit", () => {
  it("refuses the call over the limit, per IP, and allows again in a new window", () => {
    let t = 1_000_000;
    const limiter = new FixedWindowLimiter(3, 60_000, () => t);
    for (let i = 0; i < 3; i++) assert.equal(limiter.take("198.51.100.1"), 0);
    assert.ok(limiter.take("198.51.100.1") > 0, "4th call in the window is refused");
    assert.equal(limiter.take("198.51.100.2"), 0, "another IP is not affected");
    t += 60_000;
    assert.equal(limiter.take("198.51.100.1"), 0, "a new window allows again");
  });

  it("keys on Cloudflare's client IP, then the first forwarded address without its port", () => {
    const socket = { remoteAddress: "10.0.0.9" } as never;
    assert.equal(
      clientIp({
        headers: { "cf-connecting-ip": "203.0.113.5", "x-forwarded-for": "1.1.1.1" },
        socket,
      }),
      "203.0.113.5",
    );
    assert.equal(
      clientIp({ headers: { "x-forwarded-for": "203.0.113.7:51234, 10.0.0.1" }, socket }),
      "203.0.113.7",
    );
    assert.equal(clientIp({ headers: {}, socket }), "10.0.0.9");
  });
});
