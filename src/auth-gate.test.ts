import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isKeylessRequest } from "./auth-gate.js";

/**
 * Locks the API-key gate's exempt-method contract (DEB-4904). A keyless request
 * may proceed ONLY when every JSON-RPC message in the body is a discovery/
 * handshake method; anything else (notably tools/call) must still require a key.
 */
describe("isKeylessRequest", () => {
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
        isKeylessRequest({ jsonrpc: "2.0", id: 1, method }),
        true,
        `${method} should be exempt`,
      );
    }
  });

  it("requires a key for tools/call", () => {
    assert.equal(isKeylessRequest(toolsCall), false);
  });

  it("requires a key for any non-exempt / unknown method", () => {
    assert.equal(isKeylessRequest({ jsonrpc: "2.0", id: 1, method: "tools/unknown" }), false);
  });

  it("exempts a batch only when every element is exempt", () => {
    assert.equal(isKeylessRequest([init, { ...init, id: 2 }]), true);
  });

  it("requires a key for a mixed batch (any non-exempt element)", () => {
    assert.equal(isKeylessRequest([init, toolsCall]), false);
  });

  // DEB-9129: the three open tools answer without a key; nothing else does.
  const openCall = (name: unknown) => ({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name, arguments: { country: "DE" } },
  });

  it("exempts tools/call of exactly the open tools, alone or batched", () => {
    for (const name of ["check_coverage", "explain_process", "start_case_link"]) {
      assert.equal(isKeylessRequest(openCall(name)), true, `${name} should be open`);
    }
    assert.equal(isKeylessRequest([init, openCall("check_coverage")]), true);
  });

  it("requires a key for keyed, unknown or near-miss tool names", () => {
    for (const name of [
      "create_case",
      "list_cases",
      "Check_Coverage",
      "check_coverage ",
      "check",
      42,
      undefined,
    ]) {
      assert.equal(isKeylessRequest(openCall(name)), false, `${String(name)} should need a key`);
    }
    assert.equal(isKeylessRequest([openCall("check_coverage"), openCall("list_cases")]), false);
  });

  it("requires a key for an empty array (no method to vouch for it)", () => {
    assert.equal(isKeylessRequest([]), false);
  });

  it("requires a key for malformed / non-method bodies", () => {
    assert.equal(isKeylessRequest({}), false);
    assert.equal(isKeylessRequest(null), false);
    assert.equal(isKeylessRequest(undefined), false);
    assert.equal(isKeylessRequest("initialize"), false);
    assert.equal(isKeylessRequest({ method: 42 }), false);
  });
});
