// @agent-native/pinpoint — Path validation for file operations
// MIT License

import { resolve, relative } from "path";

const VALID_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Validate that an ID is safe for use in file paths.
 * Only allows alphanumeric characters, hyphens, and underscores.
 */
export function isValidId(id: string): boolean {
  return VALID_ID_PATTERN.test(id) && id.length > 0 && id.length <= 128;
}

/**
 * Validate that a resolved file path is within the expected base directory.
 * Prevents path traversal attacks.
 */
export function isWithinDirectory(filePath: string, baseDir: string): boolean {
  const resolvedPath = resolve(filePath);
  const resolvedBase = resolve(baseDir);
  const rel = relative(resolvedBase, resolvedPath);

  // Path must be a descendant (no ..)
  return !rel.startsWith("..") && !rel.startsWith("/");
}

/**
 * Strip absolute path prefixes for display.
 * Uses process.cwd() as the base.
 */
export function stripAbsolutePath(filePath: string): string {
  try {
    const cwd = process.cwd();
    if (filePath.startsWith(cwd)) {
      return filePath.slice(cwd.length + 1);
    }
  } catch {
    // process.cwd() not available (browser)
  }
  return filePath;
}
