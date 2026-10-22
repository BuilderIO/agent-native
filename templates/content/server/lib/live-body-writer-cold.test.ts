import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec, closeDbExec } from "@agent-native/core/db";
import { registerFeatureFlags } from "@agent-native/core/feature-flags";
import { afterAll, expect, it } from "vitest";

import { CONTENT_FEATURE_FLAGS } from "../../shared/feature-flags.js";

const databasePath = join(
  tmpdir(),
  `content-gate-cold-${process.pid}-${Date.now()}.pglite`,
);

afterAll(async () => {
  await closeDbExec();
  rmSync(databasePath, { recursive: true, force: true });
});

it("initializes settings on the normal gate read before any settings write", async () => {
  process.env.DATABASE_URL = `pglite:${databasePath}`;
  registerFeatureFlags(CONTENT_FEATURE_FLAGS);
  const executor = getDbExec();
  await executor.execute(`CREATE TABLE documents (
    id TEXT PRIMARY KEY, live_body_switched_at TEXT, body_revision INTEGER,
    collab_body_revision INTEGER, live_copy_version INTEGER, owner_email TEXT, org_id TEXT
  )`);
  await executor.execute(
    "CREATE TABLE _collab_docs (doc_id TEXT PRIMARY KEY, version INTEGER)",
  );
  await executor.execute({
    sql: "INSERT INTO documents VALUES (?, ?, ?, ?, ?, ?, ?)",
    args: [
      "cold",
      "2026-10-20T00:00:00Z",
      3,
      3,
      1,
      "cold-gate@example.com",
      null,
    ],
  });
  await executor.execute("INSERT INTO _collab_docs VALUES ('cold', 1)");
  const before = await executor.execute(
    "SELECT to_regclass('public.settings') AS relation",
  );
  expect(before.rows[0]?.relation).toBeNull();
  const { liveBodyWriterGate } = await import("./live-body-writer.js");
  await expect(liveBodyWriterGate("cold")).resolves.toEqual({
    writePath: "legacy",
    reason: "flag_off",
  });
  const after = await executor.execute(
    "SELECT to_regclass('public.settings') AS relation",
  );
  expect(after.rows[0]?.relation).toBe("settings");
}, 60_000);
