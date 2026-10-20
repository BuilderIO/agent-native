import { createRequire } from "node:module";

import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";

import * as schema from "../db/schema.js";
import { designFileOrder } from "./design-file-order.js";

const require = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
);
const { PGlite } = require("@electric-sql/pglite");

type SeedFile = { id: string; createdAt: string | null };
type SeedClaim = {
  restoredFileId: string;
  sourceFileId: string;
  snapshot: Record<string, unknown>;
};

describe("designFileOrder against PGlite", () => {
  it("keeps restored screens at their original order through repeated restores", async () => {
    const pglite = await PGlite.create("memory://");

    try {
      await pglite.exec(`
        CREATE TABLE design_files (
          id TEXT PRIMARY KEY,
          design_id TEXT NOT NULL,
          created_at TEXT
        );
        CREATE TABLE design_screen_restore_claims (
          id TEXT PRIMARY KEY,
          design_id TEXT NOT NULL,
          source_file_id TEXT NOT NULL,
          snapshot TEXT NOT NULL,
          consumed_at TEXT,
          restored_file_id TEXT,
          created_at TEXT NOT NULL
        );
      `);

      const db = drizzle(pglite, { schema });
      const designId = "design-order-test";
      const timestamp = "2026-10-14T12:00:00.000Z";
      const readOrder = async () => {
        const rows = await db
          .select({ id: schema.designFiles.id })
          .from(schema.designFiles)
          .leftJoin(
            schema.designScreenRestoreClaims,
            and(
              eq(
                schema.designScreenRestoreClaims.designId,
                schema.designFiles.designId,
              ),
              eq(
                schema.designScreenRestoreClaims.restoredFileId,
                schema.designFiles.id,
              ),
            ),
          )
          .where(eq(schema.designFiles.designId, designId))
          .orderBy(...designFileOrder(schema));

        return rows.map(({ id }) => id);
      };
      const seed = async (files: SeedFile[], claims: SeedClaim[] = []) => {
        await pglite.exec(
          "TRUNCATE design_screen_restore_claims, design_files",
        );

        for (const file of files) {
          await pglite.query(
            "INSERT INTO design_files (id, design_id, created_at) VALUES ($1, $2, $3)",
            [file.id, designId, file.createdAt],
          );
        }

        const currentFileIds = new Set(files.map(({ id }) => id));
        const claimedFileIds = claims.map(
          ({ restoredFileId }) => restoredFileId,
        );
        expect(new Set(claimedFileIds).size).toBe(claimedFileIds.length);
        expect(claimedFileIds.every((id) => currentFileIds.has(id))).toBe(true);

        for (const [index, claim] of claims.entries()) {
          await pglite.query(
            `INSERT INTO design_screen_restore_claims
              (id, design_id, source_file_id, snapshot, restored_file_id, created_at)
              VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              `claim-${index}`,
              designId,
              claim.sourceFileId,
              JSON.stringify(claim.snapshot),
              claim.restoredFileId,
              timestamp,
            ],
          );
        }
      };

      await seed([
        { id: "screen-z", createdAt: timestamp },
        { id: "screen-a", createdAt: timestamp },
        { id: "earlier-screen", createdAt: "2026-10-14T11:59:59.000Z" },
        { id: "later-screen", createdAt: "2026-10-14T12:00:01.000Z" },
      ]);
      expect(await readOrder()).toEqual([
        "earlier-screen",
        "screen-a",
        "screen-z",
        "later-screen",
      ]);

      await seed(
        [
          { id: "screen-a", createdAt: timestamp },
          { id: "screen-c", createdAt: timestamp },
          { id: "screen-d", createdAt: timestamp },
          { id: "screen-e", createdAt: timestamp },
          { id: "restored-with-new-id", createdAt: timestamp },
        ],
        [
          {
            restoredFileId: "restored-with-new-id",
            sourceFileId: "screen-b",
            snapshot: { fileOrderKey: "screen-b" },
          },
        ],
      );
      expect(await readOrder()).toEqual([
        "screen-a",
        "restored-with-new-id",
        "screen-c",
        "screen-d",
        "screen-e",
      ]);

      await seed(
        [
          { id: "screen-a", createdAt: timestamp },
          { id: "screen-c", createdAt: timestamp },
          { id: "restored-again", createdAt: timestamp },
        ],
        [
          {
            restoredFileId: "restored-again",
            sourceFileId: "first-restored-id",
            snapshot: { fileOrderKey: "screen-b" },
          },
        ],
      );
      expect(await readOrder()).toEqual([
        "screen-a",
        "restored-again",
        "screen-c",
      ]);

      await seed(
        [
          { id: "screen-a", createdAt: timestamp },
          { id: "screen-c", createdAt: timestamp },
          { id: "screen-d", createdAt: timestamp },
          { id: "legacy-restored-id", createdAt: timestamp },
        ],
        [
          {
            restoredFileId: "legacy-restored-id",
            sourceFileId: "screen-b",
            snapshot: {},
          },
        ],
      );
      expect(await readOrder()).toEqual([
        "screen-a",
        "legacy-restored-id",
        "screen-c",
        "screen-d",
      ]);
      await seed(
        [
          { id: "nonnull-screen", createdAt: timestamp },
          { id: "z-restored-null", createdAt: null },
          { id: "null-other", createdAt: null },
        ],
        [
          {
            restoredFileId: "z-restored-null",
            sourceFileId: "previous-null-copy",
            snapshot: { fileOrderKey: "null-a" },
          },
        ],
      );
      expect(await readOrder()).toEqual([
        "nonnull-screen",
        "z-restored-null",
        "null-other",
      ]);
    } finally {
      await pglite.close();
    }
  });
});
