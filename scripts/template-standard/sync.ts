/**
 * Write mode for the byte-synced TEMPLATE STANDARD surfaces.
 *
 * Phase 1 implements this so the mechanism exists end to end, but nothing in
 * this phase invokes it: `guard:template-standard` (checks.ts + baseline.ts)
 * never calls into sync.ts, and no CI step runs `sync:template-standard`.
 * Only creates files that are entirely MISSING — an existing file with
 * different content is left alone (that is a template maintainer's
 * intentional customization until a human decides otherwise; overwriting it
 * silently would destroy real content like Clips'/Analytics' extended
 * learnings.defaults.md).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { BYTE_SYNCED_FILES, listTemplates, templatePath } from "./manifest.ts";

export type SyncResult = {
  rule: string;
  template: string;
  path: string;
};

export function syncByteSyncedFiles(templates: string[] = listTemplates()): SyncResult[] {
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
