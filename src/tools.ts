import { stat, writeFile } from 'node:fs/promises';
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

/** Where a downloaded file goes: the given file, a file inside the given folder, or next to the PDF. */
export async function outputPath(format: FileFormat, sourcePdf: string | null, saveTo: string | undefined, suggested: string | null): Promise<string> {
  const extension = format === 'xero' ? '-xero.csv' : `.${format}`;
  const stem = sourcePdf ? basename(sourcePdf, extname(sourcePdf)) : (suggested ?? 'statement').replace(/(-xero)?\.[^.]+$/, '');

  if (!saveTo) {
    return join(sourcePdf ? dirname(resolve(sourcePdf)) : process.cwd(), `${stem}${extension}`);
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
        'Convert a PDF bank or credit card statement on this computer with BankConv. Returns the transactions (date, description, signed amount, balance) or saves a file next to the PDF. ' +
        formatHelp +
        ' Uses pages from the BankConv account.',
      inputSchema: {
        file_path: z.string().describe('Path to the PDF statement on this computer.'),
        password: z.string().optional().describe('The PDF password, if the statement is password-protected.'),
        output: z
          .enum(['transactions', ...fileFormats])
          .default('transactions')
          .describe('"transactions" returns the rows to you; any other value saves that file. ' + formatHelp),
        save_to: z.string().optional().describe('For file outputs: a file path or folder. Defaults to the PDF\'s folder.'),
        timeout_seconds: z.number().int().min(10).max(900).default(180).describe('How long to wait for the conversion.'),
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
      description: 'Get the transactions of an earlier BankConv conversion: date, description, signed amount and balance, with the account and period.',
      inputSchema: { conversion_id: z.string().describe('The conversion id.'), tables: tablesParam },
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
      description: 'Save an earlier BankConv conversion as a file. ' + formatHelp,
      inputSchema: {
        conversion_id: z.string().describe('The conversion id.'),
        format: z.enum(fileFormats).describe(formatHelp),
        save_to: z.string().optional().describe('A file path or folder. Defaults to the current folder.'),
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
      description: 'List the BankConv account\'s recent conversions with their status, file name and page count.',
      inputSchema: {
        status: z.enum(['pending', 'no_credits', 'processing', 'completed', 'failed']).optional(),
        limit: z.number().int().min(1).max(100).default(15),
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
      description: 'Check how many BankConv pages the account has left this billing period.',
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
