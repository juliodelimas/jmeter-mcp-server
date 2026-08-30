import { existsSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  addChild,
  createNode,
  findNode,
  moveNode,
  removeNode,
  renameNode,
  reorderChildren,
  updateNodeProps,
} from "../jmx/tree.js";
import { parseJmx } from "../jmx/parser.js";
import { propSchemas } from "../jmx/propSchemas.js";
import { serializePlan } from "../jmx/serializer.js";
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
      description:
        "Add an HTTP Request sampler under the given parent node (usually a Thread Group). Omit protocol/domain/" +
        "port entirely (don't just leave them out - they have no default) to inherit those fields from an " +
        "HTTP Request Defaults config element in scope (add_http_request_defaults). Passing an explicit value " +
        "always overrides the Defaults for that field.",
      inputSchema: {
        planId: z.string(),
        parentId: z.string(),
        name: z.string(),
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]),
        protocol: z.enum(["http", "https"]).optional().describe("Omit to inherit from HTTP Request Defaults"),
        domain: z.string().describe("Host name, e.g. api.example.com. Omit to inherit from HTTP Request Defaults").optional(),
        port: z.number().int().positive().optional().describe("Omit to inherit from HTTP Request Defaults"),
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

  server.registerTool(
    "add_csv_data_set",
    {
      description:
        "Add a CSV Data Set Config under the given parent (a Thread Group to feed every sampler in it, or a " +
        "single sampler to scope it there). Each thread reads one row per iteration, exposing each column as a " +
        "JMeter variable. The filename must be an absolute path readable on the machine that will run the test " +
        "(execute_test_plan runs JMeter from a fresh per-execution directory, so relative paths won't resolve).",
      inputSchema: {
        planId: z.string(),
        parentId: z.string(),
        name: z.string().default("CSV Data Set Config"),
        filename: z.string().describe("Absolute path to the CSV file"),
        variableNames: z
          .string()
          .describe("Comma-separated column names, e.g. 'username,password'. Omit if the CSV has a header row.")
          .optional(),
        delimiter: z.string().default(","),
        ignoreFirstLine: z.boolean().default(false).describe("Set true if the CSV's first line is a header row"),
        recycle: z.boolean().default(true).describe("Start over from the first line once the last row is used"),
        stopThread: z.boolean().default(false).describe("Stop the thread once the file is exhausted (instead of recycling)"),
      },
    },
    ({ planId, parentId, name, filename, variableNames, delimiter, ignoreFirstLine, recycle, stopThread }) => {
      if (!isAbsolute(filename)) {
        throw new Error(`filename must be an absolute path, got "${filename}".`);
      }
      if (!existsSync(filename)) {
        throw new Error(`CSV file not found: ${filename}`);
      }
      const plan = readPlan(planId);
      requireNode(plan.root, parentId);
      const node = createNode("CSVDataSet", name, {
        filename,
        variableNames,
        delimiter,
        ignoreFirstLine,
        recycle,
        stopThread,
      });
      addChild(plan.root, parentId, node);
      writePlan(plan);
      return jsonResult({ nodeId: node.id });
    },
  );

  server.registerTool(
    "add_user_defined_variables",
    {
      description:
        "Add a User Defined Variables config element under the given parent (TestPlan root for global variables, " +
        "or a Thread Group to scope them there). Values are set once, before the test starts.",
      inputSchema: {
        planId: z.string(),
        parentId: z.string(),
        name: z.string().default("User Defined Variables"),
        variables: z.array(z.object({ name: z.string(), value: z.string() })).min(1),
      },
    },
    ({ planId, parentId, name, variables }) => {
      const plan = readPlan(planId);
      requireNode(plan.root, parentId);
      const node = createNode("Arguments", name, { variables });
      addChild(plan.root, parentId, node);
      writePlan(plan);
      return jsonResult({ nodeId: node.id });
    },
  );

  server.registerTool(
    "add_constant_timer",
    {
      description:
        "Add a Constant Timer under the given parent to pace requests. Under a Thread Group it delays every " +
        "sampler in it; under a single sampler it delays only that one, before it fires.",
      inputSchema: {
        planId: z.string(),
        parentId: z.string(),
        name: z.string().default("Constant Timer"),
        delayMs: z.number().int().nonnegative().describe("Milliseconds to pause before each sample"),
      },
    },
    ({ planId, parentId, name, delayMs }) => {
      const plan = readPlan(planId);
      requireNode(plan.root, parentId);
      const node = createNode("ConstantTimer", name, { delayMs });
      addChild(plan.root, parentId, node);
      writePlan(plan);
      return jsonResult({ nodeId: node.id });
    },
  );

  server.registerTool(
    "add_regex_extractor",
    {
      description:
        "Add a Regular Expression Extractor under an HTTP sampler, to save a value from its response (body, " +
        "headers, etc.) into a variable using a regex capture group. Use this instead of add_json_extractor for " +
        "non-JSON (HTML/XML/plain-text) responses.",
      inputSchema: {
        planId: z.string(),
        parentId: z.string().describe("Id of the HTTP sampler node this extractor applies to"),
        name: z.string().default("Regular Expression Extractor"),
        referenceName: z.string().describe("JMeter variable name to store the extracted value in"),
        regex: z.string().describe("Regular expression with at least one capture group"),
        template: z.string().default("$1$").describe("Which capture group(s) to store, e.g. '$1$'"),
        matchNumber: z.number().int().default(1).describe("Which match to use (1 = first); 0 = random match; negative = all matches"),
        defaultValue: z.string().default("NOT_FOUND").describe("Value to use if the regex doesn't match"),
      },
    },
    ({ planId, parentId, name, referenceName, regex, template, matchNumber, defaultValue }) => {
      const plan = readPlan(planId);
      requireNode(plan.root, parentId);
      const node = createNode("RegexExtractor", name, { referenceName, regex, template, matchNumber, defaultValue });
      addChild(plan.root, parentId, node);
      writePlan(plan);
      return jsonResult({ nodeId: node.id });
    },
  );

  server.registerTool(
    "add_transaction_controller",
    {
      description:
        "Add a Transaction Controller under the given parent (usually a Thread Group). Samplers added under it " +
        "(as its children) are timed and reported as a single named transaction instead of separately.",
      inputSchema: {
        planId: z.string(),
        parentId: z.string(),
        name: z.string().describe("Name of the transaction, e.g. 'Checkout Flow'"),
        includeTimers: z.boolean().default(false).describe("Whether to include timer/pre-processor delays in the transaction's reported time"),
      },
    },
    ({ planId, parentId, name, includeTimers }) => {
      const plan = readPlan(planId);
      requireNode(plan.root, parentId);
      const node = createNode("TransactionController", name, { includeTimers });
      addChild(plan.root, parentId, node);
      writePlan(plan);
      return jsonResult({ nodeId: node.id });
    },
  );

  server.registerTool(
    "add_loop_controller",
    {
      description:
        "Add a Loop Controller under the given parent (usually a Thread Group). Samplers added under it (as its " +
        "children) repeat for the given number of loops each time the controller is reached.",
      inputSchema: {
        planId: z.string(),
        parentId: z.string(),
        name: z.string().default("Loop Controller"),
        loops: z.number().int().default(1).describe("Number of iterations, or -1 to loop forever"),
      },
    },
    ({ planId, parentId, name, loops }) => {
      const plan = readPlan(planId);
      requireNode(plan.root, parentId);
      const node = createNode("LoopController", name, { loops });
      addChild(plan.root, parentId, node);
      writePlan(plan);
      return jsonResult({ nodeId: node.id });
    },
  );

  server.registerTool(
    "add_if_controller",
    {
      description:
        "Add an If Controller under the given parent (usually a Thread Group). Samplers added under it (as its " +
        "children) only run when the condition evaluates truthy. condition is evaluated as a real JavaScript " +
        "(Rhino) expression after JMeter substitutes any ${var} references, so comparisons work directly, e.g. " +
        "'${count} < 10' or '\"${status}\" == \"ok\"'.",
      inputSchema: {
        planId: z.string(),
        parentId: z.string(),
        name: z.string().default("If Controller"),
        condition: z.string().describe("JavaScript boolean expression evaluated after ${var} substitution, e.g. '${count} < 10'"),
        evaluateAll: z.boolean().default(false).describe("Evaluate the condition for every iteration, not just the first"),
      },
    },
    ({ planId, parentId, name, condition, evaluateAll }) => {
      const plan = readPlan(planId);
      requireNode(plan.root, parentId);
      const node = createNode("IfController", name, { condition, evaluateAll });
      addChild(plan.root, parentId, node);
      writePlan(plan);
      return jsonResult({ nodeId: node.id });
    },
  );

  server.registerTool(
    "add_jdbc_connection_configuration",
    {
      description:
        "Add a JDBC Connection Configuration (pooled datasource) under the given parent, usually the Thread " +
        "Group or TestPlan root. A JDBC Request references this element's dataSource name.",
      inputSchema: {
        planId: z.string(),
        parentId: z.string(),
        name: z.string().default("JDBC Connection Configuration"),
        dataSource: z.string().describe("Pool name that JDBC Request samplers will reference"),
        dbUrl: z.string().describe("JDBC URL, e.g. jdbc:postgresql://host:5432/dbname"),
        driver: z.string().describe("JDBC driver class, e.g. org.postgresql.Driver"),
        username: z.string().optional(),
        password: z.string().optional(),
        poolMax: z.number().int().default(10).describe("Max pool size, 0 = unlimited"),
        connectionAge: z.number().int().default(5000),
        timeout: z.number().int().default(10000),
        trimInterval: z.number().int().default(60000),
        checkQuery: z.string().optional(),
      },
    },
    ({ planId, parentId, name, dataSource, dbUrl, driver, username, password, poolMax, connectionAge, timeout, trimInterval, checkQuery }) => {
      const plan = readPlan(planId);
      requireNode(plan.root, parentId);
      const node = createNode("JDBCConnectionConfiguration", name, {
        dataSource,
        dbUrl,
        driver,
        username,
        password,
        poolMax,
        connectionAge,
        timeout,
        trimInterval,
        checkQuery,
      });
      addChild(plan.root, parentId, node);
      writePlan(plan);
      return jsonResult({ nodeId: node.id });
    },
  );

  server.registerTool(
    "add_jdbc_request",
    {
      description:
        "Add a JDBC Request sampler under the given parent (usually a Thread Group). dataSource must match a " +
        "JDBC Connection Configuration's dataSource name added elsewhere in the same plan.",
      inputSchema: {
        planId: z.string(),
        parentId: z.string(),
        name: z.string().default("JDBC Request"),
        dataSource: z.string(),
        query: z.string(),
        queryType: z
          .enum([
            "Select Statement",
            "Update Statement",
            "Callable Statement",
            "Prepared Select Statement",
            "Prepared Update Statement",
            "Commit",
            "Rollback",
            "AutoCommit(false)",
            "AutoCommit(true)",
          ])
          .default("Select Statement"),
        variableNames: z.string().optional().describe("Comma-separated variable names to store each result column under"),
        resultVariable: z.string().optional().describe("Variable name to store the whole result set under"),
      },
    },
    ({ planId, parentId, name, dataSource, query, queryType, variableNames, resultVariable }) => {
      const plan = readPlan(planId);
      requireNode(plan.root, parentId);
      const node = createNode("JDBCRequest", name, { dataSource, query, queryType, variableNames, resultVariable });
      addChild(plan.root, parentId, node);
      writePlan(plan);
      return jsonResult({ nodeId: node.id });
    },
  );

  server.registerTool(
    "add_jsr223_sampler",
    {
      description: "Add a JSR223 Sampler under the given parent (usually a Thread Group), running a script as the sample itself.",
      inputSchema: {
        planId: z.string(),
        parentId: z.string(),
        name: z.string().default("JSR223 Sampler"),
        scriptLanguage: z.enum(["groovy", "beanshell", "javascript", "jexl3"]).default("groovy"),
        script: z.string(),
        parameters: z.string().optional(),
      },
    },
    ({ planId, parentId, name, scriptLanguage, script, parameters }) => {
      const plan = readPlan(planId);
      requireNode(plan.root, parentId);
      const node = createNode("JSR223Sampler", name, { scriptLanguage, script, parameters });
      addChild(plan.root, parentId, node);
      writePlan(plan);
      return jsonResult({ nodeId: node.id });
    },
  );

  server.registerTool(
    "add_ftp_request",
    {
      description: "Add an FTP Request sampler under the given parent (usually a Thread Group).",
      inputSchema: {
        planId: z.string(),
        parentId: z.string(),
        name: z.string().default("FTP Request"),
        server: z.string(),
        port: z.number().int().positive().optional(),
        filename: z.string().describe("Remote file path to download/upload"),
        localFilename: z.string().optional().describe("Local file path, for download destination or upload source"),
        inputData: z.string().optional().describe("Literal data to upload, instead of a local file"),
        binaryMode: z.boolean().default(false),
        saveResponse: z.boolean().default(false),
        upload: z.boolean().default(false),
        username: z.string().default("anonymous"),
        password: z.string().default("anonymous@test.com"),
      },
    },
    ({ planId, parentId, name, server: ftpServer, port, filename, localFilename, inputData, binaryMode, saveResponse, upload, username, password }) => {
      const plan = readPlan(planId);
      requireNode(plan.root, parentId);
      const node = createNode("FTPRequest", name, {
        server: ftpServer,
        port,
        filename,
        localFilename,
        inputData,
        binaryMode,
        saveResponse,
        upload,
        username,
        password,
      });
      addChild(plan.root, parentId, node);
      writePlan(plan);
      return jsonResult({ nodeId: node.id });
    },
  );

  server.registerTool(
    "add_tcp_sampler",
    {
      description: "Add a TCP Sampler under the given parent (usually a Thread Group), opening a raw TCP connection and sending request data.",
      inputSchema: {
        planId: z.string(),
        parentId: z.string(),
        name: z.string().default("TCP Sampler"),
        server: z.string(),
        port: z.number().int().positive(),
        request: z.string().describe("Data to send over the connection"),
        classname: z.string().default("TCPClientImpl").describe("TCP client handler class (short name resolves under org.apache.jmeter.protocol.tcp.sampler)"),
        reUseConnection: z.boolean().default(true),
        closeConnection: z.boolean().default(false),
        noDelay: z.boolean().default(false),
        connectTimeoutMs: z.number().int().optional(),
        timeoutMs: z.number().int().optional(),
      },
    },
    ({ planId, parentId, name, server: tcpServer, port, request, classname, reUseConnection, closeConnection, noDelay, connectTimeoutMs, timeoutMs }) => {
      const plan = readPlan(planId);
      requireNode(plan.root, parentId);
      const node = createNode("TCPSampler", name, {
        server: tcpServer,
        port,
        request,
        classname,
        reUseConnection,
        closeConnection,
        noDelay,
        ctimeout: connectTimeoutMs,
        timeout: timeoutMs,
      });
      addChild(plan.root, parentId, node);
      writePlan(plan);
      return jsonResult({ nodeId: node.id });
    },
  );

  server.registerTool(
    "add_http_request_defaults",
    {
      description:
        "Add HTTP Request Defaults under the given parent (usually a Thread Group or TestPlan root). Any field " +
        "left blank on a later add_http_sampler call under the same scope falls back to these values.",
      inputSchema: {
        planId: z.string(),
        parentId: z.string(),
        name: z.string().default("HTTP Request Defaults"),
        protocol: z.enum(["http", "https"]).optional(),
        domain: z.string().optional(),
        port: z.number().int().positive().optional(),
        path: z.string().optional(),
        connectTimeoutMs: z.number().int().optional(),
        responseTimeoutMs: z.number().int().optional(),
      },
    },
    ({ planId, parentId, name, protocol, domain, port, path, connectTimeoutMs, responseTimeoutMs }) => {
      const plan = readPlan(planId);
      requireNode(plan.root, parentId);
      const node = createNode("HTTPRequestDefaults", name, { protocol, domain, port, path, connectTimeoutMs, responseTimeoutMs });
      addChild(plan.root, parentId, node);
      writePlan(plan);
      return jsonResult({ nodeId: node.id });
    },
  );

  server.registerTool(
    "add_cookie_manager",
    {
      description: "Add an HTTP Cookie Manager under the given parent (usually a Thread Group), so samplers in scope share cookies automatically.",
      inputSchema: {
        planId: z.string(),
        parentId: z.string(),
        name: z.string().default("HTTP Cookie Manager"),
        clearEachIteration: z.boolean().default(false),
        policy: z.string().default("standard"),
      },
    },
    ({ planId, parentId, name, clearEachIteration, policy }) => {
      const plan = readPlan(planId);
      requireNode(plan.root, parentId);
      const node = createNode("CookieManager", name, { clearEachIteration, policy });
      addChild(plan.root, parentId, node);
      writePlan(plan);
      return jsonResult({ nodeId: node.id });
    },
  );

  server.registerTool(
    "add_while_controller",
    {
      description:
        "Add a While Controller under the given parent (usually a Thread Group). Samplers added under it (as " +
        "its children) repeat while condition holds. Leave condition blank (or 'LAST') to loop while the last " +
        "sampler in the loop succeeded; otherwise it's a JMeter expression re-evaluated each pass, looping until " +
        "it evaluates to the literal string 'false'.",
      inputSchema: {
        planId: z.string(),
        parentId: z.string(),
        name: z.string().default("While Controller"),
        condition: z.string().default(""),
      },
    },
    ({ planId, parentId, name, condition }) => {
      const plan = readPlan(planId);
      requireNode(plan.root, parentId);
      const node = createNode("WhileController", name, { condition });
      addChild(plan.root, parentId, node);
      writePlan(plan);
      return jsonResult({ nodeId: node.id });
    },
  );

  server.registerTool(
    "add_random_controller",
    {
      description:
        "Add a Random Controller under the given parent (usually a Thread Group). On each pass it runs exactly " +
        "one randomly chosen child (added under it) instead of all of them.",
      inputSchema: {
        planId: z.string(),
        parentId: z.string(),
        name: z.string().default("Random Controller"),
      },
    },
    ({ planId, parentId, name }) => {
      const plan = readPlan(planId);
      requireNode(plan.root, parentId);
      const node = createNode("RandomController", name, {});
      addChild(plan.root, parentId, node);
      writePlan(plan);
      return jsonResult({ nodeId: node.id });
    },
  );

  server.registerTool(
    "add_interleave_controller",
    {
      description:
        "Add an Interleave Controller under the given parent (usually a Thread Group). Runs one child (added " +
        "under it) per pass, alternating through them in order instead of running them all.",
      inputSchema: {
        planId: z.string(),
        parentId: z.string(),
        name: z.string().default("Interleave Controller"),
        ignoreSubControllerBlocks: z
          .boolean()
          .default(false)
          .describe("If true, interleaves across every leaf sampler recursively instead of one-per-direct-child"),
      },
    },
    ({ planId, parentId, name, ignoreSubControllerBlocks }) => {
      const plan = readPlan(planId);
      requireNode(plan.root, parentId);
      const node = createNode("InterleaveController", name, { ignoreSubControllerBlocks });
      addChild(plan.root, parentId, node);
      writePlan(plan);
      return jsonResult({ nodeId: node.id });
    },
  );

  server.registerTool(
    "add_setup_thread_group",
    {
      description:
        "Add a setUp Thread Group under the TestPlan root. Runs once, before all normal Thread Groups start, " +
        "regardless of where it sits in the tree - typically used for one-time setup (e.g. login, seeding data).",
      inputSchema: {
        planId: z.string(),
        parentId: z.string(),
        name: z.string().default("setUp Thread Group"),
        numThreads: z.number().int().positive(),
        rampTimeSeconds: z.number().nonnegative(),
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
      const node = createNode("SetupThreadGroup", name, { numThreads, rampTimeSeconds, loops, durationSeconds });
      addChild(plan.root, parentId, node);
      writePlan(plan);
      return jsonResult({ nodeId: node.id });
    },
  );

  server.registerTool(
    "add_teardown_thread_group",
    {
      description:
        "Add a tearDown Thread Group under the TestPlan root. Runs once, after all normal Thread Groups finish, " +
        "regardless of where it sits in the tree - typically used for one-time cleanup.",
      inputSchema: {
        planId: z.string(),
        parentId: z.string(),
        name: z.string().default("tearDown Thread Group"),
        numThreads: z.number().int().positive(),
        rampTimeSeconds: z.number().nonnegative(),
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
      const node = createNode("PostThreadGroup", name, { numThreads, rampTimeSeconds, loops, durationSeconds });
      addChild(plan.root, parentId, node);
      writePlan(plan);
      return jsonResult({ nodeId: node.id });
    },
  );

  server.registerTool(
    "add_xpath_extractor",
    {
      description:
        "Add an XPath Extractor under an HTTP sampler, to save a value from an XML/HTML response into a " +
        "variable using an XPath expression. Set tolerant=true for real-world (non-strict) HTML.",
      inputSchema: {
        planId: z.string(),
        parentId: z.string().describe("Id of the HTTP sampler node this extractor applies to"),
        name: z.string().default("XPath Extractor"),
        referenceName: z.string().describe("JMeter variable name to store the extracted value in"),
        xpathQuery: z.string(),
        defaultValue: z.string().default("NOT_FOUND"),
        matchNumber: z.number().int().default(1).describe("Which match to use (1 = first)"),
        tolerant: z.boolean().default(false).describe("Use a lenient HTML parser instead of a strict XML parser"),
      },
    },
    ({ planId, parentId, name, referenceName, xpathQuery, defaultValue, matchNumber, tolerant }) => {
      const plan = readPlan(planId);
      requireNode(plan.root, parentId);
      const node = createNode("XPathExtractor", name, { referenceName, xpathQuery, defaultValue, matchNumber, tolerant });
      addChild(plan.root, parentId, node);
      writePlan(plan);
      return jsonResult({ nodeId: node.id });
    },
  );

  server.registerTool(
    "add_jsr223_preprocessor",
    {
      description: "Add a JSR223 PreProcessor under an HTTP sampler (or a Thread Group, to apply to every sampler in it), running a script before the sample.",
      inputSchema: {
        planId: z.string(),
        parentId: z.string(),
        name: z.string().default("JSR223 PreProcessor"),
        scriptLanguage: z.enum(["groovy", "beanshell", "javascript", "jexl3"]).default("groovy"),
        script: z.string(),
        parameters: z.string().optional(),
      },
    },
    ({ planId, parentId, name, scriptLanguage, script, parameters }) => {
      const plan = readPlan(planId);
      requireNode(plan.root, parentId);
      const node = createNode("JSR223PreProcessor", name, { scriptLanguage, script, parameters });
      addChild(plan.root, parentId, node);
      writePlan(plan);
      return jsonResult({ nodeId: node.id });
    },
  );

  server.registerTool(
    "add_jsr223_postprocessor",
    {
      description: "Add a JSR223 PostProcessor under an HTTP sampler (or a Thread Group, to apply to every sampler in it), running a script after the sample.",
      inputSchema: {
        planId: z.string(),
        parentId: z.string(),
        name: z.string().default("JSR223 PostProcessor"),
        scriptLanguage: z.enum(["groovy", "beanshell", "javascript", "jexl3"]).default("groovy"),
        script: z.string(),
        parameters: z.string().optional(),
      },
    },
    ({ planId, parentId, name, scriptLanguage, script, parameters }) => {
      const plan = readPlan(planId);
      requireNode(plan.root, parentId);
      const node = createNode("JSR223PostProcessor", name, { scriptLanguage, script, parameters });
      addChild(plan.root, parentId, node);
      writePlan(plan);
      return jsonResult({ nodeId: node.id });
    },
  );

  server.registerTool(
    "add_user_parameters",
    {
      description:
        "Add a User Parameters pre-processor under a Thread Group, assigning each thread a different set of " +
        "variable values (cycled by thread number), set once at thread start unless perIteration is true. " +
        "Different from add_user_defined_variables, which sets the same values for every thread.",
      inputSchema: {
        planId: z.string(),
        parentId: z.string(),
        name: z.string().default("User Parameters"),
        variableNames: z.array(z.string()).min(1),
        valueSets: z
          .array(z.array(z.string()))
          .min(1)
          .describe("One array per thread/user slot; each inner array must have exactly one value per variableNames entry, in order"),
        perIteration: z.boolean().default(false).describe("Re-apply values every loop iteration instead of once at thread start"),
      },
    },
    ({ planId, parentId, name, variableNames, valueSets, perIteration }) => {
      for (const [i, values] of valueSets.entries()) {
        if (values.length !== variableNames.length) {
          throw new Error(
            `valueSets[${i}] has ${values.length} value(s) but variableNames has ${variableNames.length}; each valueSets entry must match variableNames length.`,
          );
        }
      }
      const plan = readPlan(planId);
      requireNode(plan.root, parentId);
      const node = createNode("UserParameters", name, { variableNames, valueSets, perIteration });
      addChild(plan.root, parentId, node);
      writePlan(plan);
      return jsonResult({ nodeId: node.id });
    },
  );

  server.registerTool(
    "add_json_assertion",
    {
      description: "Add a JSON Assertion under an HTTP sampler, to validate a JSONPath expression exists (and optionally matches a value) in the response.",
      inputSchema: {
        planId: z.string(),
        parentId: z.string(),
        name: z.string().default("JSON Assertion"),
        jsonPath: z.string().describe("JSONPath expression, e.g. $.value"),
        expectedValue: z.string().optional().describe("Value to compare against, only checked if jsonValidation is true"),
        jsonValidation: z.boolean().default(false).describe("Whether to check expectedValue at all"),
        expectNull: z.boolean().default(false),
        invert: z.boolean().default(false).describe("Negate the assertion"),
        isRegex: z.boolean().default(true).describe("Treat expectedValue as a regular expression"),
      },
    },
    ({ planId, parentId, name, jsonPath, expectedValue, jsonValidation, expectNull, invert, isRegex }) => {
      const plan = readPlan(planId);
      requireNode(plan.root, parentId);
      const node = createNode("JSONAssertion", name, { jsonPath, expectedValue, jsonValidation, expectNull, invert, isRegex });
      addChild(plan.root, parentId, node);
      writePlan(plan);
      return jsonResult({ nodeId: node.id });
    },
  );

  server.registerTool(
    "add_duration_assertion",
    {
      description: "Add a Duration Assertion under an HTTP sampler, failing the sample if it takes longer than maxDurationMs.",
      inputSchema: {
        planId: z.string(),
        parentId: z.string(),
        name: z.string().default("Duration Assertion"),
        maxDurationMs: z.number().int().positive(),
      },
    },
    ({ planId, parentId, name, maxDurationMs }) => {
      const plan = readPlan(planId);
      requireNode(plan.root, parentId);
      const node = createNode("DurationAssertion", name, { maxDurationMs });
      addChild(plan.root, parentId, node);
      writePlan(plan);
      return jsonResult({ nodeId: node.id });
    },
  );

  server.registerTool(
    "add_size_assertion",
    {
      description: "Add a Size Assertion under an HTTP sampler, comparing a response field's byte size against a threshold.",
      inputSchema: {
        planId: z.string(),
        parentId: z.string(),
        name: z.string().default("Size Assertion"),
        size: z.number().int().nonnegative().describe("Size in bytes to compare against"),
        operator: z.enum(["equal", "notequal", "greaterthan", "lessthan", "greaterthanequal", "lessthanequal"]).default("equal"),
        testField: z
          .enum(["response_network_size", "response_headers", "response_data", "response_code", "response_message"])
          .default("response_network_size"),
      },
    },
    ({ planId, parentId, name, size, operator, testField }) => {
      const plan = readPlan(planId);
      requireNode(plan.root, parentId);
      const node = createNode("SizeAssertion", name, { size, operator, testField });
      addChild(plan.root, parentId, node);
      writePlan(plan);
      return jsonResult({ nodeId: node.id });
    },
  );

  server.registerTool(
    "add_uniform_random_timer",
    {
      description:
        "Add a Uniform Random Timer under the given parent to pace requests with a randomized delay: " +
        "delayMs +/- a random amount up to rangeMs, picked fresh before each sample.",
      inputSchema: {
        planId: z.string(),
        parentId: z.string(),
        name: z.string().default("Uniform Random Timer"),
        delayMs: z.number().nonnegative().describe("Base/minimum delay in milliseconds"),
        rangeMs: z.number().nonnegative().describe("Maximum extra random delay added on top of delayMs"),
      },
    },
    ({ planId, parentId, name, delayMs, rangeMs }) => {
      const plan = readPlan(planId);
      requireNode(plan.root, parentId);
      const node = createNode("UniformRandomTimer", name, { delayMs, rangeMs });
      addChild(plan.root, parentId, node);
      writePlan(plan);
      return jsonResult({ nodeId: node.id });
    },
  );

  server.registerTool(
    "add_constant_throughput_timer",
    {
      description:
        "Add a Constant Throughput Timer under the given parent, pacing requests to hit a target rate rather " +
        "than a fixed per-sample delay.",
      inputSchema: {
        planId: z.string(),
        parentId: z.string(),
        name: z.string().default("Constant Throughput Timer"),
        targetSamplesPerMinute: z.number().positive(),
        calcMode: z
          .enum([
            "this_thread_only",
            "all_active_threads",
            "all_active_threads_in_current_thread_group",
            "all_active_threads_shared",
            "all_active_threads_in_current_thread_group_shared",
          ])
          .default("this_thread_only"),
      },
    },
    ({ planId, parentId, name, targetSamplesPerMinute, calcMode }) => {
      const plan = readPlan(planId);
      requireNode(plan.root, parentId);
      const node = createNode("ConstantThroughputTimer", name, { targetSamplesPerMinute, calcMode });
      addChild(plan.root, parentId, node);
      writePlan(plan);
      return jsonResult({ nodeId: node.id });
    },
  );

  server.registerTool(
    "add_view_results_tree_listener",
    {
      description:
        "Add a View Results Tree listener under the given parent (Thread Group or TestPlan). Its output is " +
        "readable via get_execution_report when there's no Aggregate/Summary Report listener present. NOTE: " +
        "captureFullData currently has no effect - execute_test_plan always runs JMeter with CSV output, and " +
        "JMeter's CSV writer never emits response body/header columns regardless of this flag (only its XML " +
        "output format can carry those); this option is a no-op until this server supports XML-format runs.",
      inputSchema: {
        planId: z.string(),
        parentId: z.string(),
        name: z.string().default("View Results Tree"),
        filename: z.string().describe("Filename kept in the .jmx for portability; ignored at execution time").optional(),
        captureFullData: z
          .boolean()
          .default(false)
          .describe("Currently has no effect under this server's CSV-only execution model - see tool description"),
      },
    },
    ({ planId, parentId, name, filename, captureFullData }) => {
      const plan = readPlan(planId);
      requireNode(plan.root, parentId);
      const node = createNode("ResultCollectorViewResultsTree", name, { filename, captureFullData });
      addChild(plan.root, parentId, node);
      writePlan(plan);
      return jsonResult({ nodeId: node.id });
    },
  );

  const INFLUXDB_DEFAULT_ARGS: Array<{ name: string; value: string }> = [
    { name: "influxdbMetricsSender", value: "org.apache.jmeter.visualizers.backend.influxdb.HttpMetricsSender" },
    { name: "influxdbUrl", value: "http://host_to_change:8086/write?db=jmeter" },
    { name: "application", value: "application name" },
    { name: "measurement", value: "jmeter" },
    { name: "summaryOnly", value: "false" },
    { name: "samplersRegex", value: ".*" },
    { name: "percentiles", value: "99;95;90" },
    { name: "testTitle", value: "Test name" },
    { name: "eventTags", value: "" },
  ];

  server.registerTool(
    "add_backend_listener",
    {
      description:
        "Add a Backend Listener under the given parent (Thread Group or TestPlan), streaming live metrics to an " +
        "external backend (InfluxDB by default) instead of a JTL file. If args is omitted, a ready-to-edit " +
        "InfluxDB argument set is used - at minimum, edit influxdbUrl before running.",
      inputSchema: {
        planId: z.string(),
        parentId: z.string(),
        name: z.string().default("Backend Listener"),
        classname: z.string().default("org.apache.jmeter.visualizers.backend.influxdb.InfluxdbBackendListenerClient"),
        args: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
      },
    },
    ({ planId, parentId, name, classname, args }) => {
      const plan = readPlan(planId);
      requireNode(plan.root, parentId);
      const node = createNode("BackendListener", name, { classname, args: args ?? INFLUXDB_DEFAULT_ARGS });
      addChild(plan.root, parentId, node);
      writePlan(plan);
      return jsonResult({ nodeId: node.id });
    },
  );

  server.registerTool(
    "remove_element",
    {
      description: "Remove an element (and its subtree) from a test plan. The root TestPlan node cannot be removed.",
      inputSchema: {
        planId: z.string(),
        nodeId: z.string(),
      },
    },
    ({ planId, nodeId }) => {
      const plan = readPlan(planId);
      const removed = removeNode(plan.root, nodeId);
      writePlan(plan);
      return jsonResult({ removed: { id: removed.id, type: removed.type, name: removed.name } });
    },
  );

  server.registerTool(
    "update_element",
    {
      description:
        "Update an element's props with a shallow merge (or full replace). A prop value of null in props " +
        "removes that key. When the node's type is one of the modeled types, the resulting props are validated " +
        "against that type's schema (check the type first via get_test_plan).",
      inputSchema: {
        planId: z.string(),
        nodeId: z.string(),
        props: z.record(z.string(), z.unknown()).describe("Patch to apply to the node's props"),
        mode: z.enum(["merge", "replace"]).default("merge"),
      },
    },
    ({ planId, nodeId, props, mode }) => {
      const plan = readPlan(planId);
      const node = requireNode(plan.root, nodeId);
      const schema = propSchemas[node.type];
      if (schema) {
        const forValidation = mode === "replace" ? props : { ...node.props, ...props };
        const toValidate = Object.fromEntries(
          Object.entries(forValidation).filter(([, v]) => v !== null && v !== undefined),
        );
        const result = schema.partial().safeParse(toValidate);
        if (!result.success) {
          throw new Error(`Invalid props for ${node.type}: ${result.error.message}`);
        }
      }
      updateNodeProps(plan.root, nodeId, props, mode);
      writePlan(plan);
      return jsonResult({ nodeId: node.id, props: node.props });
    },
  );

  server.registerTool(
    "rename_element",
    {
      description: "Rename an element (its testname in the generated .jmx).",
      inputSchema: {
        planId: z.string(),
        nodeId: z.string(),
        name: z.string(),
      },
    },
    ({ planId, nodeId, name }) => {
      const plan = readPlan(planId);
      const node = renameNode(plan.root, nodeId, name);
      writePlan(plan);
      return jsonResult({ nodeId: node.id, name: node.name });
    },
  );

  server.registerTool(
    "move_element",
    {
      description:
        "Move an element (and its subtree) to a new parent, optionally at a specific index among the new " +
        "parent's children (default: appended last). Rejects moving a node into its own subtree.",
      inputSchema: {
        planId: z.string(),
        nodeId: z.string(),
        newParentId: z.string(),
        index: z.number().int().nonnegative().optional(),
      },
    },
    ({ planId, nodeId, newParentId, index }) => {
      const plan = readPlan(planId);
      const node = moveNode(plan.root, nodeId, newParentId, index);
      writePlan(plan);
      return jsonResult({ nodeId: node.id, newParentId });
    },
  );

  server.registerTool(
    "reorder_children",
    {
      description:
        "Reorder a node's direct children. orderedChildIds must be an exact permutation of that node's " +
        "current children ids.",
      inputSchema: {
        planId: z.string(),
        parentId: z.string(),
        orderedChildIds: z.array(z.string()),
      },
    },
    ({ planId, parentId, orderedChildIds }) => {
      const plan = readPlan(planId);
      reorderChildren(plan.root, parentId, orderedChildIds);
      writePlan(plan);
      return jsonResult({ parentId, orderedChildIds });
    },
  );

  server.registerTool(
    "set_element_enabled",
    {
      description: "Enable or disable an element without removing it. A disabled element is skipped by JMeter at run time.",
      inputSchema: {
        planId: z.string(),
        nodeId: z.string(),
        enabled: z.boolean(),
      },
    },
    ({ planId, nodeId, enabled }) => {
      const plan = readPlan(planId);
      const node = requireNode(plan.root, nodeId);
      node.enabled = enabled;
      writePlan(plan);
      return jsonResult({ nodeId: node.id, enabled: node.enabled !== false });
    },
  );

  server.registerTool(
    "get_test_plan_xml",
    {
      description: "Serialize a test plan to its JMeter .jmx XML, without running JMeter.",
      inputSchema: {
        planId: z.string(),
      },
    },
    ({ planId }) => {
      const plan = readPlan(planId);
      return jsonResult({ xml: serializePlan(plan.root) });
    },
  );

  server.registerTool(
    "import_test_plan",
    {
      description:
        "Import an externally authored .jmx file (e.g. exported from the JMeter GUI) as a new test plan. " +
        "Element types this server doesn't model are kept as opaque UnknownElement nodes (their original XML " +
        "is preserved and re-emitted as-is) instead of being dropped - check unknownElementCount/unknownElementTypes " +
        "in the response to see what wasn't fully understood.",
      inputSchema: {
        filePath: z.string().describe("Absolute path to the .jmx file to import"),
        name: z.string().optional().describe("Plan name to use; defaults to the imported TestPlan element's name"),
      },
    },
    ({ filePath, name }) => {
      if (!isAbsolute(filePath)) {
        throw new Error(`filePath must be an absolute path, got "${filePath}".`);
      }
      if (!existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }
      const xml = readFileSync(filePath, "utf-8");
      const { root, unknownCount, unknownTypes } = parseJmx(xml);
      const planId = newPlanId();
      writePlan({ planId, name: name ?? root.name, createdAt: new Date().toISOString(), root });
      return jsonResult({
        planId,
        rootNodeId: root.id,
        unknownElementCount: unknownCount,
        unknownElementTypes: unknownTypes,
      });
    },
  );
}
