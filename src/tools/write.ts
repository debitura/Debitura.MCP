import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CustomerApiClient } from "../client.js";
import { API_BASE_URL } from "../config.js";
import { jsonResult, apiErrorResult, isBusinessErrorResponse } from "./results.js";

const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: false,
} as const;

const MAX_FILE_BYTES = 25 * 1024 * 1024;

/**
 * Allowed file extensions for upload_case_file.
 * Source: CasesController.cs:1982
 */
const ALLOWED_EXTENSIONS = new Set([".pdf", ".xls", ".xlsx", ".csv", ".txt", ".jpg", ".jpeg", ".png", ".gif"]);

export function registerWriteTools(
  server: McpServer,
  api: CustomerApiClient,
  apiKey: string,
): void {
  server.registerTool(
    "create_case",
    {
      title: "Create Collection Case",
      description:
        "Submit a debt collection case to Debitura. This is a LEGAL AND FINANCIAL ACTION: a collection " +
        "partner starts recovery against the debtor, and contractual fees apply on success.\n\n" +
        "Required workflow — never skip it:\n" +
        "1. Call preview_case first and show the user the pricing, assigned partner, and any contracts that need signing.\n" +
        "2. Ask the user to explicitly confirm submission.\n" +
        "3. Only then call this tool. NEVER call it without the user's explicit confirmation in this conversation.\n\n" +
        "Submission is idempotent: the server sends a unique Idempotency-Key and safely retries transient " +
        "network failures without risk of duplicate cases. A 422 response is a business rejection — read its " +
        "payload (it may contain signing URLs for required contracts, or duplicate-reference details).",
      inputSchema: {
        amountToRecover: z.number().positive().describe("Total principal amount to recover"),
        currencyCode: z.string().length(3).describe('ISO 4217 currency code, e.g. "EUR"'),
        debtor: z
          .object({
            type: z.enum(["Company", "Private"]).describe("Company (B2B) or Private individual (B2C)"),
            name: z.string().describe("Company name or person's full name"),
            contactPerson: z.string().optional().describe("Contact person (companies only)"),
            companyRegistrationNumber: z
              .string()
              .optional()
              .describe("Company registration number (VAT/CVR/org number)"),
            address: z.string().describe("Street address — required by the API"),
            zipCode: z.string().optional().describe("Postal/ZIP code"),
            city: z.string().describe("City — required by the API"),
            countryAlpha2: z.string().length(2).describe("Country (ISO 3166-1 alpha-2)"),
            stateAlpha2: z
              .string()
              .optional()
              .describe('US state code, e.g. "CA" — REQUIRED for United States debtors'),
            email: z.string().optional().describe("Debtor email"),
            phone: z.string().optional().describe("Debtor phone incl. country code"),
          })
          .describe("The debtor the claim is against"),
        date: z
          .string()
          .describe("Invoice date (ISO 8601, e.g. 2026-03-01) — required by the API"),
        dueDate: z
          .string()
          .describe(
            "Invoice due date (ISO 8601, e.g. 2026-04-30). Required — Debitura computes the age of the debt from it, which affects pricing.",
          ),
        claimDescription: z
          .string()
          .optional()
          .describe("Description of the claim (what the debt is for)"),
        comments: z
          .string()
          .optional()
          .describe("Context for the collection partner, e.g. payment history or prior communication"),
        creditorReference: z
          .string()
          .max(50)
          .optional()
          .describe(
            "RECOMMENDED: your own reference (e.g. invoice number). Helps avoid business duplicates and lets you look the case up later.",
          ),
        assignedUserEmail: z
          .string()
          .optional()
          .describe("Email of the team member to own the case (use list_team_members to find valid team members)"),
        allowPendingContracts: z
          .boolean()
          .optional()
          .describe(
            "Accept the case even if contracts (SDCA/POA) are unsigned — it waits in PendingContractSigning with signing URLs returned",
          ),
        isTest: z
          .boolean()
          .optional()
          .describe("Create as test data (persisted but excluded from production metrics)"),
        tag: z.string().optional().describe("Optional tag for grouping test data"),
      },
      annotations: { title: "Create Collection Case", ...WRITE_ANNOTATIONS, idempotentHint: false },
    },
    async (input) => {
      // Pre-validate US state requirement
      if (input.debtor.countryAlpha2.toUpperCase() === "US" && !input.debtor.stateAlpha2) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: 'debtor.stateAlpha2 is required for US debtors. Provide the two-letter state code, e.g. "CA" for California.',
            },
          ],
        };
      }

      // One key per confirmed create; reused across transient-failure retries so
      // the API can replay the stored response instead of double-creating (DEB-4574).
      const idempotencyKey = randomUUID();
      const body = {
        amountToRecover: input.amountToRecover,
        currencyCode: input.currencyCode,
        debtor: input.debtor,
        date: input.date,
        dueDate: input.dueDate,
        claimDescription: input.claimDescription,
        comments: input.comments,
        creditorReference: input.creditorReference,
        assignedUserEmail: input.assignedUserEmail,
        allowPendingContracts: input.allowPendingContracts,
        isTest: input.isTest,
        tag: input.tag,
      };

      const attempt = () =>
        api.POST("/cases", {
          body,
          headers: { "Idempotency-Key": idempotencyKey },
        });

      let lastError: unknown;
      for (let i = 0; i < 3; i++) {
        try {
          const { data, error, response } = await attempt();
          if (data) return jsonResult(data);
          // Retry only transient upstream failures; everything else is final.
          if ([502, 503, 504].includes(response.status) && i < 2) continue;
          return apiErrorResult(response.status, error, createCaseGuidance(response.status, error, input.creditorReference));
        } catch (err) {
          lastError = err; // network-level failure — safe to retry with the same key
        }
      }
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Network failure submitting the case after 3 attempts (idempotency key ${idempotencyKey}): ${String(lastError)}. The same key was used for all attempts, so no duplicate case was created. Use list_cases to check whether the case was created before retrying.`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "upload_case_file",
    {
      title: "Upload Case File",
      description:
        "Attach a document to a case (invoice copy, contract, correspondence, proof of delivery). " +
        "Max 25 MB. Allowed extensions: .pdf, .xls, .xlsx, .csv, .txt, .jpg, .jpeg, .png, .gif. " +
        "Provide the file content base64-encoded.",
      inputSchema: {
        caseId: z.string().uuid().describe("Debitura case ID (GUID)"),
        fileName: z.string().describe('File name including extension, e.g. "invoice-1042.pdf"'),
        contentBase64: z.string().describe("File content, base64-encoded"),
        contentType: z
          .string()
          .optional()
          .describe('MIME type, e.g. "application/pdf" (inferred from extension if omitted)'),
        description: z.string().optional().describe("Short description of the document"),
        documentType: z
          .enum([
            "OriginalInvoice",
            "DebtorDocuments",
            "CreditorDocuments",
            "PartnerDocuments",
            "DemandLetter",
            "Miscellaneous",
          ])
          .optional()
          .describe(
            "Document category (default: OriginalInvoice). " +
            "Values: OriginalInvoice · DebtorDocuments · CreditorDocuments · PartnerDocuments · DemandLetter · Miscellaneous",
          ),
      },
      annotations: { title: "Upload Case File", ...WRITE_ANNOTATIONS, idempotentHint: false },
    },
    async ({ caseId, fileName, contentBase64, contentType, description, documentType }) => {
      // Pre-validate file extension
      const ext = "." + (fileName.toLowerCase().split(".").pop() ?? "");
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                `File extension "${ext}" is not allowed. Supported extensions: ${[...ALLOWED_EXTENSIONS].join(", ")}.`,
            },
          ],
        };
      }

      let bytes: Buffer;
      try {
        bytes = Buffer.from(contentBase64, "base64");
      } catch {
        return { isError: true, content: [{ type: "text", text: "contentBase64 is not valid base64." }] };
      }
      if (bytes.length === 0) {
        return { isError: true, content: [{ type: "text", text: "Decoded file is empty." }] };
      }
      if (bytes.length > MAX_FILE_BYTES) {
        return {
          isError: true,
          content: [{ type: "text", text: `File is ${bytes.length} bytes — exceeds the 25 MB limit.` }],
        };
      }

      const form = new FormData();
      form.append(
        "File",
        new Blob([new Uint8Array(bytes)], { type: contentType ?? guessMimeType(fileName) }),
        fileName,
      );
      if (description) form.append("Description", description);
      if (documentType) form.append("DocumentType", documentType);

      const response = await fetch(`${API_BASE_URL}/cases/${caseId}/files`, {
        method: "POST",
        headers: { XApiKey: apiKey },
        body: form,
      });
      const responseBody = await response.json().catch(() => undefined);
      if (!response.ok) return apiErrorResult(response.status, responseBody);
      return jsonResult(responseBody);
    },
  );

  server.registerTool(
    "send_case_message",
    {
      title: "Send Case Message",
      description:
        "Send a chat message on a case to the collection partner handling it. The partner is notified " +
        "by email. The message is attributed to a named team member, so a sender is REQUIRED: pass the " +
        "sender's userId or email from list_team_members. Ask the user who the message should be sent as " +
        "if it is not obvious.",
      inputSchema: {
        caseId: z.string().uuid().describe("Debitura case ID (GUID)"),
        message: z.string().min(1).describe("The message to send"),
        senderUserId: z
          .string()
          .uuid()
          .optional()
          .describe("Team member ID sending the message (from list_team_members)"),
        senderEmail: z
          .string()
          .optional()
          .describe("Team member email sending the message (alternative to senderUserId)"),
      },
      annotations: { title: "Send Case Message", ...WRITE_ANNOTATIONS, idempotentHint: false },
    },
    async ({ caseId, message, senderUserId, senderEmail }) => {
      if (!senderUserId && !senderEmail) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "A sender is required: provide senderUserId or senderEmail. Use the list_team_members tool to find valid team members, and ask the user who the message should be sent as.",
            },
          ],
        };
      }
      const { data, error, response } = await api.POST("/cases/{id}/chats", {
        params: { path: { id: caseId } },
        body: { message, userId: senderUserId, userEmail: senderEmail },
      });
      if (!data) return apiErrorResult(response.status, error);
      return jsonResult(data);
    },
  );
}

/**
 * create_case-specific overlay for the 422 business rejection.
 *
 * The generic renderer in apiErrorResult already turns each business error into
 * an actionable line. This adds context only create_case knows about:
 *  - a duplicate creditorReference should be looked up with `get_case` using the
 *    exact reference the agent just submitted, and
 *  - a missing debt collection contract means the user must sign before retry —
 *    point the agent at the signing URL in the rendered payload as the action.
 *
 * Returns undefined for non-business or unrecognised errors so nothing extra is
 * appended (graceful fallback — the body renders exactly as it otherwise would).
 */
function createCaseGuidance(
  status: number,
  body: unknown,
  creditorReference: string | undefined,
): string | undefined {
  if (status !== 422 || !isBusinessErrorResponse(body)) return undefined;

  const codes = new Set((body.businessErrors ?? []).map((e) => e.type).filter(Boolean) as string[]);
  const tips: string[] = [];

  if (codes.has("DuplicateCreditorReference")) {
    const ref = creditorReference ? ` "${creditorReference}"` : "";
    tips.push(
      `A case with creditorReference${ref} already exists. Do NOT retry create_case — call get_case with creditorReference${ref} to retrieve the existing case.`,
    );
  }

  if (codes.has("MissingDebtCollectionContract") || codes.has("MissingPowerOfAttorney")) {
    tips.push(
      "A required contract is unsigned. Present the signing URL above to the user (the combined signing link if shown), then retry create_case once signing is complete — or pass allowPendingContracts to queue the case in PendingContractSigning.",
    );
  }

  // UnsupportedCountry/Currency and NoPartnerAvailable are covered by the generic
  // per-error hints (preview_case for eligibility) — no create_case-specific
  // overlay needed, so they intentionally fall through to the rendered lines.

  return tips.length > 0 ? tips.join("\n") : undefined;
}

function guessMimeType(fileName: string): string {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    txt: "text/plain",
    csv: "text/csv",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    msg: "application/vnd.ms-outlook",
    eml: "message/rfc822",
  };
  return map[ext] ?? "application/octet-stream";
}
