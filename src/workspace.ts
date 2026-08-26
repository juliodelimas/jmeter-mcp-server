import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { genId } from "./jmx/tree.js";
import type { PlanFile } from "./jmx/types.js";

const WORKSPACE_DIR =
  process.env.JMETER_MCP_WORKSPACE ?? path.join(process.cwd(), "jmeter-workspace");

function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function plansDir(): string {
  return ensureDir(path.join(WORKSPACE_DIR, "plans"));
}

export function planDir(planId: string): string {
  return ensureDir(path.join(plansDir(), planId));
}

export function planJsonPath(planId: string): string {
  return path.join(planDir(planId), "plan.json");
}

export function executionsDir(): string {
  return ensureDir(path.join(WORKSPACE_DIR, "executions"));
}

export function executionDir(executionId: string): string {
  return ensureDir(path.join(executionsDir(), executionId));
}

export function newPlanId(): string {
  return genId("plan");
}

export function newExecutionId(): string {
  return genId("exec");
}

export function planExists(planId: string): boolean {
  return existsSync(planJsonPath(planId));
}

export function readPlan(planId: string): PlanFile {
  if (!planExists(planId)) {
    throw new Error(`Test plan not found: ${planId}`);
  }
  return JSON.parse(readFileSync(planJsonPath(planId), "utf-8")) as PlanFile;
}

export function writePlan(plan: PlanFile): void {
  writeFileSync(planJsonPath(plan.planId), JSON.stringify(plan, null, 2), "utf-8");
}

export function listPlans(): Array<{ planId: string; name: string; createdAt: string }> {
  const dir = plansDir();
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((planId) => planExists(planId))
    .map((planId) => {
      const plan = readPlan(planId);
      return { planId: plan.planId, name: plan.name, createdAt: plan.createdAt };
    });
}
