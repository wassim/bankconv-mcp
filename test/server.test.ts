import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { BankConvClient, BankConvError, dispositionFilename, type Transactions } from '../src/client.js';
import { outputPath, registerTools, transactionsResult } from '../src/tools.js';

const transactions: Transactions = {
  tables: '0:1,1:0',
  institution: 'JPMorgan Chase Bank, N.A.',
  country: 'US',
  account_type: 'checking',
  account_number: 'XXXX4821',
  currency: 'USD',
  period: { start: '2026-01-03', end: '2026-01-05' },
  transaction_count: 2,
  transactions: [
    { date: '2026-01-03', description: 'Payroll deposit', reference: null, amount: '3200.00', balance: '4450.00' },
    { date: '2026-01-04', description: 'Coffee shop', reference: null, amount: '-4.80', balance: '4445.20' },
  ],
  warnings: [],
};

const conversion = (status: string) => ({ id: 'c1', status, pages_count: 3, expired: false, created_at: '2026-10-20T10:00:00Z', completed_at: null });

/** A fake BankConv API that records requests and answers by path. */
function fakeApi(statuses: string[] = ['processing', 'completed'], notReadyAnswers = 0) {
  const requests: Array<{ method: string; url: string; headers: Record<string, string>; body: unknown }> = [];

  const fetcher = (async (url: string, init: RequestInit) => {
    requests.push({ method: init.method ?? 'GET', url, headers: init.headers as Record<string, string>, body: init.body });
    const path = new URL(url).pathname.replace('/api/v1', '');

    if (init.method === 'POST' && path === '/conversions') {
      return Response.json({ data: conversion('pending') }, { status: 201 });
    }

    if (path === '/conversions/c1') {
      return Response.json({ data: conversion(statuses.shift() ?? 'completed') });
    }

    if (path.startsWith('/conversions/c1/') && notReadyAnswers > 0) {
      notReadyAnswers--;
      return Response.json({ error: { code: 'not_ready', message: 'The statement details are still being read.', status: 422 } }, { status: 422 });
    }

    if (path === '/conversions/c1/transactions') {
      return Response.json({ data: transactions });
    }

    if (path === '/conversions/c1/download') {
      return new Response('OFXHEADER:100', {
        headers: { 'content-disposition': 'attachment; filename="statement.qbo"', 'x-bankconv-warnings': '["Generic bank ID."]' },
      });
    }

    if (path === '/conversions/missing/transactions') {
      return Response.json({ error: { code: 'not_found', message: 'Resource not found.', status: 404 } }, { status: 404 });
    }

    return Response.json({ data: { remaining: 480 } });
  }) as unknown as typeof fetch;

  return { client: new BankConvClient('sk_test', 'https://bankconv.test/api/v1', fetcher, { sleep: async () => {} }), requests };
}

async function pdf(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'bankconv-mcp-'));
  const path = join(dir, 'chase-jan.pdf');
  await writeFile(path, '%PDF-1.4');

  return path;
}

describe('BankConvClient', () => {
  it('uploads the PDF with the API key and polls until it completes', async () => {
    const { client, requests } = fakeApi(['processing', 'processing', 'completed']);

    const uploaded = await client.upload(await pdf(), 'secret');
    const done = await client.waitForCompletion(uploaded.id, { sleep: async () => {} });

    expect(done.status).toBe('completed');
    expect(requests[0].headers.Authorization).toBe('Bearer sk_test');
    expect((requests[0].body as FormData).get('password')).toBe('secret');
    expect(((requests[0].body as FormData).get('file') as File).name).toBe('chase-jan.pdf');
    expect(requests.filter((request) => request.url.endsWith('/conversions/c1'))).toHaveLength(3);
  });

  it('stops on failed and no_credits conversions', async () => {
    await expect(fakeApi(['failed']).client.waitForCompletion('c1', { sleep: async () => {} })).rejects.toThrow('could not convert');
    await expect(fakeApi(['no_credits']).client.waitForCompletion('c1', { sleep: async () => {} })).rejects.toThrow('Not enough BankConv pages');
  });

  it('gives up after the timeout', async () => {
    const { client } = fakeApi(Array(50).fill('processing'));

    await expect(client.waitForCompletion('c1', { timeoutMs: 0, sleep: async () => {} })).rejects.toMatchObject({ code: 'timeout' });
  });

  it('turns API errors into readable errors', async () => {
    await expect(fakeApi().client.transactions('missing')).rejects.toEqual(new BankConvError('Resource not found.', 404, 'not_found'));
  });

  it('retries while the statement details are still being read', async () => {
    const { client, requests } = fakeApi([], 2);

    expect((await client.transactions('c1')).transaction_count).toBe(2);
    expect(requests).toHaveLength(3);
  });

  it('reads plain, quoted and UTF-8 file names', () => {
    expect(dispositionFilename('attachment; filename=statement.qbo')).toBe('statement.qbo');
    expect(dispositionFilename('attachment; filename="chase \\"jan\\".ofx"')).toBe('chase "jan".ofx');
    expect(dispositionFilename(`attachment; filename="chase e.ofx"; filename*=utf-8''chase%20%C3%A9.ofx`)).toBe('chase é.ofx');
  });

  it('downloads a file with its name and warnings', async () => {
    const { client, requests } = fakeApi();

    const file = await client.download('c1', 'qbo', '0:1');

    expect(file.content.toString()).toBe('OFXHEADER:100');
    expect(file.filename).toBe('statement.qbo');
    expect(file.warnings).toEqual(['Generic bank ID.']);
    expect(requests[0].url).toContain('format=qbo');
    expect(requests[0].url).toContain('tables=0%3A1');
  });
});

describe('tools', () => {
  it('saves files next to the PDF, in a folder, or at a path', async () => {
    const source = await pdf();
    const folder = await mkdtemp(join(tmpdir(), 'bankconv-out-'));

    expect(await outputPath('qbo', source, undefined, null)).toBe(source.replace('.pdf', '.qbo'));
    expect(await outputPath('xero', source, folder, null)).toBe(join(folder, 'chase-jan-xero.csv'));
    expect(await outputPath('ofx', null, join(folder, 'jan.ofx'), 'statement.ofx')).toBe(join(folder, 'jan.ofx'));
    expect(await outputPath('xero', null, folder, 'statement-xero.csv')).toBe(join(folder, 'statement-xero.csv'));
  });

  it('saves files with no PDF next to them in Downloads or the home folder, never the working directory', async () => {
    const path = await outputPath('ofx', null, undefined, 'statement.ofx');

    expect([join(homedir(), 'Downloads', 'statement.ofx'), join(homedir(), 'statement.ofx')]).toContain(path);
  });

  it('summarises transactions before the full JSON', () => {
    const result = transactionsResult(transactions, 'c1');
    const [summary, json] = result.content as Array<{ text: string }>;

    expect(summary.text).toContain('2 transactions from 2026-01-03 to 2026-01-05 in USD.');
    expect(summary.text).toContain('Money in 3200.00, money out -4.80.');
    expect(JSON.parse(json.text).transactions).toHaveLength(2);
  });

  it('converts a statement end to end over MCP', async () => {
    const { client: api } = fakeApi(['completed']);
    const server = new McpServer({ name: 'bankconv', version: 'test' });
    registerTools(server, api);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test', version: '1' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const tools = (await client.listTools()).tools.map((tool) => tool.name);
    expect(tools).toEqual(['convert_statement', 'get_transactions', 'download_statement', 'list_conversions', 'get_credits']);

    const source = await pdf();
    const converted = await client.callTool({ name: 'convert_statement', arguments: { file_path: source } });
    expect((converted.content as Array<{ text: string }>)[0].text).toContain('2 transactions');

    const saved = await client.callTool({ name: 'convert_statement', arguments: { file_path: source, output: 'qbo' } });
    expect((saved.content as Array<{ text: string }>)[0].text).toContain(`Saved QBO to ${source.replace('.pdf', '.qbo')}`);
    expect(await readFile(source.replace('.pdf', '.qbo'), 'utf8')).toBe('OFXHEADER:100');
  });
});
