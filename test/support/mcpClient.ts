import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SERVER_ENTRY = path.join(REPO_ROOT, "dist", "index.js");

export interface TestServer {
  client: Client;
  workspaceDir: string;
  close(): Promise<void>;
}

/**
 * Spawns the real built stdio server (dist/index.js) - the same entry point a real
 * MCP client (Claude Code, Claude Desktop) launches - and connects a real Client to it
 * over stdio. Each call gets its own throwaway workspace directory, isolated from the
 * repo and from other concurrently-running test files.
 */
export async function startServer(opts: { withJmeterHome?: boolean } = {}): Promise<TestServer> {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), "jmeter-mcp-test-"));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  env.JMETER_MCP_WORKSPACE = workspaceDir;
  if (opts.withJmeterHome === false) {
    delete env.JMETER_HOME;
  }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_ENTRY],
    env,
  });
  const client = new Client({ name: "jmeter-mcp-test-client", version: "0.0.0" });
  await client.connect(transport);

  return {
    client,
    workspaceDir,
    async close() {
      await client.close();
      rmSync(workspaceDir, { recursive: true, force: true });
    },
  };
}

function firstText(result: CallToolResult): string {
  const first = result.content[0];
  if (!first || first.type !== "text") {
    throw new Error(`Expected tool result to have text content, got: ${JSON.stringify(result.content)}`);
  }
  return first.text;
}

/** Calls a tool expecting success, and JSON-parses its jsonResult payload. */
export async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<any> {
  const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
  if (result.isError) {
    throw new Error(`Tool "${name}" returned an error: ${firstText(result)}`);
  }
  return JSON.parse(firstText(result));
}

/** Calls a tool expecting it to fail, and returns the error message text. */
export async function expectToolError(client: Client, name: string, args: Record<string, unknown>): Promise<string> {
  const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
  if (!result.isError) {
    throw new Error(`Expected tool "${name}" to fail but it succeeded: ${firstText(result)}`);
  }
  return firstText(result);
}
