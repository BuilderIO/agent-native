import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    pgliteRoot: string;
  }
}

// One database root per Vitest run, removed when the run ends. A worker slot
// number repeats in every run, so a path built from it alone would let two
// concurrent runs share a database and let a run inherit the last one's data.
export default function setup(project: TestProject) {
  const root = mkdtempSync(path.join(os.tmpdir(), "agent-native-core-vitest-"));
  project.provide("pgliteRoot", root);
  return () => rmSync(root, { recursive: true, force: true });
}
