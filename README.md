# Debitura MCP Server

[![License: MIT](https://img.shields.io/badge/License-MIT-1f6feb.svg)](./LICENSE)
[![Model Context Protocol](https://img.shields.io/badge/MCP-Streamable_HTTP-000000.svg)](https://modelcontextprotocol.io)
[![Node](https://img.shields.io/badge/Node-%E2%89%A520-339933.svg?logo=node.js&logoColor=white)](https://nodejs.org)
[![Docs](https://img.shields.io/badge/Docs-docs.debitura.com-0b7285.svg)](https://docs.debitura.com)

**The MCP server for cross-border debt collection.** Connect Claude, Cursor, VS Code, or any
MCP-compatible agent to [Debitura](https://www.debitura.com) and manage international debt
recovery from your AI assistant: check case status, read partner conversations, get pricing,
and submit new collection cases — handled by vetted local collection partners in 183 countries
on a no-cure-no-pay basis.

- **Endpoint:** `https://mcp.debitura.com/mcp` (streamable HTTP)
- **Auth:** your Debitura API key in the `XApiKey` header (or `Authorization: Bearer <key>`)
- **Get a key:** log in at [app.debitura.com](https://app.debitura.com) → [API key page](https://app.debitura.com/CreditorApiKey)
- **Connector page:** [debitura.com/integration/mcp-server](https://www.debitura.com/integration/mcp-server)

## Tools

### Read

| Tool                       | What it does                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------- |
| `ping`                     | Test the connection — "✓ Connected as {your company}"                                  |
| `list_cases`               | List your collection cases (paging, status filter, sorting)                            |
| `get_case`                 | Fetch one case by ID, your own reference, or Debitura case reference                   |
| `get_case_activity`        | Case timeline — what has happened so far (returns `{ items, currentEngagementPhase }`) |
| `get_case_messages`        | Read the chat with the collection partner                                              |
| `get_case_payments`        | Money recovered on a case                                                              |
| `get_case_contract_status` | Which contracts are signed / blocking a case                                           |
| `get_case_tasks`           | Open tasks (action-items) for one case                                                 |
| `list_case_files`          | List documents attached to a case, with time-limited download URLs                     |
| `get_account_summary`      | Case counts per lifecycle stage — a quick portfolio overview                           |
| `list_tasks`               | Every open task (action-item) across your account, with solutionUrl + resolving action |
| `preview_case`             | Pricing + eligibility dry-run before submitting (nothing persisted)                    |
| `list_team_members`        | Your team — used to attribute messages and assign case owners                          |

### Write

| Tool                | What it does                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_case`       | Submit a collection case. Safety-wrapped: preview first → explicit user confirmation → idempotent submit (auto `Idempotency-Key`, safe retries, no duplicate cases) |
| `upload_case_file`  | Attach documents to a case (invoice copies, contracts — max 25 MB)                                                                                                  |
| `send_case_message` | Message the collection partner on a case, attributed to a named team member                                                                                         |

Every tool carries proper MCP annotations (`readOnlyHint` / `destructiveHint`), and `create_case`
never auto-fires — it is a legal/financial action and always requires explicit human confirmation.

## Distribution

Debitura runs this MCP server as a **hosted service** at `https://mcp.debitura.com/mcp`. That is the
only supported way to use it — point any MCP client at the endpoint and authenticate with your
Debitura API key (see [Install](#install) below). There is **no published npm package**: the
`@debitura/mcp-server` package is private (`"private": true`) and is not distributed on the npm
registry. The source is published so you can audit it and, if you wish, run your own copy (see
[Self-hosting / development](#self-hosting--development)) — but normal usage is the hosted endpoint.

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

Ask your assistant: _"Ping Debitura"_ → you should see `✓ Connected as {your company}`.

## Example prompts

- _"What's the status of my Debitura cases? Anything that needs my attention?"_
- _"What would it cost to collect a €12,000 B2B debt in Germany?"_
- _"Any new messages from collection partners this week?"_
- _"Submit a collection case against Acme GmbH in Berlin for invoice 2026-014, €8,400, due 1 March."_

## Security

- **Authentication & tenancy.** The `XApiKey` header IS the tenant boundary. The server is
  **stateless** — each request creates a fresh MCP server bound to the caller's API key, which is
  passed straight through to the Debitura Customer API. No keys or case data are stored.
- **Rate limiting** is handled at the **Cloudflare edge** (WAF / rate rules) that fronts
  `mcp.debitura.com`, not in-app. Note that some tools fan out to multiple Customer-API calls per
  invocation (e.g. `get_account_summary` queries one count per lifecycle stage), which the edge
  limits account for.
- **Vulnerability reports:** see [SECURITY.md](./SECURITY.md).

## Self-hosting / development

The supported way to use Debitura's MCP is the hosted endpoint above. The steps below are for
**local development / auditing** of this repository only.

```bash
npm install
npm run dev          # starts on :3000, POST /mcp
```

| Env var                 | Default                             | Purpose                                                                   |
| ----------------------- | ----------------------------------- | ------------------------------------------------------------------------- |
| `PORT`                  | `3000`                              | Listen port                                                               |
| `DEBITURA_API_BASE_URL` | `https://customer-api.debitura.com` | Point at `https://testcustomer-api.debitura.com` for the test environment |

See [`.env.example`](./.env.example) for a starter env file.

```bash
npm run build && npm start        # production-style local run
docker build -t debitura-mcp . && docker run -p 3000:3000 debitura-mcp
```

> **Deployment note:** the hosted service deploys the built app as a **zip to Azure App Service**
> (see `.github/workflows/deploy.yml`) — it does **not** run the Docker image in production. The
> `Dockerfile` is provided for local/self-hosted use.

### E2E tests

Runs every tool against the test environment (creates only tagged `isTest` cases and deletes them):

```bash
DEBITURA_API_BASE_URL=https://testcustomer-api.debitura.com npm run dev   # terminal 1
DEBITURA_TEST_API_KEY=<test key> MCP_URL=http://localhost:3000/mcp npx tsx scripts/e2e.ts
```

### Regenerating API types

Types and the HTTP client are generated from the Customer API's OpenAPI spec
(`openapi/customer-api.json`) via `openapi-typescript` — the curated 16-tool layer on top is
hand-written:

```bash
npm run fetch:spec   # pull latest spec + regenerate src/generated/customer-api.d.ts
```

### Releasing a new version

The version lives in **`package.json`** (`config.ts` and `client.ts` derive from it). When bumping
it, also update **`server.json`** — its `version` field is independent and must match the published
registry listing. (`smithery.yaml` has no version field; Smithery picks up the package version
automatically.)

When **adding or removing a tool**, also update the tool catalog above and the `tools/list`
assertion in `scripts/e2e.ts` (it asserts the exact registered tool set).

## About Debitura

Debitura is a global debt collection platform covering 183 countries. Creditors submit overdue
B2B and B2C claims; vetted local collection partners in the debtor's jurisdiction recover them,
typically no-cure-no-pay. Learn more at [debitura.com](https://www.debitura.com) · API docs at
[docs.debitura.com](https://docs.debitura.com).
