import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isKeylessDiscoveryRequest } from "./auth-gate.js";

/**
 * Locks the API-key gate's exempt-method contract (DEB-4904). A keyless request
 * may proceed ONLY when every JSON-RPC message in the body is a discovery/
 * handshake method; anything else (notably tools/call) must still require a key.
 */
describe("isKeylessDiscoveryRequest", () => {
  const init = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {},
  };
  const toolsCall = {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "ping", arguments: {} },
  };

  it("exempts each discovery/handshake method", () => {
    for (const method of [
      "initialize",
      "notifications/initialized",
      "ping",
      "tools/list",
      "prompts/list",
      "resources/list",
      "resources/templates/list",
    ]) {
      assert.equal(
        isKeylessDiscoveryRequest({ jsonrpc: "2.0", id: 1, method }),
        true,
        `${method} should be exempt`,
      );
    }
  });

  it("requires a key for tools/call", () => {
    assert.equal(isKeylessDiscoveryRequest(toolsCall), false);
  });

  it("requires a key for any non-exempt / unknown method", () => {
    assert.equal(
      isKeylessDiscoveryRequest({ jsonrpc: "2.0", id: 1, method: "tools/unknown" }),
      false,
    );
  });

  it("exempts a batch only when every element is exempt", () => {
    assert.equal(isKeylessDiscoveryRequest([init, { ...init, id: 2 }]), true);
  });

  it("requires a key for a mixed batch (any non-exempt element)", () => {
    assert.equal(isKeylessDiscoveryRequest([init, toolsCall]), false);
  });

  it("requires a key for an empty array (no method to vouch for it)", () => {
    assert.equal(isKeylessDiscoveryRequest([]), false);
  });

  it("requires a key for malformed / non-method bodies", () => {
    assert.equal(isKeylessDiscoveryRequest({}), false);
    assert.equal(isKeylessDiscoveryRequest(null), false);
    assert.equal(isKeylessDiscoveryRequest(undefined), false);
    assert.equal(isKeylessDiscoveryRequest("initialize"), false);
    assert.equal(isKeylessDiscoveryRequest({ method: 42 }), false);
  });
});
