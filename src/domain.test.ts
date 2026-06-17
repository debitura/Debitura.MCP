import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toUtcIso, sasExpiry, normalizeTimestamps, chatRoleLabel } from "./domain.js";

// ---------------------------------------------------------------------------
// toUtcIso
// ---------------------------------------------------------------------------

describe("toUtcIso", () => {
  it("appends Z to a naive datetime", () => {
    assert.equal(toUtcIso("2026-06-17T08:30:00"), "2026-06-17T08:30:00Z");
  });

  it("appends Z to a naive datetime with fractional seconds", () => {
    assert.equal(toUtcIso("2026-06-17T08:30:00.123"), "2026-06-17T08:30:00.123Z");
  });

  it("passes an already-Z value through unchanged (no double suffix)", () => {
    assert.equal(toUtcIso("2026-06-17T08:30:00Z"), "2026-06-17T08:30:00Z");
    assert.equal(toUtcIso("2026-06-17T08:30:00.500Z"), "2026-06-17T08:30:00.500Z");
  });

  it("passes a value with a numeric offset through unchanged", () => {
    assert.equal(toUtcIso("2026-06-17T08:30:00+02:00"), "2026-06-17T08:30:00+02:00");
    assert.equal(toUtcIso("2026-06-17T08:30:00-0500"), "2026-06-17T08:30:00-0500");
  });

  it("trims surrounding whitespace before deciding", () => {
    assert.equal(toUtcIso("  2026-06-17T08:30:00  "), "2026-06-17T08:30:00Z");
  });

  it("returns null for null / undefined / empty / non-string", () => {
    assert.equal(toUtcIso(null), null);
    assert.equal(toUtcIso(undefined), null);
    assert.equal(toUtcIso(""), null);
    assert.equal(toUtcIso("   "), null);
    assert.equal(toUtcIso(42), null);
    assert.equal(toUtcIso({}), null);
  });

  it("passes a date-only or unrecognised string through without inventing a zone", () => {
    assert.equal(toUtcIso("2026-06-17"), "2026-06-17");
    assert.equal(toUtcIso("not a date"), "not a date");
  });
});

// ---------------------------------------------------------------------------
// sasExpiry
// ---------------------------------------------------------------------------

describe("sasExpiry", () => {
  it("extracts and UTC-normalises the se param from a SAS-style URL", () => {
    const url =
      "https://acct.blob.core.windows.net/files/doc.pdf?sv=2022-11-02&se=2026-06-17T09%3A30%3A00Z&sr=b&sig=abc123";
    assert.equal(sasExpiry(url), "2026-06-17T09:30:00Z");
  });

  it("normalises a naive se value to UTC by appending Z", () => {
    const url = "https://acct.blob.core.windows.net/files/doc.pdf?se=2026-06-17T09%3A30%3A00&sr=b";
    assert.equal(sasExpiry(url), "2026-06-17T09:30:00Z");
  });

  it("returns null for a URL without an se param", () => {
    const url = "https://acct.blob.core.windows.net/files/doc.pdf?sv=2022-11-02&sr=b&sig=abc123";
    assert.equal(sasExpiry(url), null);
  });

  it("returns null for null / empty / non-string / unparseable", () => {
    assert.equal(sasExpiry(null), null);
    assert.equal(sasExpiry(undefined), null);
    assert.equal(sasExpiry(""), null);
    assert.equal(sasExpiry(42), null);
    assert.equal(sasExpiry("not a url"), null);
  });
});

// ---------------------------------------------------------------------------
// normalizeTimestamps
// ---------------------------------------------------------------------------

describe("normalizeTimestamps", () => {
  it("normalises naive datetimes nested in objects and arrays", () => {
    const input = {
      sentAt: "2026-06-17T08:30:00",
      items: [{ at: "2026-01-01T00:00:00.250" }],
      already: "2026-06-17T08:30:00Z",
    };
    assert.deepEqual(normalizeTimestamps(input), {
      sentAt: "2026-06-17T08:30:00Z",
      items: [{ at: "2026-01-01T00:00:00.250Z" }],
      already: "2026-06-17T08:30:00Z",
    });
  });

  it("leaves non-datetime strings, numbers, booleans, null and date-only values untouched", () => {
    const input = {
      name: "Acme GmbH",
      amount: 1234.56,
      flag: true,
      nothing: null,
      dueDate: "2026-06-17",
    };
    assert.deepEqual(normalizeTimestamps(input), input);
  });

  it("does not mutate the input object", () => {
    const input = { at: "2026-06-17T08:30:00" };
    const out = normalizeTimestamps(input);
    assert.equal(input.at, "2026-06-17T08:30:00");
    assert.notEqual(out, input);
  });
});

// ---------------------------------------------------------------------------
// chatRoleLabel
// ---------------------------------------------------------------------------

describe("chatRoleLabel", () => {
  it("maps known role ints", () => {
    assert.equal(chatRoleLabel(0, null), "Creditor");
    assert.equal(chatRoleLabel(1, null), "Partner");
    assert.equal(chatRoleLabel(2, null), "System");
  });

  it("prefers an existing label when present", () => {
    assert.equal(chatRoleLabel(0, "Custom"), "Custom");
  });

  it("falls back to Unknown for unknown / missing roles", () => {
    assert.equal(chatRoleLabel(99, null), "Unknown");
    assert.equal(chatRoleLabel(undefined, null), "Unknown");
  });
});
