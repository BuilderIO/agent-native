import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const distDir = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(
  distDir,
  "../../../.github/workflows/pr-visual-recap.yml",
);
const destination = path.join(distDir, "workflows", "pr-visual-recap.yml");
const workflow = readFileSync(source, "utf8");

mkdirSync(path.dirname(destination), { recursive: true });
copyFileSync(source, destination);
writeFileSync(
  path.join(distDir, "pr-visual-recap-workflow.js"),
  `export const PR_VISUAL_RECAP_WORKFLOW_YML = ${JSON.stringify(workflow)};\n`,
);
