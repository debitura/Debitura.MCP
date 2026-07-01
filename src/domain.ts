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
 * Per-lifecycle-stage metadata. Keyed by the exact enum NAME — which is what
 * `list_cases` accepts in its `statuses` filter and what the existing tool
 * descriptions document.
 *
 * `label` is the human text the API actually RETURNS for that stage (the enum's
 * `[Description]`, surfaced via `Lifecycle.GetDescription()`) — it can differ
 * from the enum name (e.g. NeedsAdditionalDetails → "More Info Required"), so
 * the glossary shows both: the name to filter by and the label you will see.
 * `state` is whether the case is open (Active) or finished (Closed) at that
 * stage. Mirrors `InvoicePartnerLifecycle` on the platform.
 */
export const LIFECYCLE_DESCRIPTIONS: Record<
  LifecycleValue,
  { label: string; state: "Active" | "Closed"; description: string }
> = {
  PendingContractSigning: {
    label: "Pending contract signing",
    state: "Active",
    description:
      "Submitted, but a required contract (debt collection agreement / power of attorney) is still unsigned. Recovery cannot start until signing completes.",
  },
  PendingVerificationInternal: {
    label: "Pending Verification Internal",
    state: "Active",
    description:
      "Awaiting Debitura's internal verification of the case data before it is routed to a partner.",
  },
  PendingVerification: {
    label: "Pending Verification",
    state: "Active",
    description:
      "The assigned collection partner needs additional information or verification from the creditor before proceeding.",
  },
  NeedsAdditionalDetails: {
    label: "More Info Required",
    state: "Active",
    description:
      "The case is missing details needed to proceed and is waiting on the creditor to supply them.",
  },
  Leads: {
    label: "Collecting Quotes",
    state: "Active",
    description:
      "An early-stage lead in the quoting phase — gathering quotes from the partner network, not yet an active case.",
  },
  LeadsQuoteGiven: {
    label: "Pending Quote Selection",
    state: "Active",
    description:
      "A lead for which one or more pricing quotes have been provided but not yet accepted.",
  },
  Active: {
    label: "Active",
    state: "Active",
    description:
      "Live recovery is underway — a collection partner in the debtor's country is actively pursuing the debt.",
  },
  Paused: {
    label: "Paused",
    state: "Active",
    description:
      "Recovery is temporarily on hold (e.g. awaiting instruction or an external event) and can resume.",
  },
  Closed: {
    label: "Closed",
    state: "Closed",
    description:
      "The case is finished. See the case's close code for the outcome (paid, partially paid, or written off / withdrawn).",
  },
  Merged: {
    label: "Merged",
    state: "Closed",
    description: "Folded into another case; this record is retained for history only.",
  },
};

/**
 * Close-code meanings for finished (Closed) cases.
 *
 * The Customer API serializes `closeCode` as the human-readable DESCRIPTION
 * STRING (via `InvoiceCloseCode.GetDescription()`), NOT an integer — so the
 * `label` values below are exactly what the tools return on a closed case.
 * `recovered: true` marks the only two outcomes that represent money collected
 * (Paid + Partially paid); every other code is a write-off / withdrawal /
 * never-started outcome. Do NOT count a Closed case as "collected" on the basis
 * of lifecycle alone — check the close code.
 *
 * Mirrors `InvoiceCloseCode` on the platform; obsolete legacy codes (1–5) are
 * intentionally omitted — current cases use the codes below.
 */
export const CLOSE_CODE_DESCRIPTIONS: { label: string; recovered: boolean; meaning: string }[] = [
  { label: "Paid", recovered: true, meaning: "Recovered in full — the debt was collected." },
  {
    label: "Partially paid",
    recovered: true,
    meaning: "Part of the debt was recovered; the remainder was not collected.",
  },
  {
    label: "Debtor Insolvent/Bankrupt",
    recovered: false,
    meaning: "Closed because the debtor is insolvent / bankrupt — not recovered.",
  },
  {
    label: "Debtor Untraceable",
    recovered: false,
    meaning: "Closed because the debtor could not be located — not recovered.",
  },
  {
    label: "Disputed – Legal Action Declined by Client",
    recovered: false,
    meaning: "Claim was disputed and the client declined to pursue legal action — not recovered.",
  },
  {
    label: "Withdrawn by Client",
    recovered: false,
    meaning: "Withdrawn by the creditor before recovery completed.",
  },
  {
    label: "Pre-Legal Exhausted – No Payment",
    recovered: false,
    meaning: "Pre-legal collection was exhausted without payment.",
  },
  {
    label: "Statute of Limitations Expired",
    recovered: false,
    meaning: "The claim is time-barred — not recoverable.",
  },
  {
    label: "Settlement Rejected by Client",
    recovered: false,
    meaning: "A settlement was available but the client rejected it — closed without recovery.",
  },
  {
    label: "Unresponsive Client",
    recovered: false,
    meaning: "Closed because the client did not respond when input was needed.",
  },
  {
    label: "Uneconomical to Pursue",
    recovered: false,
    meaning: "Closed because further recovery effort was not economically worthwhile.",
  },
  {
    label: "Other",
    recovered: false,
    meaning: "Closed for a reason not covered by the other codes — not recovered.",
  },
  {
    label: "Case never started",
    recovered: false,
    meaning: "The case was closed before collection began.",
  },
  {
    label: "Case never started - Internal",
    recovered: false,
    meaning: "The case was closed before collection began (internal variant).",
  },
  {
    label: "Invalid Case Data",
    recovered: false,
    meaning: "Closed because the case data was invalid.",
  },
  {
    label: "No Quotes Received",
    recovered: false,
    meaning: "A lead expired without any quotes from the partner network.",
  },
  {
    label: "Quotes Expired – Not Accepted",
    recovered: false,
    meaning: "A lead received quotes but none were accepted before expiry.",
  },
];

/**
 * Numeric ChatRole → label. The single mapping behind both `chatRoleLabel`
 * (message projection) and the chat-role glossary resource.
 *
 * Mirrors the platform `ChatRole` enum exactly: 0=Partner, 1=Creditor,
 * 2=ManagedByPartner. The Customer API sets `roleLabel` from the enum's
 * `[Description]`, so `chatRoleLabel` uses that label when present and only
 * falls back to this map when it is absent — keeping the numeric mapping in
 * lock-step with the enum.
 */
export const CHAT_ROLES: { value: number; label: string; description: string }[] = [
  {
    value: 0,
    label: "Partner",
    description: "The local collection partner in the debtor's country handling the case.",
  },
  {
    value: 1,
    label: "Creditor",
    description: "You — the creditor account that owns the API key (or your team members).",
  },
  {
    value: 2,
    label: "Managed by partner",
    description:
      "A message made by the collection partner on behalf of the creditor (partner-managed account).",
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

/**
 * Creditor-facing task types exposed by GET /tasks and GET /cases/{id}/tasks
 * (Debitura.Web.ExternalApi.Contracts.V1.Tasks). Mirrors the API's
 * `AccessLevel=Creditor` allow-list — keep in lock-step if that list changes.
 */
export const TASK_TYPE_VALUES = [
  "Generic",
  "ReplyToChat",
  "SelectQuoteWinner",
  "ReviewPartner",
  "ClientInputRequired",
  "SignContract",
  "MoreInfoNeeded",
  "AssignBankAccount",
  "CaseValidationNeedsInfo",
] as const;

export type TaskTypeValue = (typeof TASK_TYPE_VALUES)[number];

/** Valid values for the `status` filter on both task endpoints. */
export const TASK_STATUS_VALUES = ["Open", "Solved"] as const;

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
