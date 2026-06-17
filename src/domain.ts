/**
 * Shared domain constants and pure helpers used across tools and resources.
 *
 * This is the single source of truth for the case-lifecycle enum and the
 * chat-role mapping. The read tools consume them for validation/projection and
 * the MCP resources (src/resources.ts) render them into human glossaries — so
 * the published domain knowledge can never drift from what the tools actually
 * accept and return.
 */

/**
 * Valid lifecycle enum values (InvoicePartnerLifecycle).
 * These are the values the API accepts for Statuses filtering and returns as lifecycle labels.
 */
export const LIFECYCLE_VALUES = [
  "PendingContractSigning",
  "PendingVerificationInternal",
  "PendingVerification",
  "NeedsAdditionalDetails",
  "Leads",
  "LeadsQuoteGiven",
  "Active",
  "Paused",
  "Closed",
  "Merged",
] as const;

export type LifecycleValue = (typeof LIFECYCLE_VALUES)[number];

/**
 * Human-readable descriptions of each lifecycle stage, plus whether the case is
 * still open (Active) or finished (Closed) at that stage. Keyed by the exact
 * enum value the API emits, so the glossary stays in lock-step with the enum.
 */
export const LIFECYCLE_DESCRIPTIONS: Record<
  LifecycleValue,
  { state: "Active" | "Closed"; description: string }
> = {
  PendingContractSigning: {
    state: "Active",
    description:
      "Submitted, but a required contract (debt collection agreement / power of attorney) is still unsigned. Recovery cannot start until signing completes.",
  },
  PendingVerificationInternal: {
    state: "Active",
    description:
      "Awaiting Debitura's internal verification of the case data before it is routed to a partner.",
  },
  PendingVerification: {
    state: "Active",
    description:
      "The assigned collection partner needs additional information or verification from the creditor before proceeding.",
  },
  NeedsAdditionalDetails: {
    state: "Active",
    description:
      "The case is missing details needed to proceed and is waiting on the creditor to supply them.",
  },
  Leads: {
    state: "Active",
    description: "An early-stage lead that has not yet been converted into an active case.",
  },
  LeadsQuoteGiven: {
    state: "Active",
    description: "A lead for which a pricing quote has been provided but not yet accepted.",
  },
  Active: {
    state: "Active",
    description:
      "Live recovery is underway — a collection partner in the debtor's country is actively pursuing the debt.",
  },
  Paused: {
    state: "Active",
    description:
      "Recovery is temporarily on hold (e.g. awaiting instruction or an external event) and can resume.",
  },
  Closed: {
    state: "Closed",
    description:
      "The case is finished. See the case's close code for the outcome (paid, partially paid, or written off / withdrawn).",
  },
  Merged: {
    state: "Closed",
    description: "Folded into another case; this record is retained for history only.",
  },
};

/**
 * Close-code meanings for finished (Closed) cases. Only `Paid` (0) and
 * `PartiallyPaid` (9) represent money recovered; every other code is a
 * write-off / withdrawal outcome. Mirrors Invoice.CloseCode on the platform.
 */
export const CLOSE_CODE_DESCRIPTIONS: { code: number; name: string; meaning: string }[] = [
  { code: 0, name: "Paid", meaning: "Recovered in full — the debt was collected." },
  {
    code: 9,
    name: "PartiallyPaid",
    meaning: "Part of the debt was recovered; the remainder was not collected.",
  },
  {
    code: 1,
    name: "WrittenOff",
    meaning: "Closed without recovery — written off (e.g. uneconomical to pursue).",
  },
  {
    code: 2,
    name: "Bankrupt",
    meaning: "Closed because the debtor is insolvent / bankrupt — not recovered.",
  },
  {
    code: 3,
    name: "Untraceable",
    meaning: "Closed because the debtor could not be located — not recovered.",
  },
  {
    code: 4,
    name: "Withdrawn",
    meaning: "Withdrawn by the creditor before recovery completed.",
  },
  {
    code: 5,
    name: "Disputed",
    meaning: "Closed as disputed — the claim was contested and not collected.",
  },
];

/**
 * Numeric ChatRole → label. The single mapping behind both `chatRoleLabel`
 * (message projection) and the chat-role glossary resource.
 */
export const CHAT_ROLES: { value: number; label: string; description: string }[] = [
  {
    value: 0,
    label: "Creditor",
    description: "You — the creditor account that owns the API key (or your team members).",
  },
  {
    value: 1,
    label: "Partner",
    description: "The local collection partner in the debtor's country handling the case.",
  },
  {
    value: 2,
    label: "System",
    description: "An automated Debitura platform message (status updates, notifications).",
  },
];

const CHAT_ROLE_BY_VALUE = new Map(CHAT_ROLES.map((r) => [r.value, r.label]));

/** Map a numeric ChatRole to a human-readable label. */
export function chatRoleLabel(
  role: number | undefined,
  existingLabel: string | null | undefined,
): string {
  if (existingLabel) return existingLabel;
  if (role === undefined) return "Unknown";
  return CHAT_ROLE_BY_VALUE.get(role) ?? "Unknown";
}

// ---------------------------------------------------------------------------
// Timestamp normalization (DEB-4702 C)
// ---------------------------------------------------------------------------

/** A naive `YYYY-MM-DDTHH:mm:ss` with optional fractional seconds and no zone. */
const NAIVE_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
/** Already carries a zone: trailing `Z`, or a `+hh:mm` / `-hh:mm` offset. */
const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/;

/**
 * Normalize a timestamp string to offset-aware ISO-8601 UTC.
 *
 * The Customer API stores and computes everything in UTC (the write path
 * already serializes with a trailing `Z`), but several read endpoints serialize
 * the same instants *naively* — `2026-06-17T08:30:00` with no zone — which is
 * ambiguous to a client. This appends `Z` to a naive value so it is
 * unambiguously UTC. Values that already carry a zone (`Z` or a numeric offset)
 * pass through untouched — never double-suffixed. Null/empty/non-string → null.
 */
export function toUtcIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (HAS_ZONE.test(trimmed)) return trimmed;
  if (NAIVE_DATETIME.test(trimmed)) return `${trimmed}Z`;
  // Date-only or any other shape we don't recognise: pass through unchanged
  // rather than guessing a zone.
  return trimmed;
}

/**
 * Recursively normalize every naive-datetime string found in an arbitrary
 * JSON-ish value to offset-aware UTC (via `toUtcIso`).
 *
 * Used on the read tools that pass an upstream object through largely untouched
 * (get_case detail, timeline, payments, contract-status), so nested date fields
 * are normalized without having to enumerate every key. Only strings that look
 * like a *naive* datetime are rewritten — already-zoned timestamps, date-only
 * values, and all other strings are left exactly as-is, so non-date text can
 * never be mangled. Arrays and objects are walked; the input is not mutated.
 */
export function normalizeTimestamps<T>(value: T): T {
  if (typeof value === "string") {
    return (NAIVE_DATETIME.test(value.trim()) ? toUtcIso(value) : value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => normalizeTimestamps(v)) as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = normalizeTimestamps(v);
    }
    return out as T;
  }
  return value;
}

// ---------------------------------------------------------------------------
// SAS download URL expiry (DEB-4702 B)
// ---------------------------------------------------------------------------

/**
 * Extract the expiry instant of an Azure Blob SAS download URL.
 *
 * SAS URLs carry their expiry in the `se` (signed-expiry) query parameter as a
 * URL-encoded ISO-8601 instant, e.g. `se=2026-06-17T09%3A30%3A00Z`. Returns the
 * decoded, UTC-normalized expiry, or null when the URL is missing, has no `se`
 * parameter, or cannot be parsed. Lets a consumer caching the URL know when it
 * dies.
 */
export function sasExpiry(url: unknown): string | null {
  if (typeof url !== "string" || url === "") return null;
  let se: string | null;
  try {
    se = new URL(url).searchParams.get("se");
  } catch {
    return null;
  }
  if (!se) return null;
  // URLSearchParams already decodes %3A etc.; just normalise the zone.
  return toUtcIso(se);
}
