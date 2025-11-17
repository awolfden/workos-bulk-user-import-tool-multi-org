import fs from "node:fs";
import path from "node:path";
import { ErrorRecord } from "./types.js";

function escapeCsvValue(value: string): string {
  const needsQuotes = /[,"\n]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

export async function writeErrorsOut(outPath: string, errors: ErrorRecord[]): Promise<void> {
  if (errors.length === 0) return;
  const ext = path.extname(outPath).toLowerCase();
  if (ext === ".csv") {
    const header = ["recordNumber", "email", "userId", "errorMessage", "httpStatus", "workosCode", "workosRequestId", "timestamp", "rawRow"];
    const lines: string[] = [];
    lines.push(header.join(","));
    for (const err of errors) {
      const rawRowStr = err.rawRow ? JSON.stringify(err.rawRow) : "";
      const row = [
        String(err.recordNumber),
        err.email ?? "",
        err.userId ?? "",
        err.errorMessage,
        err.httpStatus != null ? String(err.httpStatus) : "",
        err.workosCode ?? "",
        err.workosRequestId ?? "",
        err.timestamp,
        rawRowStr
      ].map(v => escapeCsvValue(v));
      lines.push(row.join(","));
    }
    await fs.promises.writeFile(outPath, lines.join("\n"), "utf8");
  } else {
    await fs.promises.writeFile(outPath, JSON.stringify(errors, null, 2), "utf8");
  }
}

