import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJmx } from "../src/jmx/parser.js";

function wrap(elementXml: string): string {
  const child = elementXml ? `${elementXml}\n<hashTree/>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.6.3">
<hashTree>
<TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="Root" enabled="true">
<stringProp name="TestPlan.comments"></stringProp>
</TestPlan>
<hashTree>
${child}
</hashTree>
</hashTree>
</jmeterTestPlan>
`;
}

test("parseJmx rejects a document with no <jmeterTestPlan> root", () => {
  assert.throws(() => parseJmx("<foo></foo>"), /jmeterTestPlan/);
});

test("parseJmx rejects a root element that isn't <TestPlan>", () => {
  const xml = `<?xml version="1.0"?>
<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.6.3">
<hashTree>
<ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup" testname="Users" enabled="true">
<stringProp name="ThreadGroup.num_threads">1</stringProp>
</ThreadGroup>
<hashTree/>
</hashTree>
</jmeterTestPlan>`;
  assert.throws(() => parseJmx(xml), /must be <TestPlan>/);
});

test("parseJmx parses TestPlan name/enabled", () => {
  const { root } = parseJmx(wrap(""));
  assert.equal(root.type, "TestPlan");
  assert.equal(root.name, "Root");
  assert.notEqual(root.enabled, false);
});

test("ThreadGroup (fixed loops)", () => {
  const xml = `<ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup" testname="Users" enabled="true">
<stringProp name="ThreadGroup.on_sample_error">continue</stringProp>
<elementProp name="ThreadGroup.main_controller" elementType="LoopController" guiclass="LoopControlPanel" testclass="LoopController" testname="Loop Controller" enabled="true">
<boolProp name="LoopController.continue_forever">false</boolProp>
<intProp name="LoopController.loops">5</intProp>
</elementProp>
<stringProp name="ThreadGroup.num_threads">10</stringProp>
<stringProp name="ThreadGroup.ramp_time">20</stringProp>
<boolProp name="ThreadGroup.scheduler">false</boolProp>
<stringProp name="ThreadGroup.duration"></stringProp>
</ThreadGroup>`;
  const { root } = parseJmx(wrap(xml));
  const tg = root.children[0];
  assert.equal(tg.type, "ThreadGroup");
  assert.deepEqual(tg.props, { numThreads: 10, rampTimeSeconds: 20, loops: 5 });
});

test("ThreadGroup (fixed loops, LoopController.loops as stringProp - real JMeter GUI export format)", () => {
  const xml = `<ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup" testname="Users" enabled="true">
<stringProp name="ThreadGroup.on_sample_error">continue</stringProp>
<elementProp name="ThreadGroup.main_controller" elementType="LoopController" guiclass="LoopControlPanel" testclass="LoopController" testname="Loop Controller" enabled="true">
<boolProp name="LoopController.continue_forever">false</boolProp>
<stringProp name="LoopController.loops">3</stringProp>
</elementProp>
<stringProp name="ThreadGroup.num_threads">50</stringProp>
<stringProp name="ThreadGroup.ramp_time">20</stringProp>
<boolProp name="ThreadGroup.scheduler">false</boolProp>
<stringProp name="ThreadGroup.duration"></stringProp>
</ThreadGroup>`;
  const { root } = parseJmx(wrap(xml));
  const tg = root.children[0];
  assert.equal(tg.type, "ThreadGroup");
  assert.deepEqual(tg.props, { numThreads: 50, rampTimeSeconds: 20, loops: 3 });
});

test("ThreadGroup (scheduler duration)", () => {
  const xml = `<ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup" testname="Users" enabled="true">
<elementProp name="ThreadGroup.main_controller" elementType="LoopController" guiclass="LoopControlPanel" testclass="LoopController" testname="Loop Controller" enabled="true">
<boolProp name="LoopController.continue_forever">false</boolProp>
<intProp name="LoopController.loops">-1</intProp>
</elementProp>
<stringProp name="ThreadGroup.num_threads">1</stringProp>
<stringProp name="ThreadGroup.ramp_time">1</stringProp>
<boolProp name="ThreadGroup.scheduler">true</boolProp>
<stringProp name="ThreadGroup.duration">30</stringProp>
</ThreadGroup>`;
  const { root } = parseJmx(wrap(xml));
  const tg = root.children[0];
  assert.deepEqual(tg.props, { numThreads: 1, rampTimeSeconds: 1, durationSeconds: 30 });
});

test("SetupThreadGroup / PostThreadGroup reuse ThreadGroup parsing under their own tags", () => {
  const setup = `<SetupThreadGroup guiclass="SetupThreadGroupGui" testclass="SetupThreadGroup" testname="setUp" enabled="true">
<elementProp name="ThreadGroup.main_controller" elementType="LoopController" guiclass="LoopControlPanel" testclass="LoopController" testname="Loop Controller" enabled="true">
<intProp name="LoopController.loops">1</intProp>
</elementProp>
<stringProp name="ThreadGroup.num_threads">1</stringProp>
<stringProp name="ThreadGroup.ramp_time">1</stringProp>
<boolProp name="ThreadGroup.scheduler">false</boolProp>
</SetupThreadGroup>`;
  const { root } = parseJmx(wrap(setup));
  assert.equal(root.children[0].type, "SetupThreadGroup");
});

test("HTTPSamplerProxy, including inline body JSON", () => {
  const xml = `<HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="Post" enabled="true">
<elementProp name="HTTPsampler.Arguments" elementType="Arguments" guiclass="HTTPArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">
<collectionProp name="Arguments.arguments">
<elementProp name="" elementType="HTTPArgument">
<boolProp name="HTTPArgument.always_encode">false</boolProp>
<stringProp name="Argument.value">{"a":1}</stringProp>
<stringProp name="Argument.metadata">=</stringProp>
</elementProp>
</collectionProp>
</elementProp>
<stringProp name="HTTPSampler.domain">example.org</stringProp>
<stringProp name="HTTPSampler.port">8443</stringProp>
<stringProp name="HTTPSampler.protocol">https</stringProp>
<stringProp name="HTTPSampler.path">/users</stringProp>
<stringProp name="HTTPSampler.method">POST</stringProp>
</HTTPSamplerProxy>`;
  const { root } = parseJmx(wrap(xml));
  const sampler = root.children[0];
  assert.equal(sampler.type, "HTTPSamplerProxy");
  assert.deepEqual(sampler.props, {
    method: "POST",
    protocol: "https",
    domain: "example.org",
    port: 8443,
    path: "/users",
    bodyJson: '{"a":1}',
  });
});

test("HTTPSamplerProxy leaves protocol/domain/port/bodyJson undefined when the XML values are empty", () => {
  const xml = `<HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="Get" enabled="true">
<elementProp name="HTTPsampler.Arguments" elementType="Arguments" guiclass="HTTPArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">
<collectionProp name="Arguments.arguments"/>
</elementProp>
<stringProp name="HTTPSampler.domain"></stringProp>
<stringProp name="HTTPSampler.port"></stringProp>
<stringProp name="HTTPSampler.protocol"></stringProp>
<stringProp name="HTTPSampler.path">/users</stringProp>
<stringProp name="HTTPSampler.method">GET</stringProp>
</HTTPSamplerProxy>`;
  const { root } = parseJmx(wrap(xml));
  const sampler = root.children[0];
  assert.deepEqual(sampler.props, { method: "GET", path: "/users" });
});

test("HeaderManager", () => {
  const xml = `<HeaderManager guiclass="HeaderPanel" testclass="HeaderManager" testname="Headers" enabled="true">
<collectionProp name="HeaderManager.headers">
<elementProp name="" elementType="Header">
<stringProp name="Header.name">X-Test</stringProp>
<stringProp name="Header.value">1</stringProp>
</elementProp>
</collectionProp>
</HeaderManager>`;
  const { root } = parseJmx(wrap(xml));
  assert.deepEqual(root.children[0].props, { headers: [{ name: "X-Test", value: "1" }] });
});

test("ResponseAssertion decodes the match-type bitmask", () => {
  const xml = `<ResponseAssertion guiclass="AssertionGui" testclass="ResponseAssertion" testname="Check" enabled="true">
<collectionProp name="Asserion.test_strings">
<stringProp name="1">ok</stringProp>
</collectionProp>
<stringProp name="Assertion.custom_message"></stringProp>
<stringProp name="Assertion.test_field">Assertion.response_data</stringProp>
<boolProp name="Assertion.assume_success">false</boolProp>
<intProp name="Assertion.test_type">6</intProp>
</ResponseAssertion>`;
  const { root } = parseJmx(wrap(xml));
  assert.deepEqual(root.children[0].props, {
    testField: "response_data",
    matchType: "contains",
    patterns: ["ok"],
    not: true,
  });
});

test("CSVDataSet", () => {
  const xml = `<CSVDataSet guiclass="TestBeanGUI" testclass="CSVDataSet" testname="CSV" enabled="true">
<stringProp name="filename">/abs/path/data.csv</stringProp>
<stringProp name="fileEncoding">UTF-8</stringProp>
<stringProp name="variableNames">a,b</stringProp>
<boolProp name="ignoreFirstLine">true</boolProp>
<stringProp name="delimiter">,</stringProp>
<boolProp name="quotedData">false</boolProp>
<boolProp name="recycle">true</boolProp>
<boolProp name="stopThread">false</boolProp>
<stringProp name="shareMode">shareMode.all</stringProp>
</CSVDataSet>`;
  const { root } = parseJmx(wrap(xml));
  assert.deepEqual(root.children[0].props, {
    filename: "/abs/path/data.csv",
    variableNames: "a,b",
    delimiter: ",",
    ignoreFirstLine: true,
    recycle: true,
    stopThread: false,
  });
});

test("Arguments (User Defined Variables)", () => {
  const xml = `<Arguments guiclass="ArgumentsPanel" testclass="Arguments" testname="UDV" enabled="true">
<collectionProp name="Arguments.arguments">
<elementProp name="host" elementType="Argument">
<stringProp name="Argument.name">host</stringProp>
<stringProp name="Argument.value">example.org</stringProp>
<stringProp name="Argument.metadata">=</stringProp>
</elementProp>
</collectionProp>
</Arguments>`;
  const { root } = parseJmx(wrap(xml));
  assert.deepEqual(root.children[0].props, { variables: [{ name: "host", value: "example.org" }] });
});

test("ConstantTimer", () => {
  const xml = `<ConstantTimer guiclass="ConstantTimerGui" testclass="ConstantTimer" testname="Timer" enabled="true">
<stringProp name="ConstantTimer.delay">250</stringProp>
</ConstantTimer>`;
  const { root } = parseJmx(wrap(xml));
  assert.deepEqual(root.children[0].props, { delayMs: 250 });
});

test("RegexExtractor", () => {
  const xml = `<RegexExtractor guiclass="RegexExtractorGui" testclass="RegexExtractor" testname="Extract" enabled="true">
<stringProp name="RegexExtractor.useHeaders">false</stringProp>
<stringProp name="RegexExtractor.refname">token</stringProp>
<stringProp name="RegexExtractor.regex">token=(.*)</stringProp>
<stringProp name="RegexExtractor.template">$1$</stringProp>
<stringProp name="RegexExtractor.default">NOT_FOUND</stringProp>
<stringProp name="RegexExtractor.match_number">1</stringProp>
</RegexExtractor>`;
  const { root } = parseJmx(wrap(xml));
  assert.deepEqual(root.children[0].props, {
    referenceName: "token",
    regex: "token=(.*)",
    template: "$1$",
    matchNumber: 1,
    defaultValue: "NOT_FOUND",
  });
});

test("TransactionController", () => {
  const xml = `<TransactionController guiclass="TransactionControllerGui" testclass="TransactionController" testname="Flow" enabled="true">
<boolProp name="TransactionController.includeTimers">true</boolProp>
<boolProp name="TransactionController.parent">false</boolProp>
</TransactionController>`;
  const { root } = parseJmx(wrap(xml));
  assert.deepEqual(root.children[0].props, { includeTimers: true });
});

test("LoopController", () => {
  const xml = `<LoopController guiclass="LoopControlPanel" testclass="LoopController" testname="Loop" enabled="true">
<boolProp name="LoopController.continue_forever">false</boolProp>
<intProp name="LoopController.loops">5</intProp>
</LoopController>`;
  const { root } = parseJmx(wrap(xml));
  assert.deepEqual(root.children[0].props, { loops: 5 });
});

test("LoopController (loops as stringProp - real JMeter GUI export format)", () => {
  const xml = `<LoopController guiclass="LoopControlPanel" testclass="LoopController" testname="Loop" enabled="true">
<boolProp name="LoopController.continue_forever">false</boolProp>
<stringProp name="LoopController.loops">5</stringProp>
</LoopController>`;
  const { root } = parseJmx(wrap(xml));
  assert.deepEqual(root.children[0].props, { loops: 5 });
});

test("IfController", () => {
  const xml = `<IfController guiclass="IfControllerPanel" testclass="IfController" testname="If" enabled="true">
<stringProp name="IfController.condition">${"${count} &lt; 10"}</stringProp>
<boolProp name="IfController.evaluateAll">false</boolProp>
<boolProp name="IfController.useExpression">false</boolProp>
</IfController>`;
  const { root } = parseJmx(wrap(xml));
  assert.deepEqual(root.children[0].props, { condition: "${count} < 10", evaluateAll: false });
});

test("HTTPRequestDefaults", () => {
  const xml = `<ConfigTestElement guiclass="HttpDefaultsGui" testclass="ConfigTestElement" testname="Defaults" enabled="true">
<elementProp name="HTTPsampler.Arguments" elementType="Arguments" guiclass="HTTPArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">
<collectionProp name="Arguments.arguments"/>
</elementProp>
<stringProp name="HTTPSampler.domain">example.org</stringProp>
<stringProp name="HTTPSampler.port"></stringProp>
<stringProp name="HTTPSampler.connect_timeout"></stringProp>
<stringProp name="HTTPSampler.response_timeout"></stringProp>
<stringProp name="HTTPSampler.protocol">https</stringProp>
<stringProp name="HTTPSampler.contentEncoding"></stringProp>
<stringProp name="HTTPSampler.path"></stringProp>
<stringProp name="HTTPSampler.concurrentPool">4</stringProp>
</ConfigTestElement>`;
  const { root } = parseJmx(wrap(xml));
  assert.equal(root.children[0].type, "HTTPRequestDefaults");
  assert.deepEqual(root.children[0].props, { protocol: "https", domain: "example.org" });
});

test("CookieManager", () => {
  const xml = `<CookieManager guiclass="CookiePanel" testclass="CookieManager" testname="Cookies" enabled="true">
<collectionProp name="CookieManager.cookies"/>
<boolProp name="CookieManager.clearEachIteration">true</boolProp>
<stringProp name="CookieManager.policy">standard</stringProp>
<stringProp name="CookieManager.implementation">org.apache.jmeter.protocol.http.control.HC4CookieHandler</stringProp>
</CookieManager>`;
  const { root } = parseJmx(wrap(xml));
  assert.deepEqual(root.children[0].props, { clearEachIteration: true, policy: "standard" });
});

test("ResultCollectorAggregate / ResultCollectorSummary are disambiguated by guiclass", () => {
  const agg = `<ResultCollector guiclass="StatVisualizer" testclass="ResultCollector" testname="Aggregate Report" enabled="true">
<boolProp name="ResultCollector.error_logging">false</boolProp>
<stringProp name="filename">/tmp/agg.jtl</stringProp>
</ResultCollector>`;
  const sum = `<ResultCollector guiclass="SummaryReport" testclass="ResultCollector" testname="Summary Report" enabled="true">
<boolProp name="ResultCollector.error_logging">false</boolProp>
<stringProp name="filename"></stringProp>
</ResultCollector>`;
  assert.equal(parseJmx(wrap(agg)).root.children[0].type, "ResultCollectorAggregate");
  assert.deepEqual(parseJmx(wrap(agg)).root.children[0].props, { filename: "/tmp/agg.jtl" });
  assert.equal(parseJmx(wrap(sum)).root.children[0].type, "ResultCollectorSummary");
  assert.deepEqual(parseJmx(wrap(sum)).root.children[0].props, {});
});

test("ResultCollectorViewResultsTree reads captureFullData from the nested objProp/value", () => {
  const xml = `<ResultCollector guiclass="ViewResultsFullVisualizer" testclass="ResultCollector" testname="VRT" enabled="true">
<boolProp name="ResultCollector.error_logging">false</boolProp>
<objProp>
<name>saveConfig</name>
<value class="SampleSaveConfiguration">
<responseData>true</responseData>
<samplerData>true</samplerData>
</value>
</objProp>
<stringProp name="filename"></stringProp>
</ResultCollector>`;
  const { root } = parseJmx(wrap(xml));
  assert.deepEqual(root.children[0].props, { captureFullData: true });
});

test("enabled=\"false\" is preserved as node.enabled === false", () => {
  const xml = `<ConstantTimer guiclass="ConstantTimerGui" testclass="ConstantTimer" testname="Timer" enabled="false">
<stringProp name="ConstantTimer.delay">250</stringProp>
</ConstantTimer>`;
  const { root } = parseJmx(wrap(xml));
  assert.equal(root.children[0].enabled, false);
});

test("an unrecognized element type falls back to UnknownElement with reconstructed rawXml", () => {
  const xml = `<JSR223Sampler guiclass="TestBeanGUI" testclass="JSR223Sampler" testname="Script" enabled="true">
<stringProp name="scriptLanguage">groovy</stringProp>
<stringProp name="script">1+1</stringProp>
</JSR223Sampler>`;
  const { root, unknownCount, unknownTypes } = parseJmx(wrap(xml));
  const node = root.children[0];
  assert.equal(node.type, "UnknownElement");
  assert.equal(node.name, "Script");
  assert.equal(unknownCount, 1);
  assert.deepEqual(unknownTypes, ["JSR223Sampler"]);
  assert.match(node.props.rawXml as string, /scriptLanguage/);
  // testname/enabled are deliberately NOT baked into rawXml - they live on node.name/enabled
  // instead (see renderUnknownElement in serializer.ts) so rename_element/set_element_enabled
  // still take effect on an imported element this server doesn't otherwise model.
  assert.doesNotMatch(node.props.rawXml as string, /testname=/);
  assert.doesNotMatch(node.props.rawXml as string, /enabled=/);
});

test("nested children parse into TestNode.children, preserving structure", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.6.3">
<hashTree>
<TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="Root" enabled="true">
</TestPlan>
<hashTree>
<ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup" testname="Users" enabled="true">
<elementProp name="ThreadGroup.main_controller" elementType="LoopController" guiclass="LoopControlPanel" testclass="LoopController" testname="Loop Controller" enabled="true">
<intProp name="LoopController.loops">1</intProp>
</elementProp>
<stringProp name="ThreadGroup.num_threads">1</stringProp>
<stringProp name="ThreadGroup.ramp_time">1</stringProp>
<boolProp name="ThreadGroup.scheduler">false</boolProp>
</ThreadGroup>
<hashTree>
<ConstantTimer guiclass="ConstantTimerGui" testclass="ConstantTimer" testname="Timer" enabled="true">
<stringProp name="ConstantTimer.delay">100</stringProp>
</ConstantTimer>
<hashTree/>
</hashTree>
</hashTree>
</hashTree>
</jmeterTestPlan>
`;
  const { root } = parseJmx(xml);
  const tg = root.children[0];
  assert.equal(tg.children.length, 1);
  assert.equal(tg.children[0].type, "ConstantTimer");
});

test("parseJmx rejects hashTree children that aren't in element/hashTree pairs", () => {
  const xml = `<?xml version="1.0"?>
<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.6.3">
<hashTree>
<TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="Root" enabled="true">
</TestPlan>
</hashTree>
</jmeterTestPlan>`;
  assert.throws(() => parseJmx(xml), /pairs/);
});
