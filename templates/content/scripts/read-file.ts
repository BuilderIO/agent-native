import fs from "fs";
import path from "path";
import {
  loadEnv,
  parseArgs,
  camelCaseArgs,
  isValidPath,
  isValidProjectPath,
  isValidWorkspace,
  PROJECTS_DIR,
  SHARED_DIR,
  fail,
} from "./_utils.js";

export default async function main(args: string[]) {
  loadEnv();
  const raw = parseArgs(args);
  const opts = camelCaseArgs(raw);

  if (raw["help"]) {
    console.log(`Usage: pnpm script read-file --file-path <path> [options]

Options:
  --file-path      Relative path to the file (required)
  --project-slug   Project slug (omit for shared resources)
  --workspace      Workspace name (for workspace shared resources)`);
    return;
  }

  const { filePath, projectSlug, workspace } = opts;
  if (!filePath) fail("--file-path is required");
  if (!isValidPath(filePath)) fail("Invalid file path");
  if (projectSlug && !isValidProjectPath(projectSlug))
    fail("Invalid project slug");
  if (workspace && !isValidWorkspace(workspace)) fail("Invalid workspace name");

  let baseDir: string;
  if (projectSlug) {
    baseDir = path.join(PROJECTS_DIR, projectSlug);
  } else if (workspace) {
    baseDir = path.join(PROJECTS_DIR, workspace, "shared-resources");
  } else {
    baseDir = SHARED_DIR;
  }

  const fullPath = path.join(baseDir, filePath);
  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    fail(`File not found: ${filePath}`);
  }

  const content = fs.readFileSync(fullPath, "utf-8");
  const location = projectSlug ? `${projectSlug}/${filePath}` : filePath;
  console.log(`--- ${location} ---\n\n${content}`);
}
