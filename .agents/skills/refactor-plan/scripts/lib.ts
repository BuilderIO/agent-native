import { mkdirSync } from "node:fs";
import path from "node:path";

import { loadSkillConfig, repoRoot } from "../../fragility-common/lib/cli.ts";

export function plansDir(id: string): string {
  const { plansDir } = loadSkillConfig<{ plansDir: string }>(import.meta.url);
  const dir = path.join(repoRoot(), plansDir, id);
  mkdirSync(dir, { recursive: true });
  return dir;
}
