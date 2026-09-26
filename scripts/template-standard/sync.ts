import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { BYTE_SYNCED_FILES, listTemplates, templatePath } from "./manifest.ts";

export type SyncResult = {
  rule: string;
  template: string;
  path: string;
};

export function syncByteSyncedFiles(
  templates: string[] = listTemplates(),
): SyncResult[] {
  const written: SyncResult[] = [];
  for (const surface of BYTE_SYNCED_FILES) {
    const canonical = readFileSync(surface.canonicalPath, "utf-8");
    for (const template of templates) {
      const path = templatePath(template, surface.relPath);
      if (existsSync(path)) continue;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, canonical);
      written.push({ rule: surface.rule, template, path });
    }
  }
  return written;
}
