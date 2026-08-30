import { z } from "zod";
import type { NodeType } from "./types.js";

/**
 * Per-type prop schemas, mirroring the props shape each add_* tool builds (see
 * src/tools/planTools.ts and the render*Props interfaces in src/jmx/serializer.ts).
 * Used by update_element to validate a patch against the node's type when it's known.
 * Types with no meaningful props (TestPlan, RandomController) map to an empty object.
 */
export const propSchemas: Record<NodeType, z.ZodObject<any>> = {
  TestPlan: z.object({}),

  ThreadGroup: z.object({
    numThreads: z.number().int().positive(),
    rampTimeSeconds: z.number().nonnegative(),
    loops: z.number().int().optional(),
    durationSeconds: z.number().positive().optional(),
  }),
  SetupThreadGroup: z.object({
    numThreads: z.number().int().positive(),
    rampTimeSeconds: z.number().nonnegative(),
    loops: z.number().int().optional(),
    durationSeconds: z.number().positive().optional(),
  }),
  PostThreadGroup: z.object({
    numThreads: z.number().int().positive(),
    rampTimeSeconds: z.number().nonnegative(),
    loops: z.number().int().optional(),
    durationSeconds: z.number().positive().optional(),
  }),

  HTTPSamplerProxy: z.object({
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]),
    protocol: z.enum(["http", "https"]).optional(),
    domain: z.string().optional(),
    port: z.number().int().positive().optional(),
    path: z.string(),
    bodyJson: z.string().optional(),
  }),

  HeaderManager: z.object({
    headers: z.array(z.object({ name: z.string(), value: z.string() })).min(1),
  }),

  JSONPostProcessor: z.object({
    referenceName: z.string(),
    jsonPathExpr: z.string(),
    defaultValue: z.string(),
  }),

  ResponseAssertion: z.object({
    testField: z.enum(["response_data", "response_code", "response_headers", "response_message"]),
    matchType: z.enum(["contains", "matches", "equals", "substring"]),
    patterns: z.array(z.string()).min(1),
    not: z.boolean().optional(),
  }),

  ResultCollectorAggregate: z.object({
    filename: z.string().optional(),
  }),
  ResultCollectorSummary: z.object({
    filename: z.string().optional(),
  }),

  CSVDataSet: z.object({
    filename: z.string(),
    variableNames: z.string().optional(),
    delimiter: z.string(),
    ignoreFirstLine: z.boolean(),
    recycle: z.boolean(),
    stopThread: z.boolean(),
  }),

  Arguments: z.object({
    variables: z.array(z.object({ name: z.string(), value: z.string() })).min(1),
  }),

  ConstantTimer: z.object({
    delayMs: z.number().int().nonnegative(),
  }),

  RegexExtractor: z.object({
    referenceName: z.string(),
    regex: z.string(),
    template: z.string(),
    matchNumber: z.number().int(),
    defaultValue: z.string(),
  }),

  TransactionController: z.object({
    includeTimers: z.boolean(),
  }),

  LoopController: z.object({
    loops: z.number().int(),
  }),

  IfController: z.object({
    condition: z.string(),
    evaluateAll: z.boolean(),
  }),

  JDBCConnectionConfiguration: z.object({
    dataSource: z.string(),
    dbUrl: z.string(),
    driver: z.string(),
    username: z.string().optional(),
    password: z.string().optional(),
    poolMax: z.number().int(),
    connectionAge: z.number().int(),
    timeout: z.number().int(),
    trimInterval: z.number().int(),
    checkQuery: z.string().optional(),
  }),

  JDBCRequest: z.object({
    dataSource: z.string(),
    query: z.string(),
    queryType: z.enum([
      "Select Statement",
      "Update Statement",
      "Callable Statement",
      "Prepared Select Statement",
      "Prepared Update Statement",
      "Commit",
      "Rollback",
      "AutoCommit(false)",
      "AutoCommit(true)",
    ]),
    variableNames: z.string().optional(),
    resultVariable: z.string().optional(),
    queryArguments: z.string().optional(),
    queryArgumentsTypes: z.string().optional(),
  }),

  JSR223Sampler: z.object({
    scriptLanguage: z.enum(["groovy", "beanshell", "javascript", "jexl3"]),
    script: z.string(),
    parameters: z.string().optional(),
  }),

  FTPRequest: z.object({
    server: z.string(),
    port: z.number().int().positive().optional(),
    filename: z.string(),
    localFilename: z.string().optional(),
    inputData: z.string().optional(),
    binaryMode: z.boolean(),
    saveResponse: z.boolean(),
    upload: z.boolean(),
    username: z.string(),
    password: z.string(),
  }),

  TCPSampler: z.object({
    server: z.string(),
    port: z.number().int().positive(),
    request: z.string(),
    classname: z.string(),
    reUseConnection: z.boolean(),
    closeConnection: z.boolean(),
    noDelay: z.boolean(),
    ctimeout: z.number().int().optional(),
    timeout: z.number().int().optional(),
  }),

  HTTPRequestDefaults: z.object({
    protocol: z.enum(["http", "https"]).optional(),
    domain: z.string().optional(),
    port: z.number().int().positive().optional(),
    path: z.string().optional(),
    connectTimeoutMs: z.number().int().optional(),
    responseTimeoutMs: z.number().int().optional(),
  }),

  CookieManager: z.object({
    clearEachIteration: z.boolean(),
    policy: z.string(),
  }),

  WhileController: z.object({
    condition: z.string(),
  }),

  RandomController: z.object({}),

  InterleaveController: z.object({
    ignoreSubControllerBlocks: z.boolean(),
  }),

  XPathExtractor: z.object({
    referenceName: z.string(),
    xpathQuery: z.string(),
    defaultValue: z.string(),
    matchNumber: z.number().int(),
    tolerant: z.boolean(),
  }),

  JSR223PreProcessor: z.object({
    scriptLanguage: z.enum(["groovy", "beanshell", "javascript", "jexl3"]),
    script: z.string(),
    parameters: z.string().optional(),
  }),
  JSR223PostProcessor: z.object({
    scriptLanguage: z.enum(["groovy", "beanshell", "javascript", "jexl3"]),
    script: z.string(),
    parameters: z.string().optional(),
  }),

  UserParameters: z.object({
    variableNames: z.array(z.string()).min(1),
    valueSets: z.array(z.array(z.string())).min(1),
    perIteration: z.boolean(),
  }),

  JSONAssertion: z.object({
    jsonPath: z.string(),
    expectedValue: z.string().optional(),
    jsonValidation: z.boolean(),
    expectNull: z.boolean(),
    invert: z.boolean(),
    isRegex: z.boolean(),
  }),

  DurationAssertion: z.object({
    maxDurationMs: z.number().int().positive(),
  }),

  SizeAssertion: z.object({
    size: z.number().int().nonnegative(),
    operator: z.enum(["equal", "notequal", "greaterthan", "lessthan", "greaterthanequal", "lessthanequal"]),
    testField: z.enum(["response_network_size", "response_headers", "response_data", "response_code", "response_message"]),
  }),

  UniformRandomTimer: z.object({
    delayMs: z.number().nonnegative(),
    rangeMs: z.number().nonnegative(),
  }),

  ConstantThroughputTimer: z.object({
    targetSamplesPerMinute: z.number().positive(),
    calcMode: z.enum([
      "this_thread_only",
      "all_active_threads",
      "all_active_threads_in_current_thread_group",
      "all_active_threads_shared",
      "all_active_threads_in_current_thread_group_shared",
    ]),
  }),

  ResultCollectorViewResultsTree: z.object({
    filename: z.string().optional(),
    captureFullData: z.boolean(),
  }),

  BackendListener: z.object({
    classname: z.string(),
    args: z.array(z.object({ name: z.string(), value: z.string() })),
  }),

  UnknownElement: z.object({
    rawXml: z.string(),
  }),
};
