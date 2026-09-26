
import fs from "fs";
import path from "path";

import { resourcePut, SHARED_OWNER } from "../../resources/store.js";

export default async function migrateLearningsScript(
  _args: string[],
): Promise<void> {
  const filePath = path.resolve(process.cwd(), "learnings.md");

  if (!fs.existsSync(filePath)) {
    console.log("No learnings.md found");
    return;
  }

  const content = fs.readFileSync(filePath, "utf-8");

  const resource = await resourcePut(
    SHARED_OWNER,
    "LEARNINGS.md",
    content,
    "text/markdown",
  );
  console.log(
    `Migrated learnings.md to shared resource store as LEARNINGS.md (${resource.size} bytes)`,
  );
}
