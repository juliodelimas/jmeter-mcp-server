import { test } from "node:test";
import assert from "node:assert/strict";
import { addChild, createNode } from "../src/jmx/tree.js";
import { serializePlan } from "../src/jmx/serializer.js";
import { parseJmx } from "../src/jmx/parser.js";
import type { TestNode } from "../src/jmx/types.js";

/** Strips ids (regenerated on parse) so trees built independently can be compared. */
function stripIds(node: TestNode): unknown {
  return {
    type: node.type,
    name: node.name,
    enabled: node.enabled,
    props: node.props,
    children: node.children.map(stripIds),
  };
}

function roundTrip(root: TestNode): TestNode {
  const xml = serializePlan(root);
  return parseJmx(xml).root;
}

test("a plan built with every parser-covered type round-trips through serialize -> parse unchanged", () => {
  const root = createNode("TestPlan", "Round Trip Plan");

  const threadGroup = createNode("ThreadGroup", "Users", { numThreads: 5, rampTimeSeconds: 10, loops: 3 });
  addChild(root, root.id, threadGroup);

  const setup = createNode("SetupThreadGroup", "setUp", { numThreads: 1, rampTimeSeconds: 1, loops: 1 });
  addChild(root, root.id, setup);

  const teardown = createNode("PostThreadGroup", "tearDown", { numThreads: 1, rampTimeSeconds: 1, durationSeconds: 30 });
  addChild(root, root.id, teardown);

  const defaults = createNode("HTTPRequestDefaults", "Defaults", {
    protocol: "https",
    domain: "example.org",
    port: 8443,
    path: "/api",
    connectTimeoutMs: 1000,
    responseTimeoutMs: 5000,
  });
  addChild(root, root.id, defaults);

  const cookies = createNode("CookieManager", "Cookies", { clearEachIteration: true, policy: "standard" });
  addChild(root, root.id, cookies);

  const sampler = createNode("HTTPSamplerProxy", "Get Users", {
    method: "POST",
    protocol: "https",
    domain: "example.org",
    port: 8443,
    path: "/users",
    bodyJson: '{"a":1}',
  });
  addChild(root, threadGroup.id, sampler);

  const headers = createNode("HeaderManager", "Headers", { headers: [{ name: "X-Test", value: "1" }] });
  addChild(root, sampler.id, headers);

  const assertion = createNode("ResponseAssertion", "Check", {
    testField: "response_code",
    matchType: "equals",
    patterns: ["200", "201"],
    not: false,
  });
  addChild(root, sampler.id, assertion);

  const regex = createNode("RegexExtractor", "Extract Token", {
    referenceName: "token",
    regex: "token=(.*)",
    template: "$1$",
    matchNumber: 1,
    defaultValue: "NOT_FOUND",
  });
  addChild(root, sampler.id, regex);

  const csv = createNode("CSVDataSet", "CSV", {
    filename: "/abs/path/data.csv",
    variableNames: "a,b",
    delimiter: ";",
    ignoreFirstLine: true,
    recycle: true,
    stopThread: false,
  });
  addChild(root, threadGroup.id, csv);

  const udv = createNode("Arguments", "UDV", { variables: [{ name: "host", value: "example.org" }] });
  addChild(root, threadGroup.id, udv);

  const timer = createNode("ConstantTimer", "Timer", { delayMs: 250 });
  timer.enabled = false;
  addChild(root, threadGroup.id, timer);

  const txn = createNode("TransactionController", "Flow", { includeTimers: true });
  addChild(root, threadGroup.id, txn);

  const loop = createNode("LoopController", "Loop", { loops: 5 });
  addChild(root, txn.id, loop);

  const ifCtrl = createNode("IfController", "If", { condition: "${count} < 10", evaluateAll: true });
  addChild(root, loop.id, ifCtrl);

  const agg = createNode("ResultCollectorAggregate", "Aggregate Report", { filename: "/tmp/agg.jtl" });
  addChild(root, threadGroup.id, agg);

  const summary = createNode("ResultCollectorSummary", "Summary Report", {});
  addChild(root, threadGroup.id, summary);

  const vrt = createNode("ResultCollectorViewResultsTree", "VRT", { captureFullData: true });
  addChild(root, threadGroup.id, vrt);

  const parsedRoot = roundTrip(root);
  assert.deepEqual(stripIds(parsedRoot), stripIds(root));
});

test("round-tripping preserves an UnknownElement's rawXml well enough for a second parse to see the same tag", () => {
  const root = createNode("TestPlan", "Unknown Round Trip");
  // Per the UnknownElementProps convention, rawXml carries no testname/enabled of its own -
  // those come from the node's name/enabled instead.
  const jsr223 = createNode("UnknownElement", "Script", {
    rawXml:
      '<JSR223Sampler guiclass="TestBeanGUI" testclass="JSR223Sampler">' +
      '<stringProp name="scriptLanguage">groovy</stringProp><stringProp name="script">1+1</stringProp>' +
      "</JSR223Sampler>",
  });
  addChild(root, root.id, jsr223);

  const xml = serializePlan(root);
  assert.match(xml, /<JSR223Sampler[^>]*testname="Script"/);
  assert.match(xml, /<JSR223Sampler[^>]*enabled="true"/);

  const { root: parsedRoot, unknownCount, unknownTypes } = parseJmx(xml);
  assert.equal(unknownCount, 1);
  assert.deepEqual(unknownTypes, ["JSR223Sampler"]);
  const parsedChild = parsedRoot.children[0];
  assert.equal(parsedChild.type, "UnknownElement");
  assert.equal(parsedChild.name, "Script");
  assert.match(parsedChild.props.rawXml as string, /scriptLanguage.*groovy/s);
});

test("rename_element/set_element_enabled take effect on an UnknownElement, not just its modeled siblings", () => {
  const root = createNode("TestPlan", "Unknown Edit");
  const jsr223 = createNode("UnknownElement", "Original Name", {
    rawXml: '<JSR223Sampler guiclass="TestBeanGUI" testclass="JSR223Sampler"><stringProp name="script">1+1</stringProp></JSR223Sampler>',
  });
  addChild(root, root.id, jsr223);

  jsr223.name = "Renamed";
  jsr223.enabled = false;

  const xml = serializePlan(root);
  assert.match(xml, /<JSR223Sampler[^>]*testname="Renamed"/);
  assert.match(xml, /<JSR223Sampler[^>]*enabled="false"/);
  assert.doesNotMatch(xml, /testname="Original Name"/);
});
