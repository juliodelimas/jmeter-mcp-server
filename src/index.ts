#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerExecutionTools } from "./tools/executionTools.js";
import { registerPlanTools } from "./tools/planTools.js";

const server = new McpServer({
  name: "jmeter-mcp-server",
  version: "0.1.0",
});

registerPlanTools(server);
registerExecutionTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error starting jmeter-mcp-server:", err);
  process.exit(1);
});
