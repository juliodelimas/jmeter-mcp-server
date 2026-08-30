import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addChild,
  createNode,
  findParent,
  isDescendant,
  moveNode,
  removeNode,
  renameNode,
  reorderChildren,
  updateNodeProps,
} from "../src/jmx/tree.js";

function buildTree() {
  const root = createNode("TestPlan", "Root");
  const tg = createNode("ThreadGroup", "Users", { numThreads: 1, rampTimeSeconds: 1, loops: 1 });
  addChild(root, root.id, tg);
  const sampler1 = createNode("HTTPSamplerProxy", "Sampler 1", { method: "GET", path: "/a" });
  const sampler2 = createNode("HTTPSamplerProxy", "Sampler 2", { method: "GET", path: "/b" });
  addChild(root, tg.id, sampler1);
  addChild(root, tg.id, sampler2);
  return { root, tg, sampler1, sampler2 };
}

test("findParent finds the direct parent, and undefined for the root", () => {
  const { root, tg, sampler1 } = buildTree();
  assert.equal(findParent(root, sampler1.id), tg);
  assert.equal(findParent(root, tg.id), root);
  assert.equal(findParent(root, root.id), undefined);
});

test("removeNode rejects removing the root TestPlan node", () => {
  const { root } = buildTree();
  assert.throws(() => removeNode(root, root.id), /Cannot remove the root/);
});

test("removeNode removes a node and returns it", () => {
  const { root, tg, sampler1 } = buildTree();
  const removed = removeNode(root, sampler1.id);
  assert.equal(removed.id, sampler1.id);
  assert.ok(!tg.children.some((c) => c.id === sampler1.id));
});

test("removeNode throws a clear error for an unknown id", () => {
  const { root } = buildTree();
  assert.throws(() => removeNode(root, "node_nope"), /No node with id/);
});

test("updateNodeProps merges by default", () => {
  const { root, sampler1 } = buildTree();
  updateNodeProps(root, sampler1.id, { path: "/updated" });
  assert.equal(sampler1.props.path, "/updated");
  assert.equal(sampler1.props.method, "GET");
});

test("updateNodeProps with a null value deletes that key", () => {
  const { root, sampler1 } = buildTree();
  updateNodeProps(root, sampler1.id, { method: null });
  assert.ok(!("method" in sampler1.props));
  assert.equal(sampler1.props.path, "/a");
});

test("updateNodeProps replace mode discards existing props", () => {
  const { root, sampler1 } = buildTree();
  updateNodeProps(root, sampler1.id, { path: "/only" }, "replace");
  assert.deepEqual(sampler1.props, { path: "/only" });
});

test("renameNode updates the node's name", () => {
  const { root, sampler1 } = buildTree();
  renameNode(root, sampler1.id, "Renamed");
  assert.equal(sampler1.name, "Renamed");
});

test("isDescendant is true for the node itself and any node in its subtree", () => {
  const { root, tg, sampler1 } = buildTree();
  assert.ok(isDescendant(tg, tg.id));
  assert.ok(isDescendant(tg, sampler1.id));
  assert.ok(!isDescendant(sampler1, tg.id));
});

test("moveNode rejects moving a node into its own subtree", () => {
  const { root, tg } = buildTree();
  assert.throws(() => moveNode(root, tg.id, tg.id), /own subtree/);
  const inner = createNode("LoopController", "Loop", { loops: 1 });
  addChild(root, tg.id, inner);
  assert.throws(() => moveNode(root, tg.id, inner.id), /own subtree/);
});

test("moveNode relocates a node under a new parent, appended by default", () => {
  const { root, tg, sampler1 } = buildTree();
  moveNode(root, sampler1.id, root.id);
  assert.ok(!tg.children.some((c) => c.id === sampler1.id));
  assert.ok(root.children.some((c) => c.id === sampler1.id));
});

test("moveNode honors an explicit index", () => {
  const { root, tg, sampler1, sampler2 } = buildTree();
  const sampler3 = createNode("HTTPSamplerProxy", "Sampler 3", { method: "GET", path: "/c" });
  addChild(root, tg.id, sampler3);
  moveNode(root, sampler3.id, tg.id, 0);
  assert.deepEqual(
    tg.children.map((c) => c.id),
    [sampler3.id, sampler1.id, sampler2.id],
  );
});

test("reorderChildren requires an exact permutation of current children", () => {
  const { root, tg, sampler1, sampler2 } = buildTree();
  assert.throws(() => reorderChildren(root, tg.id, [sampler1.id]), /exact permutation/);
  assert.throws(() => reorderChildren(root, tg.id, [sampler1.id, sampler2.id, "node_extra"]), /exact permutation/);
  assert.throws(() => reorderChildren(root, tg.id, [sampler1.id, sampler1.id]), /exact permutation/);
});

test("reorderChildren applies a valid permutation", () => {
  const { root, tg, sampler1, sampler2 } = buildTree();
  reorderChildren(root, tg.id, [sampler2.id, sampler1.id]);
  assert.deepEqual(
    tg.children.map((c) => c.id),
    [sampler2.id, sampler1.id],
  );
});
