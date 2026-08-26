export type NodeType =
  | "TestPlan"
  | "ThreadGroup"
  | "HTTPSamplerProxy"
  | "HeaderManager"
  | "JSONPostProcessor"
  | "ResponseAssertion"
  | "ResultCollectorAggregate"
  | "ResultCollectorSummary";

export interface TestNode {
  id: string;
  type: NodeType;
  name: string;
  props: Record<string, unknown>;
  children: TestNode[];
}

export interface PlanFile {
  planId: string;
  name: string;
  createdAt: string;
  root: TestNode;
}
