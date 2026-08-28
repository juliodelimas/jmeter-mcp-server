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

/**
 * RFC 4180 CSV tokenizer: row boundaries are only recognized outside quoted
 * fields, so a quoted field spanning multiple physical lines (e.g. a
 * multi-line responseMessage/failureMessage from a stack trace or HTML error
 * body) stays part of the same row instead of corrupting the row count.
 */
function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      endField();
      i++;
      continue;
    }
    if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
      i++;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    endRow();
  }
  return rows;
}

export function parseJtl(filePath: string): SampleResult[] {
  const raw = readFileSync(filePath, "utf-8");
  const rows = parseCsvRows(raw).filter((r) => !(r.length === 1 && r[0] === ""));
  if (rows.length === 0) return [];
  const header = rows[0];
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
  for (let i = 1; i < rows.length; i++) {
    const fields = rows[i];
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
