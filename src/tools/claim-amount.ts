import { z } from "zod";

export const claimLinesSchema = z
  .array(
    z.object({
      dueDate: z.string().describe("Invoice due date (ISO 8601)"),
      amount: z
        .number()
        .positive()
        .refine((value) => Number.isInteger(value * 100), "Amount must have at most 2 decimals")
        .describe("Outstanding balance after payments and credit notes"),
      reference: z
        .string()
        .optional()
        .describe("Optional invoice reference; must be unique within the claim"),
    }),
  )
  .min(1)
  .max(1000)
  .optional()
  .describe(
    "Unpaid invoices making up the claim. Use instead of amountToRecover and age buckets; Debitura derives the total and aging.",
  );

export type ClaimAmountAndAge = {
  amountToRecover?: number;
  amountToRecoverOver6Months?: number;
  amountToRecoverOver12Months?: number;
  amountToRecoverOver24Months?: number;
  claimLines?: Array<{ dueDate: string; amount: number; reference?: string }>;
  dueDate?: string;
};

/**
 * Keep MCP's three amount-and-aging modes mutually exclusive before a request reaches the API.
 * Creation may keep a case-level due date with claim lines; preview may not because it treats
 * dueDate as a competing pricing input.
 */
export function validateClaimAmountAndAge(
  input: ClaimAmountAndAge,
  operation: "create" | "preview",
): string | undefined {
  const hasClaimLines = input.claimLines !== undefined;
  const buckets = [
    input.amountToRecoverOver6Months,
    input.amountToRecoverOver12Months,
    input.amountToRecoverOver24Months,
  ];
  const hasBuckets = buckets.some((value) => value !== undefined);

  if (!hasClaimLines && input.amountToRecover === undefined) {
    return "Provide amountToRecover, or provide claimLines so Debitura can derive the total.";
  }
  if (hasClaimLines && (input.amountToRecover !== undefined || hasBuckets)) {
    return "claimLines cannot be combined with amountToRecover or age bucket fields. Choose one amount-and-aging mode.";
  }
  if (operation === "preview" && hasClaimLines && input.dueDate !== undefined) {
    return "preview_case cannot combine claimLines with dueDate. Each claim line already carries its own pricing date.";
  }
  if (operation === "preview" && hasBuckets && input.dueDate !== undefined) {
    return "preview_case cannot combine age bucket fields with dueDate. Choose one aging mode.";
  }

  return undefined;
}
