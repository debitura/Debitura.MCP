import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CustomerApiClient } from "../client.js";
import { jsonResult, textResult, apiErrorResult } from "./results.js";

const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/**
 * Valid lifecycle enum values (InvoicePartnerLifecycle).
 * These are the values the API accepts for Statuses filtering and returns as lifecycle labels.
 */
const LIFECYCLE_VALUES = [
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

/**
 * Valid sort field names accepted by the API.
 * Unknown fields are silently ignored by the API, so we validate here.
 */
const SORTABLE_FIELDS = new Set([
  "DateCreated",
  "DateUpdated",
  "DateFinished",
  "DateCollectionStarted",
  "DueDate",
  "Date",
  "GrossAmount",
  "Remainder",
  "InterestFees",
  "CollectionFees",
]);

/** Map a numeric ChatRole to a human-readable label. */
function chatRoleLabel(role: number | undefined, existingLabel: string | null | undefined): string {
  if (existingLabel) return existingLabel;
  switch (role) {
    case 0: return "Creditor";
    case 1: return "Partner";
    case 2: return "System";
    default: return "Unknown";
  }
}

/** Project a full InvoiceDto down to a compact summary for list_cases. */
function projectCaseSummary(c: Record<string, unknown>): Record<string, unknown> {
  const debtor = (c.debtor ?? {}) as Record<string, unknown>;
  const partner = (c.collectionPartner ?? {}) as Record<string, unknown>;
  return {
    id: c.id,
    reference: c.reference,
    creditorReference: c.creditorReference,
    debtorName: debtor.name,
    debtorCountry: debtor.countryAlpha2,
    grossAmount: c.grossAmount,
    currency: c.currency,
    remainder: c.remainder,
    lifecycle: c.lifecycle,
    partnerName: partner.name ?? null,
    dateCreated: c.dateCreated,
    dueDate: c.dueDate,
    isTestCase: c.isTestCase,
  };
}

/** Project a full InvoiceDto for get_case — drops the creditor block (caller IS the creditor). */
function projectCaseDetail(c: Record<string, unknown>): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { creditor, ...rest } = c;
  // Also strip surveyCadenceMode (raw numeric enum) from the collectionPartner block
  if (rest.collectionPartner && typeof rest.collectionPartner === "object") {
    const { surveyCadenceMode, ...partnerRest } = rest.collectionPartner as Record<string, unknown>;
    void surveyCadenceMode;
    rest.collectionPartner = partnerRest;
  }
  return rest;
}

export function registerReadTools(server: McpServer, api: CustomerApiClient): void {
  server.registerTool(
    "ping",
    {
      title: "Test Connection",
      description:
        "Verify the connection to Debitura and show which creditor account the API key belongs to. " +
        "Call this first to confirm the integration is set up correctly.",
      inputSchema: {},
      annotations: { title: "Test Connection", ...READ_ANNOTATIONS },
    },
    async () => {
      const { data, error, response } = await api.GET("/me");
      if (!data) return apiErrorResult(response.status, error);
      return textResult(
        `✓ Connected as ${data.companyName}` +
          (data.country ? ` (${data.country})` : "") +
          `\n\nAccount details:\n${JSON.stringify(data, null, 2)}`,
      );
    },
  );

  server.registerTool(
    "list_cases",
    {
      title: "List Cases",
      description:
        "List the creditor's debt collection cases with pagination, status filtering, and sorting. " +
        "Returns compact case summaries: reference, debtor name + country, amounts, lifecycle, partner, key dates. " +
        "Use get_case for full detail on a specific case.\n\n" +
        "Lifecycle values (statuses filter and output):\n" +
        "`PendingContractSigning` · `PendingVerificationInternal` · `PendingVerification` · " +
        "`NeedsAdditionalDetails` · `Leads` · `LeadsQuoteGiven` · `Active` · `Paused` · `Closed` · `Merged`\n\n" +
        "Sortable fields: `DateCreated` · `DateUpdated` · `DateFinished` · `DateCollectionStarted` · " +
        "`DueDate` · `Date` · `GrossAmount` · `Remainder` · `InterestFees` · `CollectionFees`\n" +
        "Sort format: `Field:asc` or `Field:desc`, e.g. `GrossAmount:desc`",
      inputSchema: {
        page: z.number().int().min(1).optional().describe("Page number, starting from 1 (default 1)"),
        pageSize: z.number().int().min(1).max(100).optional().describe("Results per page (default 10, max 100)"),
        statuses: z
          .array(z.enum(LIFECYCLE_VALUES as unknown as [string, ...string[]]))
          .optional()
          .describe(
            "Filter by lifecycle status. Values: PendingContractSigning, PendingVerificationInternal, " +
            "PendingVerification, NeedsAdditionalDetails, Leads, LeadsQuoteGiven, Active, Paused, Closed, Merged",
          ),
        sort: z
          .string()
          .optional()
          .describe(
            "Sort expression: Field:asc or Field:desc. " +
            "Valid fields: DateCreated, DateUpdated, DateFinished, DateCollectionStarted, DueDate, Date, " +
            "GrossAmount, Remainder, InterestFees, CollectionFees. Example: GrossAmount:desc",
          ),
      },
      annotations: { title: "List Cases", ...READ_ANNOTATIONS },
    },
    async ({ page, pageSize, statuses, sort }) => {
      // Validate sort field before calling the API (unknown fields are silently ignored).
      // Match case-insensitively and normalise to canonical PascalCase.
      let canonicalSort: string | undefined;
      if (sort) {
        const [rawField, direction] = sort.split(":");
        const lowerField = rawField.toLowerCase();
        const canonicalField = [...SORTABLE_FIELDS].find((f) => f.toLowerCase() === lowerField);
        if (!canonicalField) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text:
                  `Unknown sort field "${rawField}". Valid fields are: ${[...SORTABLE_FIELDS].join(", ")}. ` +
                  `Format: Field:asc or Field:desc, e.g. GrossAmount:desc`,
              },
            ],
          };
        }
        canonicalSort = direction ? `${canonicalField}:${direction}` : canonicalField;
      }

      const { data, error, response } = await api.GET("/cases", {
        params: {
          query: { Page: page, PageSize: pageSize, Statuses: statuses, Sort: canonicalSort },
        },
      });
      if (!data) return apiErrorResult(response.status, error);

      // Project to compact summaries
      const cases = (data.cases ?? []).map((c) => projectCaseSummary(c as Record<string, unknown>));
      return jsonResult({ page: data.page, cases });
    },
  );

  server.registerTool(
    "get_case",
    {
      title: "Get Case",
      description:
        "Fetch one collection case in full detail. Look it up by Debitura case ID (GUID), by your own " +
        "creditor reference (e.g. invoice number), or by the Debitura case reference shown in the portal. " +
        "Provide exactly one of the three identifiers.",
      inputSchema: {
        id: z.string().uuid().optional().describe("Debitura case ID (GUID)"),
        creditorReference: z
          .string()
          .optional()
          .describe("Your own reference for the case (e.g. invoice number)"),
        caseReference: z
          .string()
          .optional()
          .describe("Debitura case reference as shown in the portal"),
      },
      annotations: { title: "Get Case", ...READ_ANNOTATIONS },
    },
    async ({ id, caseReference, creditorReference }) => {
      const provided = [id, caseReference, creditorReference].filter(Boolean);
      if (provided.length !== 1) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Provide exactly one of: id, creditorReference, caseReference.",
            },
          ],
        };
      }
      const { data, error, response } = id
        ? await api.GET("/cases/{id}", { params: { path: { id } } })
        : creditorReference
          ? await api.GET("/cases/by-creditor-reference/{creditorReference}", {
              params: { path: { creditorReference } },
            })
          : await api.GET("/cases/case-reference/{caseReference}", {
              params: { path: { caseReference: caseReference! } },
            });
      if (!data) return apiErrorResult(response.status, error);
      return jsonResult(projectCaseDetail(data as Record<string, unknown>));
    },
  );

  server.registerTool(
    "get_case_activity",
    {
      title: "Get Case Activity",
      description:
        "Fetch the chronological timeline of a case — what has happened so far: status changes, " +
        "partner actions, communications, and payments.",
      inputSchema: {
        caseId: z.string().uuid().describe("Debitura case ID (GUID)"),
      },
      annotations: { title: "Get Case Activity", ...READ_ANNOTATIONS },
    },
    async ({ caseId }) => {
      const { data, error, response } = await api.GET("/cases/{id}/timeline", {
        params: { path: { id: caseId } },
      });
      if (!data) return apiErrorResult(response.status, error);
      return jsonResult(data);
    },
  );

  server.registerTool(
    "get_case_messages",
    {
      title: "Get Case Messages",
      description:
        "Read the chat conversation on a case between you and the collection partner handling it. " +
        "Each message includes: senderName, role (Creditor / Partner / System), sentAt, message.",
      inputSchema: {
        caseId: z.string().uuid().describe("Debitura case ID (GUID)"),
      },
      annotations: { title: "Get Case Messages", ...READ_ANNOTATIONS },
    },
    async ({ caseId }) => {
      const { data, error, response } = await api.GET("/cases/{id}/chats", {
        params: { path: { id: caseId } },
      });
      if (!data) return apiErrorResult(response.status, error);

      // Project each message — strip internal IDs, timestamps, emails
      const messages = (data as unknown[]).map((m) => {
        const msg = m as Record<string, unknown>;
        const user = (msg.user ?? {}) as Record<string, unknown>;
        const firstName = (user.firstName as string | null | undefined) ?? "";
        const lastName = (user.lastName as string | null | undefined) ?? "";
        const senderName = [firstName, lastName].filter(Boolean).join(" ") || "System";
        const rawMessage = (msg.message as string | null | undefined) ?? "";
        return {
          senderName,
          role: chatRoleLabel(msg.role as number | undefined, msg.roleLabel as string | null | undefined),
          sentAt: msg.dateCreated,
          message: rawMessage.replace(/\r\n/g, "\n").replace(/\r/g, "\n"),
        };
      });
      return jsonResult(messages);
    },
  );

  server.registerTool(
    "get_case_payments",
    {
      title: "Get Case Payments",
      description: "List every payment recorded on a case — money recovered so far.",
      inputSchema: {
        caseId: z.string().uuid().describe("Debitura case ID (GUID)"),
      },
      annotations: { title: "Get Case Payments", ...READ_ANNOTATIONS },
    },
    async ({ caseId }) => {
      const { data, error, response } = await api.GET("/cases/{id}/payments", {
        params: { path: { id: caseId } },
      });
      if (!data) return apiErrorResult(response.status, error);
      return jsonResult(data);
    },
  );

  server.registerTool(
    "get_case_contract_status",
    {
      title: "Get Case Contract Status",
      description:
        "Check which contracts (e.g. debt collection agreement, power of attorney) are signed or still " +
        "blocking a case, including signing URLs for any outstanding documents.",
      inputSchema: {
        caseId: z.string().uuid().describe("Debitura case ID (GUID)"),
      },
      annotations: { title: "Get Case Contract Status", ...READ_ANNOTATIONS },
    },
    async ({ caseId }) => {
      const { data, error, response } = await api.GET("/cases/{id}/contract-status", {
        params: { path: { id: caseId } },
      });
      if (!data) return apiErrorResult(response.status, error);
      return jsonResult(data);
    },
  );

  server.registerTool(
    "preview_case",
    {
      title: "Preview Case (Pricing & Eligibility)",
      description:
        "Dry-run a collection case BEFORE creating it: returns eligibility, the assigned collection " +
        "partner, pricing (success fee), and any contracts that would need signing. Nothing is persisted. " +
        "ALWAYS call this before create_case and show the user the pricing and requirements.",
      inputSchema: {
        amountToRecover: z
          .number()
          .positive()
          .describe("Total principal amount to recover"),
        currencyCode: z
          .string()
          .length(3)
          .describe('ISO 4217 currency code, e.g. "EUR", "USD", "DKK"'),
        debtorType: z
          .enum(["Company", "Private"])
          .describe("Company (B2B) or Private individual (B2C)"),
        debtorCountryAlpha2: z
          .string()
          .length(2)
          .describe('Debtor country, ISO 3166-1 alpha-2, e.g. "DE", "US"'),
        debtorStateAlpha2: z
          .string()
          .optional()
          .describe('US state code, e.g. "CA" — REQUIRED when the debtor is in the United States'),
        dueDate: z
          .string()
          .optional()
          .describe("Invoice due date (ISO 8601) — used to compute debt age for pricing"),
      },
      annotations: { title: "Preview Case (Pricing & Eligibility)", ...READ_ANNOTATIONS },
    },
    async ({ amountToRecover, currencyCode, debtorType, debtorCountryAlpha2, debtorStateAlpha2, dueDate }) => {
      // Pre-validate US state requirement
      if (debtorCountryAlpha2.toUpperCase() === "US" && !debtorStateAlpha2) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "debtorStateAlpha2 is required for US debtors. Provide the two-letter state code, e.g. \"CA\" for California.",
            },
          ],
        };
      }

      const { data, error, response } = await api.POST("/cases/preview", {
        body: {
          amountToRecover,
          currencyCode,
          dueDate,
          debtor: {
            type: debtorType,
            countryAlpha2: debtorCountryAlpha2,
            stateAlpha2: debtorStateAlpha2,
          },
        },
      });
      if (!data) return apiErrorResult(response.status, error);
      return jsonResult(data);
    },
  );

  server.registerTool(
    "list_team_members",
    {
      title: "List Team Members",
      description:
        "List the team members on the creditor's Debitura account. Use this to resolve a valid sender " +
        "(userId or email) before calling send_case_message, or a case owner for create_case.",
      inputSchema: {
        page: z.number().int().min(1).optional().describe("Page number (default 1)"),
        pageSize: z.number().int().min(1).max(100).optional().describe("Results per page"),
      },
      annotations: { title: "List Team Members", ...READ_ANNOTATIONS },
    },
    async ({ page, pageSize }) => {
      const { data, error, response } = await api.GET("/users", {
        params: { query: { Page: page, PageSize: pageSize } },
      });
      if (!data) return apiErrorResult(response.status, error);
      return jsonResult(data);
    },
  );

  server.registerTool(
    "list_case_files",
    {
      title: "List Case Files",
      description:
        "List all documents attached to a case: file name, document type, description, upload date, " +
        "and a time-limited SAS download URL. Use upload_case_file to attach new documents.",
      inputSchema: {
        caseId: z.string().uuid().describe("Debitura case ID (GUID)"),
      },
      annotations: { title: "List Case Files", ...READ_ANNOTATIONS },
    },
    async ({ caseId }) => {
      const { data, error, response } = await api.GET("/cases/{id}/files", {
        params: { path: { id: caseId } },
      });
      if (!data) return apiErrorResult(response.status, error);

      // Project to the fields agents need; url is the SAS download URL
      const files = (data as unknown[]).map((f) => {
        const file = f as Record<string, unknown>;
        return {
          fileName: file.fileName,
          documentType: file.documentType,
          description: file.description,
          uploadedAt: file.dateCreated,
          downloadUrl: file.url,
        };
      });
      return jsonResult(files);
    },
  );

  server.registerTool(
    "get_account_summary",
    {
      title: "Get Account Summary",
      description:
        "Return a count of cases per lifecycle stage for the creditor's account. " +
        "Useful for a quick portfolio overview without listing all cases. " +
        "Stages: PendingContractSigning, PendingVerificationInternal, PendingVerification, " +
        "NeedsAdditionalDetails, Leads, LeadsQuoteGiven, Active, Paused, Closed, Merged.",
      inputSchema: {},
      annotations: { title: "Get Account Summary", ...READ_ANNOTATIONS },
    },
    async () => {
      // One call per lifecycle — reads totalResults from page metadata only (pageSize=1)
      const results = await Promise.all(
        LIFECYCLE_VALUES.map(async (lifecycle) => {
          const { data, error, response } = await api.GET("/cases", {
            params: { query: { Statuses: [lifecycle], PageSize: 1, Page: 1 } },
          });
          if (!data) {
            return { lifecycle, count: null as number | null, error: `HTTP ${response.status}: ${JSON.stringify(error)}` };
          }
          return { lifecycle, count: data.page?.totalResults ?? 0, error: null };
        }),
      );

      const failed = results.filter((r) => r.error !== null);
      if (failed.length > 0) {
        const details = failed.map((r) => `  ${r.lifecycle}: ${r.error}`).join("\n");
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Failed to fetch counts for ${failed.length} lifecycle(s):\n${details}`,
            },
          ],
        };
      }

      const summary: Record<string, number> = {};
      for (const { lifecycle, count } of results) {
        summary[lifecycle] = count as number;
      }
      return jsonResult(summary);
    },
  );
}
