import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDbExec } from "@agent-native/core/db";
import { eq } from "@agent-native/core/db/schema";
import {
  PrivateBlobError,
  registerPrivateBlobProvider,
  unregisterPrivateBlobProvider,
} from "@agent-native/core/private-blob";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getDb, schema } from "../db/index.js";
import { ensureAnalyticsDatabase } from "./database.js";
import {
  countDataframeBlobs,
  registerOutputDataframe,
  sweepDataframeBlobs,
  sweepDataframeBlobsAfterWrite,
} from "./dataframe-lifecycle.js";

const dir = mkdtempSync(join(tmpdir(), "lifecycle-regression-"));
const previous = process.env.DATABASE_URL;
const scope = { ownerEmail: "lifecycle@example.test", orgId: "lifecycle-org" };
const blobs = new Set<string>();
let failDelete = false;
const provider = "lifecycle-regression";
const handle = (id: string) => ({
  id,
  provider,
  opaque: true as const,
  encrypted: true as const,
});

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${join(dir, "db")}`;
  await ensureAnalyticsDatabase();
  registerPrivateBlobProvider({
    id: provider,
    name: "Lifecycle regression",
    isConfigured: () => true,
    put: async () => {
      throw new Error("Unexpected put");
    },
    read: async (h) => {
      if (!blobs.has(h.id)) throw new PrivateBlobError("Gone", "gone");
      return { data: new Uint8Array(), handle: h };
    },
    delete: async (h) => {
      if (failDelete) throw new PrivateBlobError("Unavailable", "unavailable");
      return { deleted: blobs.delete(h.id), provider };
    },
  });
});
afterAll(async () => {
  unregisterPrivateBlobProvider(provider);
  await closeDbExec();
  if (previous === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previous;
  rmSync(dir, { recursive: true, force: true });
});

async function fixture() {
  const projectId = randomUUID();
  await getDb()
    .insert(schema.projects)
    .values({
      id: projectId,
      ...scope,
      workingVersionId: "work",
      createdAt: "now",
      updatedAt: "now",
    });
  return projectId;
}
async function ledger(projectId: string, ids: string[]) {
  await getDb()
    .insert(schema.dataframeBlobs)
    .values(
      ids.map((id) => ({
        provider,
        handleId: id,
        ...scope,
        projectId,
        handleJson: JSON.stringify(handle(id)),
        createdAt: "now",
      })),
    );
  ids.forEach((id) => blobs.add(id));
}

describe("dataframe cleanup", () => {
  it("reaches an unreferenced blob after a full batch of referenced blobs", async () => {
    const projectId = await fixture();
    const pinned = Array.from(
      { length: 200 },
      (_, i) => `p-${String(i).padStart(3, "0")}`,
    );
    const orphan = "p-200";
    await ledger(projectId, [...pinned, orphan]);
    await getDb()
      .insert(schema.cellOutputs)
      .values(
        pinned.map((id, i) => ({
          cellId: `${projectId}-${i}`,
          projectId,
          status: "complete" as const,
          output: JSON.stringify({ id }),
          ranAt: "now",
        })),
      );
    expect(await countDataframeBlobs(scope, projectId)).toBe(201);
    expect(await sweepDataframeBlobs(scope, projectId)).toEqual({ removed: 1 });
    expect(blobs.has(orphan)).toBe(false);
    expect(pinned.every((id) => blobs.has(id))).toBe(true);
    expect(await countDataframeBlobs(scope, projectId)).toBe(200);
  });
  it("rejects a stale handle after cleanup has completed", async () => {
    const projectId = await fixture();
    const id = `stale-${randomUUID()}`;
    await ledger(projectId, [id]);
    await sweepDataframeBlobs(scope, projectId);
    const output = {
      type: "table" as const,
      columns: [],
      rows: [],
      rowCount: 0,
      truncated: false,
      materialization: {
        version: 1 as const,
        handle: handle(id),
        snapshot: "a".repeat(64),
        digest: "b".repeat(64),
        dependencies: [],
      },
    };
    await expect(
      getDb().transaction((tx) =>
        registerOutputDataframe(tx, scope, projectId, output),
      ),
    ).rejects.toMatchObject({
      errorCode: "project_dataframe_blob_unavailable",
    });
  });
  it("reports cleanup pending after a committed change and permits retry", async () => {
    const projectId = await fixture();
    const id = `z-${randomUUID()}`;
    await ledger(projectId, [id]);
    failDelete = true;
    try {
      await expect(
        sweepDataframeBlobsAfterWrite(scope, projectId),
      ).rejects.toMatchObject({
        errorCode: "project_dataframe_cleanup_pending",
        details: { committed: true },
      });
      expect(await countDataframeBlobs(scope, projectId)).toBe(1);
      expect(
        (
          await getDb()
            .select()
            .from(schema.dataframeBlobs)
            .where(eq(schema.dataframeBlobs.handleId, id))
        )[0],
      ).toMatchObject({ state: "deleting", attempts: 1 });
    } finally {
      failDelete = false;
    }
    expect(await sweepDataframeBlobs(scope, projectId)).toEqual({ removed: 1 });
    expect(blobs.has(id)).toBe(false);
  });
});
