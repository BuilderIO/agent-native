
import fs from "node:fs";
import path from "node:path";

import { ensureS3FileUploadProvider } from "../file-upload/s3.js";
import { importRuntimeSourceModule } from "../server/runtime-source-module.js";

const BOOTSTRAP_DIRS = ["actions", "scripts"];
const BOOTSTRAP_EXTENSIONS = [".ts", ".js", ".mjs"];

export function resolveCliBootstrapFile(cwd = process.cwd()): string | null {
  for (const dir of BOOTSTRAP_DIRS) {
    for (const extension of BOOTSTRAP_EXTENSIONS) {
      const candidate = path.resolve(cwd, dir, `_cli-bootstrap${extension}`);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export async function loadCliBootstrap(cwd = process.cwd()): Promise<void> {
  const file = resolveCliBootstrapFile(cwd);
  if (file) {
    await importRuntimeSourceModule(file);
  }
  ensureS3FileUploadProvider();
}
