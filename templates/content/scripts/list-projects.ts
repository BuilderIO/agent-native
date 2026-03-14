import fs from "fs";
import path from "path";
import { loadEnv, ensureDir, PROJECTS_DIR } from "./_utils.js";

export default async function main(_args: string[]) {
  loadEnv();
  ensureDir(PROJECTS_DIR);

  const entries = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
  const projects: { slug: string; name: string; group?: string }[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const entryDir = path.join(PROJECTS_DIR, entry.name);
    const metaPath = path.join(entryDir, ".project.json");

    if (fs.existsSync(metaPath)) {
      let name = entry.name.replace(/-/g, " ");
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
        name = meta.name || name;
      } catch {}
      projects.push({ slug: entry.name, name });
      continue;
    }

    // Check for group directory
    const groupEntries = fs.readdirSync(entryDir, { withFileTypes: true });
    for (const groupEntry of groupEntries) {
      if (!groupEntry.isDirectory()) continue;
      const projectDir = path.join(entryDir, groupEntry.name);
      const projectMeta = path.join(projectDir, ".project.json");
      if (!fs.existsSync(projectMeta)) continue;

      let name = groupEntry.name.replace(/-/g, " ");
      try {
        const meta = JSON.parse(fs.readFileSync(projectMeta, "utf-8"));
        name = meta.name || name;
      } catch {}
      projects.push({ slug: `${entry.name}/${groupEntry.name}`, name, group: entry.name });
    }
  }

  console.log(`Found ${projects.length} projects:\n`);
  for (const p of projects) {
    let line = `  - ${p.name} (${p.slug})`;
    if (p.group) line += ` [group: ${p.group}]`;
    console.log(line);
  }
}
