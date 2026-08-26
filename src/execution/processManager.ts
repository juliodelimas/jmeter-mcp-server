import { type ChildProcess, spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveJmeterBin } from "../jmeter.js";
import { findNode } from "../jmx/tree.js";
import { serializePlan } from "../jmx/serializer.js";
import type { TestNode } from "../jmx/types.js";
import { executionDir, newExecutionId, readPlan } from "../workspace.js";

export type ExecutionStatus = "running" | "completed" | "failed";

export interface ExecutionMeta {
  executionId: string;
  planId: string;
  pid: number;
  status: ExecutionStatus;
  startTime: string;
  endTime?: string;
  exitCode?: number | null;
  jmxPath: string;
  stdoutLogPath: string;
  aggregateFilename?: string;
  summaryFilename?: string;
}

const registry = new Map<string, ChildProcess>();

function metaPath(executionId: string): string {
  return path.join(executionDir(executionId), "meta.json");
}

function writeMeta(meta: ExecutionMeta): void {
  writeFileSync(metaPath(meta.executionId), JSON.stringify(meta, null, 2), "utf-8");
}

export function readMeta(executionId: string): ExecutionMeta {
  const file = metaPath(executionId);
  if (!existsSync(file)) {
    throw new Error(`Execution not found: ${executionId}`);
  }
  return JSON.parse(readFileSync(file, "utf-8")) as ExecutionMeta;
}

function hasNodeOfType(root: TestNode, type: TestNode["type"]): boolean {
  if (root.type === type) return true;
  return root.children.some((child) => hasNodeOfType(child, type));
}

export function startExecution(planId: string): { executionId: string; status: ExecutionStatus } {
  const jmeterBin = resolveJmeterBin();
  const plan = readPlan(planId);
  const executionId = newExecutionId();
  const execDir = executionDir(executionId);

  const jmxPath = path.join(execDir, "generated.jmx");
  const stdoutLogPath = path.join(execDir, "stdout.log");
  const jmeterLogPath = path.join(execDir, "jmeter.log");

  const aggregateFilename = hasNodeOfType(plan.root, "ResultCollectorAggregate")
    ? path.join(execDir, "aggregate-report.jtl")
    : undefined;
  const summaryFilename = hasNodeOfType(plan.root, "ResultCollectorSummary")
    ? path.join(execDir, "summary-report.jtl")
    : undefined;

  const jmx = serializePlan(plan.root, { aggregateFilename, summaryFilename });
  writeFileSync(jmxPath, jmx, "utf-8");

  const stdoutFd = openSync(stdoutLogPath, "a");
  const child = spawn(
    jmeterBin,
    ["-n", "-t", jmxPath, "-j", jmeterLogPath, "-Jjmeter.save.saveservice.output_format=csv"],
    { cwd: execDir, stdio: ["ignore", stdoutFd, stdoutFd] },
  );
  closeSync(stdoutFd);

  const meta: ExecutionMeta = {
    executionId,
    planId,
    pid: child.pid ?? -1,
    status: "running",
    startTime: new Date().toISOString(),
    jmxPath,
    stdoutLogPath,
    aggregateFilename,
    summaryFilename,
  };
  writeMeta(meta);
  registry.set(executionId, child);

  child.on("exit", (code) => {
    const current = readMeta(executionId);
    current.status = code === 0 ? "completed" : "failed";
    current.exitCode = code;
    current.endTime = new Date().toISOString();
    writeMeta(current);
    registry.delete(executionId);
  });

  return { executionId, status: "running" };
}

export function tailLog(executionId: string, maxLines = 40): string {
  const meta = readMeta(executionId);
  if (!existsSync(meta.stdoutLogPath)) return "";
  const content = readFileSync(meta.stdoutLogPath, "utf-8").trim();
  if (!content) return "";
  return content.split(/\r?\n/).slice(-maxLines).join("\n");
}

export function stopExecution(executionId: string): { stopped: boolean; message: string } {
  const meta = readMeta(executionId);
  if (meta.status !== "running") {
    return { stopped: false, message: `Execution is already ${meta.status}.` };
  }
  const child = registry.get(executionId);
  try {
    if (child) {
      child.kill("SIGTERM");
    } else {
      process.kill(meta.pid, "SIGTERM");
    }
    return { stopped: true, message: "Sent SIGTERM to the JMeter process." };
  } catch (err) {
    return { stopped: false, message: `Could not stop process: ${(err as Error).message}` };
  }
}
