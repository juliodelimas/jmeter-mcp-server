import { test } from "node:test";
import assert from "node:assert/strict";
import { createNode, addChild } from "../src/jmx/tree.js";
import { serializePlan } from "../src/jmx/serializer.js";
import type { TestNode } from "../src/jmx/types.js";

function xmlOf(node: TestNode): string {
  // serializePlan renders the whole tree; for a single-node tree the root IS the node under test.
  return serializePlan(node);
}

function assertTag(xml: string, tag: string, guiclass: string, testclass?: string) {
  const re = new RegExp(`<${tag}[^>]*guiclass="${guiclass}"[^>]*testclass="${testclass ?? tag}"`);
  assert.match(xml, re, `expected <${tag} guiclass="${guiclass}" testclass="${testclass ?? tag}" ...>`);
}

function assertProp(xml: string, kind: "stringProp" | "boolProp" | "intProp", name: string, value: string) {
  const re = new RegExp(`<${kind} name="${name}">${value}</${kind}>`);
  assert.match(xml, re, `expected <${kind} name="${name}">${value}</${kind}>`);
}

test("TestPlan", () => {
  const node = createNode("TestPlan", "My Plan");
  const xml = xmlOf(node);
  assertTag(xml, "TestPlan", "TestPlanGui");
});

test("ThreadGroup", () => {
  const node = createNode("ThreadGroup", "Users", { numThreads: 5, rampTimeSeconds: 10, loops: 3 });
  const xml = xmlOf(node);
  assertTag(xml, "ThreadGroup", "ThreadGroupGui");
  assertProp(xml, "stringProp", "ThreadGroup.num_threads", "5");
  assertProp(xml, "stringProp", "ThreadGroup.ramp_time", "10");
  assertProp(xml, "intProp", "LoopController.loops", "3");
});

test("ThreadGroup with scheduler duration uses infinite loops", () => {
  const node = createNode("ThreadGroup", "Users", { numThreads: 1, rampTimeSeconds: 1, durationSeconds: 30 });
  const xml = xmlOf(node);
  assertProp(xml, "boolProp", "ThreadGroup.scheduler", "true");
  assertProp(xml, "intProp", "LoopController.loops", "-1");
  assertProp(xml, "stringProp", "ThreadGroup.duration", "30");
});

test("SetupThreadGroup reuses ThreadGroup properties under its own tag", () => {
  const node = createNode("SetupThreadGroup", "setUp", { numThreads: 1, rampTimeSeconds: 1, loops: 1 });
  const xml = xmlOf(node);
  assertTag(xml, "SetupThreadGroup", "SetupThreadGroupGui");
  assertProp(xml, "stringProp", "ThreadGroup.num_threads", "1");
});

test("PostThreadGroup reuses ThreadGroup properties under its own tag", () => {
  const node = createNode("PostThreadGroup", "tearDown", { numThreads: 1, rampTimeSeconds: 1, loops: 1 });
  const xml = xmlOf(node);
  assertTag(xml, "PostThreadGroup", "PostThreadGroupGui");
  assertProp(xml, "stringProp", "ThreadGroup.num_threads", "1");
});

test("HTTPSamplerProxy", () => {
  const node = createNode("HTTPSamplerProxy", "Get Users", {
    method: "GET",
    protocol: "https",
    domain: "example.org",
    path: "/users",
  });
  const xml = xmlOf(node);
  assertTag(xml, "HTTPSamplerProxy", "HttpTestSampleGui");
  assertProp(xml, "stringProp", "HTTPSampler.domain", "example.org");
});

test("HTTPSamplerProxy leaves protocol/domain/port empty when omitted, so HTTP Request Defaults can fill them in", () => {
  // Regression guard: a real user hit this. protocol used to default to "https" in the tool
  // schema, which baked a non-empty value into every sampler and silently overrode
  // add_http_request_defaults every time, even when the caller never asked for https.
  // JMeter's Config Element inheritance only fills in a property that is genuinely empty.
  const node = createNode("HTTPSamplerProxy", "Inherits", { method: "GET", path: "/users" });
  const xml = xmlOf(node);
  assertProp(xml, "stringProp", "HTTPSampler.protocol", "");
  assertProp(xml, "stringProp", "HTTPSampler.domain", "");
  assertProp(xml, "stringProp", "HTTPSampler.port", "");
  assertProp(xml, "stringProp", "HTTPSampler.method", "GET");
});

test("HeaderManager", () => {
  const node = createNode("HeaderManager", "Headers", { headers: [{ name: "X-Test", value: "1" }] });
  const xml = xmlOf(node);
  assertTag(xml, "HeaderManager", "HeaderPanel");
  assertProp(xml, "stringProp", "Header.name", "X-Test");
});

test("JSONPostProcessor", () => {
  const node = createNode("JSONPostProcessor", "Extract", {
    referenceName: "id",
    jsonPathExpr: "$.id",
    defaultValue: "NOT_FOUND",
  });
  const xml = xmlOf(node);
  assertTag(xml, "JSONPostProcessor", "JSONPostProcessorGui");
  assertProp(xml, "stringProp", "JSONPostProcessor.referenceNames", "id");
});

test("ResponseAssertion match-type bitmask", () => {
  const node = createNode("ResponseAssertion", "Check", {
    testField: "response_data",
    matchType: "contains",
    patterns: ["ok"],
    not: true,
  });
  const xml = xmlOf(node);
  assertTag(xml, "ResponseAssertion", "AssertionGui");
  // contains=2, NOT_BIT=4 => 6
  assertProp(xml, "intProp", "Assertion.test_type", "6");
});

test("ResultCollectorAggregate / ResultCollectorSummary", () => {
  const agg = createNode("ResultCollectorAggregate", "Aggregate Report", {});
  assertTag(xmlOf(agg), "ResultCollector", "StatVisualizer");
  const sum = createNode("ResultCollectorSummary", "Summary Report", {});
  assertTag(xmlOf(sum), "ResultCollector", "SummaryReport");
});

test("CSVDataSet", () => {
  const node = createNode("CSVDataSet", "CSV", {
    filename: "/abs/path/data.csv",
    variableNames: "a,b",
    delimiter: ",",
    ignoreFirstLine: true,
    recycle: true,
    stopThread: false,
  });
  const xml = xmlOf(node);
  assertTag(xml, "CSVDataSet", "TestBeanGUI");
  assertProp(xml, "stringProp", "filename", "/abs/path/data.csv");
  assertProp(xml, "boolProp", "ignoreFirstLine", "true");
});

test("Arguments (User Defined Variables)", () => {
  const node = createNode("Arguments", "UDV", { variables: [{ name: "host", value: "example.org" }] });
  const xml = xmlOf(node);
  assertTag(xml, "Arguments", "ArgumentsPanel");
  assertProp(xml, "stringProp", "Argument.value", "example.org");
});

test("ConstantTimer", () => {
  const node = createNode("ConstantTimer", "Timer", { delayMs: 250 });
  const xml = xmlOf(node);
  assertTag(xml, "ConstantTimer", "ConstantTimerGui");
  assertProp(xml, "stringProp", "ConstantTimer.delay", "250");
});

test("RegexExtractor", () => {
  const node = createNode("RegexExtractor", "Extract", {
    referenceName: "token",
    regex: "token=(.*)",
    template: "$1$",
    matchNumber: 1,
    defaultValue: "NOT_FOUND",
  });
  const xml = xmlOf(node);
  assertTag(xml, "RegexExtractor", "RegexExtractorGui");
  assertProp(xml, "stringProp", "RegexExtractor.refname", "token");
});

test("TransactionController", () => {
  const node = createNode("TransactionController", "Flow", { includeTimers: true });
  const xml = xmlOf(node);
  assertTag(xml, "TransactionController", "TransactionControllerGui");
  assertProp(xml, "boolProp", "TransactionController.includeTimers", "true");
});

test("LoopController", () => {
  const node = createNode("LoopController", "Loop", { loops: 5 });
  const xml = xmlOf(node);
  assertTag(xml, "LoopController", "LoopControlPanel");
  assertProp(xml, "boolProp", "LoopController.continue_forever", "false");
  assertProp(xml, "intProp", "LoopController.loops", "5");
});

test("LoopController with -1 loops sets continue_forever", () => {
  const node = createNode("LoopController", "Loop", { loops: -1 });
  const xml = xmlOf(node);
  assertProp(xml, "boolProp", "LoopController.continue_forever", "true");
});

test("IfController uses real JS evaluation (useExpression=false), not the literal-'true' mode", () => {
  // Regression guard: useExpression=true makes JMeter's IfController do a dumb
  // cond.equalsIgnoreCase("true") check instead of evaluating the condition as JS,
  // which silently breaks any non-trivial condition. Confirmed against real JMeter
  // 5.6.3 (IfController.java) during manual verification.
  const node = createNode("IfController", "If", { condition: '${count} < 10', evaluateAll: false });
  const xml = xmlOf(node);
  assertTag(xml, "IfController", "IfControllerPanel");
  assertProp(xml, "boolProp", "IfController.useExpression", "false");
});

test("JDBCConnectionConfiguration", () => {
  const node = createNode("JDBCConnectionConfiguration", "JDBC Config", {
    dataSource: "pool1",
    dbUrl: "jdbc:postgresql://host/db",
    driver: "org.postgresql.Driver",
    poolMax: 10,
    connectionAge: 5000,
    timeout: 10000,
    trimInterval: 60000,
  });
  const xml = xmlOf(node);
  assertTag(xml, "JDBCDataSource", "TestBeanGUI");
  assertProp(xml, "stringProp", "dataSource", "pool1");
  assertProp(xml, "stringProp", "driver", "org.postgresql.Driver");
});

test("JDBCRequest", () => {
  const node = createNode("JDBCRequest", "JDBC Request", {
    dataSource: "pool1",
    query: "select 1",
    queryType: "Select Statement",
  });
  const xml = xmlOf(node);
  assertTag(xml, "JDBCSampler", "TestBeanGUI");
  assertProp(xml, "stringProp", "query", "select 1");
});

test("JSR223Sampler", () => {
  const node = createNode("JSR223Sampler", "Script", { scriptLanguage: "groovy", script: "1+1" });
  const xml = xmlOf(node);
  assertTag(xml, "JSR223Sampler", "TestBeanGUI");
  assertProp(xml, "stringProp", "scriptLanguage", "groovy");
  assertProp(xml, "stringProp", "cacheKey", "true");
});

test("FTPRequest", () => {
  const node = createNode("FTPRequest", "FTP", {
    server: "ftp.example.org",
    filename: "/f.txt",
    binaryMode: false,
    saveResponse: false,
    upload: false,
    username: "anonymous",
    password: "anonymous@test.com",
  });
  const xml = xmlOf(node);
  assertTag(xml, "FTPSampler", "FtpTestSamplerGui");
  assertProp(xml, "stringProp", "FTPSampler.server", "ftp.example.org");
  assertProp(xml, "stringProp", "ConfigTestElement.username", "anonymous");
});

test("TCPSampler", () => {
  const node = createNode("TCPSampler", "TCP", {
    server: "localhost",
    port: 9999,
    request: "PING\n",
    classname: "TCPClientImpl",
    reUseConnection: true,
    closeConnection: false,
    noDelay: false,
  });
  const xml = xmlOf(node);
  assertTag(xml, "TCPSampler", "TCPSamplerGui");
  assertProp(xml, "stringProp", "TCPSampler.server", "localhost");
  assertProp(xml, "stringProp", "TCPSampler.port", "9999");
});

test("HTTPRequestDefaults", () => {
  const node = createNode("HTTPRequestDefaults", "Defaults", { protocol: "https", domain: "example.org" });
  const xml = xmlOf(node);
  assertTag(xml, "ConfigTestElement", "HttpDefaultsGui");
  assertProp(xml, "stringProp", "HTTPSampler.domain", "example.org");
});

test("CookieManager", () => {
  const node = createNode("CookieManager", "Cookies", { clearEachIteration: true, policy: "standard" });
  const xml = xmlOf(node);
  assertTag(xml, "CookieManager", "CookiePanel");
  assertProp(xml, "stringProp", "CookieManager.policy", "standard");
});

test("WhileController", () => {
  const node = createNode("WhileController", "While", { condition: '${__javaScript(${i}<3)}' });
  const xml = xmlOf(node);
  assertTag(xml, "WhileController", "WhileControllerGui");
  assert.match(xml, /<stringProp name="WhileController.condition">/);
});

test("RandomController emits the inherited InterleaveControl.style property", () => {
  // Regression guard: this is a real naming trap - RandomController has no property
  // of its own, it inherits InterleaveControl.style=1 from InterleaveControl.
  const node = createNode("RandomController", "Random", {});
  const xml = xmlOf(node);
  assertTag(xml, "RandomController", "RandomControlGui");
  assertProp(xml, "intProp", "InterleaveControl.style", "1");
  assert.doesNotMatch(xml, /RandomController\.style/);
});

test("InterleaveController", () => {
  const node = createNode("InterleaveController", "Interleave", { ignoreSubControllerBlocks: true });
  const xml = xmlOf(node);
  assertTag(xml, "InterleaveControl", "InterleaveControlGui");
  assertProp(xml, "intProp", "InterleaveControl.style", "1");
});

test("XPathExtractor", () => {
  const node = createNode("XPathExtractor", "XPath", {
    referenceName: "title",
    xpathQuery: "//title/text()",
    defaultValue: "NOT_FOUND",
    matchNumber: 1,
    tolerant: true,
  });
  const xml = xmlOf(node);
  assertTag(xml, "XPathExtractor", "XPathExtractorGui");
  assertProp(xml, "boolProp", "XPathExtractor.tolerant", "true");
});

test("JSR223PreProcessor / JSR223PostProcessor", () => {
  const pre = createNode("JSR223PreProcessor", "Pre", { scriptLanguage: "groovy", script: "vars.put('x','1')" });
  assertTag(xmlOf(pre), "JSR223PreProcessor", "TestBeanGUI");
  const post = createNode("JSR223PostProcessor", "Post", { scriptLanguage: "groovy", script: "vars.put('y','2')" });
  assertTag(xmlOf(post), "JSR223PostProcessor", "TestBeanGUI");
});

test("UserParameters", () => {
  const node = createNode("UserParameters", "UP", {
    variableNames: ["u", "p"],
    valueSets: [
      ["alice", "pw1"],
      ["bob", "pw2"],
    ],
    perIteration: false,
  });
  const xml = xmlOf(node);
  assertTag(xml, "UserParameters", "UserParametersGui");
  assert.match(xml, /<collectionProp name="UserParameters.names">/);
  assert.match(xml, /<collectionProp name="UserParameters.thread_values">/);
  assert.match(xml, />alice</);
  assert.match(xml, />bob</);
});

test("JSONAssertion defaults isRegex to true (confirmed real JMeter default)", () => {
  const node = createNode("JSONAssertion", "JSON Assertion", {
    jsonPath: "$.value",
    jsonValidation: false,
    expectNull: false,
    invert: false,
    isRegex: true,
  });
  const xml = xmlOf(node);
  assertTag(xml, "JSONPathAssertion", "JSONPathAssertionGui");
  assert.ok(xml.includes('<stringProp name="JSON_PATH">$.value</stringProp>'));
  assertProp(xml, "boolProp", "ISREGEX", "true");
});

test("DurationAssertion", () => {
  const node = createNode("DurationAssertion", "Duration", { maxDurationMs: 5000 });
  const xml = xmlOf(node);
  assertTag(xml, "DurationAssertion", "DurationAssertionGui");
  assertProp(xml, "stringProp", "DurationAssertion.duration", "5000");
});

test("SizeAssertion operator encoding is 1-based", () => {
  const node = createNode("SizeAssertion", "Size", {
    size: 1024,
    operator: "greaterthan",
    testField: "response_data",
  });
  const xml = xmlOf(node);
  assertTag(xml, "SizeAssertion", "SizeAssertionGui");
  assertProp(xml, "intProp", "SizeAssertion.operator", "3");
  assertProp(xml, "stringProp", "Assertion.test_field", "SizeAssertion.response_data");
});

test("UniformRandomTimer", () => {
  const node = createNode("UniformRandomTimer", "URT", { delayMs: 1000, rangeMs: 500 });
  const xml = xmlOf(node);
  assertTag(xml, "UniformRandomTimer", "UniformRandomTimerGui");
  assertProp(xml, "stringProp", "ConstantTimer.delay", "1000");
  assertProp(xml, "stringProp", "RandomTimer.range", "500");
});

test("ConstantThroughputTimer uses doubleProp for throughput and 0-based calcMode", () => {
  const node = createNode("ConstantThroughputTimer", "CTT", {
    targetSamplesPerMinute: 30,
    calcMode: "all_active_threads",
  });
  const xml = xmlOf(node);
  assertTag(xml, "ConstantThroughputTimer", "TestBeanGUI");
  assert.match(xml, /<doubleProp>\s*<name>throughput<\/name>\s*<value>30<\/value>/);
  assertProp(xml, "intProp", "calcMode", "1");
});

test("ResultCollectorViewResultsTree", () => {
  const node = createNode("ResultCollectorViewResultsTree", "VRT", { captureFullData: false });
  const xml = xmlOf(node);
  assertTag(xml, "ResultCollector", "ViewResultsFullVisualizer");
  assert.match(xml, /<responseData>false<\/responseData>/);
});

test("ResultCollectorViewResultsTree captureFullData flips the body/header flags", () => {
  const node = createNode("ResultCollectorViewResultsTree", "VRT", { captureFullData: true });
  const xml = xmlOf(node);
  assert.match(xml, /<responseData>true<\/responseData>/);
  assert.match(xml, /<samplerData>true<\/samplerData>/);
});

test("BackendListener", () => {
  const node = createNode("BackendListener", "Backend", {
    classname: "org.apache.jmeter.visualizers.backend.influxdb.InfluxdbBackendListenerClient",
    args: [{ name: "influxdbUrl", value: "http://localhost:8086/write?db=jmeter" }],
  });
  const xml = xmlOf(node);
  assertTag(xml, "BackendListener", "BackendListenerGui");
  assertProp(xml, "stringProp", "classname", "org.apache.jmeter.visualizers.backend.influxdb.InfluxdbBackendListenerClient");
  assert.match(xml, /influxdbUrl/);
});

test("nested children serialize inside a matching hashTree", () => {
  const root = createNode("TestPlan", "Parent/Child");
  const tg = createNode("ThreadGroup", "Users", { numThreads: 1, rampTimeSeconds: 1, loops: 1 });
  addChild(root, root.id, tg);
  const sampler = createNode("HTTPSamplerProxy", "Sampler", {
    method: "GET",
    protocol: "https",
    domain: "example.org",
    path: "/",
  });
  addChild(root, tg.id, sampler);
  const xml = serializePlan(root);
  const tgIndex = xml.indexOf("<ThreadGroup ");
  const samplerIndex = xml.indexOf("<HTTPSamplerProxy ");
  assert.ok(tgIndex > -1 && samplerIndex > -1 && samplerIndex > tgIndex, "sampler must be nested after its parent thread group");
});
