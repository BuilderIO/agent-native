import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const distDir = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(
  distDir,
  "../../../.github/workflows/pr-visual-recap.yml",
);
const destination = path.join(distDir, "workflows", "pr-visual-recap.yml");

mkdirSync(path.dirname(destination), { recursive: true });
copyFileSync(source, destination);
