import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    pgliteRoot: string;
  }
}

export default function setup(project: TestProject) {
  const root = mkdtempSync(path.join(os.tmpdir(), "plan-vitest-"));
  project.provide("pgliteRoot", root);
  return () => rmSync(root, { recursive: true, force: true });
}
