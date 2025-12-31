import { ImportSummary } from "./types.js";

function supportsColor(): boolean {
  if (process.env.NO_COLOR) return false;
  return Boolean(process.stderr && process.stderr.isTTY);
}

function colorize(text: string, color: "red" | "green"): string {
  if (!supportsColor()) return text;
  const RED = "\x1b[31m";
  const GREEN = "\x1b[32m";
  const RESET = "\x1b[0m";
  const code = color === "red" ? RED : GREEN;
  return `${code}${text}${RESET}`;
}

function formatDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 1) return `${ms.toFixed(0)} ms`;
  return `${seconds.toFixed(1)} s`;
}

export function computeStatus(summary: ImportSummary): "Success" | "Completed with errors" | "Failed" {
  if (summary.failures === 0 && summary.successes > 0) return "Success";
  if (summary.failures > 0 && summary.successes > 0) return "Completed with errors";
  return "Failed";
}

export function renderSummaryBox(summary: ImportSummary): string {
  const status = computeStatus(summary);
  const duration = formatDuration(summary.endedAt - summary.startedAt);
  const imported = `${summary.successes}/${summary.total}`;
  const warningsCount = summary.warnings.length;
  const errorsCount = summary.failures;
  const memberships = summary.membershipsCreated;

  const content = [
    "SUMMARY",
    `Status: ${status}`,
    `Users imported: ${imported}`,
    `Memberships created: ${memberships}`,
    `Duration: ${duration}`,
    `Warnings: ${warningsCount}`,
    `Errors: ${errorsCount}`
  ];

  // Add cache statistics if available (multi-org mode)
  if (summary.cacheStats) {
    content.push(
      `Cache hits: ${summary.cacheStats.hits}`,
      `Cache misses: ${summary.cacheStats.misses}`,
      `Cache hit rate: ${summary.cacheStats.hitRate}`
    );
  }

  // Compute max content width and render a neatly padded box
  const maxLen = content.reduce((m, s) => Math.max(m, s.length), 0);
  const horizontal = "─".repeat(maxLen + 2);
  const top = `┌${horizontal}┐`;
  const bottom = `└${horizontal}┘`;
  const body = content.map((line) => `│ ${line.padEnd(maxLen, " ")} │`);
  const box = [top, ...body, bottom].join("\n");

  // Apply color based on status (entire box) for TTYs; honor NO_COLOR
  if (status === "Success") {
    return colorize(box, "green");
  }
  // "Completed with errors" or "Failed"
  return colorize(box, "red");
}

