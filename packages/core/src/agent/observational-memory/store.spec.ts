import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let sqlite: Database.Database;

const rawClient = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    if (typeof input === "string") {
      sqlite.exec(input);
      return { rows: [], rowsAffected: 0 };
    }
    const stmt = sqlite.prepare(input.sql);
    const args = (input.args ?? []) as unknown[];
    if (/^\s*select/i.test(input.sql)) {
      return { rows: stmt.all(...args), rowsAffected: 0 };
    }
    const info = stmt.run(...args);
    return { rows: [], rowsAffected: info.changes };
  }),
};

vi.mock("../../db/client.js", () => ({
  getDbExec: () => rawClient,
  isPostgres: () => false,
}));

const {
  insertObservationalMemory,
  listObservationalMemory,
  getObservedThroughIndex,
  getObservationLogTokens,
  __resetObservationalMemoryTableCache,
} = await import("./store.js");

beforeEach(() => {
  sqlite = new Database(":memory:");
  __resetObservationalMemoryTableCache();
});

afterEach(() => {
  sqlite.close();
  vi.clearAllMocks();
});

describe("observational-memory store", () => {
  it("creates the table lazily and round-trips an observation entry", async () => {
    const entry = await insertObservationalMemory({
      threadId: "t1",
      tier: "observation",
      text: "2026-06-17 decided X; blocked on Y",
      tokenEstimate: 42,
      sourceStartIndex: 0,
      sourceEndIndex: 9,
      sourceMessageCount: 10,
      ownerEmail: "alice@example.com",
    });

    expect(entry.id).toMatch(/^om-/);
    expect(entry.tier).toBe("observation");

    const rows = await listObservationalMemory({
      threadId: "t1",
      ownerEmail: "alice@example.com",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe("2026-06-17 decided X; blocked on Y");
    expect(rows[0].tokenEstimate).toBe(42);
    expect(rows[0].sourceStartIndex).toBe(0);
    expect(rows[0].sourceEndIndex).toBe(9);
    expect(rows[0].sourceMessageCount).toBe(10);
  });

  it("filters by tier", async () => {
    await insertObservationalMemory({
      threadId: "t1",
      tier: "observation",
      text: "obs",
      tokenEstimate: 10,
      ownerEmail: "alice@example.com",
    });
    await insertObservationalMemory({
      threadId: "t1",
      tier: "reflection",
      text: "refl",
      tokenEstimate: 5,
      ownerEmail: "alice@example.com",
    });

    const obs = await listObservationalMemory({
      threadId: "t1",
      ownerEmail: "alice@example.com",
      tier: "observation",
    });
    const refl = await listObservationalMemory({
      threadId: "t1",
      ownerEmail: "alice@example.com",
      tier: "reflection",
    });
    expect(obs.map((e) => e.text)).toEqual(["obs"]);
    expect(refl.map((e) => e.text)).toEqual(["refl"]);
  });

  it("scopes reads by owner so entries never leak across owners", async () => {
    await insertObservationalMemory({
      threadId: "t1",
      tier: "observation",
      text: "alice secret",
      tokenEstimate: 10,
      ownerEmail: "alice@example.com",
    });
    await insertObservationalMemory({
      threadId: "t1",
      tier: "observation",
      text: "bob secret",
      tokenEstimate: 10,
      ownerEmail: "bob@example.com",
    });

    const aliceRows = await listObservationalMemory({
      threadId: "t1",
      ownerEmail: "alice@example.com",
    });
    const bobRows = await listObservationalMemory({
      threadId: "t1",
      ownerEmail: "bob@example.com",
    });

    expect(aliceRows.map((e) => e.text)).toEqual(["alice secret"]);
    expect(bobRows.map((e) => e.text)).toEqual(["bob secret"]);
  });

  it("scopes reads by org as well as owner", async () => {
    await insertObservationalMemory({
      threadId: "t1",
      tier: "observation",
      text: "alice org a",
      tokenEstimate: 10,
      sourceEndIndex: 10,
      ownerEmail: "alice@example.com",
      orgId: "org-a",
    });
    await insertObservationalMemory({
      threadId: "t1",
      tier: "observation",
      text: "alice org b",
      tokenEstimate: 20,
      sourceEndIndex: 20,
      ownerEmail: "alice@example.com",
      orgId: "org-b",
    });
    await insertObservationalMemory({
      threadId: "t1",
      tier: "observation",
      text: "alice personal",
      tokenEstimate: 30,
      sourceEndIndex: 30,
      ownerEmail: "alice@example.com",
    });

    const orgARows = await listObservationalMemory({
      threadId: "t1",
      ownerEmail: "alice@example.com",
      orgId: "org-a",
    });
    const orgBRows = await listObservationalMemory({
      threadId: "t1",
      ownerEmail: "alice@example.com",
      orgId: "org-b",
    });
    const personalRows = await listObservationalMemory({
      threadId: "t1",
      ownerEmail: "alice@example.com",
    });

    expect(orgARows.map((e) => e.text)).toEqual(["alice org a"]);
    expect(orgBRows.map((e) => e.text)).toEqual(["alice org b"]);
    expect(personalRows.map((e) => e.text)).toEqual(["alice personal"]);
    expect(
      await getObservedThroughIndex({
        threadId: "t1",
        ownerEmail: "alice@example.com",
        orgId: "org-a",
      }),
    ).toBe(10);
    expect(
      await getObservationLogTokens({
        threadId: "t1",
        ownerEmail: "alice@example.com",
        orgId: "org-a",
      }),
    ).toBe(10);
  });

  it("reports the observed-through index and observation log token total per owner", async () => {
    expect(
      await getObservedThroughIndex({
        threadId: "t1",
        ownerEmail: "alice@example.com",
      }),
    ).toBe(-1);

    await insertObservationalMemory({
      threadId: "t1",
      tier: "observation",
      text: "obs-1",
      tokenEstimate: 100,
      sourceStartIndex: 0,
      sourceEndIndex: 9,
      ownerEmail: "alice@example.com",
    });
    await insertObservationalMemory({
      threadId: "t1",
      tier: "observation",
      text: "obs-2",
      tokenEstimate: 200,
      sourceStartIndex: 10,
      sourceEndIndex: 19,
      ownerEmail: "alice@example.com",
    });
    // A different owner's larger range must NOT bleed into alice's accounting.
    await insertObservationalMemory({
      threadId: "t1",
      tier: "observation",
      text: "bob obs",
      tokenEstimate: 999,
      sourceStartIndex: 0,
      sourceEndIndex: 999,
      ownerEmail: "bob@example.com",
    });

    expect(
      await getObservedThroughIndex({
        threadId: "t1",
        ownerEmail: "alice@example.com",
      }),
    ).toBe(19);
    expect(
      await getObservationLogTokens({
        threadId: "t1",
        ownerEmail: "alice@example.com",
      }),
    ).toBe(300);
  });
});
