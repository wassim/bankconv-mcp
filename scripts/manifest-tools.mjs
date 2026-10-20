// Writes the server's tools into manifest.json (name and description, all the bundle format allows) and, with their input schemas, into smithery-tools.json for Smithery's registry.
import { readFile, writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { BankConvClient } from '../dist/client.js';
import { registerTools } from '../dist/tools.js';

const manifestPath = new URL('../manifest.json', import.meta.url);
const server = new McpServer({ name: 'bankconv', version: 'manifest' });
registerTools(server, new BankConvClient('unused'));

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: 'manifest', version: '1' });
await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

const { tools } = await client.listTools();
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.tools = tools.map(({ name, description }) => ({ name, description }));

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(
  new URL('../smithery-tools.json', import.meta.url),
  `${JSON.stringify(tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })), null, 2)}\n`,
);
await client.close();
