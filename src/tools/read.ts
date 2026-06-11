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
        "Returns case summaries including reference, debtor, amounts, status, and assigned collection partner.",
      inputSchema: {
        page: z.number().int().min(1).optional().describe("Page number, starting from 1 (default 1)"),
        pageSize: z.number().int().min(1).max(100).optional().describe("Results per page (default 10, max 100)"),
        statuses: z
          .array(
            z.enum([
              "Open",
              "OnHold",
              "PaymentPlan",
              "Closed",
              "Withdrawn",
              "Completed",
              "PendingContractSigning",
              "PendingVerificationInternal",
            ]),
          )
          .optional()
          .describe("Filter by case status"),
        sort: z
          .string()
          .optional()
          .describe("Sort expression, e.g. 'date:desc' or 'amount:asc'"),
      },
      annotations: { title: "List Cases", ...READ_ANNOTATIONS },
    },
    async ({ page, pageSize, statuses, sort }) => {
      const { data, error, response } = await api.GET("/cases", {
        params: {
          query: { Page: page, PageSize: pageSize, Statuses: statuses, Sort: sort },
        },
      });
      if (!data) return apiErrorResult(response.status, error);
      return jsonResult(data);
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
      return jsonResult(data);
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
        "Read the chat conversation on a case between you and the collection partner handling it.",
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
      return jsonResult(data);
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
}
