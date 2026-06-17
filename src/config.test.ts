import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { SERVER_VERSION, SERVER_NAME, API_BASE_URL } from "./config.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string; name: string };

describe("config", () => {
  it("derives SERVER_VERSION from package.json (single source of truth)", () => {
    assert.equal(SERVER_VERSION, pkg.version);
    assert.match(SERVER_VERSION, /^\d+\.\d+\.\d+/);
  });

  it("exposes a stable server name", () => {
    assert.equal(SERVER_NAME, "debitura");
  });

  it("defaults the API base URL to production", () => {
    // No DEBITURA_API_BASE_URL set in the test env.
    assert.equal(API_BASE_URL, "https://customer-api.debitura.com");
  });
});
