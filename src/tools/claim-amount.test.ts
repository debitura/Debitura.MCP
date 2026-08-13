import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateClaimAmountAndAge } from "./claim-amount.js";

describe("validateClaimAmountAndAge", () => {
  it("accepts claim lines without a top-level amount", () => {
    assert.equal(
      validateClaimAmountAndAge(
        { claimLines: [{ dueDate: "2025-01-15", amount: 423.42 }] },
        "create",
      ),
      undefined,
    );
  });

  it("rejects claim lines combined with another principal source", () => {
    assert.match(
      validateClaimAmountAndAge(
        {
          amountToRecover: 423.42,
          claimLines: [{ dueDate: "2025-01-15", amount: 423.42 }],
        },
        "create",
      ) ?? "",
      /cannot be combined/,
    );
  });

  it("allows a creation due date but rejects a preview due date with claim lines", () => {
    const input = {
      claimLines: [{ dueDate: "2025-01-15", amount: 423.42 }],
      dueDate: "2025-01-10",
    };

    assert.equal(validateClaimAmountAndAge(input, "create"), undefined);
    assert.match(validateClaimAmountAndAge(input, "preview") ?? "", /cannot combine/);
  });
});
