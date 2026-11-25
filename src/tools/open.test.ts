import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSignupUrl } from "./open.js";

// RISK (DEB-9129): a renamed claim_*/utm_* parameter silently stops MCP sign-ups
// from being prefilled (DEB-8074) or counted.
describe("start-case sign-up link", () => {
  const base = "https://app.debitura.com";

  it("carries DEB-8074's claim parameters and the MCP UTM tags", () => {
    const url = new URL(
      buildSignupUrl(
        { country: "DE", amount: 15000, currency: "eur", debtorType: "Company" },
        "claude",
        base,
      ),
    );
    assert.equal(url.origin + url.pathname, "https://app.debitura.com/Onboarding");
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      claim_country: "DE",
      claim_amount: "15000",
      claim_currency: "EUR",
      claim_debtor: "Company",
      utm_source: "claude",
      utm_medium: "mcp",
      utm_campaign: "start_case",
    });
  });
});
