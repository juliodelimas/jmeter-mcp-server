import type { TestNode } from "./types.js";

export interface SerializeOptions {
  /** Absolute path to force as the Aggregate Report listener's output file. */
  aggregateFilename?: string;
  /** Absolute path to force as the Summary Report listener's output file. */
  summaryFilename?: string;
}

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const stringProp = (name: string, value: unknown) =>
  `<stringProp name="${esc(name)}">${esc(value)}</stringProp>`;
const boolProp = (name: string, value: boolean) =>
  `<boolProp name="${esc(name)}">${value}</boolProp>`;
const intProp = (name: string, value: number) =>
  `<intProp name="${esc(name)}">${value}</intProp>`;

function renderTestPlan(node: TestNode): string {
  return `<TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="${esc(node.name)}" enabled="true">
${stringProp("TestPlan.comments", "")}
${boolProp("TestPlan.functional_mode", false)}
${boolProp("TestPlan.tearDown_on_shutdown", true)}
${boolProp("TestPlan.serialize_threadgroups", false)}
<elementProp name="TestPlan.user_defined_variables" elementType="Arguments" guiclass="ArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">
<collectionProp name="Arguments.arguments"/>
</elementProp>
${stringProp("TestPlan.user_define_classpath", "")}
</TestPlan>`;
}

interface ThreadGroupProps {
  numThreads: number;
  rampTimeSeconds: number;
  loops?: number;
  durationSeconds?: number;
}

function renderThreadGroup(node: TestNode): string {
  const p = node.props as unknown as ThreadGroupProps;
  const scheduler = p.durationSeconds !== undefined;
  const loops = p.loops ?? (scheduler ? 1 : 1);
  return `<ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup" testname="${esc(node.name)}" enabled="true">
${stringProp("ThreadGroup.on_sample_error", "continue")}
<elementProp name="ThreadGroup.main_controller" elementType="LoopController" guiclass="LoopControlPanel" testclass="LoopController" testname="Loop Controller" enabled="true">
${boolProp("LoopController.continue_forever", false)}
${intProp("LoopController.loops", scheduler ? -1 : loops)}
</elementProp>
${stringProp("ThreadGroup.num_threads", p.numThreads)}
${stringProp("ThreadGroup.ramp_time", p.rampTimeSeconds)}
${boolProp("ThreadGroup.scheduler", scheduler)}
${stringProp("ThreadGroup.duration", scheduler ? p.durationSeconds : "")}
${stringProp("ThreadGroup.delay", "")}
${boolProp("ThreadGroup.same_user_on_next_iteration", true)}
</ThreadGroup>`;
}

interface HttpSamplerProps {
  method: string;
  protocol: string;
  domain: string;
  port?: number;
  path: string;
  bodyJson?: string;
}

function renderHttpArguments(bodyJson?: string): string {
  if (!bodyJson) {
    return `<elementProp name="HTTPsampler.Arguments" elementType="Arguments" guiclass="HTTPArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">
<collectionProp name="Arguments.arguments"/>
</elementProp>`;
  }
  return `<elementProp name="HTTPsampler.Arguments" elementType="Arguments" guiclass="HTTPArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">
<collectionProp name="Arguments.arguments">
<elementProp name="" elementType="HTTPArgument">
${boolProp("HTTPArgument.always_encode", false)}
${stringProp("Argument.value", bodyJson)}
${stringProp("Argument.metadata", "=")}
</elementProp>
</collectionProp>
</elementProp>`;
}

function renderHttpSampler(node: TestNode): string {
  const p = node.props as unknown as HttpSamplerProps;
  return `<HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="${esc(node.name)}" enabled="true">
${renderHttpArguments(p.bodyJson)}
${stringProp("HTTPSampler.domain", p.domain)}
${stringProp("HTTPSampler.port", p.port ?? "")}
${stringProp("HTTPSampler.protocol", p.protocol)}
${stringProp("HTTPSampler.path", p.path)}
${stringProp("HTTPSampler.method", p.method)}
${boolProp("HTTPSampler.follow_redirects", true)}
${boolProp("HTTPSampler.auto_redirects", false)}
${boolProp("HTTPSampler.use_keepalive", true)}
${boolProp("HTTPSampler.DO_MULTIPART_POST", false)}
${boolProp("HTTPSampler.postBodyRaw", Boolean(p.bodyJson))}
</HTTPSamplerProxy>`;
}

interface HeaderManagerProps {
  headers: Array<{ name: string; value: string }>;
}

function renderHeaderManager(node: TestNode): string {
  const p = node.props as unknown as HeaderManagerProps;
  const headerXml = p.headers
    .map(
      (h) => `<elementProp name="" elementType="Header">
${stringProp("Header.name", h.name)}
${stringProp("Header.value", h.value)}
</elementProp>`,
    )
    .join("\n");
  return `<HeaderManager guiclass="HeaderPanel" testclass="HeaderManager" testname="${esc(node.name)}" enabled="true">
<collectionProp name="HeaderManager.headers">
${headerXml}
</collectionProp>
</HeaderManager>`;
}

interface JsonExtractorProps {
  referenceName: string;
  jsonPathExpr: string;
  defaultValue: string;
}

function renderJsonExtractor(node: TestNode): string {
  const p = node.props as unknown as JsonExtractorProps;
  return `<JSONPostProcessor guiclass="JSONPostProcessorGui" testclass="JSONPostProcessor" testname="${esc(node.name)}" enabled="true">
${stringProp("JSONPostProcessor.referenceNames", p.referenceName)}
${stringProp("JSONPostProcessor.jsonPathExprs", p.jsonPathExpr)}
${stringProp("JSONPostProcessor.match_numbers", "0")}
${stringProp("JSONPostProcessor.defaultValues", p.defaultValue)}
</JSONPostProcessor>`;
}

export type AssertionTestField =
  | "response_data"
  | "response_code"
  | "response_headers"
  | "response_message";
export type AssertionMatchType = "contains" | "matches" | "equals" | "substring";

const MATCH_TYPE_BIT: Record<AssertionMatchType, number> = {
  matches: 1,
  contains: 2,
  equals: 8,
  substring: 16,
};
const NOT_BIT = 4;

interface ResponseAssertionProps {
  testField: AssertionTestField;
  matchType: AssertionMatchType;
  patterns: string[];
  not?: boolean;
}

function renderResponseAssertion(node: TestNode): string {
  const p = node.props as unknown as ResponseAssertionProps;
  const testType = MATCH_TYPE_BIT[p.matchType] + (p.not ? NOT_BIT : 0);
  const patternsXml = p.patterns
    .map((pattern, i) => stringProp(String(i + 1), pattern))
    .join("\n");
  return `<ResponseAssertion guiclass="AssertionGui" testclass="ResponseAssertion" testname="${esc(node.name)}" enabled="true">
<collectionProp name="Asserion.test_strings">
${patternsXml}
</collectionProp>
${stringProp("Assertion.custom_message", "")}
${stringProp("Assertion.test_field", `Assertion.${p.testField}`)}
${boolProp("Assertion.assume_success", false)}
${intProp("Assertion.test_type", testType)}
</ResponseAssertion>`;
}

function renderResultCollector(
  node: TestNode,
  testname: string,
  guiclass: string,
  forcedFilename?: string,
): string {
  const filename = forcedFilename ?? (node.props.filename as string | undefined) ?? "";
  return `<ResultCollector guiclass="${guiclass}" testclass="ResultCollector" testname="${esc(testname)}" enabled="true">
${boolProp("ResultCollector.error_logging", false)}
<objProp>
<name>saveConfig</name>
<value class="SampleSaveConfiguration">
<time>true</time>
<latency>true</latency>
<timestamp>true</timestamp>
<success>true</success>
<label>true</label>
<code>true</code>
<message>true</message>
<threadName>true</threadName>
<dataType>true</dataType>
<encoding>false</encoding>
<assertions>true</assertions>
<subresults>true</subresults>
<responseData>false</responseData>
<samplerData>false</samplerData>
<xml>false</xml>
<fieldNames>true</fieldNames>
<responseHeaders>false</responseHeaders>
<requestHeaders>false</requestHeaders>
<responseDataOnError>false</responseDataOnError>
<saveAssertionResultsFailureMessage>true</saveAssertionResultsFailureMessage>
<assertionsResultsToSave>0</assertionsResultsToSave>
<bytes>true</bytes>
<sentBytes>true</sentBytes>
<url>true</url>
<threadCounts>true</threadCounts>
<idleTime>true</idleTime>
<connectTime>true</connectTime>
</value>
</objProp>
${stringProp("filename", filename)}
</ResultCollector>`;
}

function renderElement(node: TestNode, opts: SerializeOptions): string {
  switch (node.type) {
    case "TestPlan":
      return renderTestPlan(node);
    case "ThreadGroup":
      return renderThreadGroup(node);
    case "HTTPSamplerProxy":
      return renderHttpSampler(node);
    case "HeaderManager":
      return renderHeaderManager(node);
    case "JSONPostProcessor":
      return renderJsonExtractor(node);
    case "ResponseAssertion":
      return renderResponseAssertion(node);
    case "ResultCollectorAggregate":
      return renderResultCollector(
        node,
        "Aggregate Report",
        "StatVisualizer",
        opts.aggregateFilename,
      );
    case "ResultCollectorSummary":
      return renderResultCollector(node, "Summary Report", "SummaryReport", opts.summaryFilename);
    default: {
      const exhaustive: never = node.type;
      throw new Error(`Unknown node type: ${exhaustive}`);
    }
  }
}

function renderNode(node: TestNode, opts: SerializeOptions): string {
  const elementXml = renderElement(node, opts);
  const childrenXml = node.children.map((child) => renderNode(child, opts)).join("\n");
  return `${elementXml}\n<hashTree>\n${childrenXml}\n</hashTree>`;
}

export function serializePlan(root: TestNode, opts: SerializeOptions = {}): string {
  const body = renderNode(root, opts);
  return `<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.6.3">
<hashTree>
${body}
</hashTree>
</jmeterTestPlan>
`;
}
