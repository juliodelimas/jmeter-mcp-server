import { type ChildProcess, execFileSync, spawn } from "node:child_process";
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
  viewResultsTreeFilename?: string;
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

/**
 * Node refuses to spawn .bat/.cmd files directly on Windows (throws EINVAL) unless
 * `shell: true` is set - see https://nodejs.org/en/blog/vulnerability/february-2024-security-releases
 * (CVE-2024-27980). With `shell: true` on Windows, Node joins command+args with plain
 * spaces before handing the line to cmd.exe, so we must quote any piece containing
 * whitespace ourselves (JMETER_HOME and JMX paths routinely contain spaces).
 */
export function buildSpawnInvocation(
  bin: string,
  args: string[],
  platform: NodeJS.Platform,
): { command: string; args: string[]; shell: boolean } {
  const isWindowsBatch = platform === "win32" && /\.(bat|cmd)$/i.test(bin);
  if (!isWindowsBatch) {
    return { command: bin, args, shell: false };
  }
  const quote = (value: string): string => (/[\s"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value);
  return { command: quote(bin), args: args.map(quote), shell: true };
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
  const viewResultsTreeFilename = hasNodeOfType(plan.root, "ResultCollectorViewResultsTree")
    ? path.join(execDir, "view-results-tree.jtl")
    : undefined;

  const jmx = serializePlan(plan.root, { aggregateFilename, summaryFilename, viewResultsTreeFilename });
  writeFileSync(jmxPath, jmx, "utf-8");

  const stdoutFd = openSync(stdoutLogPath, "a");
  const invocation = buildSpawnInvocation(
    jmeterBin,
    ["-n", "-t", jmxPath, "-j", jmeterLogPath, "-Jjmeter.save.saveservice.output_format=csv"],
    process.platform,
  );
  const child = spawn(invocation.command, invocation.args, {
    cwd: execDir,
    stdio: ["ignore", stdoutFd, stdoutFd],
    shell: invocation.shell,
  });
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
    viewResultsTreeFilename,
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
  try {
    if (process.platform === "win32") {
      // JMeter runs under cmd.exe (see buildSpawnInvocation), so killing just the
      // registered pid would leave the actual java.exe orphaned; /t kills the tree.
      execFileSync("taskkill", ["/pid", String(meta.pid), "/t", "/f"]);
      return { stopped: true, message: "Terminated the JMeter process tree." };
    }
    const child = registry.get(executionId);
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
