import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { addChild, createNode, findNode } from "../jmx/tree.js";
import type { TestNode } from "../jmx/types.js";
import { listPlans, newPlanId, readPlan, writePlan } from "../workspace.js";
import { jsonResult } from "./shared.js";

function requireNode(root: TestNode, parentId: string): TestNode {
  const node = findNode(root, parentId);
  if (!node) {
    throw new Error(`No node with id "${parentId}" was found in this test plan.`);
  }
  return node;
}

export function registerPlanTools(server: McpServer): void {
  server.registerTool(
    "create_test_plan",
    {
      description: "Create a new JMeter test plan. Returns the planId and the id of its root TestPlan node, which you'll use as parentId for the first thread group.",
      inputSchema: {
        name: z.string().describe("Human-readable name for the test plan"),
      },
    },
    ({ name }) => {
      const planId = newPlanId();
      const root = createNode("TestPlan", name);
      writePlan({ planId, name, createdAt: new Date().toISOString(), root });
      return jsonResult({ planId, rootNodeId: root.id });
    },
  );

  server.registerTool(
    "list_test_plans",
    {
      description: "List all test plans in the workspace.",
      inputSchema: {},
    },
    () => jsonResult(listPlans()),
  );

  server.registerTool(
    "get_test_plan",
    {
      description: "Get the full element tree of a test plan, including every node's id (needed as parentId for add_* tools) and type.",
      inputSchema: {
        planId: z.string(),
      },
    },
    ({ planId }) => jsonResult(readPlan(planId)),
  );

  server.registerTool(
    "add_thread_group",
    {
      description: "Add a Thread Group (virtual users) under the given parent node (usually the TestPlan root).",
      inputSchema: {
        planId: z.string(),
        parentId: z.string().describe("Id of the node to attach this thread group under"),
        name: z.string(),
        numThreads: z.number().int().positive().describe("Number of concurrent virtual users"),
        rampTimeSeconds: z.number().nonnegative().describe("Seconds to reach full thread count"),
        loops: z.number().int().describe("Number of loop iterations per thread, -1 for infinite").optional(),
        durationSeconds: z
          .number()
          .positive()
          .describe("If set, run on a scheduler for this many seconds instead of a fixed loop count")
          .optional(),
      },
    },
    ({ planId, parentId, name, numThreads, rampTimeSeconds, loops, durationSeconds }) => {
      const plan = readPlan(planId);
      requireNode(plan.root, parentId);
      const node = createNode("ThreadGroup", name, { numThreads, rampTimeSeconds, loops, durationSeconds });
      addChild(plan.root, parentId, node);
      writePlan(plan);
      return jsonResult({ nodeId: node.id });
    },
  );

  server.registerTool(
    "add_http_sampler",
    {
      description: "Add an HTTP Request sampler under the given parent node (usually a Thread Group).",
      inputSchema: {
        planId: z.string(),
        parentId: z.string(),
        name: z.string(),
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]),
        protocol: z.enum(["http", "https"]).default("https"),
        domain: z.string().describe("Host name, e.g. api.example.com"),
        port: z.number().int().positive().optional(),
        path: z.string().describe("Request path, e.g. /v1/users"),
        bodyJson: z.string().describe("Raw JSON request body, if any").optional(),
      },
    },
    ({ planId, parentId, name, method, protocol, domain, port, path, bodyJson }) => {
      const plan = readPlan(planId);
      requireNode(plan.root, parentId);
      const node = createNode("HTTPSamplerProxy", name, {
        method,
        protocol,
        domain,
        port,
        path,
        bodyJson,
      });
      addChild(plan.root, parentId, node);
      writePlan(plan);
      return jsonResult({ nodeId: node.id });
    },
  );

  server.registerTool(
    "add_json_extractor",
    {
      description: "Add a JSON Extractor post-processor under an HTTP sampler, to save a value from the JSON response into a variable.",
      inputSchema: {
        planId: z.string(),
        parentId: z.string().describe("Id of the HTTP sampler node this extractor applies to"),
        name: z.string(),
        referenceName: z.string().describe("JMeter variable name to store the extracted value in"),
        jsonPathExpr: z.string().describe("JSONPath expression, e.g. $.data.id"),
        defaultValue: z.string().default("NOT_FOUND").describe("Value to use if the JSONPath doesn't match"),
      },
    },
    ({ planId, parentId, name, referenceName, jsonPathExpr, defaultValue }) => {
      const plan = readPlan(planId);
      requireNode(plan.root, parentId);
      const node = createNode("JSONPostProcessor", name, { referenceName, jsonPathExpr, defaultValue });
      addChild(plan.root, parentId, node);
      writePlan(plan);
      return jsonResult({ nodeId: node.id });
    },
  );

  server.registerTool(
    "add_header_manager",
    {
      description: "Add an HTTP Header Manager under an HTTP sampler (or a Thread Group, to apply to every sampler in it).",
      inputSchema: {
        planId: z.string(),
        parentId: z.string(),
        name: z.string().default("HTTP Header Manager"),
        headers: z.array(z.object({ name: z.string(), value: z.string() })).min(1),
      },
    },
    ({ planId, parentId, name, headers }) => {
      const plan = readPlan(planId);
      requireNode(plan.root, parentId);
      const node = createNode("HeaderManager", name, { headers });
      addChild(plan.root, parentId, node);
      writePlan(plan);
      return jsonResult({ nodeId: node.id });
    },
  );

  server.registerTool(
    "add_response_assertion",
    {
      description: "Add a Response Assertion under an HTTP sampler, to fail the sample if the response doesn't match.",
      inputSchema: {
        planId: z.string(),
        parentId: z.string(),
        name: z.string().default("Response Assertion"),
        testField: z
          .enum(["response_data", "response_code", "response_headers", "response_message"])
          .default("response_data"),
        matchType: z.enum(["contains", "matches", "equals", "substring"]).default("contains"),
        patterns: z.array(z.string()).min(1),
        not: z.boolean().default(false).describe("Negate the match (assert the pattern does NOT match)"),
      },
    },
    ({ planId, parentId, name, testField, matchType, patterns, not }) => {
      const plan = readPlan(planId);
      requireNode(plan.root, parentId);
      const node = createNode("ResponseAssertion", name, { testField, matchType, patterns, not });
      addChild(plan.root, parentId, node);
      writePlan(plan);
      return jsonResult({ nodeId: node.id });
    },
  );

  server.registerTool(
    "add_aggregate_report_listener",
    {
      description: "Add an Aggregate Report listener under the given parent (Thread Group or TestPlan). Its output is what get_execution_report reads after a run.",
      inputSchema: {
        planId: z.string(),
        parentId: z.string(),
        name: z.string().default("Aggregate Report"),
        filename: z.string().describe("Filename kept in the .jmx for portability; ignored at execution time").optional(),
      },
    },
    ({ planId, parentId, name, filename }) => {
      const plan = readPlan(planId);
      requireNode(plan.root, parentId);
      const node = createNode("ResultCollectorAggregate", name, { filename });
      addChild(plan.root, parentId, node);
      writePlan(plan);
      return jsonResult({ nodeId: node.id });
    },
  );

  server.registerTool(
    "add_summary_report_listener",
    {
      description: "Add a Summary Report listener under the given parent (Thread Group or TestPlan). Its output is what get_execution_report reads after a run.",
      inputSchema: {
        planId: z.string(),
        parentId: z.string(),
        name: z.string().default("Summary Report"),
        filename: z.string().describe("Filename kept in the .jmx for portability; ignored at execution time").optional(),
      },
    },
    ({ planId, parentId, name, filename }) => {
      const plan = readPlan(planId);
      requireNode(plan.root, parentId);
      const node = createNode("ResultCollectorSummary", name, { filename });
      addChild(plan.root, parentId, node);
      writePlan(plan);
      return jsonResult({ nodeId: node.id });
    },
  );
}
