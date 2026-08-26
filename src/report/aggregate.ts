import type { SampleResult } from "./jtlParser.js";

export interface LabelStats {
  label: string;
  count: number;
  errors: number;
  errorPct: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  medianMs: number;
  p90Ms: number;
  p95Ms: number;
  p99Ms: number;
  throughputPerSec: number;
  kbPerSec: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function statsFor(label: string, samples: SampleResult[]): LabelStats {
  const elapsed = samples.map((s) => s.elapsed).sort((a, b) => a - b);
  const errors = samples.filter((s) => !s.success).length;
  const timestamps = samples.map((s) => s.timestamp);
  const endTimes = samples.map((s) => s.timestamp + s.elapsed);
  const spanMs = Math.max(1, Math.max(...endTimes) - Math.min(...timestamps));
  const spanSec = spanMs / 1000;
  const totalBytes = samples.reduce((sum, s) => sum + s.bytes, 0);

  return {
    label,
    count: samples.length,
    errors,
    errorPct: samples.length ? (errors / samples.length) * 100 : 0,
    avgMs: elapsed.reduce((a, b) => a + b, 0) / (elapsed.length || 1),
    minMs: elapsed[0] ?? 0,
    maxMs: elapsed[elapsed.length - 1] ?? 0,
    medianMs: percentile(elapsed, 50),
    p90Ms: percentile(elapsed, 90),
    p95Ms: percentile(elapsed, 95),
    p99Ms: percentile(elapsed, 99),
    throughputPerSec: samples.length / spanSec,
    kbPerSec: totalBytes / 1024 / spanSec,
  };
}

export interface AggregateReport {
  byLabel: LabelStats[];
  overall: LabelStats;
}

export function computeAggregate(samples: SampleResult[]): AggregateReport {
  const byLabelMap = new Map<string, SampleResult[]>();
  for (const s of samples) {
    const list = byLabelMap.get(s.label) ?? [];
    list.push(s);
    byLabelMap.set(s.label, list);
  }
  const byLabel = Array.from(byLabelMap.entries()).map(([label, list]) => statsFor(label, list));
  const overall = statsFor("TOTAL", samples);
  return { byLabel, overall };
}
