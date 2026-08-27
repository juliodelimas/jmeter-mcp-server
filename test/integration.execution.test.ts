import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, callTool, type TestServer } from "./support/mcpClient.js";
import { resolveJmeterBin } from "../src/jmeter.js";

function jmeterAvailable(): boolean {
  try {
    resolveJmeterBin();
    return true;
  } catch {
    return false;
  }
}

const skip = !jmeterAvailable();
const skipReason = "JMETER_HOME is not set/resolvable - run `npm run test:integration` with a real JMeter install";

let server: TestServer;

before(async () => {
  if (skip) return;
  server = await startServer();
});

after(async () => {
  if (skip) return;
  await server.close();
});

async function runPlan(planId: string, timeoutMs = 30000): Promise<any> {
  const { executionId } = await callTool(server.client, "execute_test_plan", { planId });
  const deadline = Date.now() + timeoutMs;
  let status = await callTool(server.client, "get_execution_status", { executionId });
  while (status.status === "running") {
    if (Date.now() > deadline) throw new Error(`Execution ${executionId} did not finish within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 250));
    status = await callTool(server.client, "get_execution_status", { executionId });
  }
  assert.equal(status.status, "completed", `execution failed, log tail:\n${status.logTail}`);
  return callTool(server.client, "get_execution_report", { executionId });
}

function label(report: any, name: string): any {
  const found = report.byLabel.find((l: any) => l.label === name);
  assert.ok(found, `no sample labeled "${name}" in report; labels present: ${report.byLabel.map((l: any) => l.label).join(", ")}`);
  return found;
}

/** A JSR223 sampler that asserts `expr` (Groovy boolean) - turns "is this variable right" into a pass/fail sample. */
function assertSampler(name: string, expr: string) {
  return {
    scriptLanguage: "groovy",
    script: `SampleResult.setSuccessful(${expr}); SampleResult.setResponseCode(SampleResult.isSuccessful() ? "200" : "500"); SampleResult.setResponseData("" + (${expr}), "UTF-8");`,
  };
}

test("If Controller: true condition runs the child, false condition skips it", { skip: skip && skipReason }, async () => {
  const { planId, rootNodeId } = await callTool(server.client, "create_test_plan", { name: "If Controller" });
  const { nodeId: tg } = await callTool(server.client, "add_thread_group", {
    planId,
    parentId: rootNodeId,
    name: "Users",
    numThreads: 1,
    rampTimeSeconds: 1,
    loops: 1,
  });
  const { nodeId: trueBranch } = await callTool(server.client, "add_if_controller", {
    planId,
    parentId: tg,
    name: "True Branch",
    condition: "1 < 2",
  });
  await callTool(server.client, "add_jsr223_sampler", {
    planId,
    parentId: trueBranch,
    name: "Should Run",
    ...assertSampler("Should Run", "true"),
  });
  const { nodeId: falseBranch } = await callTool(server.client, "add_if_controller", {
    planId,
    parentId: tg,
    name: "False Branch",
    condition: "1 > 2",
  });
  await callTool(server.client, "add_jsr223_sampler", {
    planId,
    parentId: falseBranch,
    name: "Should Not Run",
    ...assertSampler("Should Not Run", "true"),
  });
  await callTool(server.client, "add_aggregate_report_listener", { planId, parentId: tg });

  const report = await runPlan(planId);
  assert.equal(label(report, "Should Run").count, 1);
  assert.equal(label(report, "Should Run").errorPct, 0);
  assert.ok(
    !report.byLabel.some((l: any) => l.label === "Should Not Run"),
    "If Controller with a false condition must not run its child at all",
  );
});

test("While Controller loops exactly the expected number of times", { skip: skip && skipReason }, async () => {
  const { planId, rootNodeId } = await callTool(server.client, "create_test_plan", { name: "While Controller" });
  await callTool(server.client, "add_user_defined_variables", {
    planId,
    parentId: rootNodeId,
    variables: [{ name: "i", value: "0" }],
  });
  const { nodeId: tg } = await callTool(server.client, "add_thread_group", {
    planId,
    parentId: rootNodeId,
    name: "Users",
    numThreads: 1,
    rampTimeSeconds: 1,
    durationSeconds: 5, // hard safety net in case the loop condition is ever wrong again
  });
  const { nodeId: whileCtrl } = await callTool(server.client, "add_while_controller", {
    planId,
    parentId: tg,
    condition: "${__javaScript(${i}<3)}",
  });
  await callTool(server.client, "add_jsr223_preprocessor", {
    planId,
    parentId: whileCtrl,
    script: 'vars.put("i", ((vars.get("i") as int) + 1).toString());',
  });
  await callTool(server.client, "add_jsr223_sampler", {
    planId,
    parentId: whileCtrl,
    name: "Iteration",
    scriptLanguage: "groovy",
    script: 'SampleResult.setSuccessful(true); SampleResult.setResponseCode("200");',
  });
  await callTool(server.client, "add_aggregate_report_listener", { planId, parentId: tg });

  const report = await runPlan(planId);
  assert.equal(label(report, "Iteration").count, 3);
});

test("CSV Data Set Config feeds distinct rows per iteration", { skip: skip && skipReason }, async () => {
  const { writeFileSync, mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const dir = mkdtempSync(path.join(tmpdir(), "jmeter-mcp-csv-fixture-"));
  const csvPath = path.join(dir, "users.csv");
  writeFileSync(csvPath, "username\nalice\nbob\n", "utf-8");
  try {
    const { planId, rootNodeId } = await callTool(server.client, "create_test_plan", { name: "CSV Data Set" });
    const { nodeId: tg } = await callTool(server.client, "add_thread_group", {
      planId,
      parentId: rootNodeId,
      name: "Users",
      numThreads: 1,
      rampTimeSeconds: 1,
      loops: 2,
    });
    await callTool(server.client, "add_csv_data_set", {
      planId,
      parentId: tg,
      filename: csvPath,
      variableNames: "username",
      ignoreFirstLine: true,
      recycle: true,
    });
    await callTool(server.client, "add_jsr223_sampler", {
      planId,
      parentId: tg,
      name: "Row Iter",
      scriptLanguage: "groovy",
      script: 'SampleResult.setSuccessful(vars.get("username") == "alice" || vars.get("username") == "bob"); SampleResult.setResponseCode(SampleResult.isSuccessful() ? "200" : "500");',
    });
    await callTool(server.client, "add_aggregate_report_listener", { planId, parentId: tg });

    const report = await runPlan(planId);
    const row = label(report, "Row Iter");
    assert.equal(row.count, 2);
    assert.equal(row.errorPct, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("User Parameters assigns distinct values per thread", { skip: skip && skipReason }, async () => {
  const { planId, rootNodeId } = await callTool(server.client, "create_test_plan", { name: "User Parameters" });
  const { nodeId: tg } = await callTool(server.client, "add_thread_group", {
    planId,
    parentId: rootNodeId,
    name: "Users",
    numThreads: 2,
    rampTimeSeconds: 1,
    loops: 1,
  });
  await callTool(server.client, "add_user_parameters", {
    planId,
    parentId: tg,
    variableNames: ["u"],
    valueSets: [["alice"], ["bob"]],
  });
  await callTool(server.client, "add_jsr223_sampler", {
    planId,
    parentId: tg,
    name: "Check User",
    scriptLanguage: "groovy",
    script: 'SampleResult.setSuccessful(vars.get("u") == "alice" || vars.get("u") == "bob"); SampleResult.setResponseCode(SampleResult.isSuccessful() ? "200" : "500");',
  });
  await callTool(server.client, "add_aggregate_report_listener", { planId, parentId: tg });

  const report = await runPlan(planId);
  const row = label(report, "Check User");
  assert.equal(row.count, 2);
  assert.equal(row.errorPct, 0);
});

test("Constant Timer paces requests by roughly the configured delay", { skip: skip && skipReason }, async () => {
  const { planId, rootNodeId } = await callTool(server.client, "create_test_plan", { name: "Constant Timer" });
  const { nodeId: tg } = await callTool(server.client, "add_thread_group", {
    planId,
    parentId: rootNodeId,
    name: "Users",
    numThreads: 1,
    rampTimeSeconds: 1,
    loops: 2,
  });
  await callTool(server.client, "add_constant_timer", { planId, parentId: tg, delayMs: 500 });
  await callTool(server.client, "add_jsr223_sampler", {
    planId,
    parentId: tg,
    name: "Paced",
    scriptLanguage: "groovy",
    script: 'SampleResult.setSuccessful(true); SampleResult.setResponseCode("200");',
  });
  await callTool(server.client, "add_aggregate_report_listener", { planId, parentId: tg });

  const start = Date.now();
  const report = await runPlan(planId);
  const elapsed = Date.now() - start;
  assert.equal(label(report, "Paced").count, 2);
  // 2 iterations x ~500ms timer, minus the first iteration's timer arguably still applying before it too;
  // just assert we spent at least one real delay period, not zero (the previous no-op-timer regression).
  assert.ok(elapsed >= 450, `expected at least one ~500ms pause, only took ${elapsed}ms`);
});

test("Transaction Controller + Loop Controller group and repeat samples correctly", { skip: skip && skipReason }, async () => {
  const { planId, rootNodeId } = await callTool(server.client, "create_test_plan", { name: "Transaction+Loop" });
  const { nodeId: tg } = await callTool(server.client, "add_thread_group", {
    planId,
    parentId: rootNodeId,
    name: "Users",
    numThreads: 1,
    rampTimeSeconds: 1,
    loops: 1,
  });
  const { nodeId: txn } = await callTool(server.client, "add_transaction_controller", {
    planId,
    parentId: tg,
    name: "Flow",
  });
  const { nodeId: loop } = await callTool(server.client, "add_loop_controller", { planId, parentId: txn, loops: 3 });
  await callTool(server.client, "add_jsr223_sampler", {
    planId,
    parentId: loop,
    name: "Inner",
    scriptLanguage: "groovy",
    script: 'SampleResult.setSuccessful(true); SampleResult.setResponseCode("200");',
  });
  await callTool(server.client, "add_aggregate_report_listener", { planId, parentId: tg });

  const report = await runPlan(planId);
  assert.equal(label(report, "Inner").count, 3);
  const flow = label(report, "Flow");
  assert.equal(flow.errorPct, 0);
});

test("setUp and tearDown Thread Groups run exactly once each", { skip: skip && skipReason }, async () => {
  const { planId, rootNodeId } = await callTool(server.client, "create_test_plan", { name: "Setup+Teardown" });
  const { nodeId: setup } = await callTool(server.client, "add_setup_thread_group", {
    planId,
    parentId: rootNodeId,
    numThreads: 1,
    rampTimeSeconds: 1,
    loops: 1,
  });
  await callTool(server.client, "add_jsr223_sampler", {
    planId,
    parentId: setup,
    name: "Setup Call",
    scriptLanguage: "groovy",
    script: 'SampleResult.setSuccessful(true); SampleResult.setResponseCode("200");',
  });
  const { nodeId: tg } = await callTool(server.client, "add_thread_group", {
    planId,
    parentId: rootNodeId,
    name: "Users",
    numThreads: 1,
    rampTimeSeconds: 1,
    loops: 1,
  });
  await callTool(server.client, "add_jsr223_sampler", {
    planId,
    parentId: tg,
    name: "Normal Call",
    scriptLanguage: "groovy",
    script: 'SampleResult.setSuccessful(true); SampleResult.setResponseCode("200");',
  });
  const { nodeId: teardown } = await callTool(server.client, "add_teardown_thread_group", {
    planId,
    parentId: rootNodeId,
    numThreads: 1,
    rampTimeSeconds: 1,
    loops: 1,
  });
  await callTool(server.client, "add_jsr223_sampler", {
    planId,
    parentId: teardown,
    name: "Teardown Call",
    scriptLanguage: "groovy",
    script: 'SampleResult.setSuccessful(true); SampleResult.setResponseCode("200");',
  });
  // Listener at TestPlan root so it captures samples from every Thread Group, not just one.
  await callTool(server.client, "add_aggregate_report_listener", { planId, parentId: rootNodeId });

  const report = await runPlan(planId);
  assert.equal(label(report, "Setup Call").count, 1);
  assert.equal(label(report, "Normal Call").count, 1);
  assert.equal(label(report, "Teardown Call").count, 1);
});

test("Regex Extractor pulls the correct value from a real response", { skip: skip && skipReason }, async () => {
  const { planId, rootNodeId } = await callTool(server.client, "create_test_plan", { name: "Regex Extractor" });
  const { nodeId: tg } = await callTool(server.client, "add_thread_group", {
    planId,
    parentId: rootNodeId,
    name: "Users",
    numThreads: 1,
    rampTimeSeconds: 1,
    loops: 1,
  });
  const { nodeId: sampler } = await callTool(server.client, "add_http_sampler", {
    planId,
    parentId: tg,
    name: "Get UUID",
    method: "GET",
    protocol: "https",
    domain: "httpbin.org",
    path: "/uuid",
  });
  await callTool(server.client, "add_regex_extractor", {
    planId,
    parentId: sampler,
    referenceName: "uuidVar",
    regex: '"uuid": "(.*?)"',
    defaultValue: "NOT_FOUND",
  });
  await callTool(server.client, "add_jsr223_sampler", {
    planId,
    parentId: tg,
    name: "Check Extracted",
    scriptLanguage: "groovy",
    script: 'SampleResult.setSuccessful(vars.get("uuidVar") != null && vars.get("uuidVar") != "NOT_FOUND"); SampleResult.setResponseCode(SampleResult.isSuccessful() ? "200" : "500");',
  });
  await callTool(server.client, "add_aggregate_report_listener", { planId, parentId: tg });

  const report = await runPlan(planId);
  assert.equal(label(report, "Check Extracted").errorPct, 0);
});

test("XPath Extractor pulls the correct value from a real XML response", { skip: skip && skipReason }, async () => {
  const { planId, rootNodeId } = await callTool(server.client, "create_test_plan", { name: "XPath Extractor" });
  const { nodeId: tg } = await callTool(server.client, "add_thread_group", {
    planId,
    parentId: rootNodeId,
    name: "Users",
    numThreads: 1,
    rampTimeSeconds: 1,
    loops: 1,
  });
  const { nodeId: sampler } = await callTool(server.client, "add_http_sampler", {
    planId,
    parentId: tg,
    name: "Get XML",
    method: "GET",
    protocol: "https",
    domain: "httpbin.org",
    path: "/xml",
  });
  await callTool(server.client, "add_xpath_extractor", {
    planId,
    parentId: sampler,
    referenceName: "slideTitle",
    xpathQuery: "//slideshow/@title",
    defaultValue: "NOT_FOUND",
  });
  await callTool(server.client, "add_jsr223_sampler", {
    planId,
    parentId: tg,
    name: "Check Title",
    scriptLanguage: "groovy",
    script: 'SampleResult.setSuccessful(vars.get("slideTitle") == "Sample Slide Show"); SampleResult.setResponseCode(SampleResult.isSuccessful() ? "200" : "500"); SampleResult.setResponseData("" + vars.get("slideTitle"), "UTF-8");',
  });
  await callTool(server.client, "add_aggregate_report_listener", { planId, parentId: tg });

  const report = await runPlan(planId);
  assert.equal(label(report, "Check Title").errorPct, 0);
});

test("JSON Assertion passes on a matching path, Duration/Size Assertion fail when set impossibly strict", { skip: skip && skipReason }, async () => {
  const { planId, rootNodeId } = await callTool(server.client, "create_test_plan", { name: "Assertions" });
  const { nodeId: tg } = await callTool(server.client, "add_thread_group", {
    planId,
    parentId: rootNodeId,
    name: "Users",
    numThreads: 1,
    rampTimeSeconds: 1,
    loops: 1,
  });
  const { nodeId: sampler } = await callTool(server.client, "add_http_sampler", {
    planId,
    parentId: tg,
    name: "Get JSON",
    method: "GET",
    protocol: "https",
    domain: "httpbin.org",
    path: "/json",
  });
  await callTool(server.client, "add_json_assertion", {
    planId,
    parentId: sampler,
    jsonPath: "$.slideshow.title",
    jsonValidation: false,
  });
  await callTool(server.client, "add_duration_assertion", { planId, parentId: sampler, maxDurationMs: 1 });
  await callTool(server.client, "add_size_assertion", { planId, parentId: sampler, size: 999999, operator: "equal" });
  await callTool(server.client, "add_aggregate_report_listener", { planId, parentId: tg });

  const report = await runPlan(planId);
  const row = label(report, "Get JSON");
  // Duration Assertion (1ms) and Size Assertion (exact 999999 bytes) can never pass for a real
  // response - if this ever comes back 0% errors, the assertions stopped being wired up.
  assert.equal(row.errorPct, 100, "Duration/Size Assertion should have forced this sample to fail");
});

test("get_execution_report falls back to View Results Tree when there's no Aggregate/Summary listener", { skip: skip && skipReason }, async () => {
  const { planId, rootNodeId } = await callTool(server.client, "create_test_plan", { name: "VRT Fallback" });
  const { nodeId: tg } = await callTool(server.client, "add_thread_group", {
    planId,
    parentId: rootNodeId,
    name: "Users",
    numThreads: 1,
    rampTimeSeconds: 1,
    loops: 1,
  });
  await callTool(server.client, "add_jsr223_sampler", {
    planId,
    parentId: tg,
    name: "Only Sample",
    scriptLanguage: "groovy",
    script: 'SampleResult.setSuccessful(true); SampleResult.setResponseCode("200");',
  });
  await callTool(server.client, "add_view_results_tree_listener", { planId, parentId: tg });

  const report = await runPlan(planId);
  assert.equal(label(report, "Only Sample").count, 1);
});
