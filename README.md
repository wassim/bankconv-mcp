# BankConv MCP server

[![wassim/bankconv-mcp MCP server](https://glama.ai/mcp/servers/wassim/bankconv-mcp/badges/score.svg)](https://glama.ai/mcp/servers/wassim/bankconv-mcp)

Convert PDF bank statements into transactions, CSV, OFX, QFX, QBO or Xero CSV from Claude, Cursor, VS Code and other AI assistants.

Point your assistant at a statement on your computer and ask for what you need: the transactions to analyse, a CSV, or a file your accounting software imports. The server uploads the PDF to [BankConv](https://bankconv.com), waits for the conversion and either returns the transactions or saves the file next to the PDF.

```
You: Convert ~/Downloads/chase-september.pdf to QBO for QuickBooks Desktop.
Assistant: Saved QBO to ~/Downloads/chase-september.qbo.
```

## What you get

- **Transactions** with real dates, one signed amount (money in positive, money out negative) and the running balance. Opening balance and total lines are left out.
- **Files**: CSV, OFX (Xero, Sage, MYOB, QuickBooks Online), QFX (Quicken), QBO (QuickBooks Desktop Web Connect, with your bank's QuickBooks ID) and Xero CSV (Xero's own columns).
- Password-protected PDFs, scanned statements and multi-page statements.

## Setup

1. Create an API key in BankConv under **Team → API keys** (<https://app.bankconv.com/teams/api-keys>). Conversions use pages from your BankConv plan.
2. Add the server to your assistant with the key in `BANKCONV_API_KEY`.

### Claude Code

```bash
claude mcp add bankconv -e BANKCONV_API_KEY=sk_live_your_key -- npx -y bankconv-mcp
```

### Claude Desktop

One click: download [`bankconv.mcpb`](https://github.com/wassim/bankconv-mcp/releases/latest/download/bankconv.mcpb) and open it. Claude Desktop installs the server and asks for your API key.

Or add this to `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "bankconv": {
      "command": "npx",
      "args": ["-y", "bankconv-mcp"],
      "env": { "BANKCONV_API_KEY": "sk_live_your_key" }
    }
  }
}
```

### Cursor, Windsurf and other clients

Use the same `command`, `args` and `env` in the client's MCP settings (for Cursor, `~/.cursor/mcp.json`).

### VS Code

```json
{
  "servers": {
    "bankconv": {
      "command": "npx",
      "args": ["-y", "bankconv-mcp"],
      "env": { "BANKCONV_API_KEY": "sk_live_your_key" }
    }
  }
}
```

Requires Node.js 20 or later.

## Tools

| Tool | What it does |
| --- | --- |
| `convert_statement` | Convert a PDF on this computer. Returns the transactions, or saves CSV, OFX, QFX, QBO or Xero CSV (next to the PDF unless you give `save_to`). Takes the PDF password if there is one. |
| `get_transactions` | Get the transactions of an earlier conversion. |
| `download_statement` | Save an earlier conversion as CSV, OFX, QFX, QBO or Xero CSV (in Downloads unless you say where). |
| `list_conversions` | List recent conversions with their status. |
| `get_credits` | Check how many pages are left this billing period. |

## Example prompts

- "Convert `statement.pdf` and tell me my five biggest expenses."
- "Turn every PDF in `~/Statements/2026` into OFX files for Xero."
- "Convert `amex-march.pdf` to QBO for QuickBooks Desktop. The PDF password is 4821."
- "Total my September spending by category from `chase-sep.pdf`."

## Agent skill

For agents without MCP support, [`skills/bankconv/SKILL.md`](skills/bankconv/SKILL.md) teaches the same workflow through the REST API with `curl`.

## Privacy

The PDF is uploaded to BankConv over HTTPS and processed there. The PDF and its converted files are deleted automatically after 24 hours, or 48 or 72 hours if your team chose a longer window; see [security and data handling](https://bankconv.com/security). The server only reads the files you name and only writes the files you ask for.

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `BANKCONV_API_KEY` | (required) | Your BankConv API key |
| `BANKCONV_API_URL` | `https://bankconv.com/api/v1` | API base URL |

## Links

- [BankConv](https://bankconv.com) · [MCP server page](https://bankconv.com/integrations/mcp) · [API docs](https://bankconv.com/api-docs) · [Supported banks](https://bankconv.com/banks)

## License

MIT
