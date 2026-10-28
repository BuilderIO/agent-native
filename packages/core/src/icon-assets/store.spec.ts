import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import { ORG_MIGRATIONS } from "../org/migrations.js";
import type { PrivateBlobHandle } from "../private-blob/types.js";

const putBlob = vi.hoisted(() => vi.fn());
const readBlob = vi.hoisted(() => vi.fn());
const deleteBlob = vi.hoisted(() => vi.fn());
let db: ReturnType<typeof drizzle>;
let postgres: Awaited<ReturnType<typeof createTestPglite>>;

vi.mock("../db/create-get-db.js", () => ({ createGetDb: () => () => db }));
vi.mock("../private-blob/index.js", () => ({
  putPrivateBlob: putBlob,
  readPrivateBlob: readBlob,
  deletePrivateBlob: deleteBlob,
}));

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const handle: PrivateBlobHandle = {
  id: "test-handle",
  provider: "test",
  opaque: true,
  encrypted: true,
};

beforeEach(async () => {
  postgres = await createTestPglite();
  db = drizzle(postgres.db);
  const migration = ORG_MIGRATIONS.find((entry) => entry.version === 1034);
  if (!migration) throw new Error("Missing private icon migration");
  await postgres.exec(migration.sql);
  putBlob.mockReset().mockResolvedValue(handle);
  readBlob.mockReset().mockImplementation(async () => ({ data: png, handle }));
  deleteBlob.mockReset().mockResolvedValue({ deleted: true, provider: "test" });
});

afterEach(async () => {
  await postgres.close();
});

describe("private icon assets", () => {
  it("persists a private handle and verifies bytes before exposing an asset ID", async () => {
    const { putIconAsset, getIconAsset, readIconAsset, listIconAssets } =
      await import("./store.js");
    const asset = await putIconAsset({
      data: png,
      mimeType: "image/png",
      filename: "profile.png",
      alt: "Profile",
      ownerEmail: "Alice@Example.com",
      orgId: "org-1",
    });
    expect(asset.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(asset.filename).toBe("profile.png");
    expect(asset.alt).toBe("Profile");
    expect(readBlob).toHaveBeenCalledWith(handle);
    const stored = await postgres.query(
      "SELECT blob_handle_json FROM private_icon_assets",
    );
    expect(
      JSON.parse(
        (stored.rows[0] as { blob_handle_json: string }).blob_handle_json,
      ),
    ).toEqual(handle);
    expect(
      await getIconAsset(asset.id, {
        ownerEmail: "alice@example.com",
        orgId: "org-1",
      }),
    ).toEqual(asset);
    expect(
      (
        await readIconAsset(asset.id, {
          ownerEmail: "alice@example.com",
          orgId: "org-1",
        })
      )?.data,
    ).toEqual(png);
    expect(
      await listIconAssets({ ownerEmail: "alice@example.com", orgId: "org-1" }),
    ).toEqual([asset]);
  });

  it("requires owner and organization on direct reads, and organization on trusted reads", async () => {
    const {
      putIconAsset,
      readIconAsset,
      readIconAssetForAuthorizedReference,
      listIconAssets,
    } = await import("./store.js");
    const asset = await putIconAsset({
      data: png,
      mimeType: "image/png",
      ownerEmail: "alice@example.com",
      orgId: "org-1",
    });
    readBlob.mockClear();
    expect(
      await readIconAsset(asset.id, {
        ownerEmail: "bob@example.com",
        orgId: "org-1",
      }),
    ).toBeNull();
    expect(
      await readIconAsset(asset.id, {
        ownerEmail: "alice@example.com",
        orgId: "org-2",
      }),
    ).toBeNull();
    expect(
      await listIconAssets({ ownerEmail: "bob@example.com", orgId: "org-1" }),
    ).toEqual([]);
    expect(
      await readIconAssetForAuthorizedReference(asset.id, { orgId: "org-2" }),
    ).toBeNull();
    expect(readBlob).not.toHaveBeenCalled();
    expect(
      (await readIconAssetForAuthorizedReference(asset.id, { orgId: "org-1" }))
        ?.data,
    ).toEqual(png);
  });

  it("rejects malformed MIME and unsafe SVG before upload", async () => {
    const { putIconAsset } = await import("./store.js");
    await expect(
      putIconAsset({
        data: png,
        mimeType: "image/jpeg",
        ownerEmail: "alice@example.com",
      }),
    ).rejects.toThrow(/type does not match/);
    await expect(
      putIconAsset({
        data: new TextEncoder().encode("<svg><script>alert(1)</script></svg>"),
        mimeType: "image/svg+xml",
        ownerEmail: "alice@example.com",
      }),
    ).rejects.toThrow(/unsupported markup/);
    await expect(
      putIconAsset({
        data: new TextEncoder().encode('<svg><path onload="alert(1)"/></svg>'),
        mimeType: "image/svg+xml",
        ownerEmail: "alice@example.com",
      }),
    ).rejects.toThrow(/unsafe attribute/);
    expect(putBlob).not.toHaveBeenCalled();
  });

  it("stores a canonical safe SVG and checks its readback", async () => {
    const { putIconAsset, readIconAsset } = await import("./store.js");
    const original = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path fill="currentColor" d="M 1 2 L 3 4"/></svg>',
    );
    readBlob.mockImplementation(async () => ({
      data: putBlob.mock.calls[0]?.[0].data,
      handle,
    }));
    const asset = await putIconAsset({
      data: original,
      mimeType: "image/svg+xml",
      ownerEmail: "alice@example.com",
    });
    expect(new TextDecoder().decode(putBlob.mock.calls[0]?.[0].data)).toContain(
      '<path fill="currentColor" d="M 1 2 L 3 4"></path>',
    );
    expect(
      (await readIconAsset(asset.id, { ownerEmail: "alice@example.com" }))
        ?.mimeType,
    ).toBe("image/svg+xml");
  });

  it("fails closed when storage is unavailable and cleans up failed writes/readback", async () => {
    const { putIconAsset } = await import("./store.js");
    putBlob.mockResolvedValueOnce(null);
    await expect(
      putIconAsset({
        data: png,
        mimeType: "image/png",
        ownerEmail: "alice@example.com",
      }),
    ).rejects.toThrow(/unavailable/);
    readBlob.mockResolvedValueOnce({ data: new Uint8Array([1]), handle });
    await expect(
      putIconAsset({
        data: png,
        mimeType: "image/png",
        ownerEmail: "alice@example.com",
      }),
    ).rejects.toThrow(/read-back/);
    expect(deleteBlob).toHaveBeenCalledWith(handle);
    vi.spyOn(db, "insert").mockImplementationOnce(() => {
      throw new Error("insert failed");
    });
    await expect(
      putIconAsset({
        data: png,
        mimeType: "image/png",
        ownerEmail: "alice@example.com",
      }),
    ).rejects.toThrow("insert failed");
    expect(deleteBlob).toHaveBeenCalledTimes(2);
    const rows = await postgres.query("SELECT id FROM private_icon_assets");
    expect(rows.rows).toEqual([]);
  });
});
