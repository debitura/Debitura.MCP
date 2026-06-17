import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  LIFECYCLE_VALUES,
  LIFECYCLE_DESCRIPTIONS,
  CLOSE_CODE_DESCRIPTIONS,
  CHAT_ROLES,
} from "./domain.js";

/**
 * Static domain-knowledge resources + ready-made prompts.
 *
 * Resources give an agent the glossary it needs to interpret tool output
 * (lifecycle stages, close codes, chat roles) without guessing; prompts give a
 * one-click way to kick off the common "review my portfolio" flow. All content
 * is static text built from the same domain constants the tools use (see
 * src/domain.ts), so it can never drift from what the tools accept and return.
 *
 * Registering any resource/prompt makes the SDK advertise the corresponding
 * capability on initialize automatically.
 */

// ---------------------------------------------------------------------------
// Resource bodies (static markdown, built from the single-source domain enums)
// ---------------------------------------------------------------------------

function caseLifecycleGlossary(): string {
  const rows = LIFECYCLE_VALUES.map((v) => {
    const { state, description } = LIFECYCLE_DESCRIPTIONS[v];
    return `| \`${v}\` | ${state} | ${description} |`;
  }).join("\n");

  const closeRows = CLOSE_CODE_DESCRIPTIONS.map(
    (c) => `| \`${c.label}\` | ${c.recovered ? "Yes" : "No"} | ${c.meaning} |`,
  ).join("\n");

  return `# Debitura case lifecycle & status glossary

Every case carries a \`lifecycle\` stage. These are the exact values returned by
\`get_case\` / \`list_cases\` and accepted by the \`statuses\` filter on \`list_cases\`.

A case is either **Active** (still open / in progress) or **Closed** (finished).

| Lifecycle stage | Open/Closed | Meaning |
|---|---|---|
${rows}

## Close codes (for Closed cases)

When a case is \`Closed\`, its \`closeCode\` records the outcome. The API returns
\`closeCode\` as the text label shown below (not a number). Only **Paid** and
**Partially paid** represent money recovered; every other code is a write-off,
withdrawal, or never-started outcome — do NOT count those as "collected".

| Close code (text) | Money recovered? | Meaning |
|---|---|---|
${closeRows}
`;
}

function chatRoleGlossary(): string {
  const rows = CHAT_ROLES.map((r) => `| ${r.value} | \`${r.label}\` | ${r.description} |`).join(
    "\n",
  );
  return `# Debitura chat role glossary

\`get_case_messages\` returns each message with a \`role\`. The role tells you who
sent the message in the conversation on a case.

| Role int | Label | Who |
|---|---|---|
${rows}
`;
}

function coverageReference(): string {
  return `# Debitura coverage & pricing-zone reference

Debitura is a **global cross-border debt collection platform**: you submit an
overdue B2B or B2C claim, and a local collection partner *in the debtor's own
country* recovers it on a **no-cure-no-pay** basis (you pay a success fee only on
what is actually recovered).

## Coverage (directional)

- **Global cross-border coverage** — the network spans local partners across many
  jurisdictions worldwide, so a claim against a debtor abroad is routed to a
  partner who knows that country's law and language.
- Coverage is **tiered**: most common B2B/B2C jurisdictions are well covered;
  some markets are more specialised. The reliable way to confirm coverage and
  eligibility for a *specific* debtor country and currency is to call
  **\`preview_case\`** — it returns eligibility, the partner that would be
  assigned, and pricing, with nothing persisted.
- Debitura publicly reports a headline recovery success rate of **around 87%**.
  Treat that as a directional, platform-wide indicator of effectiveness — it is
  **not** a per-country guarantee, and per-country recovery rates are not
  published. Never quote a precise recovery percentage for an individual country.

## Pricing (directional)

- Pricing is a **success fee** — a percentage of the amount recovered — set by
  the debtor's jurisdiction and the case profile (debtor type, debt age).
- Pricing tiers vary by region; higher-effort or higher-risk jurisdictions carry
  higher success-fee rates.
- For the exact fee on a real case, always call **\`preview_case\`** before
  \`create_case\` and show the user the returned pricing. Do not estimate fees
  from memory.

## How to use this

1. \`preview_case\` to confirm a debtor country/currency is eligible and see the
   fee.
2. Show the user the pricing and any contracts needing signing.
3. Only on explicit confirmation, \`create_case\`.
`;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerResources(server: McpServer): void {
  server.registerResource(
    "case-lifecycle-glossary",
    "debitura://glossary/case-lifecycle",
    {
      title: "Case Lifecycle & Status Glossary",
      description:
        "The case lifecycle stages (Active vs Closed) and close-code meanings. Reference for interpreting the `lifecycle` field on get_case / list_cases and the `statuses` filter.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: caseLifecycleGlossary() }],
    }),
  );

  server.registerResource(
    "chat-role-glossary",
    "debitura://glossary/chat-roles",
    {
      title: "Chat Role Glossary",
      description:
        "Who is who in a case conversation: the Creditor / Partner / System roles returned by get_case_messages, with their role integers.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: chatRoleGlossary() }],
    }),
  );

  server.registerResource(
    "coverage-pricing-reference",
    "debitura://reference/coverage-pricing",
    {
      title: "Coverage & Pricing-Zone Reference",
      description:
        "Directional overview of Debitura's global cross-border coverage and success-fee pricing model. Use preview_case for the exact eligibility and fee on any specific case.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: coverageReference() }],
    }),
  );
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "review_overdue_portfolio",
    {
      title: "Review my overdue portfolio",
      description:
        "Review the creditor's open (Active) collection cases, dig into the most material one, and produce a concise portfolio summary.",
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              "Review my overdue debt-collection portfolio on Debitura.\n\n" +
              "Steps:\n" +
              '1. Call `list_cases` with statuses=["Active"], sort=`GrossAmount:desc`, pageSize 25 to get my open cases by size.\n' +
              "2. Identify the most material case — the highest grossAmount (break ties by the oldest dueDate). " +
              "Call `get_case` on it for full detail, and `get_case_activity` on it to see what has happened recently.\n" +
              "3. If you are unsure what a `lifecycle` stage means, read the `debitura://glossary/case-lifecycle` resource.\n\n" +
              "Then give me a concise summary: how many active cases and their total outstanding amount (by currency), " +
              "the standout case (debtor, amount, country, lifecycle, latest activity), and anything that looks stuck " +
              "(e.g. PendingContractSigning or PendingVerification). End with a short, prioritised list of suggested next actions. " +
              "Do NOT create cases, send messages, or take any action — this is read-only review.",
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "draft_partner_update",
    {
      title: "Draft a partner update on a case",
      description:
        "Draft a chat message to the collection partner asking for a status update on a specific case. Drafts only — does not send.",
      argsSchema: {
        caseReference: z
          .string()
          .describe(
            "The case to ask about — a Debitura case ID/reference or your creditor reference",
          ),
      },
    },
    ({ caseReference }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text:
              `Help me draft a chat message to the collection partner on case "${caseReference}".\n\n` +
              "Steps:\n" +
              "1. Look the case up with `get_case` (try it as a case ID, case reference, or creditorReference).\n" +
              "2. Read the recent conversation with `get_case_messages` so the message fits the context and does not repeat what was already asked.\n\n" +
              "Then draft a short, polite message asking the partner for a current status update and expected next steps. " +
              "Show me the draft for review. Do NOT send it — only after I approve, you would use `send_case_message` " +
              "(which requires me to choose a sender via `list_team_members`).",
          },
        },
      ],
    }),
  );
}
