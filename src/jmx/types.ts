export type NodeType =
  | "TestPlan"
  | "ThreadGroup"
  | "HTTPSamplerProxy"
  | "HeaderManager"
  | "JSONPostProcessor"
  | "ResponseAssertion"
  | "ResultCollectorAggregate"
  | "ResultCollectorSummary"
  | "CSVDataSet"
  | "Arguments"
  | "ConstantTimer"
  | "RegexExtractor"
  | "TransactionController"
  | "LoopController"
  | "IfController"
  | "JDBCConnectionConfiguration"
  | "JDBCRequest"
  | "JSR223Sampler"
  | "FTPRequest"
  | "TCPSampler"
  | "HTTPRequestDefaults"
  | "CookieManager"
  | "WhileController"
  | "RandomController"
  | "InterleaveController"
  | "SetupThreadGroup"
  | "PostThreadGroup"
  | "XPathExtractor"
  | "JSR223PreProcessor"
  | "JSR223PostProcessor"
  | "UserParameters"
  | "JSONAssertion"
  | "DurationAssertion"
  | "SizeAssertion"
  | "UniformRandomTimer"
  | "ConstantThroughputTimer"
  | "ResultCollectorViewResultsTree"
  | "BackendListener"
  | "UnknownElement";

export interface TestNode {
  id: string;
  type: NodeType;
  name: string;
  /** Absent means enabled (matches JMeter's own default). */
  enabled?: boolean;
  props: Record<string, unknown>;
  children: TestNode[];
}

export interface PlanFile {
  planId: string;
  name: string;
  createdAt: string;
  root: TestNode;
}
