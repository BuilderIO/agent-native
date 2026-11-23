import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

export function createLocalQaDescriptor(directory: string, contents: string) {
  const path = resolve(directory, `analytics-2-local-qa-${randomUUID()}.json`);
  writeFileSync(path, contents, { flag: "wx", mode: 0o600 });
  return path;
}
