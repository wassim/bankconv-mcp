# BankConv for Hermes

Convert PDF bank and credit card statements from Hermes. Point the agent at a statement on your computer and it returns the transactions (ISO dates, one signed amount, running balance; opening balances and totals left out), or saves a file next to the PDF: CSV, OFX for Xero, MYOB, Sage and QuickBooks Online, QFX for Quicken, QBO Web Connect for QuickBooks Desktop, or Xero CSV. It handles password-protected and scanned PDFs.

This package bundles the [BankConv MCP server](https://bankconv.com/integrations/mcp) (`bankconv-mcp` on npm, pinned to 0.1.1) and a `bankconv` skill that tells the agent how to use it.

## Install

1. Create an API key at [app.bankconv.com/teams/api-keys](https://app.bankconv.com/teams/api-keys) and add it to your shell or Hermes profile `.env`:

   ```bash
   BANKCONV_API_KEY=sk_live_your_api_key
   ```

2. Install and enable the plugin:

   ```bash
   hermes plugins install bankconv
   hermes plugins enable bankconv
   ```

Node.js 20 or newer is needed: Hermes starts the server with `npx`.

## Tools

| Tool | What it does | Asks first |
|---|---|---|
| `convert_statement` | Converts a PDF and returns the transactions. Uses one BankConv page per PDF page | Yes |
| `get_transactions` | Reads the transactions of an earlier conversion | No |
| `download_statement` | Saves a CSV, OFX, QFX, QBO or Xero CSV file next to the PDF | Yes |
| `list_conversions` | Lists earlier conversions | No |
| `get_credits` | Shows the pages left on the account | No |

The package marks the server `untrusted`, so Hermes asks before each tool that isn't read-only and refuses them in unattended runs.

## Example prompts

- Convert ~/Downloads/september.pdf and list my ten biggest expenses.
- Turn every PDF in ~/Statements/2026 into OFX files for Xero.
- Convert amex-march.pdf to QBO for QuickBooks Desktop.

## What leaves your computer

The PDFs you name go to BankConv over HTTPS and are deleted after 24 hours by default. The agent only sees the transactions if you ask for them; for file outputs it gets back the saved path. The server makes no other network calls and keeps no files of its own.

## Links

- [BankConv](https://bankconv.com): bank statement converter
- [MCP setup for other clients](https://bankconv.com/integrations/mcp)
- [API reference](https://bankconv.com/api-docs)
- [Supported banks](https://bankconv.com/banks)
- Support: support@bankconv.com
