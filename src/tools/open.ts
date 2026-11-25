import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { API_BASE_URL, APP_BASE_URL, SERVER_VERSION } from "../config.js";
import { countryPageUrl, resolveCountry, type ResolvedCountry } from "../countries.js";
import { jsonResult } from "./results.js";

/**
 * The open tools (DEB-9129): answers a creditor can get before signing up, with
 * no API key. They are listed in OPEN_TOOL_NAMES (src/auth-gate.ts).
 *
 * Every sentence below comes from the messaging framework's claims register
 * (Debitura.Wiki internal/commercial/messaging-framework.md, sections 2 and 6).
 * Change wording there first; no fee figures, no recovery percentages.
 */

const OPEN_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** ChatGPT reads per-tool auth from here; these tools need no sign-in. */
const NO_AUTH_META = { securitySchemes: [{ type: "noauth" }] };

const FEE_LINE =
  "From 6% in Europe and 7.5% elsewhere, depending on claim size and the debtor's country. " +
  "The exact fee is shown before you submit.";
const PRICING_CALCULATOR = "https://www.debitura.com/pricing";
const CONSUMER_LINE =
  "We collect from businesses across borders. Consumer claims we take on as larger portfolios, " +
  "agreed with the local partners first: contact us.";
const UPSTREAM_FAILED = "Coverage could not be checked right now. Please try again in a moment.";

const COUNTRY_INPUT = z
  .string()
  .min(1)
  .max(100)
  .describe(
    "The debtor's country: ISO 3166-1 alpha-2 code (e.g. DE) or English name (e.g. Germany)",
  );

const DEBTOR_TYPE_INPUT = z
  .enum(["Company", "Private"])
  .optional()
  .describe("Company (a business) or Private (a consumer)");

function errorResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

function unresolvedCountry(input: string): CallToolResult {
  return errorResult(
    `"${input.slice(0, 100)}" is not a country I recognise. Use the two-letter ISO code, for example DE for Germany.`,
  );
}

function notTakenOn(country: ResolvedCountry): CallToolResult {
  return jsonResult({
    country: country.name,
    covered: false,
    message: `Debitura does not take on cases against debtors in ${country.name}.`,
  });
}

interface EstimateBody {
  notice?: string;
  claimEligibility?: {
    status?: string;
    missingInputs?: string[];
    currencyCode?: string | null;
    marketMinimumAmount?: number | null;
    admissionMinimumAmount?: number | null;
    meetsAdmissionMinimum?: boolean | null;
  };
}

type Estimate =
  { kind: "ok"; body: EstimateBody } | { kind: "invalid"; message: string } | { kind: "failed" };

/**
 * The Customer API's keyless coverage estimate (DEB-9128). Deliberately a plain
 * fetch with no key header: the caller's API key must never reach this call.
 */
export async function fetchEstimate(query: Record<string, string | undefined>): Promise<Estimate> {
  const url = new URL("/coverage/estimate", API_BASE_URL);
  for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, v);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": `debitura-mcp/${SERVER_VERSION}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 400) {
      const body = (await res.json().catch(() => ({}))) as { message?: unknown };
      const message =
        typeof body.message === "string" ? body.message.slice(0, 300) : "Invalid input.";
      return { kind: "invalid", message };
    }
    if (!res.ok) return { kind: "failed" };
    return { kind: "ok", body: (await res.json()) as EstimateBody };
  } catch {
    return { kind: "failed" };
  }
}

/**
 * Country-only estimate: is this a country Debitura takes cases in at all?
 * Restricted countries answer "Unavailable" (DEB-9128); fail closed otherwise.
 */
async function checkCountry(
  country: ResolvedCountry,
): Promise<"open" | "unavailable" | CallToolResult> {
  const estimate = await fetchEstimate({ country: country.alpha2 });
  if (estimate.kind === "failed") return errorResult(UPSTREAM_FAILED);
  if (estimate.kind === "invalid") return errorResult(estimate.message);
  return estimate.body.claimEligibility?.status === "Unavailable" ? "unavailable" : "open";
}

const AMOUNT_SHAPE = /^\d{1,12}(\.\d{1,2})?$/;

/**
 * The sign-up link with the claim filled in.
 *
 * Rule: parameters are exactly DEB-8074's `claim_*` names and shapes, plus
 *       utm_source=<client>, utm_medium=mcp, utm_campaign=start_case.
 * Why: the app prefills the first case from `claim_*` (DEB-8074) and stores
 *      `utm_*` on the sign-up, which is how MCP sign-ups are counted (the bar
 *      for OAuth, DEB-9127).
 * Breaks if: a name or shape drifts from DEB-8074: the app silently drops the
 *      value (a bad amount is skipped, not rejected), so nobody would notice.
 */
export function buildSignupUrl(
  input: {
    country: string;
    amount?: string | number;
    currency?: string;
    debtorType?: "Company" | "Private";
  },
  client: string,
  appBaseUrl: string = APP_BASE_URL,
): string {
  const url = new URL("/Onboarding", appBaseUrl);
  url.searchParams.set("claim_country", input.country);
  const amount = input.amount === undefined ? undefined : String(input.amount).trim();
  if (amount && AMOUNT_SHAPE.test(amount) && Number(amount) > 0) {
    url.searchParams.set("claim_amount", amount);
  }
  if (input.currency && /^[A-Za-z]{3}$/.test(input.currency)) {
    url.searchParams.set("claim_currency", input.currency.toUpperCase());
  }
  if (input.debtorType) url.searchParams.set("claim_debtor", input.debtorType);
  url.searchParams.set("utm_source", client);
  url.searchParams.set("utm_medium", "mcp");
  url.searchParams.set("utm_campaign", "start_case");
  return url.href;
}

function processSteps(countryName: string): string[] {
  return [
    "Create a free Debitura account and submit the claim. It takes a few minutes.",
    "The first time you assign a claim, you sign the Standard Debt Collection Agreement once, plus a power of attorney for the local partner.",
    `A vetted local partner in ${countryName}, matched to your case, works it under local law. ` +
      "The standard agreement covers undisputed unpaid invoices and loan repayments, pre-legal.",
    "You follow every step on the platform and talk to the partner directly in the case chat. " +
      "Partners must resolve open tasks and respond to client inquiries within 48 business hours.",
    "The partner has a six-month collection period, extended on payment or a promise to pay.",
    "If money is recovered, the partner deducts the success fee and pays you the rest. " +
      "If nothing is recovered, you pay nothing for the pre-legal phase.",
    "Legal action is optional, quoted separately, and starts only if you accept the quote.",
  ];
}

export function registerOpenTools(server: McpServer, context: { client: string }): void {
  server.registerTool(
    "check_coverage",
    {
      title: "Check Coverage (no sign-in)",
      description:
        "Check whether Debitura can collect from a debtor in a given country, and from what claim amount. " +
        "Works without an API key. Returns the coverage status, the minimum claim amount, the general fee " +
        "range and a link to the pricing calculator. It is an estimate, not a quote. " +
        "For the United States give the state. Give an amount together with its currency.",
      inputSchema: {
        country: COUNTRY_INPUT,
        debtorType: DEBTOR_TYPE_INPUT,
        amount: z
          .number()
          .positive()
          .max(1_000_000_000_000)
          .optional()
          .describe("Claim amount (principal), with currency"),
        currency: z
          .string()
          .regex(/^[A-Za-z]{3}$/)
          .optional()
          .describe("ISO 4217 currency code of the amount, e.g. EUR"),
        stateName: z
          .string()
          .max(100)
          .optional()
          .describe("US state name, e.g. California (United States only)"),
      },
      annotations: { title: "Check Coverage (no sign-in)", ...OPEN_ANNOTATIONS },
      _meta: NO_AUTH_META,
    },
    async ({ country, debtorType, amount, currency, stateName }) => {
      const resolved = resolveCountry(country);
      if (!resolved) return unresolvedCountry(country);
      const estimate = await fetchEstimate({
        country: resolved.alpha2,
        debtorType,
        amount: amount === undefined ? undefined : String(amount),
        currencyCode: currency?.toUpperCase(),
        stateName,
      });
      if (estimate.kind === "failed") return errorResult(UPSTREAM_FAILED);
      if (estimate.kind === "invalid") return errorResult(estimate.message);
      const e = estimate.body.claimEligibility ?? {};
      if (e.status === "Unavailable") return notTakenOn(resolved);
      const minimum =
        amount !== undefined && e.admissionMinimumAmount != null
          ? e.admissionMinimumAmount
          : e.marketMinimumAmount;
      return jsonResult({
        country: resolved.name,
        status: e.status,
        covered: e.status === "Available",
        missingInputs: e.missingInputs?.length ? e.missingInputs : undefined,
        currency: e.currencyCode ?? undefined,
        minimumClaimAmount: minimum ?? undefined,
        meetsMinimum: e.meetsAdmissionMinimum ?? undefined,
        fees: FEE_LINE,
        pricingCalculator: PRICING_CALCULATOR,
        consumerClaims: debtorType === "Private" ? CONSUMER_LINE : undefined,
        notice: estimate.body.notice,
      });
    },
  );

  server.registerTool(
    "explain_process",
    {
      title: "How Debt Collection Works (no sign-in)",
      description:
        "Explain what happens when a customer in a given country does not pay and the claim is sent to " +
        "Debitura: the steps, what the local partner does, when legal action can come in, and a link to " +
        "the country page. Works without an API key.",
      inputSchema: { country: COUNTRY_INPUT },
      annotations: { title: "How Debt Collection Works (no sign-in)", ...OPEN_ANNOTATIONS },
      _meta: NO_AUTH_META,
    },
    async ({ country }) => {
      const resolved = resolveCountry(country);
      if (!resolved) return unresolvedCountry(country);
      const check = await checkCountry(resolved);
      if (check === "unavailable") return notTakenOn(resolved);
      if (check !== "open") return check;
      return jsonResult({
        country: resolved.name,
        steps: processSteps(resolved.name),
        countryPage: countryPageUrl(resolved.alpha2),
      });
    },
  );

  server.registerTool(
    "start_case_link",
    {
      title: "Start a Case: Sign-up Link (no sign-in)",
      description:
        "Get a link to create a free Debitura account with the claim's country, amount, currency and " +
        "debtor type filled in. Only offer it when the user wants to submit the claim; it is an optional " +
        "next step, not required to use the other tools. Works without an API key.",
      inputSchema: {
        country: COUNTRY_INPUT,
        amount: z
          .union([z.number(), z.string().max(20)])
          .optional()
          .describe("Claim amount (principal), up to 2 decimals"),
        currency: z.string().max(3).optional().describe("ISO 4217 currency code, e.g. EUR"),
        debtorType: DEBTOR_TYPE_INPUT,
      },
      annotations: { title: "Start a Case: Sign-up Link (no sign-in)", ...OPEN_ANNOTATIONS },
      _meta: NO_AUTH_META,
    },
    async ({ country, amount, currency, debtorType }) => {
      const resolved = resolveCountry(country);
      if (!resolved) return unresolvedCountry(country);
      const check = await checkCountry(resolved);
      if (check === "unavailable") return notTakenOn(resolved);
      if (check !== "open") return check;
      return jsonResult({
        country: resolved.name,
        signupUrl: buildSignupUrl(
          { country: resolved.alpha2, amount, currency, debtorType },
          context.client,
        ),
        note:
          "If you want to submit this claim, this link opens a free Debitura account with the claim " +
          "details filled in. There is no upfront cost: you pay a success fee only when money is recovered.",
      });
    },
  );
}
