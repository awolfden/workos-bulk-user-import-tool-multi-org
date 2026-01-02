/**
 * Rich CLI progress UI with colors and progress bars
 * Gracefully degrades to plain text in non-interactive environments
 */

import cliProgress from 'cli-progress';
import chalk from 'chalk';

export interface ProgressStats {
  totalUsers: number;
  imported: number;
  failed: number;
  cacheHits: number;
  cacheMisses: number;
  duration: number;
  throughput: number;
  membershipsCreated?: number;
}

export interface WorkerProgress {
  workerId: number;
  currentChunk: number;
  totalChunks: number;
  status: 'processing' | 'idle' | 'completed';
}

export class ProgressUI {
  private multibar: cliProgress.MultiBar | null = null;
  private mainProgress: cliProgress.SingleBar | null = null;
  private workerBars: Map<number, cliProgress.SingleBar> = new Map();
  private isInteractive: boolean;
  private startTime: number = Date.now();
  private totalChunks: number = 0;

  constructor(private quiet: boolean = false) {
    // Only create progress bars if in TTY (interactive terminal) and colors are supported
    this.isInteractive = process.stdout.isTTY && !quiet && !process.env.NO_COLOR && !process.env.CI;

    if (this.isInteractive) {
      this.multibar = new cliProgress.MultiBar({
        format: '{label} |{bar}| {percentage}% | {value}/{total} {unit}',
        barCompleteChar: '█',
        barIncompleteChar: '░',
        hideCursor: true,
        clearOnComplete: false,
        stopOnComplete: true
      }, cliProgress.Presets.shades_classic);
    }
  }

  /**
   * Initialize main progress bar
   */
  startImport(totalChunks: number): void {
    this.totalChunks = totalChunks;
    this.startTime = Date.now();

    if (!this.isInteractive || !this.multibar) {
      // Fallback to simple text output
      if (!this.quiet) {
        console.log(`Starting import: ${totalChunks} chunks to process\n`);
      }
      return;
    }

    this.mainProgress = this.multibar.create(totalChunks, 0, {
      label: chalk.bold.cyan('Overall'),
      unit: 'chunks'
    });
  }

  /**
   * Initialize worker progress bars
   */
  initializeWorkers(workerCount: number): void {
    if (!this.isInteractive || !this.multibar) return;

    for (let i = 0; i < workerCount; i++) {
      const bar = this.multibar.create(100, 0, {
        label: chalk.cyan(`Worker ${i + 1}`),
        unit: '%'
      });
      this.workerBars.set(i, bar);
    }
  }

  /**
   * Update overall progress
   */
  updateProgress(completedChunks: number, totalChunks?: number): void {
    if (this.isInteractive && this.mainProgress) {
      this.mainProgress.update(completedChunks);
    } else if (!this.quiet) {
      // Fallback to text (current behavior)
      const total = totalChunks || this.totalChunks;
      const percentage = total > 0 ? Math.round((completedChunks / total) * 100) : 0;
      const elapsed = Date.now() - this.startTime;
      const eta = completedChunks > 0
        ? Math.round((elapsed / completedChunks) * (total - completedChunks))
        : 0;

      console.log(`Progress: ${completedChunks}/${total} chunks (${percentage}%) - ETA: ${this.formatDuration(eta)}`);
    }
  }

  /**
   * Update worker progress
   */
  updateWorker(workerId: number, chunkId: number, totalChunks: number): void {
    const bar = this.workerBars.get(workerId);
    if (bar && totalChunks > 0) {
      const percentage = Math.round((chunkId / totalChunks) * 100);
      bar.update(percentage);
    }
  }

  /**
   * Display final summary with colors and formatting
   */
  displaySummary(stats: ProgressStats, mode: string): void {
    if (this.multibar) {
      this.multibar.stop();
    }

    // Reset colors to prevent bleeding from previous output
    if (this.isInteractive) {
      process.stdout.write('\x1b[0m');
    }

    // Use colors if interactive, otherwise plain text
    const useColors = this.isInteractive;

    console.log('\n' + '═'.repeat(60));
    console.log(useColors ? chalk.bold('  SUMMARY') : '  SUMMARY');
    console.log('═'.repeat(60) + '\n');

    // Status indicator
    const statusText = stats.failed === 0 && stats.imported > 0
      ? 'Success'
      : stats.failed > 0 && stats.imported > 0
      ? 'Completed with errors'
      : 'Failed';

    const statusColored = useColors
      ? (stats.failed === 0 && stats.imported > 0
          ? chalk.green('✓ ' + statusText)
          : stats.failed > 0 && stats.imported > 0
          ? chalk.yellow('⚠ ' + statusText)
          : chalk.red('✗ ' + statusText))
      : statusText;

    console.log(`Status:              ${statusColored}`);

    // Import stats
    const importedStr = `${stats.imported.toLocaleString()}/${stats.totalUsers.toLocaleString()}`;
    console.log(`Users imported:      ${useColors ? chalk.cyan(importedStr) : importedStr}`);

    if (stats.failed > 0) {
      const failedStr = stats.failed.toLocaleString();
      console.log(`Failed:              ${useColors ? chalk.red(failedStr) : failedStr}`);
    }

    // Memberships (if applicable)
    if (stats.membershipsCreated !== undefined && stats.membershipsCreated > 0) {
      const membershipStr = stats.membershipsCreated.toLocaleString();
      console.log(`Memberships created: ${useColors ? chalk.blue(membershipStr) : membershipStr}`);
    }

    // Cache stats (if multi-org mode)
    if (stats.cacheHits + stats.cacheMisses > 0) {
      const hitRate = ((stats.cacheHits / (stats.cacheHits + stats.cacheMisses)) * 100).toFixed(1);
      const cacheStr = `${stats.cacheHits.toLocaleString()} (${hitRate}%)`;
      console.log(`Cache hits:          ${useColors ? chalk.blue(cacheStr) : cacheStr}`);
      console.log(`Cache misses:        ${stats.cacheMisses.toLocaleString()}`);
    }

    // Performance stats
    const durationStr = this.formatDuration(stats.duration);
    console.log(`Duration:            ${useColors ? chalk.magenta(durationStr) : durationStr}`);

    if (stats.throughput > 0) {
      const throughputStr = `${stats.throughput.toFixed(1)} users/sec`;
      console.log(`Throughput:          ${useColors ? chalk.cyan(throughputStr) : throughputStr}`);
    }

    console.log('\n' + '═'.repeat(60) + '\n');
  }

  /**
   * Log error (color-coded)
   */
  logError(message: string): void {
    if (!this.quiet) {
      const formatted = this.isInteractive
        ? chalk.red('✗ Error: ') + message
        : `Error: ${message}`;
      console.error(formatted);
    }
  }

  /**
   * Log warning (color-coded)
   */
  logWarning(message: string): void {
    if (!this.quiet) {
      const formatted = this.isInteractive
        ? chalk.yellow('⚠ Warning: ') + message
        : `Warning: ${message}`;
      console.warn(formatted);
    }
  }

  /**
   * Log info (subtle)
   */
  logInfo(message: string): void {
    if (!this.quiet) {
      const formatted = this.isInteractive
        ? chalk.gray('ℹ ') + message
        : message;
      console.log(formatted);
    }
  }

  /**
   * Log success (color-coded)
   */
  logSuccess(message: string): void {
    if (!this.quiet) {
      const formatted = this.isInteractive
        ? chalk.green('✓ ') + message
        : message;
      console.log(formatted);
    }
  }

  /**
   * Format duration in human-readable format
   */
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }

  /**
   * Cleanup (call at end)
   */
  stop(): void {
    if (this.multibar) {
      this.multibar.stop();
    }
  }
}
