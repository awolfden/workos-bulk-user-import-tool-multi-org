import chalk from 'chalk';
import { ImportSummary } from "./types.js";

function supportsColor(): boolean {
  if (process.env.NO_COLOR || process.env.CI) return false;
  return Boolean(process.stderr && process.stderr.isTTY);
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
  const useColors = supportsColor();

  // Status with icon
  let statusLine = `Status: ${status}`;
  if (useColors) {
    if (status === 'Success') {
      statusLine = `Status: ${chalk.green('✓ ' + status)}`;
    } else if (status === 'Completed with errors') {
      statusLine = `Status: ${chalk.yellow('⚠ ' + status)}`;
    } else {
      statusLine = `Status: ${chalk.red('✗ ' + status)}`;
    }
  }

  // Build content array
  const content = [
    useColors ? chalk.bold('SUMMARY') : 'SUMMARY',
    statusLine,
    `Users imported: ${useColors ? chalk.cyan(imported) : imported}`,
    `Memberships created: ${useColors ? chalk.blue(memberships.toString()) : memberships}`,
    `Duration: ${useColors ? chalk.magenta(duration) : duration}`,
    `Warnings: ${warningsCount}`,
    `Errors: ${useColors && errorsCount > 0 ? chalk.red(errorsCount.toString()) : errorsCount}`
  ];

  // Add role assignment stats if any roles were assigned
  if (summary.rolesAssigned > 0 || summary.roleAssignmentFailures > 0) {
    content.push(
      `Roles assigned: ${useColors ? chalk.blue(summary.rolesAssigned.toString()) : summary.rolesAssigned}`
    );
    if (summary.roleAssignmentFailures > 0) {
      content.push(
        `Role failures: ${useColors ? chalk.red(summary.roleAssignmentFailures.toString()) : summary.roleAssignmentFailures}`
      );
    }
  }

  // Add cache statistics if available (multi-org mode)
  if (summary.cacheStats) {
    const hitRate = summary.cacheStats.hitRate;
    content.push(
      `Cache hits: ${useColors ? chalk.blue(summary.cacheStats.hits.toString()) : summary.cacheStats.hits} (${hitRate})`,
      `Cache misses: ${summary.cacheStats.misses}`
    );
  }

  // Add chunk progress if available (chunked mode)
  if (summary.chunkProgress) {
    const progress = `${summary.chunkProgress.completedChunks}/${summary.chunkProgress.totalChunks} chunks (${summary.chunkProgress.percentComplete}%)`;
    content.push(
      `Chunk progress: ${useColors ? chalk.cyan(progress) : progress}`
    );
  }

  // Compute max content width (strip ANSI codes for accurate length)
  const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*m/g, '');
  const maxLen = content.reduce((m, s) => Math.max(m, stripAnsi(s).length), 0);
  const horizontal = "═".repeat(maxLen + 2);
  const top = `┌${horizontal}┐`;
  const bottom = `└${horizontal}┘`;
  const body = content.map((line) => {
    const stripped = stripAnsi(line);
    const padding = " ".repeat(maxLen - stripped.length);
    return `│ ${line}${padding} │`;
  });
  const box = [top, ...body, bottom].join("\n");

  return box;
}

