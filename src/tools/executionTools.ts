import { existsSync } from "node:fs";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readMeta, startExecution, stopExecution, tailLog } from "../execution/processManager.js";
import { computeAggregate } from "../report/aggregate.js";
import { parseJtl } from "../report/jtlParser.js";
import { jsonResult } from "./shared.js";

export function registerExecutionTools(server: McpServer): void {
  server.registerTool(
    "execute_test_plan",
    {
      description:
        "Start running a test plan with JMeter in non-GUI mode. Returns immediately with an executionId; " +
        "the run continues in the background. Poll get_execution_status to know when it's done, then call " +
        "get_execution_report to read the results.",
      inputSchema: {
        planId: z.string(),
      },
    },
    ({ planId }) => jsonResult(startExecution(planId)),
  );

  server.registerTool(
    "get_execution_status",
    {
      description: "Check the status of a test run started with execute_test_plan (running/completed/failed), plus the tail of its log.",
      inputSchema: {
        executionId: z.string(),
      },
    },
    ({ executionId }) => {
      const meta = readMeta(executionId);
      return jsonResult({ ...meta, logTail: tailLog(executionId) });
    },
  );

  server.registerTool(
    "stop_execution",
    {
      description: "Stop a running test execution (sends SIGTERM to the JMeter process).",
      inputSchema: {
        executionId: z.string(),
      },
    },
    ({ executionId }) => jsonResult(stopExecution(executionId)),
  );

  server.registerTool(
    "get_execution_report",
    {
      description:
        "Read and aggregate the results of a finished (or still-running) execution, computed from its " +
        "Aggregate Report / Summary Report listener output: per-label and overall count, error rate, " +
        "avg/min/max/median/p90/p95/p99 latency, throughput and KB/sec.",
      inputSchema: {
        executionId: z.string(),
      },
    },
    ({ executionId }) => {
      const meta = readMeta(executionId);
      const sourceFile = meta.aggregateFilename ?? meta.summaryFilename ?? meta.viewResultsTreeFilename;
      if (!sourceFile) {
        throw new Error(
          "This test plan has no Aggregate Report, Summary Report, or View Results Tree listener, so there's " +
            "nothing to read. Add one with add_aggregate_report_listener, add_summary_report_listener, or " +
            "add_view_results_tree_listener before running.",
        );
      }
      if (!existsSync(sourceFile)) {
        throw new Error(
          `Results file not found yet (${sourceFile}). Status is "${meta.status}" - if it's still running, wait and retry.`,
        );
      }
      const samples = parseJtl(sourceFile);
      return jsonResult({ executionId, status: meta.status, source: sourceFile, ...computeAggregate(samples) });
    },
  );
}
