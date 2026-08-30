import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, callTool, type TestServer } from "./support/mcpClient.js";

function findNode(node: any, id: string): any {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return undefined;
}

let server: TestServer;

before(async () => {
  server = await startServer();
});

after(async () => {
  await server.close();
});

test("README example workflow builds the expected tree shape", async () => {
  const { planId, rootNodeId } = await callTool(server.client, "create_test_plan", { name: "Example Workflow" });

  const { nodeId: threadGroupId } = await callTool(server.client, "add_thread_group", {
    planId,
    parentId: rootNodeId,
    name: "Users",
    numThreads: 5,
    rampTimeSeconds: 10,
    loops: 3,
  });

  const { nodeId: samplerId } = await callTool(server.client, "add_http_sampler", {
    planId,
    parentId: threadGroupId,
    name: "Get Users",
    method: "GET",
    protocol: "https",
    domain: "example.org",
    path: "/users",
  });

  const { nodeId: assertionId } = await callTool(server.client, "add_response_assertion", {
    planId,
    parentId: samplerId,
    patterns: ["200"],
    testField: "response_code",
  });

  const { nodeId: listenerId } = await callTool(server.client, "add_aggregate_report_listener", {
    planId,
    parentId: threadGroupId,
  });

  const tree = await callTool(server.client, "get_test_plan", { planId });

  const root = tree.root;
  assert.equal(root.id, rootNodeId);
  assert.equal(root.type, "TestPlan");

  const threadGroup = findNode(root, threadGroupId);
  assert.equal(threadGroup.type, "ThreadGroup");
  assert.ok(threadGroup.children.some((c: any) => c.id === samplerId));
  assert.ok(threadGroup.children.some((c: any) => c.id === listenerId));

  const sampler = findNode(root, samplerId);
  assert.equal(sampler.type, "HTTPSamplerProxy");
  assert.ok(sampler.children.some((c: any) => c.id === assertionId));

  const assertion = findNode(root, assertionId);
  assert.equal(assertion.type, "ResponseAssertion");
  assert.deepEqual(assertion.props.patterns, ["200"]);

  const listener = findNode(root, listenerId);
  assert.equal(listener.type, "ResultCollectorAggregate");
});

test("controller children nest under the controller, not its parent", async () => {
  const { planId, rootNodeId } = await callTool(server.client, "create_test_plan", { name: "Nesting Check" });
  const { nodeId: threadGroupId } = await callTool(server.client, "add_thread_group", {
    planId,
    parentId: rootNodeId,
    name: "Users",
    numThreads: 1,
    rampTimeSeconds: 1,
    loops: 1,
  });
  const { nodeId: transactionId } = await callTool(server.client, "add_transaction_controller", {
    planId,
    parentId: threadGroupId,
    name: "Checkout Flow",
  });
  const { nodeId: loopId } = await callTool(server.client, "add_loop_controller", {
    planId,
    parentId: transactionId,
    loops: 2,
  });
  const { nodeId: innerSamplerId } = await callTool(server.client, "add_http_sampler", {
    planId,
    parentId: loopId,
    name: "Step",
    method: "GET",
    protocol: "https",
    domain: "example.org",
    path: "/step",
  });

  const tree = await callTool(server.client, "get_test_plan", { planId });
  const threadGroup = findNode(tree.root, threadGroupId);
  const transaction = findNode(tree.root, transactionId);
  const loop = findNode(tree.root, loopId);

  // The sampler must be nested three levels deep (ThreadGroup -> TransactionController -> LoopController -> sampler),
  // not flattened as a direct sibling of the ThreadGroup.
  assert.ok(threadGroup.children.some((c: any) => c.id === transactionId));
  assert.ok(!threadGroup.children.some((c: any) => c.id === loopId), "loop controller must not be a direct child of the thread group");
  assert.ok(transaction.children.some((c: any) => c.id === loopId));
  assert.ok(loop.children.some((c: any) => c.id === innerSamplerId));
});

test("build a plan, then edit it via update_element/move_element, and read back the resulting XML", async () => {
  const { planId, rootNodeId } = await callTool(server.client, "create_test_plan", { name: "Edit Workflow" });
  const { nodeId: threadGroupId } = await callTool(server.client, "add_thread_group", {
    planId,
    parentId: rootNodeId,
    name: "Users",
    numThreads: 1,
    rampTimeSeconds: 1,
    loops: 1,
  });
  const { nodeId: samplerId } = await callTool(server.client, "add_http_sampler", {
    planId,
    parentId: threadGroupId,
    name: "Get Users",
    method: "GET",
    protocol: "https",
    domain: "example.org",
    path: "/users",
  });
  const { nodeId: timerId } = await callTool(server.client, "add_constant_timer", {
    planId,
    parentId: threadGroupId,
    delayMs: 100,
  });

  await callTool(server.client, "update_element", { planId, nodeId: samplerId, props: { path: "/v2/users" } });
  await callTool(server.client, "move_element", { planId, nodeId: timerId, newParentId: samplerId });
  await callTool(server.client, "set_element_enabled", { planId, nodeId: samplerId, enabled: false });

  const { xml } = await callTool(server.client, "get_test_plan_xml", { planId });
  assert.match(xml, /<HTTPSamplerProxy[^>]*enabled="false"/);
  assert.match(xml, /<stringProp name="HTTPSampler\.path">\/v2\/users<\/stringProp>/);

  const samplerIndex = xml.indexOf("<HTTPSamplerProxy ");
  const timerIndex = xml.indexOf("<ConstantTimer ");
  assert.ok(timerIndex > samplerIndex, "timer must now be nested after the sampler, not before it");
});
