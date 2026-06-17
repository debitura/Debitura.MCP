# Security Policy

The Debitura MCP server is a financial / legal-action tool: it lets authenticated creditors submit
real debt collection cases and exchange messages with collection partners. We take its security
seriously and appreciate responsible disclosure.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.**

Email **security@debitura.com** with:

- a description of the issue and the potential impact,
- steps to reproduce (proof-of-concept if possible),
- the affected endpoint or component, and
- any relevant logs (with secrets redacted).

We will acknowledge your report, keep you updated on remediation, and credit you if you wish once a
fix has shipped. Please give us a reasonable window to address the issue before any public
disclosure.

## Scope

In scope:

- This MCP server (`Admino-SaaS/Debitura.MCP`) and the hosted endpoint `https://mcp.debitura.com/mcp`.

Please note:

- **Never use a production API key or real case data in a report.** Use the test environment
  (`https://testcustomer-api.debitura.com`) with `isTest` cases where you need to demonstrate
  behavior against live tooling.
- The server is **stateless** and does not persist API keys or case data; the `XApiKey` header is the
  tenant boundary and is forwarded to the Debitura Customer API per request.
- Rate limiting and WAF protection are enforced at the Cloudflare edge in front of the endpoint.

## Authentication

Authentication uses your Debitura API key in the `XApiKey` header (or `Authorization: Bearer`).
Treat the key like a password — if you believe a key has been exposed, rotate it immediately from
the [API key page](https://app.debitura.com/CreditorApiKey).
