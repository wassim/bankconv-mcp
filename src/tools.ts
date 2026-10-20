import { existsSync } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { BankConvClient, BankConvError, type FileFormat, type Transactions } from './client.js';

const fileFormats = ['csv', 'ofx', 'qfx', 'qbo', 'xero'] as const;

const formatHelp =
  'csv: the statement as a spreadsheet; ofx: Xero, Sage, MYOB, QuickBooks Online; qfx: Quicken; qbo: QuickBooks Desktop (Web Connect); xero: Xero CSV with Xero\'s own columns.';

const tablesParam = z
  .string()
  .regex(/^\d+:\d+(,\d+:\d+)*$/)
  .optional()
  .describe('Advanced: which tables to read, as page:table indexes from 0 ("0:1,1:0"). Leave out and BankConv picks the transaction tables.');

const errorHelp =
  'Errors say what went wrong: not_found for an unknown conversion id, gone once a conversion was deleted under data retention (24 hours by default), unreadable_statement when the tables can\'t be read as transactions (the message names the row), insufficient_credits when the account has too few pages.';

/** The folder for files that have no PDF next to them: Downloads when it exists, else the home folder. */
function defaultFolder(): string {
  const downloads = join(homedir(), 'Downloads');

  return existsSync(downloads) ? downloads : homedir();
}

/** Where a downloaded file goes: the given file, a file inside the given folder, next to the PDF, or in the default folder. */
export async function outputPath(format: FileFormat, sourcePdf: string | null, saveTo: string | undefined, suggested: string | null): Promise<string> {
  const extension = format === 'xero' ? '-xero.csv' : `.${format}`;
  const stem = sourcePdf ? basename(sourcePdf, extname(sourcePdf)) : (suggested ?? 'statement').replace(/(-xero)?\.[^.]+$/, '');

  if (!saveTo) {
    return join(sourcePdf ? dirname(resolve(sourcePdf)) : defaultFolder(), `${stem}${extension}`);
  }

  const target = resolve(saveTo);
  const isDirectory = await stat(target).then((info) => info.isDirectory()).catch(() => false);

  return isDirectory ? join(target, `${stem}${extension}`) : target;
}

/** A short, readable summary for the assistant, followed by the full data as JSON. */
export function transactionsResult(data: Transactions, conversionId: string): CallToolResult {
  const account = [data.institution, data.account_type, data.account_number].filter(Boolean).join(' · ');
  const totals = data.transactions.reduce(
    (sum, row) => {
      const amount = Number(row.amount);
      return amount >= 0 ? { ...sum, in: sum.in + amount } : { ...sum, out: sum.out + amount };
    },
    { in: 0, out: 0 },
  );
  const lines = [
    `${data.transaction_count} transactions${data.period.start ? ` from ${data.period.start} to ${data.period.end}` : ''}${data.currency ? ` in ${data.currency}` : ''}.`,
    account ? `Account: ${account}.` : null,
    `Money in ${totals.in.toFixed(2)}, money out ${totals.out.toFixed(2)}.`,
    data.warnings.length ? `Warnings: ${data.warnings.join(' ')}` : null,
    `Conversion id: ${conversionId} (tables ${data.tables}).`,
  ].filter(Boolean);

  return {
    content: [
      { type: 'text', text: lines.join('\n') },
      { type: 'text', text: JSON.stringify(data, null, 2) },
    ],
  };
}

function errorResult(error: unknown): CallToolResult {
  const message = error instanceof BankConvError || error instanceof Error ? error.message : String(error);

  return { isError: true, content: [{ type: 'text', text: message }] };
}

async function saveFile(client: BankConvClient, conversionId: string, format: FileFormat, sourcePdf: string | null, saveTo: string | undefined, tables?: string): Promise<CallToolResult> {
  const file = await client.download(conversionId, format, tables);
  const path = await outputPath(format, sourcePdf, saveTo, file.filename);
  await writeFile(path, file.content);

  const lines = [`Saved ${format.toUpperCase()} to ${path}.`, file.warnings.length ? `Warnings: ${file.warnings.join(' ')}` : null, `Conversion id: ${conversionId}.`];

  return { content: [{ type: 'text', text: lines.filter(Boolean).join('\n') }] };
}

export function registerTools(server: McpServer, client: BankConvClient): void {
  server.registerTool(
    'convert_statement',
    {
      title: 'Convert a bank statement PDF',
      description:
        'Convert a PDF bank or credit card statement on this computer with BankConv. Use this for a new PDF; for a statement converted earlier, use get_transactions or download_statement with its conversion id (list_conversions finds it). ' +
        'With output "transactions" (the default) it returns a summary and every transaction as JSON: ISO date, description, signed amount (money in positive), running balance; opening balances and totals are left out. ' +
        'Any other output saves that file and returns only its path and any warnings. ' +
        formatHelp +
        ' Uploading uses one BankConv page per PDF page. Waits until the conversion finishes. ' +
        errorHelp,
      inputSchema: {
        file_path: z.string().describe('Path to the PDF statement on this computer.'),
        password: z.string().optional().describe('The PDF password, if the statement is password-protected.'),
        output: z
          .enum(['transactions', ...fileFormats])
          .default('transactions')
          .describe('"transactions" returns the rows to you; any other value saves that file. ' + formatHelp),
        save_to: z.string().optional().describe('For file outputs: a file path or folder. Defaults to the PDF\'s folder, named after the PDF. An existing file at that path is overwritten.'),
        timeout_seconds: z.number().int().min(10).max(900).default(180).describe('How long to wait for the conversion. On timeout the conversion keeps running; fetch it later with its conversion id.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ file_path, password, output, save_to, timeout_seconds }) => {
      try {
        const uploaded = await client.upload(resolve(file_path), password);
        await client.waitForCompletion(uploaded.id, { timeoutMs: timeout_seconds * 1000 });

        if (output === 'transactions') {
          return transactionsResult(await client.transactions(uploaded.id), uploaded.id);
        }

        return await saveFile(client, uploaded.id, output, file_path, save_to);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'get_transactions',
    {
      title: 'Get the transactions of a conversion',
      description:
        'Get the transactions of an earlier BankConv conversion by its conversion id (from convert_statement or list_conversions): ISO date, description, signed amount (money in positive) and running balance, with the bank, account, period and currency. Read-only; uses no pages. To save a file instead, use download_statement. ' +
        errorHelp,
      inputSchema: { conversion_id: z.string().describe('The conversion id, as returned by convert_statement or list_conversions.'), tables: tablesParam },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ conversion_id, tables }) => {
      try {
        return transactionsResult(await client.transactions(conversion_id, tables), conversion_id);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'download_statement',
    {
      title: 'Save a conversion as a file',
      description:
        'Save an earlier BankConv conversion as a file on this computer, by its conversion id (from convert_statement or list_conversions). Returns the saved path and any warnings (for example a bank QuickBooks doesn\'t list), not the file contents. Uses no pages. ' +
        formatHelp +
        ' ' +
        errorHelp,
      inputSchema: {
        conversion_id: z.string().describe('The conversion id, as returned by convert_statement or list_conversions.'),
        format: z.enum(fileFormats).describe(formatHelp),
        save_to: z
          .string()
          .optional()
          .describe('A file path or folder. Defaults to the Downloads folder (or the home folder), named after the original PDF. An existing file at that path is overwritten.'),
        tables: tablesParam,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ conversion_id, format, save_to, tables }) => {
      try {
        return await saveFile(client, conversion_id, format, null, save_to, tables);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'list_conversions',
    {
      title: 'List recent conversions',
      description:
        'List the BankConv account\'s recent conversions, newest first, one line each: conversion id, status, file name, page count and upload time. Use it to find the id of an earlier conversion for get_transactions or download_statement, or to check on one still processing. Read-only.',
      inputSchema: {
        status: z
          .enum(['pending', 'no_credits', 'processing', 'completed', 'failed'])
          .optional()
          .describe('Only list conversions with this status. no_credits means it waits for pages; failed means the PDF couldn\'t be converted.'),
        limit: z.number().int().min(1).max(100).default(15).describe('How many conversions to list, 1 to 100.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ status, limit }) => {
      try {
        const conversions = await client.conversions({ status, perPage: limit });
        const lines = conversions.map(
          (conversion) => `${conversion.id} · ${conversion.status} · ${conversion.input?.filename ?? 'statement'} · ${conversion.pages_count ?? '?'} pages · ${conversion.created_at}`,
        );

        return { content: [{ type: 'text', text: lines.length ? lines.join('\n') : 'No conversions yet.' }] };
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'get_credits',
    {
      title: 'Check the page balance',
      description:
        'Check how many BankConv pages the account has left in the current period, as JSON. Each PDF page uses one page, so check before converting a large batch. Read-only.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(await client.credits(), null, 2) }] };
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
