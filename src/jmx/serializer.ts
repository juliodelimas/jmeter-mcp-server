import type { TestNode } from "./types.js";
import type {
  ArgumentsProps,
  AssertionMatchType,
  AssertionTestField,
  BackendListenerProps,
  ConstantThroughputTimerProps,
  ConstantTimerProps,
  CookieManagerProps,
  CsvDataSetProps,
  DurationAssertionProps,
  FtpRequestProps,
  HeaderManagerProps,
  HttpRequestDefaultsProps,
  HttpSamplerProps,
  IfControllerProps,
  InterleaveControllerProps,
  JdbcConnectionConfigProps,
  JdbcRequestProps,
  JsonAssertionProps,
  JsonExtractorProps,
  Jsr223ProcessorProps,
  Jsr223SamplerProps,
  LoopControllerProps,
  RegexExtractorProps,
  ResponseAssertionProps,
  SizeAssertionOperator,
  SizeAssertionProps,
  SizeAssertionTestField,
  TcpSamplerProps,
  ThreadGroupProps,
  ThroughputCalcMode,
  TransactionControllerProps,
  UniformRandomTimerProps,
  UnknownElementProps,
  UserParametersProps,
  ViewResultsTreeProps,
  WhileControllerProps,
  XPathExtractorProps,
} from "./propTypes.js";

export type {
  AssertionMatchType,
  AssertionTestField,
  SizeAssertionOperator,
  SizeAssertionTestField,
  ThroughputCalcMode,
};

export interface SerializeOptions {
  /** Absolute path to force as the Aggregate Report listener's output file. */
  aggregateFilename?: string;
  /** Absolute path to force as the Summary Report listener's output file. */
  summaryFilename?: string;
  /** Absolute path to force as the View Results Tree listener's output file. */
  viewResultsTreeFilename?: string;
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
const doubleProp = (name: string, value: number) =>
  `<doubleProp>\n<name>${esc(name)}</name>\n<value>${value}</value>\n<savedValue>0.0</savedValue>\n</doubleProp>`;

function renderTestPlan(node: TestNode): string {
  return `<TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="${esc(node.name)}" enabled="${node.enabled !== false}">
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

function renderThreadGroupVariant(node: TestNode, tag: string, guiclass: string): string {
  const p = node.props as unknown as ThreadGroupProps;
  const scheduler = p.durationSeconds !== undefined;
  const loops = p.loops ?? (scheduler ? 1 : 1);
  return `<${tag} guiclass="${guiclass}" testclass="${tag}" testname="${esc(node.name)}" enabled="${node.enabled !== false}">
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
</${tag}>`;
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
  return `<HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="${esc(node.name)}" enabled="${node.enabled !== false}">
${renderHttpArguments(p.bodyJson)}
${stringProp("HTTPSampler.domain", p.domain ?? "")}
${stringProp("HTTPSampler.port", p.port ?? "")}
${stringProp("HTTPSampler.protocol", p.protocol ?? "")}
${stringProp("HTTPSampler.path", p.path)}
${stringProp("HTTPSampler.method", p.method)}
${boolProp("HTTPSampler.follow_redirects", true)}
${boolProp("HTTPSampler.auto_redirects", false)}
${boolProp("HTTPSampler.use_keepalive", true)}
${boolProp("HTTPSampler.DO_MULTIPART_POST", false)}
${boolProp("HTTPSampler.postBodyRaw", Boolean(p.bodyJson))}
</HTTPSamplerProxy>`;
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
  return `<HeaderManager guiclass="HeaderPanel" testclass="HeaderManager" testname="${esc(node.name)}" enabled="${node.enabled !== false}">
<collectionProp name="HeaderManager.headers">
${headerXml}
</collectionProp>
</HeaderManager>`;
}

function renderJsonExtractor(node: TestNode): string {
  const p = node.props as unknown as JsonExtractorProps;
  return `<JSONPostProcessor guiclass="JSONPostProcessorGui" testclass="JSONPostProcessor" testname="${esc(node.name)}" enabled="${node.enabled !== false}">
${stringProp("JSONPostProcessor.referenceNames", p.referenceName)}
${stringProp("JSONPostProcessor.jsonPathExprs", p.jsonPathExpr)}
${stringProp("JSONPostProcessor.match_numbers", "0")}
${stringProp("JSONPostProcessor.defaultValues", p.defaultValue)}
</JSONPostProcessor>`;
}

export const MATCH_TYPE_BIT: Record<AssertionMatchType, number> = {
  matches: 1,
  contains: 2,
  equals: 8,
  substring: 16,
};
export const NOT_BIT = 4;

function renderResponseAssertion(node: TestNode): string {
  const p = node.props as unknown as ResponseAssertionProps;
  const testType = MATCH_TYPE_BIT[p.matchType] + (p.not ? NOT_BIT : 0);
  const patternsXml = p.patterns
    .map((pattern, i) => stringProp(String(i + 1), pattern))
    .join("\n");
  return `<ResponseAssertion guiclass="AssertionGui" testclass="ResponseAssertion" testname="${esc(node.name)}" enabled="${node.enabled !== false}">
<collectionProp name="Asserion.test_strings">
${patternsXml}
</collectionProp>
${stringProp("Assertion.custom_message", "")}
${stringProp("Assertion.test_field", `Assertion.${p.testField}`)}
${boolProp("Assertion.assume_success", false)}
${intProp("Assertion.test_type", testType)}
</ResponseAssertion>`;
}

function renderCsvDataSet(node: TestNode): string {
  const p = node.props as unknown as CsvDataSetProps;
  return `<CSVDataSet guiclass="TestBeanGUI" testclass="CSVDataSet" testname="${esc(node.name)}" enabled="${node.enabled !== false}">
${stringProp("filename", p.filename)}
${stringProp("fileEncoding", "UTF-8")}
${stringProp("variableNames", p.variableNames ?? "")}
${boolProp("ignoreFirstLine", p.ignoreFirstLine)}
${stringProp("delimiter", p.delimiter)}
${boolProp("quotedData", false)}
${boolProp("recycle", p.recycle)}
${boolProp("stopThread", p.stopThread)}
${stringProp("shareMode", "shareMode.all")}
</CSVDataSet>`;
}

function renderArguments(node: TestNode): string {
  const p = node.props as unknown as ArgumentsProps;
  const argsXml = p.variables
    .map(
      (v) => `<elementProp name="${esc(v.name)}" elementType="Argument">
${stringProp("Argument.name", v.name)}
${stringProp("Argument.value", v.value)}
${stringProp("Argument.metadata", "=")}
</elementProp>`,
    )
    .join("\n");
  return `<Arguments guiclass="ArgumentsPanel" testclass="Arguments" testname="${esc(node.name)}" enabled="${node.enabled !== false}">
<collectionProp name="Arguments.arguments">
${argsXml}
</collectionProp>
</Arguments>`;
}

function renderConstantTimer(node: TestNode): string {
  const p = node.props as unknown as ConstantTimerProps;
  return `<ConstantTimer guiclass="ConstantTimerGui" testclass="ConstantTimer" testname="${esc(node.name)}" enabled="${node.enabled !== false}">
${stringProp("ConstantTimer.delay", p.delayMs)}
</ConstantTimer>`;
}

function renderRegexExtractor(node: TestNode): string {
  const p = node.props as unknown as RegexExtractorProps;
  return `<RegexExtractor guiclass="RegexExtractorGui" testclass="RegexExtractor" testname="${esc(node.name)}" enabled="${node.enabled !== false}">
${stringProp("RegexExtractor.useHeaders", "false")}
${stringProp("RegexExtractor.refname", p.referenceName)}
${stringProp("RegexExtractor.regex", p.regex)}
${stringProp("RegexExtractor.template", p.template)}
${stringProp("RegexExtractor.default", p.defaultValue)}
${stringProp("RegexExtractor.match_number", p.matchNumber)}
</RegexExtractor>`;
}

function renderTransactionController(node: TestNode): string {
  const p = node.props as unknown as TransactionControllerProps;
  return `<TransactionController guiclass="TransactionControllerGui" testclass="TransactionController" testname="${esc(node.name)}" enabled="${node.enabled !== false}">
${boolProp("TransactionController.includeTimers", p.includeTimers)}
${boolProp("TransactionController.parent", false)}
</TransactionController>`;
}

function renderLoopController(node: TestNode): string {
  const p = node.props as unknown as LoopControllerProps;
  const continueForever = p.loops === -1;
  return `<LoopController guiclass="LoopControlPanel" testclass="LoopController" testname="${esc(node.name)}" enabled="${node.enabled !== false}">
${boolProp("LoopController.continue_forever", continueForever)}
${intProp("LoopController.loops", p.loops)}
</LoopController>`;
}

function renderIfController(node: TestNode): string {
  const p = node.props as unknown as IfControllerProps;
  return `<IfController guiclass="IfControllerPanel" testclass="IfController" testname="${esc(node.name)}" enabled="${node.enabled !== false}">
${stringProp("IfController.condition", p.condition)}
${boolProp("IfController.evaluateAll", p.evaluateAll)}
${boolProp("IfController.useExpression", false)}
</IfController>`;
}

function renderJdbcConnectionConfiguration(node: TestNode): string {
  const p = node.props as unknown as JdbcConnectionConfigProps;
  return `<JDBCDataSource guiclass="TestBeanGUI" testclass="JDBCDataSource" testname="${esc(node.name)}" enabled="${node.enabled !== false}">
${boolProp("autocommit", true)}
${stringProp("checkQuery", p.checkQuery ?? "")}
${stringProp("connectionAge", p.connectionAge)}
${stringProp("dataSource", p.dataSource)}
${stringProp("dbUrl", p.dbUrl)}
${stringProp("driver", p.driver)}
${boolProp("keepAlive", true)}
${stringProp("password", p.password ?? "")}
${stringProp("poolMax", p.poolMax)}
${stringProp("timeout", p.timeout)}
${stringProp("transactionIsolation", "DEFAULT")}
${stringProp("trimInterval", p.trimInterval)}
${stringProp("username", p.username ?? "")}
</JDBCDataSource>`;
}

function renderJdbcRequest(node: TestNode): string {
  const p = node.props as unknown as JdbcRequestProps;
  return `<JDBCSampler guiclass="TestBeanGUI" testclass="JDBCSampler" testname="${esc(node.name)}" enabled="${node.enabled !== false}">
${stringProp("dataSource", p.dataSource)}
${stringProp("query", p.query)}
${stringProp("queryArguments", p.queryArguments ?? "")}
${stringProp("queryArgumentsTypes", p.queryArgumentsTypes ?? "")}
${stringProp("queryType", p.queryType)}
${stringProp("resultVariable", p.resultVariable ?? "")}
${stringProp("variableNames", p.variableNames ?? "")}
</JDBCSampler>`;
}

function renderJsr223Sampler(node: TestNode): string {
  const p = node.props as unknown as Jsr223SamplerProps;
  return `<JSR223Sampler guiclass="TestBeanGUI" testclass="JSR223Sampler" testname="${esc(node.name)}" enabled="${node.enabled !== false}">
${stringProp("cacheKey", "true")}
${stringProp("filename", "")}
${stringProp("parameters", p.parameters ?? "")}
${stringProp("script", p.script)}
${stringProp("scriptLanguage", p.scriptLanguage)}
</JSR223Sampler>`;
}

function renderFtpRequest(node: TestNode): string {
  const p = node.props as unknown as FtpRequestProps;
  return `<FTPSampler guiclass="FtpTestSamplerGui" testclass="FTPSampler" testname="${esc(node.name)}" enabled="${node.enabled !== false}">
${stringProp("FTPSampler.server", p.server)}
${stringProp("FTPSampler.port", p.port ?? "")}
${stringProp("FTPSampler.filename", p.filename)}
${stringProp("FTPSampler.localfilename", p.localFilename ?? "")}
${stringProp("FTPSampler.inputdata", p.inputData ?? "")}
${boolProp("FTPSampler.binarymode", p.binaryMode)}
${boolProp("FTPSampler.saveresponse", p.saveResponse)}
${boolProp("FTPSampler.upload", p.upload)}
${stringProp("ConfigTestElement.username", p.username)}
${stringProp("ConfigTestElement.password", p.password)}
</FTPSampler>`;
}

function renderTcpSampler(node: TestNode): string {
  const p = node.props as unknown as TcpSamplerProps;
  return `<TCPSampler guiclass="TCPSamplerGui" testclass="TCPSampler" testname="${esc(node.name)}" enabled="${node.enabled !== false}">
${stringProp("TCPSampler.server", p.server)}
${stringProp("TCPSampler.port", p.port)}
${stringProp("TCPSampler.classname", p.classname)}
${boolProp("TCPSampler.reUseConnection", p.reUseConnection)}
${boolProp("TCPSampler.closeConnection", p.closeConnection)}
${stringProp("TCPSampler.soLinger", "")}
${stringProp("TCPSampler.EolByte", "")}
${stringProp("TCPSampler.ctimeout", p.ctimeout ?? "")}
${stringProp("TCPSampler.timeout", p.timeout ?? "")}
${boolProp("TCPSampler.nodelay", p.noDelay)}
${stringProp("TCPSampler.request", p.request)}
${stringProp("TCPSampler.filename", "")}
</TCPSampler>`;
}

function renderHttpRequestDefaults(node: TestNode): string {
  const p = node.props as unknown as HttpRequestDefaultsProps;
  return `<ConfigTestElement guiclass="HttpDefaultsGui" testclass="ConfigTestElement" testname="${esc(node.name)}" enabled="${node.enabled !== false}">
<elementProp name="HTTPsampler.Arguments" elementType="Arguments" guiclass="HTTPArgumentsPanel" testclass="Arguments" testname="User Defined Variables" enabled="true">
<collectionProp name="Arguments.arguments"/>
</elementProp>
${stringProp("HTTPSampler.domain", p.domain ?? "")}
${stringProp("HTTPSampler.port", p.port ?? "")}
${stringProp("HTTPSampler.connect_timeout", p.connectTimeoutMs ?? "")}
${stringProp("HTTPSampler.response_timeout", p.responseTimeoutMs ?? "")}
${stringProp("HTTPSampler.protocol", p.protocol ?? "")}
${stringProp("HTTPSampler.contentEncoding", "")}
${stringProp("HTTPSampler.path", p.path ?? "")}
${stringProp("HTTPSampler.concurrentPool", "4")}
</ConfigTestElement>`;
}

function renderCookieManager(node: TestNode): string {
  const p = node.props as unknown as CookieManagerProps;
  return `<CookieManager guiclass="CookiePanel" testclass="CookieManager" testname="${esc(node.name)}" enabled="${node.enabled !== false}">
<collectionProp name="CookieManager.cookies"/>
${boolProp("CookieManager.clearEachIteration", p.clearEachIteration)}
${stringProp("CookieManager.policy", p.policy)}
${stringProp("CookieManager.implementation", "org.apache.jmeter.protocol.http.control.HC4CookieHandler")}
</CookieManager>`;
}

function renderWhileController(node: TestNode): string {
  const p = node.props as unknown as WhileControllerProps;
  return `<WhileController guiclass="WhileControllerGui" testclass="WhileController" testname="${esc(node.name)}" enabled="${node.enabled !== false}">
${stringProp("WhileController.condition", p.condition)}
</WhileController>`;
}

function renderRandomController(node: TestNode): string {
  return `<RandomController guiclass="RandomControlGui" testclass="RandomController" testname="${esc(node.name)}" enabled="${node.enabled !== false}">
${intProp("InterleaveControl.style", 1)}
</RandomController>`;
}

function renderInterleaveController(node: TestNode): string {
  const p = node.props as unknown as InterleaveControllerProps;
  return `<InterleaveControl guiclass="InterleaveControlGui" testclass="InterleaveControl" testname="${esc(node.name)}" enabled="${node.enabled !== false}">
${intProp("InterleaveControl.style", p.ignoreSubControllerBlocks ? 1 : 0)}
</InterleaveControl>`;
}

function renderXPathExtractor(node: TestNode): string {
  const p = node.props as unknown as XPathExtractorProps;
  return `<XPathExtractor guiclass="XPathExtractorGui" testclass="XPathExtractor" testname="${esc(node.name)}" enabled="${node.enabled !== false}">
${stringProp("XPathExtractor.default", p.defaultValue)}
${stringProp("XPathExtractor.refname", p.referenceName)}
${stringProp("XPathExtractor.xpathQuery", p.xpathQuery)}
${boolProp("XPathExtractor.validate", false)}
${boolProp("XPathExtractor.tolerant", p.tolerant)}
${boolProp("XPathExtractor.namespace", false)}
${boolProp("XPathExtractor.quiet", true)}
${boolProp("XPathExtractor.report_errors", false)}
${boolProp("XPathExtractor.show_warnings", false)}
${boolProp("XPathExtractor.download_dtds", false)}
${boolProp("XPathExtractor.whitespace", false)}
${boolProp("XPathExtractor.fragment", false)}
${intProp("XPathExtractor.matchNumber", p.matchNumber)}
</XPathExtractor>`;
}

function renderJsr223Processor(node: TestNode, tag: string): string {
  const p = node.props as unknown as Jsr223ProcessorProps;
  return `<${tag} guiclass="TestBeanGUI" testclass="${tag}" testname="${esc(node.name)}" enabled="${node.enabled !== false}">
${stringProp("scriptLanguage", p.scriptLanguage)}
${stringProp("parameters", p.parameters ?? "")}
${stringProp("filename", "")}
${stringProp("cacheKey", "true")}
${stringProp("script", p.script)}
</${tag}>`;
}

function renderUserParameters(node: TestNode): string {
  const p = node.props as unknown as UserParametersProps;
  const namesXml = p.variableNames.map((name, i) => stringProp(String(i + 1), name)).join("\n");
  const threadValuesXml = p.valueSets
    .map((values, j) => {
      const valuesXml = values.map((value, i) => stringProp(String(i + 1), value)).join("\n");
      return `<collectionProp name="${j + 1}">\n${valuesXml}\n</collectionProp>`;
    })
    .join("\n");
  return `<UserParameters guiclass="UserParametersGui" testclass="UserParameters" testname="${esc(node.name)}" enabled="${node.enabled !== false}">
<collectionProp name="UserParameters.names">
${namesXml}
</collectionProp>
<collectionProp name="UserParameters.thread_values">
${threadValuesXml}
</collectionProp>
${boolProp("UserParameters.per_iteration", p.perIteration)}
</UserParameters>`;
}

function renderJsonAssertion(node: TestNode): string {
  const p = node.props as unknown as JsonAssertionProps;
  return `<JSONPathAssertion guiclass="JSONPathAssertionGui" testclass="JSONPathAssertion" testname="${esc(node.name)}" enabled="${node.enabled !== false}">
${stringProp("JSON_PATH", p.jsonPath)}
${stringProp("EXPECTED_VALUE", p.expectedValue ?? "")}
${boolProp("JSONVALIDATION", p.jsonValidation)}
${boolProp("EXPECT_NULL", p.expectNull)}
${boolProp("INVERT", p.invert)}
${boolProp("ISREGEX", p.isRegex)}
</JSONPathAssertion>`;
}

function renderDurationAssertion(node: TestNode): string {
  const p = node.props as unknown as DurationAssertionProps;
  return `<DurationAssertion guiclass="DurationAssertionGui" testclass="DurationAssertion" testname="${esc(node.name)}" enabled="${node.enabled !== false}">
${stringProp("DurationAssertion.duration", p.maxDurationMs)}
</DurationAssertion>`;
}

const SIZE_OPERATOR_CODE: Record<SizeAssertionOperator, number> = {
  equal: 1,
  notequal: 2,
  greaterthan: 3,
  lessthan: 4,
  greaterthanequal: 5,
  lessthanequal: 6,
};

function renderSizeAssertion(node: TestNode): string {
  const p = node.props as unknown as SizeAssertionProps;
  return `<SizeAssertion guiclass="SizeAssertionGui" testclass="SizeAssertion" testname="${esc(node.name)}" enabled="${node.enabled !== false}">
${stringProp("Assertion.test_field", `SizeAssertion.${p.testField}`)}
${stringProp("SizeAssertion.size", p.size)}
${intProp("SizeAssertion.operator", SIZE_OPERATOR_CODE[p.operator])}
</SizeAssertion>`;
}

function renderUniformRandomTimer(node: TestNode): string {
  const p = node.props as unknown as UniformRandomTimerProps;
  return `<UniformRandomTimer guiclass="UniformRandomTimerGui" testclass="UniformRandomTimer" testname="${esc(node.name)}" enabled="${node.enabled !== false}">
${stringProp("ConstantTimer.delay", p.delayMs)}
${stringProp("RandomTimer.range", p.rangeMs)}
</UniformRandomTimer>`;
}

const CALC_MODE_CODE: Record<ThroughputCalcMode, number> = {
  this_thread_only: 0,
  all_active_threads: 1,
  all_active_threads_in_current_thread_group: 2,
  all_active_threads_shared: 3,
  all_active_threads_in_current_thread_group_shared: 4,
};

function renderConstantThroughputTimer(node: TestNode): string {
  const p = node.props as unknown as ConstantThroughputTimerProps;
  return `<ConstantThroughputTimer guiclass="TestBeanGUI" testclass="ConstantThroughputTimer" testname="${esc(node.name)}" enabled="${node.enabled !== false}">
${intProp("calcMode", CALC_MODE_CODE[p.calcMode])}
${doubleProp("throughput", p.targetSamplesPerMinute)}
</ConstantThroughputTimer>`;
}

function renderViewResultsTree(node: TestNode, forcedFilename?: string): string {
  const p = node.props as unknown as ViewResultsTreeProps;
  const filename = forcedFilename ?? p.filename ?? "";
  const full = p.captureFullData;
  return `<ResultCollector guiclass="ViewResultsFullVisualizer" testclass="ResultCollector" testname="${esc(node.name)}" enabled="${node.enabled !== false}">
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
<message>${full}</message>
<threadName>true</threadName>
<dataType>${full}</dataType>
<encoding>false</encoding>
<assertions>${full}</assertions>
<subresults>${full}</subresults>
<responseData>${full}</responseData>
<samplerData>${full}</samplerData>
<xml>false</xml>
<fieldNames>true</fieldNames>
<responseHeaders>${full}</responseHeaders>
<requestHeaders>${full}</requestHeaders>
<responseDataOnError>${full}</responseDataOnError>
<saveAssertionResultsFailureMessage>true</saveAssertionResultsFailureMessage>
<assertionsResultsToSave>0</assertionsResultsToSave>
<bytes>true</bytes>
<sentBytes>true</sentBytes>
<url>true</url>
<threadCounts>true</threadCounts>
<sampleCount>true</sampleCount>
<idleTime>true</idleTime>
<connectTime>true</connectTime>
</value>
</objProp>
${stringProp("filename", filename)}
</ResultCollector>`;
}

function renderBackendListener(node: TestNode): string {
  const p = node.props as unknown as BackendListenerProps;
  const argsXml = p.args
    .map(
      (a) => `<elementProp name="${esc(a.name)}" elementType="Argument">
${stringProp("Argument.name", a.name)}
${stringProp("Argument.value", a.value)}
${stringProp("Argument.metadata", "=")}
</elementProp>`,
    )
    .join("\n");
  return `<BackendListener guiclass="BackendListenerGui" testclass="BackendListener" testname="${esc(node.name)}" enabled="${node.enabled !== false}">
<elementProp name="arguments" elementType="Arguments" guiclass="ArgumentsPanel" testclass="Arguments" enabled="true">
<collectionProp name="Arguments.arguments">
${argsXml}
</collectionProp>
</elementProp>
${stringProp("classname", p.classname)}
</BackendListener>`;
}

function renderResultCollector(
  node: TestNode,
  testname: string,
  guiclass: string,
  forcedFilename?: string,
): string {
  const filename = forcedFilename ?? (node.props.filename as string | undefined) ?? "";
  return `<ResultCollector guiclass="${guiclass}" testclass="ResultCollector" testname="${esc(testname)}" enabled="${node.enabled !== false}">
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

function renderUnknownElement(node: TestNode): string {
  const p = node.props as unknown as UnknownElementProps;
  // rawXml is captured without testname/enabled (see parser.ts's rebuildXml) so that
  // rename_element/set_element_enabled - which only touch TestNode.name/enabled - still
  // take effect here instead of being silently overridden by whatever was in the original XML.
  const closeIdx = p.rawXml.indexOf(">");
  if (closeIdx === -1) return p.rawXml;
  const selfClosing = p.rawXml[closeIdx - 1] === "/";
  const insertAt = selfClosing ? closeIdx - 1 : closeIdx;
  const injected = ` testname="${esc(node.name)}" enabled="${node.enabled !== false}"`;
  return p.rawXml.slice(0, insertAt) + injected + p.rawXml.slice(insertAt);
}

function renderElement(node: TestNode, opts: SerializeOptions): string {
  switch (node.type) {
    case "TestPlan":
      return renderTestPlan(node);
    case "ThreadGroup":
      return renderThreadGroupVariant(node, "ThreadGroup", "ThreadGroupGui");
    case "SetupThreadGroup":
      return renderThreadGroupVariant(node, "SetupThreadGroup", "SetupThreadGroupGui");
    case "PostThreadGroup":
      return renderThreadGroupVariant(node, "PostThreadGroup", "PostThreadGroupGui");
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
    case "CSVDataSet":
      return renderCsvDataSet(node);
    case "Arguments":
      return renderArguments(node);
    case "ConstantTimer":
      return renderConstantTimer(node);
    case "RegexExtractor":
      return renderRegexExtractor(node);
    case "TransactionController":
      return renderTransactionController(node);
    case "LoopController":
      return renderLoopController(node);
    case "IfController":
      return renderIfController(node);
    case "JDBCConnectionConfiguration":
      return renderJdbcConnectionConfiguration(node);
    case "JDBCRequest":
      return renderJdbcRequest(node);
    case "JSR223Sampler":
      return renderJsr223Sampler(node);
    case "FTPRequest":
      return renderFtpRequest(node);
    case "TCPSampler":
      return renderTcpSampler(node);
    case "HTTPRequestDefaults":
      return renderHttpRequestDefaults(node);
    case "CookieManager":
      return renderCookieManager(node);
    case "WhileController":
      return renderWhileController(node);
    case "RandomController":
      return renderRandomController(node);
    case "InterleaveController":
      return renderInterleaveController(node);
    case "XPathExtractor":
      return renderXPathExtractor(node);
    case "JSR223PreProcessor":
      return renderJsr223Processor(node, "JSR223PreProcessor");
    case "JSR223PostProcessor":
      return renderJsr223Processor(node, "JSR223PostProcessor");
    case "UserParameters":
      return renderUserParameters(node);
    case "JSONAssertion":
      return renderJsonAssertion(node);
    case "DurationAssertion":
      return renderDurationAssertion(node);
    case "SizeAssertion":
      return renderSizeAssertion(node);
    case "UniformRandomTimer":
      return renderUniformRandomTimer(node);
    case "ConstantThroughputTimer":
      return renderConstantThroughputTimer(node);
    case "ResultCollectorViewResultsTree":
      return renderViewResultsTree(node, opts.viewResultsTreeFilename);
    case "BackendListener":
      return renderBackendListener(node);
    case "UnknownElement":
      return renderUnknownElement(node);
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
