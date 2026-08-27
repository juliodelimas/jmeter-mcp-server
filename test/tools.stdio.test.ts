import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startServer, callTool, expectToolError, type TestServer } from "./support/mcpClient.js";

/** Recursively finds a node by id in the JSON tree returned by get_test_plan. */
function findNode(node: any, id: string): any {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return undefined;
}

let server: TestServer;
let planId: string;
let rootId: string;
let threadGroupId: string;
let samplerId: string;
let csvFixtureDir: string;
let csvFixturePath: string;

before(async () => {
  server = await startServer();
  csvFixtureDir = mkdtempSync(path.join(tmpdir(), "jmeter-mcp-test-fixtures-"));
  csvFixturePath = path.join(csvFixtureDir, "data.csv");
  writeFileSync(csvFixturePath, "username,password\nalice,pw1\n", "utf-8");
});

after(async () => {
  await server.close();
  rmSync(csvFixtureDir, { recursive: true, force: true });
});

test("list_test_plans / create_test_plan / get_test_plan round trip", async () => {
  const before = await callTool(server.client, "list_test_plans", {});
  assert.ok(Array.isArray(before));

  const created = await callTool(server.client, "create_test_plan", { name: "Tools Test Plan" });
  assert.ok(created.planId);
  assert.ok(created.rootNodeId);
  planId = created.planId;
  rootId = created.rootNodeId;

  const after = await callTool(server.client, "list_test_plans", {});
  assert.ok(after.some((p: any) => p.planId === planId));

  const tree = await callTool(server.client, "get_test_plan", { planId });
  assert.equal(tree.root.id, rootId);
  assert.equal(tree.root.type, "TestPlan");
});

test("add_thread_group", async () => {
  const { nodeId } = await callTool(server.client, "add_thread_group", {
    planId,
    parentId: rootId,
    name: "Users",
    numThreads: 2,
    rampTimeSeconds: 1,
    loops: 1,
  });
  threadGroupId = nodeId;
  const tree = await callTool(server.client, "get_test_plan", { planId });
  const node = findNode(tree.root, threadGroupId);
  assert.equal(node.type, "ThreadGroup");
  assert.equal(node.props.numThreads, 2);
});

test("add_http_sampler", async () => {
  const { nodeId } = await callTool(server.client, "add_http_sampler", {
    planId,
    parentId: threadGroupId,
    name: "Get Users",
    method: "GET",
    protocol: "https",
    domain: "example.org",
    path: "/users",
  });
  samplerId = nodeId;
  const tree = await callTool(server.client, "get_test_plan", { planId });
  const node = findNode(tree.root, samplerId);
  assert.equal(node.type, "HTTPSamplerProxy");
  assert.equal(node.props.domain, "example.org");
});

interface ToolCase {
  tool: string;
  parent: () => string;
  args: Record<string, unknown> | (() => Record<string, unknown>);
  expectType: string;
  check?: (props: any) => void;
}

const cases: ToolCase[] = [
  {
    tool: "add_header_manager",
    parent: () => samplerId,
    args: { headers: [{ name: "X-Test", value: "1" }] },
    expectType: "HeaderManager",
  },
  {
    tool: "add_json_extractor",
    parent: () => samplerId,
    args: { name: "Extract Id", referenceName: "id", jsonPathExpr: "$.id" },
    expectType: "JSONPostProcessor",
  },
  {
    tool: "add_response_assertion",
    parent: () => samplerId,
    args: { patterns: ["ok"] },
    expectType: "ResponseAssertion",
  },
  {
    tool: "add_aggregate_report_listener",
    parent: () => threadGroupId,
    args: {},
    expectType: "ResultCollectorAggregate",
  },
  {
    tool: "add_summary_report_listener",
    parent: () => threadGroupId,
    args: {},
    expectType: "ResultCollectorSummary",
  },
  {
    tool: "add_csv_data_set",
    parent: () => threadGroupId,
    args: () => ({ filename: csvFixturePath }),
    expectType: "CSVDataSet",
  },
  {
    tool: "add_user_defined_variables",
    parent: () => rootId,
    args: { variables: [{ name: "host", value: "example.org" }] },
    expectType: "Arguments",
  },
  {
    tool: "add_constant_timer",
    parent: () => samplerId,
    args: { delayMs: 100 },
    expectType: "ConstantTimer",
  },
  {
    tool: "add_regex_extractor",
    parent: () => samplerId,
    args: { referenceName: "token", regex: "token=(.*)" },
    expectType: "RegexExtractor",
  },
  {
    tool: "add_transaction_controller",
    parent: () => threadGroupId,
    args: { name: "Flow" },
    expectType: "TransactionController",
  },
  {
    tool: "add_loop_controller",
    parent: () => threadGroupId,
    args: { loops: 3 },
    expectType: "LoopController",
  },
  {
    tool: "add_if_controller",
    parent: () => threadGroupId,
    args: { condition: "${count} < 10" },
    expectType: "IfController",
  },
  {
    tool: "add_jdbc_connection_configuration",
    parent: () => threadGroupId,
    args: { dataSource: "pool1", dbUrl: "jdbc:postgresql://host/db", driver: "org.postgresql.Driver" },
    expectType: "JDBCConnectionConfiguration",
  },
  {
    tool: "add_jdbc_request",
    parent: () => threadGroupId,
    args: { dataSource: "pool1", query: "select 1" },
    expectType: "JDBCRequest",
  },
  {
    tool: "add_jsr223_sampler",
    parent: () => threadGroupId,
    args: { scriptLanguage: "groovy", script: "1+1" },
    expectType: "JSR223Sampler",
  },
  {
    tool: "add_ftp_request",
    parent: () => threadGroupId,
    args: { server: "ftp.example.org", filename: "/f.txt" },
    expectType: "FTPRequest",
  },
  {
    tool: "add_tcp_sampler",
    parent: () => threadGroupId,
    args: { server: "localhost", port: 9999, request: "PING\n" },
    expectType: "TCPSampler",
  },
  {
    tool: "add_http_request_defaults",
    parent: () => rootId,
    args: { protocol: "https", domain: "example.org" },
    expectType: "HTTPRequestDefaults",
  },
  {
    tool: "add_cookie_manager",
    parent: () => rootId,
    args: {},
    expectType: "CookieManager",
  },
  {
    tool: "add_while_controller",
    parent: () => threadGroupId,
    args: { condition: "" },
    expectType: "WhileController",
  },
  {
    tool: "add_random_controller",
    parent: () => threadGroupId,
    args: {},
    expectType: "RandomController",
  },
  {
    tool: "add_interleave_controller",
    parent: () => threadGroupId,
    args: {},
    expectType: "InterleaveController",
  },
  {
    tool: "add_setup_thread_group",
    parent: () => rootId,
    args: { numThreads: 1, rampTimeSeconds: 1, loops: 1 },
    expectType: "SetupThreadGroup",
  },
  {
    tool: "add_teardown_thread_group",
    parent: () => rootId,
    args: { numThreads: 1, rampTimeSeconds: 1, loops: 1 },
    expectType: "PostThreadGroup",
  },
  {
    tool: "add_xpath_extractor",
    parent: () => samplerId,
    args: { referenceName: "title", xpathQuery: "//title/text()" },
    expectType: "XPathExtractor",
  },
  {
    tool: "add_jsr223_preprocessor",
    parent: () => samplerId,
    args: { scriptLanguage: "groovy", script: "vars.put('a','1')" },
    expectType: "JSR223PreProcessor",
  },
  {
    tool: "add_jsr223_postprocessor",
    parent: () => samplerId,
    args: { scriptLanguage: "groovy", script: "vars.put('b','2')" },
    expectType: "JSR223PostProcessor",
  },
  {
    tool: "add_user_parameters",
    parent: () => threadGroupId,
    args: { variableNames: ["u", "p"], valueSets: [["alice", "pw1"], ["bob", "pw2"]] },
    expectType: "UserParameters",
  },
  {
    tool: "add_json_assertion",
    parent: () => samplerId,
    args: { jsonPath: "$.value" },
    expectType: "JSONAssertion",
  },
  {
    tool: "add_duration_assertion",
    parent: () => samplerId,
    args: { maxDurationMs: 5000 },
    expectType: "DurationAssertion",
  },
  {
    tool: "add_size_assertion",
    parent: () => samplerId,
    args: { size: 1024, operator: "greaterthan" },
    expectType: "SizeAssertion",
  },
  {
    tool: "add_uniform_random_timer",
    parent: () => samplerId,
    args: { delayMs: 1000, rangeMs: 500 },
    expectType: "UniformRandomTimer",
  },
  {
    tool: "add_constant_throughput_timer",
    parent: () => threadGroupId,
    args: { targetSamplesPerMinute: 30 },
    expectType: "ConstantThroughputTimer",
  },
  {
    tool: "add_view_results_tree_listener",
    parent: () => threadGroupId,
    args: {},
    expectType: "ResultCollectorViewResultsTree",
  },
  {
    tool: "add_backend_listener",
    parent: () => rootId,
    args: {},
    expectType: "BackendListener",
  },
];

for (const c of cases) {
  test(c.tool, async () => {
    const extraArgs = typeof c.args === "function" ? c.args() : c.args;
    const { nodeId } = await callTool(server.client, c.tool, { planId, parentId: c.parent(), ...extraArgs });
    assert.ok(typeof nodeId === "string" && nodeId.length > 0);
    const tree = await callTool(server.client, "get_test_plan", { planId });
    const node = findNode(tree.root, nodeId);
    assert.ok(node, `node ${nodeId} from ${c.tool} not found in plan tree`);
    assert.equal(node.type, c.expectType);
    c.check?.(node.props);
  });
}

test("validation: add_csv_data_set rejects a relative path", async () => {
  const message = await expectToolError(server.client, "add_csv_data_set", {
    planId,
    parentId: threadGroupId,
    filename: "relative/data.csv",
  });
  assert.match(message, /absolute path/i);
});

test("validation: add_csv_data_set rejects a nonexistent absolute path", async () => {
  const message = await expectToolError(server.client, "add_csv_data_set", {
    planId,
    parentId: threadGroupId,
    filename: "/definitely/does/not/exist.csv",
  });
  assert.match(message, /not found/i);
});

test("validation: add_user_parameters rejects a mismatched valueSets length", async () => {
  const message = await expectToolError(server.client, "add_user_parameters", {
    planId,
    parentId: threadGroupId,
    variableNames: ["a", "b"],
    valueSets: [["only-one-value"]],
  });
  assert.match(message, /valueSets\[0\]/);
});

test("validation: unknown parentId produces a clear error", async () => {
  const message = await expectToolError(server.client, "add_constant_timer", {
    planId,
    parentId: "node_doesnotexist",
    delayMs: 100,
  });
  assert.match(message, /No node with id/);
});

test("validation: unknown planId produces a clear error", async () => {
  const message = await expectToolError(server.client, "get_test_plan", { planId: "plan_doesnotexist" });
  assert.match(message, /not found/i);
});

test("execute_test_plan fails clearly when JMETER_HOME is not resolvable", async () => {
  const noJmeter = await startServer({ withJmeterHome: false });
  try {
    const created = await callTool(noJmeter.client, "create_test_plan", { name: "No JMeter" });
    const message = await expectToolError(noJmeter.client, "execute_test_plan", { planId: created.planId });
    assert.match(message, /JMETER_HOME/);
  } finally {
    await noJmeter.close();
  }
});
