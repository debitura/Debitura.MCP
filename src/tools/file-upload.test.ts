import { it } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "../server.js";

// GUARD: new document types refused or omitted types defaulted by MCP prevent
// integrators from identifying evidence correctly. Exercise the registered tool
// and multipart HTTP boundary, rather than a second copy of its Zod schema.
it("upload_case_file_NewAndLegacyTypesOrOmission_ForwardsChosenTypeWithoutDefault", async (t) => {
  const observed: (string | null)[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const form = init.body as FormData;
    assert.equal((init.headers as Record<string, string>).XApiKey, "synthetic-creditor-key");
    observed.push(form.get("DocumentType") as string | null);
    return Response.json({ documentType: form.get("DocumentType") });
  });
  const server = buildServer("synthetic-creditor-key");
  const client = new Client({ name: "upload-contract-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    for (const documentType of [
      "OriginalInvoice",
      "AccountStatement",
      "Contract",
      "TermsAndConditions",
      "ProofOfDelivery",
      "DemandLetter",
      "Correspondence",
      "PaymentProof",
      "CourtDocument",
      "IdentityDocument",
      "Miscellaneous",
      "DebtorDocuments",
      "CreditorDocuments",
      "PartnerDocuments",
      undefined,
    ]) {
      const result = await client.callTool({
        name: "upload_case_file",
        arguments: {
          caseId: "00000000-0000-4000-8000-000000000001",
          fileName: "evidence.txt",
          contentBase64: Buffer.from("synthetic evidence").toString("base64"),
          ...(documentType === undefined ? {} : { documentType }),
        },
      });
      assert.notEqual(result.isError, true, JSON.stringify(result));
      assert.equal(observed.at(-1), documentType ?? null);
    }
    assert.equal(observed.length, 15);
  } finally {
    await client.close();
    await server.close();
  }
});
