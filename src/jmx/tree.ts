import { randomUUID } from "node:crypto";
import type { NodeType, TestNode } from "./types.js";

export function genId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

export function createNode(
  type: NodeType,
  name: string,
  props: Record<string, unknown> = {},
): TestNode {
  return {
    id: genId("node"),
    type,
    name,
    props,
    children: [],
  };
}

export function findNode(root: TestNode, id: string): TestNode | undefined {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return undefined;
}

export function addChild(root: TestNode, parentId: string, child: TestNode): boolean {
  const parent = findNode(root, parentId);
  if (!parent) return false;
  parent.children.push(child);
  return true;
}

export function findParent(root: TestNode, childId: string): TestNode | undefined {
  for (const child of root.children) {
    if (child.id === childId) return root;
    const found = findParent(child, childId);
    if (found) return found;
  }
  return undefined;
}

export function removeNode(root: TestNode, id: string): TestNode {
  if (id === root.id) {
    throw new Error("Cannot remove the root TestPlan node.");
  }
  const parent = findParent(root, id);
  if (!parent) {
    throw new Error(`No node with id "${id}" was found in this test plan.`);
  }
  const index = parent.children.findIndex((c) => c.id === id);
  const [removed] = parent.children.splice(index, 1);
  return removed;
}

export function updateNodeProps(
  root: TestNode,
  id: string,
  patch: Record<string, unknown>,
  mode: "merge" | "replace" = "merge",
): TestNode {
  const node = findNode(root, id);
  if (!node) {
    throw new Error(`No node with id "${id}" was found in this test plan.`);
  }
  if (mode === "replace") {
    node.props = {};
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete node.props[key];
    } else {
      node.props[key] = value;
    }
  }
  return node;
}

export function renameNode(root: TestNode, id: string, name: string): TestNode {
  const node = findNode(root, id);
  if (!node) {
    throw new Error(`No node with id "${id}" was found in this test plan.`);
  }
  node.name = name;
  return node;
}

/** True if `descendantId` names `ancestor` itself or any node within its subtree. */
export function isDescendant(ancestor: TestNode, descendantId: string): boolean {
  if (ancestor.id === descendantId) return true;
  return ancestor.children.some((child) => isDescendant(child, descendantId));
}

export function moveNode(root: TestNode, id: string, newParentId: string, index?: number): TestNode {
  if (id === root.id) {
    throw new Error("Cannot move the root TestPlan node.");
  }
  const node = findNode(root, id);
  if (!node) {
    throw new Error(`No node with id "${id}" was found in this test plan.`);
  }
  const newParent = findNode(root, newParentId);
  if (!newParent) {
    throw new Error(`No node with id "${newParentId}" was found in this test plan.`);
  }
  if (isDescendant(node, newParentId)) {
    throw new Error(`Cannot move node "${id}" into its own subtree (would create a cycle).`);
  }
  const oldParent = findParent(root, id);
  if (!oldParent) {
    throw new Error(`No node with id "${id}" was found in this test plan.`);
  }
  const oldIndex = oldParent.children.findIndex((c) => c.id === id);
  oldParent.children.splice(oldIndex, 1);
  const insertAt = index === undefined ? newParent.children.length : index;
  if (insertAt < 0 || insertAt > newParent.children.length) {
    throw new Error(`index ${insertAt} is out of range for the new parent's ${newParent.children.length} children.`);
  }
  newParent.children.splice(insertAt, 0, node);
  return node;
}

export function reorderChildren(root: TestNode, parentId: string, orderedChildIds: string[]): TestNode {
  const parent = findNode(root, parentId);
  if (!parent) {
    throw new Error(`No node with id "${parentId}" was found in this test plan.`);
  }
  const currentIds = parent.children.map((c) => c.id);
  const sameSet =
    currentIds.length === orderedChildIds.length &&
    currentIds.every((id) => orderedChildIds.includes(id)) &&
    new Set(orderedChildIds).size === orderedChildIds.length;
  if (!sameSet) {
    throw new Error(
      `orderedChildIds must be an exact permutation of the current children [${currentIds.join(", ")}], got [${orderedChildIds.join(", ")}].`,
    );
  }
  const byId = new Map(parent.children.map((c) => [c.id, c]));
  parent.children = orderedChildIds.map((id) => byId.get(id)!);
  return parent;
}
