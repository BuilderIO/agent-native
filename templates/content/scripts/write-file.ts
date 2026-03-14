import fs from "fs";
import path from "path";
import {
  buildProjectFileFirestorePath,
  persistVersionHistory,
  registerPendingFileWrite,
  suppressWatcherVersionHistory,
} from "../server/lib/version-history.js";
import {
  loadEnv,
  parseArgs,
  camelCaseArgs,
  isValidPath,
  isValidProjectPath,
  isValidWorkspace,
  ensureDir,
  PROJECTS_DIR,
  SHARED_DIR,
  fail,
} from "./_utils.js";

export default async function main(args: string[]) {
  loadEnv();
  const raw = parseArgs(args);
  const opts = camelCaseArgs(raw);

  if (raw["help"]) {
    console.log(`Usage: pnpm script write-file --file-path <path> --content "..." [options]

Options:
  --file-path      Relative path to the file (required)
  --content        Content to write (required)
  --project-slug   Project slug (omit for shared resources)
  --workspace      Workspace name (for workspace shared resources)`);
    return;
  }

  const { filePath, content, projectSlug, workspace } = opts;
  if (!filePath) fail("--file-path is required");
  if (content === undefined) fail("--content is required");
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

  if (projectSlug && !fs.existsSync(baseDir)) fail("Project not found");

  const fullPath = path.join(baseDir, filePath);
  ensureDir(path.dirname(fullPath));

  const historyPath = projectSlug
    ? buildProjectFileFirestorePath(projectSlug, filePath)
    : null;

  if (historyPath) {
    registerPendingFileWrite(historyPath, {
      actorType: "agent",
      actorId: "agent",
      actorDisplayName: "Agent",
      source: "agentWrite",
    });
    suppressWatcherVersionHistory(fullPath);
  }

  fs.writeFileSync(fullPath, content, "utf-8");

  if (historyPath) {
    await persistVersionHistory({
      filePath: historyPath,
      content,
      fallbackTimestamp: Date.now(),
    });
  }

  const location = projectSlug ? `${projectSlug}/${filePath}` : filePath;
  console.log(`File written: ${location}`);
}
