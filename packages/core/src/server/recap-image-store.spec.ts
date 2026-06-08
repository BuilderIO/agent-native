import { describe, it, expect, beforeEach, vi } from "vitest";

// Minimal in-memory stand-in for the framework DB exec client. Stores rows in
// a Map keyed by token so the store's save → token → get round-trip can be
// exercised without a real database, mirroring the observability store spec
// pattern (mock `../db/client.js`).
const rows = new Map<string, Record<string, unknown>>();

function createMemoryDb() {
  return {
    execute: vi.fn(async (sql: string | { sql: string; args?: any[] }) => {
      const rawSql = typeof sql === "string" ? sql : sql.sql;
      const args = typeof sql === "string" ? [] : (sql.args ?? []);
      if (/^\s*INSERT\s+INTO\s+recap_images/i.test(rawSql)) {
        const [
          token,
          png_base64,
          content_type,
          byte_length,
          owner_email,
          created_at,
        ] = args;
        rows.set(String(token), {
          token,
          png_base64,
          content_type,
          byte_length,
          owner_email,
          created_at,
        });
        return { rows: [], rowsAffected: 1 };
      }
      if (/^\s*SELECT\b/i.test(rawSql)) {
        const token = String(args[0]);
        const row = rows.get(token);
        return { rows: row ? [row] : [], rowsAffected: 0 };
      }
      if (/^\s*DELETE\s+FROM\s+recap_images/i.test(rawSql)) {
        const cutoff = Number(args[0]);
        let removed = 0;
        for (const [key, row] of rows) {
          if (Number(row.created_at) < cutoff) {
            rows.delete(key);
            removed += 1;
          }
        }
        return { rows: [], rowsAffected: removed };
      }
      // CREATE TABLE and anything else just succeeds.
      return { rows: [], rowsAffected: 0 };
    }),
  };
}

const mockDb = createMemoryDb();

vi.mock("../db/client.js", () => ({
  getDbExec: () => mockDb,
  isPostgres: () => false,
  intType: () => "INTEGER",
  retryOnDdlRace: <T>(fn: () => Promise<T>) => fn(),
}));

const {
  saveRecapImage,
  getRecapImage,
  isValidRecapImageToken,
  generateRecapImageToken,
  RECAP_IMAGE_MAX_BYTES,
  RECAP_IMAGE_CONTENT_TYPE,
  RECAP_IMAGE_TTL_MS,
  pruneExpiredRecapImages,
} = await import("./recap-image-store.js");

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02, 0x03, 0x04,
]);

beforeEach(() => {
  rows.clear();
});

describe("recap-image store", () => {
  it("round-trips PNG bytes through a minted token", async () => {
    const { token } = await saveRecapImage(PNG, {
      ownerEmail: "u@example.com",
    });
    expect(isValidRecapImageToken(token)).toBe(true);

    const loaded = await getRecapImage(token);
    expect(loaded).not.toBeNull();
    expect(loaded!.contentType).toBe(RECAP_IMAGE_CONTENT_TYPE);
    expect(Buffer.from(loaded!.bytes).equals(PNG)).toBe(true);
  });

  it("mints long, unguessable, distinct hex tokens", () => {
    const a = generateRecapImageToken();
    const b = generateRecapImageToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns null for unknown tokens", async () => {
    expect(await getRecapImage("a".repeat(64))).toBeNull();
  });

  it("rejects malformed / traversal tokens without querying", async () => {
    for (const bad of [
      "",
      "../../etc/passwd",
      "abc.png",
      "ABC123", // uppercase not allowed
      "z".repeat(64), // non-hex
      "a".repeat(16), // too short
      "a/b",
    ]) {
      expect(isValidRecapImageToken(bad)).toBe(false);
      expect(await getRecapImage(bad)).toBeNull();
    }
  });

  it("enforces the size cap on write", async () => {
    const tooBig = Buffer.alloc(RECAP_IMAGE_MAX_BYTES + 1, 1);
    await expect(saveRecapImage(tooBig)).rejects.toThrow(/maximum size/i);
  });

  it("prunes images older than the TTL on the next write", async () => {
    // A leftover image from a previous PR cycle, past the retention window.
    rows.set("staleimagetoken", {
      token: "staleimagetoken",
      png_base64: PNG.toString("base64"),
      content_type: RECAP_IMAGE_CONTENT_TYPE,
      byte_length: PNG.byteLength,
      owner_email: null,
      created_at: Date.now() - RECAP_IMAGE_TTL_MS - 60_000,
    });

    const { token } = await saveRecapImage(PNG);

    expect(rows.has("staleimagetoken")).toBe(false); // expired → pruned
    expect(rows.has(token)).toBe(true); // fresh upload kept
  });

  it("pruneExpiredRecapImages removes only rows past the TTL", async () => {
    const now = Date.now();
    rows.set("fresh", { token: "fresh", created_at: now - 1000 });
    rows.set("expired", {
      token: "expired",
      created_at: now - RECAP_IMAGE_TTL_MS - 1000,
    });

    const removed = await pruneExpiredRecapImages(now);

    expect(removed).toBe(1);
    expect(rows.has("fresh")).toBe(true);
    expect(rows.has("expired")).toBe(false);
  });
});
