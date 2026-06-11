/**
 * End-to-end exercise of every tool against a running server instance.
 *
 * Usage:
 *   DEBITURA_API_BASE_URL=https://testcustomer-api.debitura.com npm run dev   # terminal 1
 *   DEBITURA_TEST_API_KEY=<key> npx tsx scripts/e2e.ts                        # terminal 2
 *
 * Creates ONLY test cases (isTest=true, tagged) and hard-deletes them afterwards
 * via the Customer API's /test/cases endpoint.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const MCP_URL = process.env.MCP_URL ?? "http://localhost:3000/mcp";
const API_KEY = process.env.DEBITURA_TEST_API_KEY;
const API_BASE = process.env.DEBITURA_API_BASE_URL ?? "https://testcustomer-api.debitura.com";
const TAG = `debitura-mcp-e2e-${Date.now()}`;

if (!API_KEY) {
  console.error("Set DEBITURA_TEST_API_KEY");
  process.exit(1);
}

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as Array<{ type: string; text?: string }>)
    .map((c) => c.text ?? "")
    .join("\n");
  return { isError: result.isError === true, text };
}

function parse<T = any>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

async function main() {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: { XApiKey: API_KEY! } },
  });
  const client = new Client({ name: "debitura-mcp-e2e", version: "0.0.1" });
  await client.connect(transport);
  check("connect + initialize", true);

  // tools/list
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name).sort();
  const expected = [
    "create_case",
    "get_case",
    "get_case_activity",
    "get_case_contract_status",
    "get_case_messages",
    "get_case_payments",
    "list_cases",
    "list_team_members",
    "ping",
    "preview_case",
    "send_case_message",
    "upload_case_file",
  ];
  check(
    "tools/list returns the 12 curated tools",
    JSON.stringify(names) === JSON.stringify(expected),
    names.join(","),
  );
  const unannotated = tools.tools.filter(
    (t) => !t.annotations || t.annotations.readOnlyHint === undefined || !t.title,
  );
  check("every tool has title + annotations", unannotated.length === 0, unannotated.map((t) => t.name).join(","));

  // ping
  const ping = await call(client, "ping", {});
  check("ping → connected as creditor", !ping.isError && ping.text.includes("✓ Connected as"), ping.text.split("\n")[0]);

  // list_cases
  const list = await call(client, "list_cases", { page: 1, pageSize: 5 });
  check("list_cases", !list.isError, list.isError ? list.text.slice(0, 200) : undefined);

  // preview_case
  const preview = await call(client, "preview_case", {
    amountToRecover: 5000,
    currencyCode: "EUR",
    debtorType: "Company",
    debtorCountryAlpha2: "DE",
  });
  check("preview_case (DE company, 5000 EUR)", !preview.isError, preview.isError ? preview.text.slice(0, 300) : undefined);

  // list_team_members
  const team = await call(client, "list_team_members", {});
  check("list_team_members", !team.isError);
  const teamData = parse(team.text);
  const sender = teamData?.users?.[0] ?? teamData?.results?.[0] ?? (Array.isArray(teamData) ? teamData[0] : undefined);

  // create_case (test data)
  const created = await call(client, "create_case", {
    amountToRecover: 1234.56,
    currencyCode: "EUR",
    dueDate: "2026-03-01",
    claimDescription: "MCP connector E2E test claim",
    creditorReference: `MCP-E2E-${Date.now()}`,
    debtor: {
      type: "Company",
      name: "MCP E2E Test Debtor GmbH",
      address: "Teststrasse 1",
      city: "Berlin",
      zipCode: "10115",
      countryAlpha2: "DE",
      email: "mcp-e2e@example.com",
    },
    allowPendingContracts: true,
    isTest: true,
    tag: TAG,
  });
  check("create_case (isTest, tagged)", !created.isError, created.isError ? created.text.slice(0, 300) : undefined);
  const createdCase = parse(created.text);
  const caseId: string | undefined = createdCase?.id;
  check("create_case returned a case id", !!caseId, caseId);

  if (caseId) {
    const byId = await call(client, "get_case", { id: caseId });
    check("get_case by id", !byId.isError);

    const activity = await call(client, "get_case_activity", { caseId });
    check("get_case_activity", !activity.isError);

    const messages = await call(client, "get_case_messages", { caseId });
    check("get_case_messages", !messages.isError);

    const payments = await call(client, "get_case_payments", { caseId });
    check("get_case_payments", !payments.isError);

    const contract = await call(client, "get_case_contract_status", { caseId });
    check("get_case_contract_status", !contract.isError);

    const upload = await call(client, "upload_case_file", {
      caseId,
      fileName: "e2e-note.pdf",
      // Minimal valid single-page PDF
      contentBase64: Buffer.from(
        "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\nxref\n0 4\ntrailer<</Size 4/Root 1 0 R>>\n%%EOF",
      ).toString("base64"),
      description: "MCP E2E upload",
    });
    check("upload_case_file", !upload.isError, upload.isError ? upload.text.slice(0, 300) : undefined);

    const noSender = await call(client, "send_case_message", {
      caseId,
      message: "should fail — no sender",
    });
    check("send_case_message rejects missing sender", noSender.isError);

    if (sender?.email || sender?.id) {
      const sent = await call(client, "send_case_message", {
        caseId,
        message: "MCP connector E2E test message — please ignore.",
        ...(sender.id ? { senderUserId: sender.id } : { senderEmail: sender.email }),
      });
      check("send_case_message with sender", !sent.isError, sent.isError ? sent.text.slice(0, 300) : undefined);
    } else {
      check("send_case_message with sender (skipped — no team member found)", true);
    }
  }

  // get_case input validation
  const badLookup = await call(client, "get_case", {});
  check("get_case rejects zero identifiers", badLookup.isError);

  await client.close();

  // Cleanup: hard-delete the tagged test cases directly via the Customer API
  const cleanup = await fetch(`${API_BASE}/test/cases?tag=${encodeURIComponent(TAG)}`, {
    method: "DELETE",
    headers: { XApiKey: API_KEY! },
  });
  check("cleanup tagged test cases", cleanup.ok || cleanup.status === 404, `HTTP ${cleanup.status}`);

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("E2E run crashed:", err);
  process.exit(1);
});
