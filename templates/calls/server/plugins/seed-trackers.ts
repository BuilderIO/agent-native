import { eq } from "drizzle-orm";
import { getDb, schema } from "../db/index.js";
import { seedDefaultTrackers } from "../lib/trackers/seed-defaults.js";

const seededWorkspaces = new Set<string>();
let bootSeeded = false;

async function seedWorkspaceIfNeeded(workspaceId: string): Promise<void> {
  if (!workspaceId || seededWorkspaces.has(workspaceId)) return;
  seededWorkspaces.add(workspaceId);
  try {
    const db = getDb();
    const [existing] = await db
      .select({ id: schema.trackerDefinitions.id })
      .from(schema.trackerDefinitions)
      .where(eq(schema.trackerDefinitions.workspaceId, workspaceId))
      .limit(1);
    if (existing) return;
    await seedDefaultTrackers(workspaceId);
  } catch (err) {
    seededWorkspaces.delete(workspaceId);
    console.warn(
      `[seed-trackers] Failed to seed workspace ${workspaceId}:`,
      (err as Error)?.message ?? err,
    );
  }
}

async function seedAllWorkspaces(): Promise<void> {
  if (bootSeeded) return;
  bootSeeded = true;
  try {
    const db = getDb();
    const rows = await db
      .select({ id: schema.workspaces.id })
      .from(schema.workspaces);
    for (const row of rows) {
      await seedWorkspaceIfNeeded(row.id);
    }
  } catch (err) {
    bootSeeded = false;
    console.warn(
      "[seed-trackers] Failed to enumerate workspaces at boot:",
      (err as Error)?.message ?? err,
    );
  }
}

export default async (nitroApp: any): Promise<void> => {
  void seedAllWorkspaces();

  try {
    nitroApp?.hooks?.hook?.("request", async () => {
      if (bootSeeded) return;
      await seedAllWorkspaces();
    });
  } catch {
    // Hooks are optional — if the host doesn't expose them, the boot-time
    // seed above still runs.
  }
};
