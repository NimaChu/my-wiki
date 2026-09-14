import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createVikiQueryTools, vikiQueryToolDefinitions } from "./viki-query-tools.mjs";

const allowWeb = process.argv[3] === "web";
let query;
const server = new Server({ name: "my-wiki-query", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: vikiQueryToolDefinitions(allowWeb) }));
server.setRequestHandler(CallToolRequestSchema, async ({ params }, { signal }) => {
  try {
    // Large vault indexing must not delay the MCP initialization handshake.
    query ||= createVikiQueryTools(process.argv[2], allowWeb);
    return await (await query).call(params.name, params.arguments, signal);
  }
  catch { return { isError: true, content: [{ type: "text", text: "The requested tool or evidence is unavailable in this scope. Use listed documents and available tools." }] }; }
});
await server.connect(new StdioServerTransport());
