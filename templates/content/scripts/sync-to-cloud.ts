import { loadEnv, parseArgs, PROJECTS_DIR } from "./_utils.js";
import fs from "fs";
import path from "path";
import crypto from "crypto";

export default async function main(args: string[]) {
  loadEnv();
  const opts = parseArgs(args);

  if (opts["help"]) {
    console.log(
      "Usage: pnpm script sync-to-cloud [--workspace <name>] [--project <name>] [--publish]",
    );
    console.log("");
    console.log("Sync local content files to the cloud database.");
    console.log(
      "If --workspace and --project are given, syncs only that project.",
    );
    console.log("If --publish is set, marks synced pages as published.");
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.error(
      "ERROR: DATABASE_URL is not set. Configure a cloud database first.",
    );
    process.exit(1);
  }

  // Dynamic import to avoid loading DB code when not needed
  const { getDb, schema } = await import("../server/db/index.js");
  const { eq } = await import("drizzle-orm");

  const db = getDb();
  if (!db) {
    console.error("ERROR: Could not connect to database.");
    process.exit(1);
  }

  const filterWorkspace = opts["workspace"];
  const filterProject = opts["project"];
  const shouldPublish = opts["publish"] === "true" || opts["publish"] === "";

  let synced = 0;

  if (!fs.existsSync(PROJECTS_DIR)) {
    console.log("No projects directory found at", PROJECTS_DIR);
    return;
  }

  const workspaces = fs
    .readdirSync(PROJECTS_DIR)
    .filter(
      (w) =>
        fs.statSync(path.join(PROJECTS_DIR, w)).isDirectory() &&
        !w.startsWith("."),
    );

  for (const workspace of workspaces) {
    if (filterWorkspace && workspace !== filterWorkspace) continue;

    const workspaceDir = path.join(PROJECTS_DIR, workspace);
    const projects = fs
      .readdirSync(workspaceDir)
      .filter(
        (p) =>
          fs.statSync(path.join(workspaceDir, p)).isDirectory() &&
          !p.startsWith(".") &&
          p !== "shared-resources",
      );

    for (const project of projects) {
      if (filterProject && project !== filterProject) continue;

      const projectDir = path.join(workspaceDir, project);
      const draftPath = path.join(projectDir, "draft.md");
      const metadataPath = path.join(projectDir, ".project.json");

      if (!fs.existsSync(draftPath)) {
        console.log(`  Skipping ${workspace}/${project} - no draft.md`);
        continue;
      }

      const content = fs.readFileSync(draftPath, "utf-8");
      let metadata: Record<string, unknown> | null = null;
      let title = project;

      if (fs.existsSync(metadataPath)) {
        try {
          metadata = JSON.parse(fs.readFileSync(metadataPath, "utf-8"));
          if (metadata && typeof metadata === "object" && "title" in metadata) {
            title = (metadata as { title: string }).title || project;
          }
        } catch {
          // Ignore invalid JSON
        }
      }

      const id = crypto
        .createHash("sha256")
        .update(`${workspace}/${project}`)
        .digest("hex")
        .slice(0, 16);

      const now = new Date().toISOString();

      // Check if page already exists
      const existing = await db
        .select()
        .from(schema.pages)
        .where(eq(schema.pages.id, id))
        .get();

      if (existing) {
        // Update
        await db
          .update(schema.pages)
          .set({
            title,
            content,
            metadata: metadata ? JSON.stringify(metadata) : null,
            updatedAt: now,
            ...(shouldPublish ? { publishedAt: now } : {}),
          })
          .where(eq(schema.pages.id, id));
        console.log(`  Updated: ${workspace}/${project}`);
      } else {
        // Insert
        await db.insert(schema.pages).values({
          id,
          workspace,
          project,
          title,
          content,
          metadata: metadata ? JSON.stringify(metadata) : null,
          updatedAt: now,
          publishedAt: shouldPublish ? now : null,
        });
        console.log(`  Inserted: ${workspace}/${project}`);
      }

      synced++;
    }
  }

  console.log(`\nSynced ${synced} page(s) to cloud database.`);
  if (shouldPublish) {
    console.log("All synced pages have been marked as published.");
  }
}
