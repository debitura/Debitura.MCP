import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildServerCard } from "./server-card.js";
import { SERVER_NAME, SERVER_VERSION } from "./config.js";

describe("server-card", () => {
  it("advertises serverInfo and that auth is required", async () => {
    const card = await buildServerCard();
    assert.deepEqual(card.serverInfo, { name: SERVER_NAME, version: SERVER_VERSION });
    assert.equal(card.authentication.required, true);
  });

  it("lists the registered tools without an API call (drift guard)", async () => {
    const card = await buildServerCard();
    const names = card.tools.map((t) => t.name);
    // A representative read tool and the flagship write tool must always be present.
    assert.ok(names.includes("ping"), "ping tool missing from card");
    assert.ok(names.includes("create_case"), "create_case tool missing from card");
    // Every tool carries the metadata a scanner needs to index it.
    for (const tool of card.tools) {
      assert.ok(tool.name, "tool missing name");
      assert.ok(tool.inputSchema, `tool ${tool.name} missing inputSchema`);
    }
  });
});
