/**
 * Export Progress UI with colors and progress bars
 * Tracks organization-level progress and user export throughput
 */

import * as cliProgress from 'cli-progress';
import chalk from 'chalk';

export interface ExportProgressStats {
  totalOrgs: number;
  completedOrgs: number;
  failedOrgs: number;
  totalUsers: number;
  skippedUsers: number;
  duration: number;
  throughput: number;
  warnings: number;
}

export class ExportProgressUI {
  private multibar: cliProgress.MultiBar | null = null;
  private orgProgress: cliProgress.SingleBar | null = null;
  private userProgress: cliProgress.SingleBar | null = null;
  private isInteractive: boolean;
  private startTime: number = Date.now();
  private totalOrgs: number = 0;
  private totalUsersEstimate: number = 0;
  private lastProgressUpdate: number = Date.now();
  private progressUpdateInterval: number = 2000; // Update every 2 seconds
  private lastUsersExported: number = 0;

  constructor(private quiet: boolean = false) {
    // Only create progress bars if in TTY (interactive terminal) and colors are supported
    this.isInteractive = process.stdout.isTTY && !quiet && !process.env.NO_COLOR && !process.env.CI;

    if (this.isInteractive) {
      this.multibar = new cliProgress.MultiBar({
        format: '{label} |{bar}| {percentage}% | {value}/{total} {unit} {eta}',
        barCompleteChar: '█',
        barIncompleteChar: '░',
        hideCursor: true,
        clearOnComplete: false,
        stopOnComplete: true
      }, cliProgress.Presets.shades_classic);
    }
  }

  /**
   * Initialize export progress bars
   */
  startExport(totalOrgs: number, estimatedUsers?: number): void {
    this.totalOrgs = totalOrgs;
    this.totalUsersEstimate = estimatedUsers || 0;
    this.startTime = Date.now();

    if (!this.isInteractive || !this.multibar) {
      // Fallback to simple text output
      if (!this.quiet) {
        console.log(`Starting export: ${totalOrgs} organizations\n`);
      }
      return;
    }

    // Create organization progress bar
    this.orgProgress = this.multibar.create(totalOrgs, 0, {
      label: chalk.bold.cyan('Organizations'),
      unit: 'orgs'
    });

    // Create user progress bar (if estimate provided)
    if (estimatedUsers && estimatedUsers > 0) {
      this.userProgress = this.multibar.create(estimatedUsers, 0, {
        label: chalk.bold.green('Users        '),
        unit: 'users'
      });
    }
  }

  /**
   * Update organization progress
   */
  updateOrgProgress(completedOrgs: number): void {
    if (this.isInteractive && this.orgProgress) {
      this.orgProgress.update(completedOrgs);
    }
  }

  /**
   * Update user progress
   */
  updateUserProgress(exportedUsers: number, totalUsers?: number): void {
    // Update total if provided (we learn this as we process organizations)
    if (totalUsers && totalUsers > this.totalUsersEstimate) {
      this.totalUsersEstimate = totalUsers;

      // Recreate user progress bar with actual total if in interactive mode
      if (this.isInteractive && this.multibar && !this.userProgress) {
        this.userProgress = this.multibar.create(totalUsers, exportedUsers, {
          label: chalk.bold.green('Users        '),
          unit: 'users',
          eta: ''
        });
      }
    }

    if (this.isInteractive && this.userProgress) {
      // Calculate ETA
      const eta = this.calculateETA(exportedUsers, this.totalUsersEstimate);
      this.userProgress.update(exportedUsers, { eta });
    } else if (!this.quiet && !this.isInteractive) {
      // Throttle text updates to avoid spam
      const now = Date.now();
      if (now - this.lastProgressUpdate >= this.progressUpdateInterval) {
        const elapsed = Date.now() - this.startTime;
        const throughput = exportedUsers / (elapsed / 1000);
        const eta = this.calculateETA(exportedUsers, this.totalUsersEstimate);
        const etaStr = eta ? ` - ETA: ${eta}` : '';
        console.log(`Progress: ${exportedUsers.toLocaleString()} users exported (${throughput.toFixed(1)} users/sec)${etaStr}`);
        this.lastProgressUpdate = now;
      }
    }

    this.lastUsersExported = exportedUsers;
  }

  /**
   * Update both organization and user progress
   */
  updateProgress(completedOrgs: number, exportedUsers: number, totalUsers?: number): void {
    this.updateOrgProgress(completedOrgs);
    this.updateUserProgress(exportedUsers, totalUsers);
  }

  /**
   * Calculate ETA based on current progress and throughput
   */
  private calculateETA(exportedUsers: number, totalUsers: number): string {
    if (!totalUsers || totalUsers <= exportedUsers) {
      return '';
    }

    const elapsed = Date.now() - this.startTime;
    const elapsedSeconds = elapsed / 1000;

    // Need at least 5 seconds of data for accurate ETA
    if (elapsedSeconds < 5) {
      return 'calculating...';
    }

    const throughput = exportedUsers / elapsedSeconds;

    // Avoid division by zero or very slow throughput
    if (throughput < 0.1) {
      return 'calculating...';
    }

    const remainingUsers = totalUsers - exportedUsers;
    const remainingSeconds = Math.ceil(remainingUsers / throughput);

    return this.formatETA(remainingSeconds);
  }

  /**
   * Format ETA in human-readable format
   */
  private formatETA(seconds: number): string {
    if (seconds < 60) {
      return `${seconds}s`;
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const remainingMinutes = Math.floor((seconds % 3600) / 60);
      return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
    }
  }

  /**
   * Log organization completion
   */
  logOrgComplete(orgName: string, usersExported: number, usersSkipped: number): void {
    if (!this.quiet && !this.isInteractive) {
      const total = usersExported + usersSkipped;
      const skippedStr = usersSkipped > 0 ? ` (${usersSkipped} skipped)` : '';
      console.log(`  ✓ ${orgName}: ${usersExported}/${total} users${skippedStr}`);
    }
  }

  /**
   * Log organization failure
   */
  logOrgFailed(orgName: string, error: string): void {
    if (!this.quiet) {
      const formatted = this.isInteractive
        ? chalk.red('  ✗ ' + orgName + ': ') + error
        : `  ✗ ${orgName}: ${error}`;
      console.error(formatted);
    }
  }

  /**
   * Log organization skip (resume scenario)
   */
  logOrgSkipped(orgName: string): void {
    if (!this.quiet && !this.isInteractive) {
      console.log(`  ↷ Skipping ${orgName} (already completed)`);
    }
  }

  /**
   * Display checkpoint creation
   */
  logCheckpointCreated(jobId: string): void {
    if (!this.quiet) {
      const formatted = this.isInteractive
        ? chalk.blue('ℹ Created checkpoint: ') + chalk.bold(jobId)
        : `Created checkpoint: ${jobId}`;
      console.log(formatted);
    }
  }

  /**
   * Display checkpoint resume
   */
  logCheckpointResume(jobId: string, completed: number, remaining: number): void {
    if (!this.quiet) {
      const formatted = this.isInteractive
        ? chalk.blue('ℹ Resuming from checkpoint: ') + chalk.bold(jobId)
        : `Resuming from checkpoint: ${jobId}`;
      console.log(formatted);
      console.log(`  Already completed: ${completed} organizations`);
      console.log(`  Remaining: ${remaining} organizations\n`);
    }
  }

  /**
   * Display final summary with colors and formatting
   */
  displaySummary(stats: ExportProgressStats): void {
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
    console.log(useColors ? chalk.bold('  EXPORT SUMMARY') : '  EXPORT SUMMARY');
    console.log('═'.repeat(60) + '\n');

    // Status indicator
    const statusText = stats.failedOrgs === 0 && stats.completedOrgs > 0
      ? 'Success'
      : stats.failedOrgs > 0 && stats.completedOrgs > 0
      ? 'Completed with errors'
      : 'Failed';

    const statusColored = useColors
      ? (stats.failedOrgs === 0 && stats.completedOrgs > 0
          ? chalk.green('✓ ' + statusText)
          : stats.failedOrgs > 0 && stats.completedOrgs > 0
          ? chalk.yellow('⚠ ' + statusText)
          : chalk.red('✗ ' + statusText))
      : statusText;

    console.log(`Status:           ${statusColored}`);

    // Organization stats
    const orgsStr = `${stats.completedOrgs}/${stats.totalOrgs}`;
    console.log(`Organizations:    ${useColors ? chalk.cyan(orgsStr) : orgsStr}`);

    if (stats.failedOrgs > 0) {
      const failedStr = stats.failedOrgs.toLocaleString();
      console.log(`Failed orgs:      ${useColors ? chalk.red(failedStr) : failedStr}`);
    }

    // User stats
    const usersStr = stats.totalUsers.toLocaleString();
    console.log(`Users exported:   ${useColors ? chalk.green(usersStr) : usersStr}`);

    if (stats.skippedUsers > 0) {
      const skippedStr = stats.skippedUsers.toLocaleString();
      console.log(`Users skipped:    ${useColors ? chalk.yellow(skippedStr) : skippedStr}`);
    }

    if (stats.warnings > 0) {
      const warningsStr = stats.warnings.toLocaleString();
      console.log(`Warnings:         ${useColors ? chalk.yellow(warningsStr) : warningsStr}`);
    }

    // Performance stats
    const durationStr = this.formatDuration(stats.duration);
    console.log(`Duration:         ${useColors ? chalk.magenta(durationStr) : durationStr}`);

    if (stats.throughput > 0) {
      const throughputStr = `${stats.throughput.toFixed(1)} users/sec`;
      console.log(`Throughput:       ${useColors ? chalk.cyan(throughputStr) : throughputStr}`);
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
