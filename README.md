# Debitura MCP Server

**The MCP server for cross-border debt collection.** Connect Claude, Cursor, VS Code, or any
MCP-compatible agent to [Debitura](https://www.debitura.com) and manage international debt
recovery from your AI assistant: check case status, read partner conversations, get pricing,
and submit new collection cases — handled by vetted local collection partners in 190+ countries
on a no-cure-no-pay basis.

- **Endpoint:** `https://mcp.debitura.com/mcp` (streamable HTTP)
- **Auth:** your Debitura API key in the `XApiKey` header (or `Authorization: Bearer <key>`)
- **Get a key:** log in at [app.debitura.com](https://app.debitura.com) → [API key page](https://app.debitura.com/CreditorApiKey)

## Tools

### Read

| Tool | What it does |
|---|---|
| `ping` | Test the connection — "✓ Connected as {your company}" |
| `list_cases` | List your collection cases (paging, status filter, sorting) |
| `get_case` | Fetch one case by ID, your own reference, or Debitura case reference |
| `get_case_activity` | Case timeline — what has happened so far |
| `get_case_messages` | Read the chat with the collection partner |
| `get_case_payments` | Money recovered on a case |
| `get_case_contract_status` | Which contracts are signed / blocking a case |
| `preview_case` | Pricing + eligibility dry-run before submitting (nothing persisted) |
| `list_team_members` | Your team — used to attribute messages and assign case owners |

### Write

| Tool | What it does |
|---|---|
| `create_case` | Submit a collection case. Safety-wrapped: preview first → explicit user confirmation → idempotent submit (auto `Idempotency-Key`, safe retries, no duplicate cases) |
| `upload_case_file` | Attach documents to a case (invoice copies, contracts — max 25 MB) |
| `send_case_message` | Message the collection partner on a case, attributed to a named team member |

Every tool carries proper MCP annotations (`readOnlyHint` / `destructiveHint`), and `create_case`
never auto-fires — it is a legal/financial action and always requires explicit human confirmation.

## Install

### Claude (web / desktop)

Settings → Connectors → **Add custom connector** → URL `https://mcp.debitura.com/mcp`.
When asked for authentication, add your API key as the `XApiKey` header (or use the
bearer-token field — both work).

### Claude Code

```bash
claude mcp add --transport http debitura https://mcp.debitura.com/mcp --header "XApiKey: YOUR_API_KEY"
```

### Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "debitura": {
      "url": "https://mcp.debitura.com/mcp",
      "headers": { "XApiKey": "YOUR_API_KEY" }
    }
  }
}
```

### VS Code (GitHub Copilot)

```bash
code --add-mcp '{"name":"debitura","type":"http","url":"https://mcp.debitura.com/mcp","headers":{"XApiKey":"YOUR_API_KEY"}}'
```

### Verify

Ask your assistant: *"Ping Debitura"* → you should see `✓ Connected as {your company}`.

## Example prompts

- *"What's the status of my Debitura cases? Anything that needs my attention?"*
- *"What would it cost to collect a €12,000 B2B debt in Germany?"*
- *"Any new messages from collection partners this week?"*
- *"Submit a collection case against Acme GmbH in Berlin for invoice 2026-014, €8,400, due 1 March."*

## Self-hosting / development

```bash
npm install
npm run dev          # starts on :3000, POST /mcp
```

| Env var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Listen port |
| `DEBITURA_API_BASE_URL` | `https://customer-api.debitura.com` | Point at `https://testcustomer-api.debitura.com` for the test environment |

The server is **stateless**: each request creates a fresh MCP server bound to the caller's API
key, which is passed through to the [Debitura Customer API](https://docs.debitura.com) as the
tenant scope. No keys or data are stored.

```bash
npm run build && npm start        # production
docker build -t debitura-mcp . && docker run -p 3000:3000 debitura-mcp
```

### E2E tests

Runs every tool against the test environment (creates only tagged `isTest` cases and deletes them):

```bash
DEBITURA_API_BASE_URL=https://testcustomer-api.debitura.com npm run dev   # terminal 1
DEBITURA_TEST_API_KEY=<test key> MCP_URL=http://localhost:3000/mcp npx tsx scripts/e2e.ts
```

### Regenerating API types

Types and the HTTP client are generated from the Customer API's OpenAPI spec
(`openapi/customer-api.json`) via `openapi-typescript` — the curated 12-tool layer on top is
hand-written:

```bash
npm run fetch:spec   # pull latest spec + regenerate src/generated/customer-api.d.ts
```

## About Debitura

Debitura is a global debt collection platform covering 190+ countries. Creditors submit overdue
B2B and B2C claims; vetted local collection partners in the debtor's jurisdiction recover them,
typically no-cure-no-pay. Learn more at [debitura.com](https://www.debitura.com) · API docs at
[docs.debitura.com](https://docs.debitura.com).
