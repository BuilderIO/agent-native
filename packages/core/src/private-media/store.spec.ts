import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import type { PrivateBlobHandle } from "../private-blob/types.js";

const putBlob = vi.hoisted(() => vi.fn());
const readBlob = vi.hoisted(() => vi.fn());
const deleteBlob = vi.hoisted(() => vi.fn());
const readUrl = vi.hoisted(() => vi.fn());
let db: ReturnType<typeof drizzle>;
let postgres: Awaited<ReturnType<typeof createTestPglite>>;

vi.mock("../db/create-get-db.js", () => ({ createGetDb: () => () => db }));
vi.mock("../db/ddl-guard.js", () => ({
  ensureTableExists: async (_name: string, sql: string) => {
    await postgres.exec(sql);
  },
  ensureIndexExists: async (_name: string, sql: string) => {
    await postgres.exec(sql);
  },
}));
vi.mock("../db/store-registry.js", () => ({
  defineStore: (definition: {
    migrations: Array<{ run: () => Promise<void> }>;
  }) => ({
    ready: async () => {
      for (const migration of definition.migrations) await migration.run();
    },
  }),
}));
vi.mock("../private-blob/index.js", () => ({
  putPrivateBlob: putBlob,
  readPrivateBlob: readBlob,
  deletePrivateBlob: deleteBlob,
  getPrivateBlobReadUrl: readUrl,
}));

const encode = (text: string) => new TextEncoder().encode(text);
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const svg = encode(
  '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>',
);
const handle: PrivateBlobHandle = {
  id: "test-handle",
  provider: "test",
  opaque: true,
  encrypted: true,
};

beforeEach(async () => {
  postgres = await createTestPglite();
  db = drizzle(postgres.db);
  putBlob.mockReset().mockResolvedValue(handle);
  readBlob.mockReset().mockImplementation(async () => ({ data: png, handle }));
  deleteBlob.mockReset().mockResolvedValue({ deleted: true, provider: "test" });
  readUrl.mockReset().mockResolvedValue(null);
});

afterEach(async () => {
  await postgres.close();
});

describe("validatePrivateMediaImage", () => {
  it("accepts images whose bytes match their type", async () => {
    const { validatePrivateMediaImage } = await import("./store.js");
    expect(validatePrivateMediaImage(png, "image/png")).toBe("image/png");
    expect(validatePrivateMediaImage(png, "IMAGE/PNG; charset=binary")).toBe(
      "image/png",
    );
    expect(validatePrivateMediaImage(svg, "image/svg+xml")).toBe(
      "image/svg+xml",
    );
    expect(
      validatePrivateMediaImage(
        new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
        "image/jpeg",
      ),
    ).toBe("image/jpeg");
  });

  it("refuses other types, empty or oversized files, and mismatched bytes", async () => {
    const {
      MAX_PRIVATE_MEDIA_BYTES,
      PrivateMediaValidationError,
      validatePrivateMediaImage,
    } = await import("./store.js");
    const status = (data: Uint8Array, type: string) => {
      try {
        validatePrivateMediaImage(data, type);
      } catch (error) {
        expect(error).toBeInstanceOf(PrivateMediaValidationError);
        return (error as InstanceType<typeof PrivateMediaValidationError>)
          .statusCode;
      }
      return null;
    };
    expect(status(png, "text/html")).toBe(415);
    expect(status(png, "image/bmp")).toBe(415);
    expect(status(new Uint8Array(), "image/png")).toBe(400);
    const large = new Uint8Array(MAX_PRIVATE_MEDIA_BYTES + 1);
    large.set(png);
    expect(status(large, "image/png")).toBe(413);
    expect(status(png, "image/gif")).toBe(415);
    expect(status(encode("<html></html>"), "image/svg+xml")).toBe(415);
    expect(status(encode("<svg><g></svg>"), "image/svg+xml")).toBe(415);
    expect(status(encode("<svg></svg><svg></svg>"), "image/svg+xml")).toBe(415);
  });
});

describe("private media store", () => {
  it("stores the blob handle and metadata, owned by the normalized email", async () => {
    const { getPrivateMedia, ownsPrivateMedia, putPrivateMedia } =
      await import("./store.js");
    const media = await putPrivateMedia({
      ownerEmail: " Alice@Example.com ",
      orgId: "org-1",
      data: png,
      mimeType: "image/png",
      filename: "screenshot.png",
    });
    expect(media).toMatchObject({
      ownerEmail: "alice@example.com",
      orgId: "org-1",
      mimeType: "image/png",
      filename: "screenshot.png",
      size: png.byteLength,
    });
    expect(media.id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(putBlob).toHaveBeenCalledWith(
      expect.objectContaining({
        data: png,
        mimeType: "image/png",
        ownerEmail: "alice@example.com",
        filename: `media-${media.id}`,
      }),
    );
    const stored = await postgres.query(
      "SELECT blob_handle_json, sha256 FROM private_media",
    );
    const row = stored.rows[0] as { blob_handle_json: string; sha256: string };
    expect(JSON.parse(row.blob_handle_json)).toEqual(handle);
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/u);

    expect(await getPrivateMedia(media.id)).toEqual(media);
    expect(await ownsPrivateMedia(media.id, "ALICE@example.com")).toBe(true);
    expect(await ownsPrivateMedia(media.id, "bob@example.com")).toBe(false);
    expect(await ownsPrivateMedia(media.id, null)).toBe(false);
    expect(await ownsPrivateMedia("not-an-id", "alice@example.com")).toBe(
      false,
    );
  });

  it("refuses the upload and stores nothing when no private storage is connected", async () => {
    const { PrivateMediaStorageUnavailableError, putPrivateMedia } =
      await import("./store.js");
    putBlob.mockResolvedValueOnce(null);
    await expect(
      putPrivateMedia({
        ownerEmail: "alice@example.com",
        data: png,
        mimeType: "image/png",
      }),
    ).rejects.toBeInstanceOf(PrivateMediaStorageUnavailableError);
    const stored = await postgres.query("SELECT id FROM private_media");
    expect(stored.rows).toEqual([]);
  });

  it("validates before touching storage", async () => {
    const { PrivateMediaValidationError, putPrivateMedia } =
      await import("./store.js");
    await expect(
      putPrivateMedia({
        ownerEmail: "alice@example.com",
        data: png,
        mimeType: "image/svg+xml",
      }),
    ).rejects.toBeInstanceOf(PrivateMediaValidationError);
    expect(putBlob).not.toHaveBeenCalled();
  });
});

describe("openPrivateMediaForAuthorizedReader", () => {
  it("redirects to a short-lived link when storage offers one", async () => {
    const { openPrivateMediaForAuthorizedReader, putPrivateMedia } =
      await import("./store.js");
    const media = await putPrivateMedia({
      ownerEmail: "alice@example.com",
      data: png,
      mimeType: "image/png",
    });
    readUrl.mockResolvedValueOnce({ url: "https://storage.test/signed" });
    const opened = await openPrivateMediaForAuthorizedReader(media.id, {
      redirectSeconds: 60,
    });
    expect(opened).toEqual({
      kind: "redirect",
      media,
      url: "https://storage.test/signed",
    });
    expect(readUrl).toHaveBeenCalledWith(handle, {
      expiresInSeconds: 60,
      contentType: "image/png",
    });
    expect(readBlob).not.toHaveBeenCalled();
  });

  it("returns verified bytes when storage has no direct links", async () => {
    const { openPrivateMediaForAuthorizedReader, putPrivateMedia } =
      await import("./store.js");
    const media = await putPrivateMedia({
      ownerEmail: "alice@example.com",
      data: png,
      mimeType: "image/png",
    });
    expect(await openPrivateMediaForAuthorizedReader(media.id)).toEqual({
      kind: "bytes",
      media,
      data: png,
    });

    readBlob.mockResolvedValueOnce({
      data: new Uint8Array([...png.slice(0, -1), 9]),
      handle,
    });
    await expect(openPrivateMediaForAuthorizedReader(media.id)).rejects.toThrow(
      "integrity",
    );
  });

  it("returns null for unknown or malformed IDs", async () => {
    const { openPrivateMediaForAuthorizedReader } = await import("./store.js");
    expect(
      await openPrivateMediaForAuthorizedReader(
        "00000000-0000-4000-8000-000000000000",
      ),
    ).toBeNull();
    expect(await openPrivateMediaForAuthorizedReader("../etc")).toBeNull();
    expect(readUrl).not.toHaveBeenCalled();
  });
});
