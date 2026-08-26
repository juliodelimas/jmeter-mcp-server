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
