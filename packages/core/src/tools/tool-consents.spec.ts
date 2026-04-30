import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Test helper: build a fake DbExec backed by an in-memory map keyed by
 * (viewer_email, tool_id, content_hash). Just enough surface to exercise
 * hasConsent / grantConsent / revokeConsent / listConsentHashes.
 */
function makeFakeClient() {
  const rows = new Map<string, { granted_at: string }>();
  function key(viewer: string, tool: string, hash: string) {
    return `${viewer}|${tool}|${hash}`;
  }
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  return {
    rows,
    calls,
    client: {
      execute: vi.fn(async (input: string | { sql: string; args: any[] }) => {
        const sql = typeof input === "string" ? input : input.sql;
        const args = typeof input === "string" ? [] : (input.args ?? []);
        calls.push({ sql, args });
        // SELECT
        if (/^SELECT\s+viewer_email/i.test(sql)) {
          const [viewer, tool, hash] = args as string[];
          return {
            rows: rows.has(key(viewer, tool, hash))
              ? [{ viewer_email: viewer }]
              : [],
            rowsAffected: 0,
          };
        }
        if (/^SELECT\s+content_hash/i.test(sql)) {
          const [viewer, tool] = args as string[];
          const hashes: string[] = [];
          for (const k of rows.keys()) {
            const [v, t, h] = k.split("|");
            if (v === viewer && t === tool) hashes.push(h);
          }
          return {
            rows: hashes.map((h) => ({ content_hash: h })),
            rowsAffected: 0,
          };
        }
        // INSERT
        if (/^INSERT\s+INTO\s+tool_consents/i.test(sql)) {
          const [viewer, tool, hash, grantedAt] = args as string[];
          rows.set(key(viewer, tool, hash), { granted_at: grantedAt });
          return { rows: [], rowsAffected: 1 };
        }
        // DELETE
        if (/^DELETE\s+FROM\s+tool_consents/i.test(sql)) {
          const [viewer, tool] = args as string[];
          for (const k of [...rows.keys()]) {
            const [v, t] = k.split("|");
            if (v === viewer && t === tool) rows.delete(k);
          }
          return { rows: [], rowsAffected: 1 };
        }
        // CREATE TABLE / DDL — accept and no-op
        return { rows: [], rowsAffected: 0 };
      }),
    },
  };
}

describe("tools/tool-consents", () => {
  let fake: ReturnType<typeof makeFakeClient>;

  beforeEach(() => {
    fake = makeFakeClient();
    vi.doMock("../db/client.js", () => ({
      getDbExec: () => fake.client,
      getDialect: () => "sqlite",
      isPostgres: () => false,
    }));
    vi.doMock("../db/create-get-db.js", () => ({
      createGetDb: () => () => ({}),
    }));
    vi.doMock("../sharing/registry.js", () => ({
      registerShareableResource: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("computes a stable SHA-256 content hash", async () => {
    const { computeContentHash } = await import("./tool-consents.js");
    const a = computeContentHash("<div>hi</div>");
    const b = computeContentHash("<div>hi</div>");
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    const c = computeContentHash("<div>hi!</div>");
    expect(c).not.toBe(a);
  });

  it("hasConsent returns false until grantConsent has run, then true", async () => {
    const { hasConsent, grantConsent } = await import("./tool-consents.js");
    expect(await hasConsent("viewer@x", "tool-1", "hash-a")).toBe(false);
    await grantConsent("viewer@x", "tool-1", "hash-a");
    expect(await hasConsent("viewer@x", "tool-1", "hash-a")).toBe(true);
  });

  it("hasConsent is scoped per content_hash — author edits force re-prompt", async () => {
    const { hasConsent, grantConsent } = await import("./tool-consents.js");
    await grantConsent("viewer@x", "tool-1", "hash-a");
    expect(await hasConsent("viewer@x", "tool-1", "hash-a")).toBe(true);
    expect(await hasConsent("viewer@x", "tool-1", "hash-b")).toBe(false);
  });

  it("hasConsent is scoped per viewer_email — one user's grant doesn't trust another", async () => {
    const { hasConsent, grantConsent } = await import("./tool-consents.js");
    await grantConsent("viewer-a@x", "tool-1", "hash-a");
    expect(await hasConsent("viewer-a@x", "tool-1", "hash-a")).toBe(true);
    expect(await hasConsent("viewer-b@x", "tool-1", "hash-a")).toBe(false);
  });

  it("revokeConsent clears every hash for a (viewer, tool) pair", async () => {
    const { hasConsent, grantConsent, revokeConsent } = await import(
      "./tool-consents.js"
    );
    await grantConsent("viewer@x", "tool-1", "hash-a");
    await grantConsent("viewer@x", "tool-1", "hash-b");
    expect(await hasConsent("viewer@x", "tool-1", "hash-a")).toBe(true);
    expect(await hasConsent("viewer@x", "tool-1", "hash-b")).toBe(true);
    await revokeConsent("viewer@x", "tool-1");
    expect(await hasConsent("viewer@x", "tool-1", "hash-a")).toBe(false);
    expect(await hasConsent("viewer@x", "tool-1", "hash-b")).toBe(false);
  });

  it("revokeConsent does not cross-delete other viewers' grants on the same tool", async () => {
    const { hasConsent, grantConsent, revokeConsent } = await import(
      "./tool-consents.js"
    );
    await grantConsent("viewer-a@x", "tool-1", "hash-a");
    await grantConsent("viewer-b@x", "tool-1", "hash-a");
    await revokeConsent("viewer-a@x", "tool-1");
    expect(await hasConsent("viewer-a@x", "tool-1", "hash-a")).toBe(false);
    expect(await hasConsent("viewer-b@x", "tool-1", "hash-a")).toBe(true);
  });

  it("listConsentHashes returns granted hashes for a viewer × tool pair", async () => {
    const { listConsentHashes, grantConsent } = await import(
      "./tool-consents.js"
    );
    await grantConsent("viewer@x", "tool-1", "hash-a");
    await grantConsent("viewer@x", "tool-1", "hash-b");
    const hashes = await listConsentHashes("viewer@x", "tool-1");
    expect(hashes).toContain("hash-a");
    expect(hashes).toContain("hash-b");
    expect(hashes).toHaveLength(2);
  });
});
