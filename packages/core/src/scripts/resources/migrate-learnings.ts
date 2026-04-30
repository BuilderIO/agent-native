/**
 * Core script: migrate-learnings
 *
 * Migrate a learnings.md file from the project root into the SQL resource store.
 *
 * Usage:
 *   pnpm action migrate-learnings
 */

import fs from "fs";
import path from "path";
import { resourcePut } from "../../resources/store.js";
import { getRequestUserEmail } from "../../server/request-context.js";
import { DEV_MODE_USER_EMAIL } from "../../server/auth.js";

export default async function migrateLearningsScript(
  args: string[],
): Promise<void> {
  const filePath = path.resolve(process.cwd(), "learnings.md");

  if (!fs.existsSync(filePath)) {
    console.log("No learnings.md found");
    return;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const owner = getRequestUserEmail() ?? DEV_MODE_USER_EMAIL;

  const resource = await resourcePut(
    owner,
    "learnings.md",
    content,
    "text/markdown",
  );
  console.log(
    `Migrated learnings.md to resource store (${resource.size} bytes)`,
  );
}
