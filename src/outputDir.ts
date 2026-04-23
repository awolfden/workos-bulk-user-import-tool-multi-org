import fs from 'fs';
import path from 'path';

export const OUTPUT_DIR = 'output';

/**
 * Ensure the output directory exists, creating it if necessary.
 */
export function ensureOutputDir(): void {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

/**
 * Return a file path inside the output directory.
 */
export function outputPath(filename: string): string {
  return path.join(OUTPUT_DIR, filename);
}
