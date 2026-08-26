import { readFileSync } from "node:fs";

export interface SampleResult {
  timestamp: number;
  elapsed: number;
  label: string;
  responseCode: string;
  success: boolean;
  bytes: number;
  latency: number;
}

function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

export function parseJtl(filePath: string): SampleResult[] {
  const raw = readFileSync(filePath, "utf-8").trim();
  if (!raw) return [];
  const lines = raw.split(/\r?\n/);
  const header = splitCsvLine(lines[0]);
  const col = (name: string) => header.indexOf(name);

  const idx = {
    timeStamp: col("timeStamp"),
    elapsed: col("elapsed"),
    label: col("label"),
    responseCode: col("responseCode"),
    success: col("success"),
    bytes: col("bytes"),
    latency: col("Latency"),
  };

  const results: SampleResult[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const fields = splitCsvLine(lines[i]);
    results.push({
      timestamp: Number(fields[idx.timeStamp] ?? 0),
      elapsed: Number(fields[idx.elapsed] ?? 0),
      label: fields[idx.label] ?? "",
      responseCode: fields[idx.responseCode] ?? "",
      success: fields[idx.success] === "true",
      bytes: Number(fields[idx.bytes] ?? 0),
      latency: Number(fields[idx.latency] ?? 0),
    });
  }
  return results;
}
