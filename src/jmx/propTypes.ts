/**
 * Per-type props shapes, shared between the serializer (tree -> XML) and the parser
 * (XML -> tree) so the two stay in sync instead of drifting apart over time.
 */

export interface ThreadGroupProps {
  numThreads: number;
  rampTimeSeconds: number;
  loops?: number;
  durationSeconds?: number;
}

export interface HttpSamplerProps {
  method: string;
  protocol?: string;
  domain?: string;
  port?: number;
  path: string;
  bodyJson?: string;
}

export interface HeaderManagerProps {
  headers: Array<{ name: string; value: string }>;
}

export interface JsonExtractorProps {
  referenceName: string;
  jsonPathExpr: string;
  defaultValue: string;
}

export type AssertionTestField =
  | "response_data"
  | "response_code"
  | "response_headers"
  | "response_message";
export type AssertionMatchType = "contains" | "matches" | "equals" | "substring";

export interface ResponseAssertionProps {
  testField: AssertionTestField;
  matchType: AssertionMatchType;
  patterns: string[];
  not?: boolean;
}

export interface CsvDataSetProps {
  filename: string;
  variableNames?: string;
  delimiter: string;
  ignoreFirstLine: boolean;
  recycle: boolean;
  stopThread: boolean;
}

export interface ArgumentsProps {
  variables: Array<{ name: string; value: string }>;
}

export interface ConstantTimerProps {
  delayMs: number;
}

export interface RegexExtractorProps {
  referenceName: string;
  regex: string;
  template: string;
  matchNumber: number;
  defaultValue: string;
}

export interface TransactionControllerProps {
  includeTimers: boolean;
}

export interface LoopControllerProps {
  loops: number;
}

export interface IfControllerProps {
  condition: string;
  evaluateAll: boolean;
}

export interface JdbcConnectionConfigProps {
  dataSource: string;
  dbUrl: string;
  driver: string;
  username?: string;
  password?: string;
  poolMax: number;
  connectionAge: number;
  timeout: number;
  trimInterval: number;
  checkQuery?: string;
}

export interface JdbcRequestProps {
  dataSource: string;
  query: string;
  queryType: string;
  variableNames?: string;
  resultVariable?: string;
  queryArguments?: string;
  queryArgumentsTypes?: string;
}

export interface Jsr223SamplerProps {
  scriptLanguage: string;
  script: string;
  parameters?: string;
}

export interface FtpRequestProps {
  server: string;
  port?: number;
  filename: string;
  localFilename?: string;
  inputData?: string;
  binaryMode: boolean;
  saveResponse: boolean;
  upload: boolean;
  username: string;
  password: string;
}

export interface TcpSamplerProps {
  server: string;
  port: number;
  request: string;
  classname: string;
  reUseConnection: boolean;
  closeConnection: boolean;
  noDelay: boolean;
  ctimeout?: number;
  timeout?: number;
}

export interface HttpRequestDefaultsProps {
  protocol?: string;
  domain?: string;
  port?: number;
  path?: string;
  connectTimeoutMs?: number;
  responseTimeoutMs?: number;
}

export interface CookieManagerProps {
  clearEachIteration: boolean;
  policy: string;
}

export interface WhileControllerProps {
  condition: string;
}

export interface InterleaveControllerProps {
  ignoreSubControllerBlocks: boolean;
}

export interface XPathExtractorProps {
  referenceName: string;
  xpathQuery: string;
  defaultValue: string;
  matchNumber: number;
  tolerant: boolean;
}

export interface Jsr223ProcessorProps {
  scriptLanguage: string;
  script: string;
  parameters?: string;
}

export interface UserParametersProps {
  variableNames: string[];
  valueSets: string[][];
  perIteration: boolean;
}

export interface JsonAssertionProps {
  jsonPath: string;
  expectedValue?: string;
  jsonValidation: boolean;
  expectNull: boolean;
  invert: boolean;
  isRegex: boolean;
}

export interface DurationAssertionProps {
  maxDurationMs: number;
}

export type SizeAssertionOperator =
  | "equal"
  | "notequal"
  | "greaterthan"
  | "lessthan"
  | "greaterthanequal"
  | "lessthanequal";
export type SizeAssertionTestField =
  | "response_network_size"
  | "response_headers"
  | "response_data"
  | "response_code"
  | "response_message";

export interface SizeAssertionProps {
  size: number;
  operator: SizeAssertionOperator;
  testField: SizeAssertionTestField;
}

export interface UniformRandomTimerProps {
  delayMs: number;
  rangeMs: number;
}

export type ThroughputCalcMode =
  | "this_thread_only"
  | "all_active_threads"
  | "all_active_threads_in_current_thread_group"
  | "all_active_threads_shared"
  | "all_active_threads_in_current_thread_group_shared";

export interface ConstantThroughputTimerProps {
  targetSamplesPerMinute: number;
  calcMode: ThroughputCalcMode;
}

export interface ViewResultsTreeProps {
  filename?: string;
  captureFullData: boolean;
}

export interface BackendListenerProps {
  classname: string;
  args: Array<{ name: string; value: string }>;
}

export interface UnknownElementProps {
  /**
   * Semantically-equivalent reconstructed XML for an element type this server doesn't model,
   * for everything BELOW the opening tag's testname/enabled attributes - those two are owned by
   * TestNode.name/enabled and injected fresh at render time (see renderUnknownElement in
   * serializer.ts), so rename_element/set_element_enabled work on this node like any other.
   * Do not include testname/enabled in a replacement rawXml or they'll be emitted twice.
   */
  rawXml: string;
}
