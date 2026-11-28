import { createRequire } from "node:module";
const { PGlite } = createRequire(import.meta.resolve("@agent-native/core/db"))(
  "@electric-sql/pglite",
);
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import * as schema from "../db/schema.js";

let database: ReturnType<typeof drizzle>;
vi.mock("../db/index.js", async () => ({
  getDb: () => database,
  schema: await import("../db/schema.js"),
}));
vi.mock("./recordings.js", async () => {
  const { sql } = await import("drizzle-orm");
  return {
    ownerEmailMatches: (column: unknown, email: string) =>
      sql`lower(${column as never}) = ${email.toLowerCase()}`,
  };
});
import { inheritedMotionCaptureMetadataJson } from "./original-capture-metadata.js";

const client = new PGlite();
const motion = JSON.stringify({
  captureMode: "motion",
  requestedFrameRate: 60,
});

beforeAll(async () => {
  await client.exec(
    "CREATE TABLE recordings (id TEXT PRIMARY KEY, owner_email TEXT NOT NULL, capture_metadata_json TEXT)",
  );
  await client.query(
    "INSERT INTO recordings (id, owner_email, capture_metadata_json) VALUES ($1, $2, $3), ($4, $5, $6), ($7, $8, $9)",
    [
      "motion-original",
      "Owner@Example.test",
      motion,
      "normal-original",
      "owner@example.test",
      JSON.stringify({ captureMode: "normal" }),
      "someone-elses-motion",
      "other@example.test",
      motion,
    ],
  );
  database = drizzle(client, { schema });
});

afterAll(async () => {
  await client.close();
});

describe("a local copy saved before it kept capture metadata", () => {
  it("inherits its original clip's Motion metadata", async () => {
    await expect(
      inheritedMotionCaptureMetadataJson({
        recordingSource: "local_copy_upload",
        originalRecordingId: "motion-original",
        ownerEmail: "owner@example.test",
      }),
    ).resolves.toBe(motion);
  });

  it("inherits nothing from a Normal original, a missing one or another owner's", async () => {
    for (const originalRecordingId of [
      "normal-original",
      "never-uploaded-local-id",
      "someone-elses-motion",
    ]) {
      await expect(
        inheritedMotionCaptureMetadataJson({
          recordingSource: "local_copy_upload",
          originalRecordingId,
          ownerEmail: "owner@example.test",
        }),
      ).resolves.toBeNull();
    }
  });

  it("only applies to local copy uploads", async () => {
    await expect(
      inheritedMotionCaptureMetadataJson({
        recordingSource: "recorder",
        originalRecordingId: "motion-original",
        ownerEmail: "owner@example.test",
      }),
    ).resolves.toBeNull();
  });
});
