/**
 * Phase 2: Duplicate Detection
 *
 * Set-based tracking for duplicate emails and external_ids.
 * Memory-efficient: ~100MB for 1M unique values.
 */

/**
 * Tracks duplicate emails and external_ids using Sets
 */
export class DuplicateDetector {
  private emails: Set<string> = new Set();
  private externalIds: Set<string> = new Set();

  /**
   * Check if an email has been seen before
   * @param email - Email address to check (will be normalized)
   * @returns true if duplicate, false if first occurrence
   */
  hasEmail(email: string): boolean {
    const normalized = this.normalizeEmail(email);
    return this.emails.has(normalized);
  }

  /**
   * Add an email to the tracking set
   * @param email - Email address to track (will be normalized)
   */
  addEmail(email: string): void {
    const normalized = this.normalizeEmail(email);
    this.emails.add(normalized);
  }

  /**
   * Check if an external_id has been seen before
   * @param externalId - External ID to check
   * @returns true if duplicate, false if first occurrence
   */
  hasExternalId(externalId: string): boolean {
    return this.externalIds.has(externalId);
  }

  /**
   * Add an external_id to the tracking set
   * @param externalId - External ID to track
   */
  addExternalId(externalId: string): void {
    this.externalIds.add(externalId);
  }

  /**
   * Get statistics about the detector
   * @returns Stats including count and estimated memory usage
   */
  getStats(): { emails: number; externalIds: number; memoryMB: number } {
    const emailCount = this.emails.size;
    const externalIdCount = this.externalIds.size;

    // Estimate memory: ~50 bytes per string + Set overhead
    // Rough estimate: 100 bytes per entry
    const totalEntries = emailCount + externalIdCount;
    const memoryMB = (totalEntries * 100) / (1024 * 1024);

    return {
      emails: emailCount,
      externalIds: externalIdCount,
      memoryMB: Math.round(memoryMB * 100) / 100
    };
  }

  /**
   * Reset the detector (clear all tracking data)
   */
  reset(): void {
    this.emails.clear();
    this.externalIds.clear();
  }

  /**
   * Normalize email for consistent duplicate detection
   * @param email - Email address to normalize
   * @returns Normalized email (lowercase, trimmed)
   */
  private normalizeEmail(email: string): string {
    return email.toLowerCase().trim();
  }
}
