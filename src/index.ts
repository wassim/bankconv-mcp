#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BankConvClient } from './client.js';
import { registerTools } from './tools.js';

const apiKey = process.env.BANKCONV_API_KEY;

if (!apiKey) {
  console.error('Set BANKCONV_API_KEY to your BankConv API key. Create one at https://app.bankconv.com/teams/api-keys.');
  process.exit(1);
}

const server = new McpServer({ name: 'bankconv', version: '0.1.0' });

registerTools(server, new BankConvClient(apiKey, process.env.BANKCONV_API_URL ?? 'https://bankconv.com/api/v1'));

await server.connect(new StdioServerTransport());
