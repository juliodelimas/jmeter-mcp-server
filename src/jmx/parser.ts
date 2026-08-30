import { XMLBuilder, XMLParser } from "fast-xml-parser";
import { genId } from "./tree.js";
import type { NodeType, TestNode } from "./types.js";
import type {
  ArgumentsProps,
  AssertionMatchType,
  AssertionTestField,
  CookieManagerProps,
  CsvDataSetProps,
  HeaderManagerProps,
  HttpRequestDefaultsProps,
  HttpSamplerProps,
  IfControllerProps,
  LoopControllerProps,
  RegexExtractorProps,
  ResponseAssertionProps,
  ThreadGroupProps,
  TransactionControllerProps,
  ViewResultsTreeProps,
} from "./propTypes.js";
import { MATCH_TYPE_BIT, NOT_BIT } from "./serializer.js";

const XML_OPTS = {
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
} as const;

/**
 * A node in fast-xml-parser's preserveOrder output shape: `{ [tagName]: children[], ":@"?: attrs }`.
 * Exactly one own key besides ":@" names the tag.
 */
type XmlNode = Record<string, any>;

export interface ParseResult {
  root: TestNode;
  unknownCount: number;
  unknownTypes: string[];
}

export function parseJmx(xml: string): ParseResult {
  const parser = new XMLParser(XML_OPTS);
  const doc = parser.parse(xml) as XmlNode[];

  const jmeterTestPlanNode = doc.find((n) => tagOf(n) === "jmeterTestPlan");
  if (!jmeterTestPlanNode) {
    throw new Error("Not a JMeter test plan: missing a <jmeterTestPlan> root element.");
  }
  const topHashTree = childrenOf(jmeterTestPlanNode).find((n) => tagOf(n) === "hashTree");
  if (!topHashTree) {
    throw new Error("Malformed .jmx: <jmeterTestPlan> has no top-level <hashTree>.");
  }
  const pairs = pairUp(childrenOf(topHashTree));
  if (pairs.length !== 1) {
    throw new Error(
      `Malformed .jmx: expected exactly one root element under <jmeterTestPlan><hashTree>, found ${pairs.length}.`,
    );
  }
  const [rootElementNode, rootChildHashTree] = pairs[0];
  if (tagOf(rootElementNode) !== "TestPlan") {
    throw new Error(`The root element of a JMeter test plan must be <TestPlan>, got <${tagOf(rootElementNode)}>.`);
  }

  const unknownTypes = new Set<string>();
  let unknownCount = 0;

  function buildNode(elementNode: XmlNode, childHashTree: XmlNode): TestNode {
    const tag = tagOf(elementNode);
    const attrs = attrsOf(elementNode);
    const elementChildren = childrenOf(elementNode);
    const { type, props } = classify(tag, attrs, elementChildren);

    const node: TestNode = {
      id: genId("node"),
      type,
      name: attrs["@_testname"] ?? tag,
      props: pruneUndefined(props as Record<string, unknown>),
      children: [],
    };
    if (attrs["@_enabled"] === "false") {
      node.enabled = false;
    }
    if (type === "UnknownElement") {
      unknownCount++;
      unknownTypes.add(tag);
      node.props = { rawXml: rebuildXml(elementNode) };
    }

    const childPairs = pairUp(childrenOf(childHashTree));
    node.children = childPairs.map(([el, ht]) => buildNode(el, ht));
    return node;
  }

  const root = buildNode(rootElementNode, rootChildHashTree);
  return { root, unknownCount, unknownTypes: [...unknownTypes] };
}

function pruneUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function rebuildXml(elementNode: XmlNode): string {
  // Drop testname/enabled - those become TestNode.name/enabled, and serializer.ts's
  // renderUnknownElement injects them back in fresh at render time so that
  // rename_element/set_element_enabled on an UnknownElement node actually take effect.
  const tag = tagOf(elementNode);
  const attrs = { ...attrsOf(elementNode) };
  delete attrs["@_testname"];
  delete attrs["@_enabled"];
  const stripped: XmlNode = { [tag]: childrenOf(elementNode) };
  if (Object.keys(attrs).length > 0) {
    stripped[":@"] = attrs;
  }
  const builder = new XMLBuilder({ ...XML_OPTS, suppressEmptyNode: false });
  return builder.build([stripped]);
}

function tagOf(node: XmlNode): string {
  for (const key of Object.keys(node)) {
    if (key !== ":@") return key;
  }
  throw new Error("Malformed .jmx: encountered an XML node with no tag name.");
}

function attrsOf(node: XmlNode): Record<string, string> {
  return node[":@"] ?? {};
}

function childrenOf(node: XmlNode): XmlNode[] {
  return node[tagOf(node)] ?? [];
}

function pairUp(nodes: XmlNode[]): Array<[XmlNode, XmlNode]> {
  if (nodes.length % 2 !== 0) {
    throw new Error("Malformed .jmx: a <hashTree>'s children must come in (element, hashTree) pairs.");
  }
  const pairs: Array<[XmlNode, XmlNode]> = [];
  for (let i = 0; i < nodes.length; i += 2) {
    const el = nodes[i];
    const ht = nodes[i + 1];
    if (tagOf(ht) !== "hashTree") {
      throw new Error(`Malformed .jmx: expected a <hashTree> right after <${tagOf(el)}>, got <${tagOf(ht)}>.`);
    }
    pairs.push([el, ht]);
  }
  return pairs;
}

function textOf(node: XmlNode): string {
  return childrenOf(node)
    .filter((c) => "#text" in c)
    .map((c) => String(c["#text"]))
    .join("");
}

function findByTag(children: XmlNode[], tag: string): XmlNode[] {
  return children.filter((c) => tagOf(c) === tag);
}

function findByTagAndName(children: XmlNode[], tag: string, name: string): XmlNode | undefined {
  return findByTag(children, tag).find((c) => attrsOf(c)["@_name"] === name);
}

function stringPropVal(children: XmlNode[], name: string, fallback = ""): string {
  const node = findByTagAndName(children, "stringProp", name);
  return node ? textOf(node) : fallback;
}

function boolPropVal(children: XmlNode[], name: string, fallback = false): boolean {
  const node = findByTagAndName(children, "boolProp", name);
  return node ? textOf(node) === "true" : fallback;
}

function intPropVal(children: XmlNode[], name: string, fallback = 0): number {
  const node = findByTagAndName(children, "intProp", name);
  if (!node) return fallback;
  const n = Number(textOf(node));
  return Number.isFinite(n) ? n : fallback;
}

function elementPropChildren(children: XmlNode[], name: string): XmlNode[] {
  const node = findByTagAndName(children, "elementProp", name);
  return node ? childrenOf(node) : [];
}

function collectionPropChildren(children: XmlNode[], name: string): XmlNode[] {
  const node = findByTagAndName(children, "collectionProp", name);
  return node ? childrenOf(node) : [];
}

function optionalString(value: string): string | undefined {
  return value === "" ? undefined : value;
}

function optionalNumber(value: string): number | undefined {
  if (value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseThreadGroupProps(children: XmlNode[]): ThreadGroupProps {
  const numThreads = intOrDefault(stringPropVal(children, "ThreadGroup.num_threads", "1"), 1);
  const rampTimeSeconds = intOrDefault(stringPropVal(children, "ThreadGroup.ramp_time", "0"), 0);
  const scheduler = boolPropVal(children, "ThreadGroup.scheduler", false);
  if (scheduler) {
    const durationSeconds = intOrDefault(stringPropVal(children, "ThreadGroup.duration", "0"), 0);
    return { numThreads, rampTimeSeconds, durationSeconds };
  }
  const mainController = elementPropChildren(children, "ThreadGroup.main_controller");
  const loops = intPropVal(mainController, "LoopController.loops", 1);
  return { numThreads, rampTimeSeconds, loops };
}

function intOrDefault(value: string, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseHttpSamplerProps(children: XmlNode[]): HttpSamplerProps {
  const argsChildren = elementPropChildren(children, "HTTPsampler.Arguments");
  const argEntries = collectionPropChildren(argsChildren, "Arguments.arguments");
  let bodyJson: string | undefined;
  if (argEntries.length > 0) {
    bodyJson = optionalString(stringPropVal(childrenOf(argEntries[0]), "Argument.value", ""));
  }
  return {
    method: stringPropVal(children, "HTTPSampler.method", "GET"),
    protocol: optionalString(stringPropVal(children, "HTTPSampler.protocol", "")),
    domain: optionalString(stringPropVal(children, "HTTPSampler.domain", "")),
    port: optionalNumber(stringPropVal(children, "HTTPSampler.port", "")),
    path: stringPropVal(children, "HTTPSampler.path", ""),
    bodyJson,
  };
}

function parseHeaderManagerProps(children: XmlNode[]): HeaderManagerProps {
  const headers = collectionPropChildren(children, "HeaderManager.headers").map((el) => {
    const c = childrenOf(el);
    return { name: stringPropVal(c, "Header.name", ""), value: stringPropVal(c, "Header.value", "") };
  });
  return { headers };
}

function parseResponseAssertionProps(children: XmlNode[]): ResponseAssertionProps {
  const patterns = collectionPropChildren(children, "Asserion.test_strings").map((c) => textOf(c));
  const testFieldRaw = stringPropVal(children, "Assertion.test_field", "Assertion.response_data");
  const testField = testFieldRaw.replace(/^Assertion\./, "") as AssertionTestField;
  const testType = intPropVal(children, "Assertion.test_type", MATCH_TYPE_BIT.contains);
  const not = (testType & NOT_BIT) !== 0;
  const bitValue = testType & ~NOT_BIT;
  const matchType =
    (Object.entries(MATCH_TYPE_BIT).find(([, bit]) => bit === bitValue)?.[0] as AssertionMatchType | undefined) ??
    "contains";
  return { testField, matchType, patterns, not };
}

function parseCsvDataSetProps(children: XmlNode[]): CsvDataSetProps {
  return {
    filename: stringPropVal(children, "filename", ""),
    variableNames: optionalString(stringPropVal(children, "variableNames", "")),
    delimiter: stringPropVal(children, "delimiter", ","),
    ignoreFirstLine: boolPropVal(children, "ignoreFirstLine", false),
    recycle: boolPropVal(children, "recycle", true),
    stopThread: boolPropVal(children, "stopThread", false),
  };
}

function parseArgumentsProps(children: XmlNode[]): ArgumentsProps {
  const variables = collectionPropChildren(children, "Arguments.arguments").map((el) => {
    const c = childrenOf(el);
    return { name: stringPropVal(c, "Argument.name", ""), value: stringPropVal(c, "Argument.value", "") };
  });
  return { variables };
}

function parseRegexExtractorProps(children: XmlNode[]): RegexExtractorProps {
  return {
    referenceName: stringPropVal(children, "RegexExtractor.refname", ""),
    regex: stringPropVal(children, "RegexExtractor.regex", ""),
    template: stringPropVal(children, "RegexExtractor.template", "$1$"),
    matchNumber: intOrDefault(stringPropVal(children, "RegexExtractor.match_number", "1"), 1),
    defaultValue: stringPropVal(children, "RegexExtractor.default", ""),
  };
}

function parseTransactionControllerProps(children: XmlNode[]): TransactionControllerProps {
  return { includeTimers: boolPropVal(children, "TransactionController.includeTimers", false) };
}

function parseLoopControllerProps(children: XmlNode[]): LoopControllerProps {
  return { loops: intPropVal(children, "LoopController.loops", 1) };
}

function parseIfControllerProps(children: XmlNode[]): IfControllerProps {
  return {
    condition: stringPropVal(children, "IfController.condition", ""),
    evaluateAll: boolPropVal(children, "IfController.evaluateAll", false),
  };
}

function parseHttpRequestDefaultsProps(children: XmlNode[]): HttpRequestDefaultsProps {
  return {
    protocol: optionalString(stringPropVal(children, "HTTPSampler.protocol", "")),
    domain: optionalString(stringPropVal(children, "HTTPSampler.domain", "")),
    port: optionalNumber(stringPropVal(children, "HTTPSampler.port", "")),
    path: optionalString(stringPropVal(children, "HTTPSampler.path", "")),
    connectTimeoutMs: optionalNumber(stringPropVal(children, "HTTPSampler.connect_timeout", "")),
    responseTimeoutMs: optionalNumber(stringPropVal(children, "HTTPSampler.response_timeout", "")),
  };
}

function parseCookieManagerProps(children: XmlNode[]): CookieManagerProps {
  return {
    clearEachIteration: boolPropVal(children, "CookieManager.clearEachIteration", false),
    policy: stringPropVal(children, "CookieManager.policy", "standard"),
  };
}

function parseResultCollectorFilename(children: XmlNode[]): { filename?: string } {
  return { filename: optionalString(stringPropVal(children, "filename", "")) };
}

function parseViewResultsTreeProps(children: XmlNode[]): ViewResultsTreeProps {
  const filename = optionalString(stringPropVal(children, "filename", ""));
  const objProp = findByTag(children, "objProp")[0];
  let captureFullData = false;
  if (objProp) {
    const valueNode = findByTag(childrenOf(objProp), "value")[0];
    if (valueNode) {
      const responseDataNode = findByTag(childrenOf(valueNode), "responseData")[0];
      captureFullData = responseDataNode ? textOf(responseDataNode) === "true" : false;
    }
  }
  return { filename, captureFullData };
}

function classify(
  tag: string,
  attrs: Record<string, string>,
  children: XmlNode[],
): { type: NodeType; props: object } {
  switch (tag) {
    case "TestPlan":
      return { type: "TestPlan", props: {} };
    case "ThreadGroup":
      return { type: "ThreadGroup", props: parseThreadGroupProps(children) };
    case "SetupThreadGroup":
      return { type: "SetupThreadGroup", props: parseThreadGroupProps(children) };
    case "PostThreadGroup":
      return { type: "PostThreadGroup", props: parseThreadGroupProps(children) };
    case "HTTPSamplerProxy":
      return { type: "HTTPSamplerProxy", props: parseHttpSamplerProps(children) };
    case "HeaderManager":
      return { type: "HeaderManager", props: parseHeaderManagerProps(children) };
    case "ResponseAssertion":
      return { type: "ResponseAssertion", props: parseResponseAssertionProps(children) };
    case "CSVDataSet":
      return { type: "CSVDataSet", props: parseCsvDataSetProps(children) };
    case "Arguments":
      return { type: "Arguments", props: parseArgumentsProps(children) };
    case "ConstantTimer":
      return { type: "ConstantTimer", props: { delayMs: intOrDefault(stringPropVal(children, "ConstantTimer.delay", "0"), 0) } };
    case "RegexExtractor":
      return { type: "RegexExtractor", props: parseRegexExtractorProps(children) };
    case "TransactionController":
      return { type: "TransactionController", props: parseTransactionControllerProps(children) };
    case "LoopController":
      return { type: "LoopController", props: parseLoopControllerProps(children) };
    case "IfController":
      return { type: "IfController", props: parseIfControllerProps(children) };
    case "CookieManager":
      return { type: "CookieManager", props: parseCookieManagerProps(children) };
    case "ConfigTestElement":
      if (attrs["@_guiclass"] === "HttpDefaultsGui") {
        return { type: "HTTPRequestDefaults", props: parseHttpRequestDefaultsProps(children) };
      }
      break;
    case "ResultCollector": {
      const guiclass = attrs["@_guiclass"];
      if (guiclass === "StatVisualizer") {
        return { type: "ResultCollectorAggregate", props: parseResultCollectorFilename(children) };
      }
      if (guiclass === "SummaryReport") {
        return { type: "ResultCollectorSummary", props: parseResultCollectorFilename(children) };
      }
      if (guiclass === "ViewResultsFullVisualizer") {
        return { type: "ResultCollectorViewResultsTree", props: parseViewResultsTreeProps(children) };
      }
      break;
    }
  }
  return { type: "UnknownElement", props: {} };
}
