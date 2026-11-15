---
name: bankconv
description: Convert PDF bank and credit card statements into transactions or CSV, OFX, QFX, QBO and Xero CSV files with the BankConv tools. Use when the user attaches or links a bank or credit card statement PDF and wants its transactions read, analysed or totalled, or needs a file for Excel, QuickBooks, Xero, Quicken, MYOB or Sage.
---

# BankConv: bank statement PDFs to transactions and accounting files

BankConv reads the transaction tables in a PDF bank or credit card statement. Its tools return ISO dates, one signed amount per transaction (money in positive, money out negative) and the running balance, with the bank, account, period and currency. Opening balances and total lines are left out.

## Which tool

| The user wants | Tool |
|---|---|
| Convert a new statement PDF | `convert_statement` with the attached file (for a public HTTPS link the user gave, put it in `file.download_url`) |
| The transactions of a statement converted earlier | `list_conversions` to find its id, then `get_transactions` |
| A file to import | `download_statement` with the conversion id and a format from the table below |
| To know how many pages are left | `get_credits` |

## Which format

| The user wants | format |
|---|---|
| Excel, Google Sheets, most software | `csv` |
| Xero, MYOB, Sage, QuickBooks Online | `ofx` |
| Quicken | `qfx` |
| QuickBooks Desktop (Web Connect) | `qbo` |
| Xero's own CSV columns | `xero` |

## Good to know

- Each PDF page uses one page of the user's BankConv account. Before converting several statements, check the balance with `get_credits`.
- A long statement can take more than a minute. If `convert_statement` returns a conversion id without transactions, fetch them later with `get_transactions`.
- Download links work for one hour. Give the link to the user and pass on any warnings, for example a bank QuickBooks doesn't list.
- Password-protected PDFs can't be converted here; the user can convert them at https://app.bankconv.com.
- BankConv only reads statements. It never connects to a bank account or moves money.
- Only convert files the user asked you to convert.
