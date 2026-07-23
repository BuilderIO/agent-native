import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const workflowPath =
  path.basename(moduleDir) === "dist"
    ? path.join(moduleDir, "workflows", "pr-visual-recap.yml")
    : path.resolve(moduleDir, "../../../.github/workflows/pr-visual-recap.yml");

/** Canonical PR Visual Recap workflow bundled by the CLI installer. */
export const PR_VISUAL_RECAP_WORKFLOW_YML = readFileSync(workflowPath, "utf8");
