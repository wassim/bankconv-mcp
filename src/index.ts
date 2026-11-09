#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BankConvClient, missingApiKeyMessage } from './client.js';
import { registerTools } from './tools.js';

const apiKey = process.env.BANKCONV_API_KEY;

if (!apiKey) {
  console.error(`${missingApiKeyMessage} The tools are listed, but each call returns this message until the key is set.`);
}

const server = new McpServer({
  name: 'bankconv',
  title: 'BankConv',
  version: '0.1.2',
  websiteUrl: 'https://bankconv.com/integrations/mcp',
  icons: [{ src: 'https://raw.githubusercontent.com/wassim/bankconv-mcp/main/assets/icon.png', mimeType: 'image/png', sizes: ['512x512'] }],
});

registerTools(server, new BankConvClient(apiKey, process.env.BANKCONV_API_URL ?? 'https://bankconv.com/api/v1'));

await server.connect(new StdioServerTransport());
