// @agent-native/pinpoint — Path validation for file operations
// MIT License

import { resolve, relative } from "path";

const VALID_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function isValidId(id: string): boolean {
  return VALID_ID_PATTERN.test(id) && id.length > 0 && id.length <= 128;
}

export function isWithinDirectory(filePath: string, baseDir: string): boolean {
  const resolvedPath = resolve(filePath);
  const resolvedBase = resolve(baseDir);
  const rel = relative(resolvedBase, resolvedPath);

  return !rel.startsWith("..") && !rel.startsWith("/");
}

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
