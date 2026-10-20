import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

export type ConversionStatus = 'pending' | 'no_credits' | 'processing' | 'completed' | 'failed';

export type Conversion = {
  id: string;
  status: ConversionStatus;
  pages_count: number | null;
  expired: boolean;
  created_at: string;
  completed_at: string | null;
  input?: { filename: string; pages_count: number | null };
};

export type Transaction = {
  date: string;
  description: string;
  reference: string | null;
  amount: string;
  balance: string | null;
};

export type Transactions = {
  tables: string;
  institution: string | null;
  country: string | null;
  account_type: string | null;
  account_number: string | null;
  currency: string | null;
  period: { start: string | null; end: string | null };
  transaction_count: number;
  transactions: Transaction[];
  warnings: string[];
};

export type FileFormat = 'csv' | 'ofx' | 'qfx' | 'qbo' | 'xero';

export type DownloadedFile = {
  content: Buffer;
  filename: string | null;
  warnings: string[];
};

export class BankConvError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

export type PollOptions = { timeoutMs?: number; intervalMs?: number; sleep?: (ms: number) => Promise<unknown> };

const defaultSleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The file name from a Content-Disposition header: the UTF-8 `filename*` when present, else `filename`. */
export function dispositionFilename(header: string): string | null {
  const encoded = /filename\*=utf-8''([^;]+)/i.exec(header)?.[1];

  if (encoded) {
    return decodeURIComponent(encoded);
  }

  const quoted = /filename="((?:[^"\\]|\\.)*)"/.exec(header)?.[1];

  if (quoted !== undefined) {
    return quoted.replace(/\\(.)/g, '$1');
  }

  return /filename=([^;]+)/.exec(header)?.[1].trim() ?? null;
}

/** A thin client for the BankConv REST API (https://bankconv.com/api-docs). */
export class BankConvClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = 'https://bankconv.com/api/v1',
    private readonly fetcher: Fetch = fetch,
    private readonly readyPoll: PollOptions = {},
  ) {}

  async upload(filePath: string, password?: string): Promise<Conversion> {
    const form = new FormData();
    form.append('file', new Blob([await readFile(filePath)], { type: 'application/pdf' }), basename(filePath));

    if (password) {
      form.append('password', password);
    }

    return (await this.json<{ data: Conversion }>('POST', '/conversions', form)).data;
  }

  async conversion(id: string): Promise<Conversion> {
    return (await this.json<{ data: Conversion }>('GET', `/conversions/${encodeURIComponent(id)}`)).data;
  }

  async conversions(params: { status?: ConversionStatus; perPage?: number } = {}): Promise<Conversion[]> {
    const query = new URLSearchParams({ per_page: String(params.perPage ?? 15) });

    if (params.status) {
      query.set('status', params.status);
    }

    return (await this.json<{ data: Conversion[] }>('GET', `/conversions?${query}`)).data;
  }

  async transactions(id: string, tables?: string): Promise<Transactions> {
    const query = tables ? `?${new URLSearchParams({ tables })}` : '';

    return this.whenReady(async () => (await this.json<{ data: Transactions }>('GET', `/conversions/${encodeURIComponent(id)}/transactions${query}`)).data);
  }

  async download(id: string, format: FileFormat, tables?: string): Promise<DownloadedFile> {
    const query = new URLSearchParams({ format, ...(format === 'csv' ? { view: 'merged' } : {}), ...(tables ? { tables } : {}) });
    const response = await this.whenReady(() => this.request('GET', `/conversions/${encodeURIComponent(id)}/download?${query}`));
    const warnings = response.headers.get('x-bankconv-warnings');

    return {
      content: Buffer.from(await response.arrayBuffer()),
      filename: dispositionFilename(response.headers.get('content-disposition') ?? ''),
      warnings: warnings ? (JSON.parse(warnings) as string[]) : [],
    };
  }

  async credits(): Promise<unknown> {
    return (await this.json<{ data: unknown }>('GET', '/credits')).data;
  }

  /**
   * Polls until the conversion finishes. Resolves on "completed"; rejects on "failed", "no_credits" or the timeout.
   */
  async waitForCompletion(id: string, { timeoutMs = 180_000, intervalMs = 3_000, sleep = defaultSleep }: PollOptions = {}): Promise<Conversion> {
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const conversion = await this.conversion(id);

      if (conversion.status === 'completed') {
        return conversion;
      }

      if (conversion.status === 'failed') {
        throw new BankConvError('BankConv could not convert this PDF.', 422, 'conversion_failed');
      }

      if (conversion.status === 'no_credits') {
        throw new BankConvError('Not enough BankConv pages left to convert this statement. Top up at https://app.bankconv.com/plans.', 402, 'no_credits');
      }

      if (Date.now() >= deadline) {
        throw new BankConvError(`The conversion is still ${conversion.status}. Check again later with conversion id ${id}.`, 408, 'timeout');
      }

      await sleep(intervalMs);
    }
  }

  /**
   * Retries while the API answers "not_ready": the statement details (account type, period) arrive a few seconds after a conversion completes.
   */
  private async whenReady<T>(call: () => Promise<T>): Promise<T> {
    const { timeoutMs = 300_000, intervalMs = 3_000, sleep = defaultSleep } = this.readyPoll;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      try {
        return await call();
      } catch (error) {
        if (!(error instanceof BankConvError) || error.code !== 'not_ready' || Date.now() >= deadline) {
          throw error;
        }
      }

      await sleep(intervalMs);
    }
  }

  private async json<T>(method: string, path: string, body?: FormData): Promise<T> {
    return (await (await this.request(method, path, body)).json()) as T;
  }

  private async request(method: string, path: string, body?: FormData): Promise<Response> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method,
      body,
      headers: { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json', 'User-Agent': 'bankconv-mcp' },
    });

    if (response.ok) {
      return response;
    }

    let message = `BankConv API error (HTTP ${response.status})`;
    let code = 'error';

    try {
      const payload = (await response.json()) as { error?: { message?: string; code?: string } };
      message = payload.error?.message ?? message;
      code = payload.error?.code ?? code;
    } catch {
      // Not JSON; keep the generic message.
    }

    throw new BankConvError(message, response.status, code);
  }
}
