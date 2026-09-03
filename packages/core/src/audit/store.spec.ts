import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuditEvent } from "./types.js";

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

vi.mock("../db/client.js", () => ({
  getDbExec: () => rawClient,
  intType: () => "INTEGER",
  isPostgres: () => false,
  retryOnDdlRace: (fn: () => any) => fn(),
}));

const {
  ensureAuditTables,
  insertAuditEvent,
  queryAuditEvents,
  getAuditEventById,
  deleteOldAuditEvents,
  __resetAuditInitForTests,
} = await import("./store.js");

let seq = 0;
function makeEvent(over: Partial<AuditEvent> = {}): AuditEvent {
  seq += 1;
  return {
    id: over.id ?? `evt-${seq}`,
    createdAt: over.createdAt ?? 1_000 + seq,
    action: over.action ?? "delete-thing",
    caller: over.caller ?? "tool",
    actorKind: over.actorKind ?? "agent",
    actorEmail: over.actorEmail ?? "alice@x.com",
    orgId: over.orgId ?? null,
    threadId: over.threadId ?? null,
    turnId: over.turnId ?? null,
    targetType: over.targetType ?? "thing",
    targetId: over.targetId ?? "t1",
    status: over.status ?? "success",
    summary: over.summary ?? null,
    input: over.input ?? null,
    errorCode: over.errorCode ?? null,
    ownerEmail: over.ownerEmail ?? "alice@x.com",
    visibility: over.visibility ?? "private",
  };
}

beforeEach(async () => {
  sqlite = new Database(":memory:");
  __resetAuditInitForTests();
  await ensureAuditTables();
  seq = 0;
});

afterEach(() => {
  sqlite.close();
  vi.clearAllMocks();
});

describe("audit store scoping", () => {
  it("returns a user only their own rows", async () => {
    await insertAuditEvent(makeEvent({ ownerEmail: "alice@x.com" }));
    await insertAuditEvent(makeEvent({ ownerEmail: "bob@x.com" }));

    const alice = await queryAuditEvents({ userEmail: "alice@x.com" });
    expect(alice).toHaveLength(1);
    expect(alice[0].ownerEmail).toBe("alice@x.com");
  });

  it("returns nothing when there is no identity", async () => {
    await insertAuditEvent(makeEvent());
    const none = await queryAuditEvents({});
    expect(none).toEqual([]);
  });

  it("includes org-visible rows for members of the same org", async () => {
    await insertAuditEvent(
      makeEvent({
        ownerEmail: "bob@x.com",
        orgId: "org-1",
        visibility: "org",
      }),
    );
    // Same org member sees it; outsider does not.
    const member = await queryAuditEvents({
      userEmail: "alice@x.com",
      orgId: "org-1",
    });
    expect(member).toHaveLength(1);

    const outsider = await queryAuditEvents({
      userEmail: "alice@x.com",
      orgId: "org-2",
    });
    expect(outsider).toHaveLength(0);
  });

  it("scopes an owner's own rows to the active org, but keeps legacy/solo rows", async () => {
    await insertAuditEvent(
      makeEvent({ id: "in-a", ownerEmail: "alice@x.com", orgId: "org-A" }),
    );
    await insertAuditEvent(
      makeEvent({ id: "legacy", ownerEmail: "alice@x.com", orgId: null }),
    );

    // While acting in org-B, Alice does NOT see her own org-A row…
    const inB = await queryAuditEvents({
      userEmail: "alice@x.com",
      orgId: "org-B",
    });
    expect(inB.map((r) => r.id)).toEqual(["legacy"]); // …but legacy/no-org rows stay visible

    // In org-A she sees both.
    const inA = await queryAuditEvents({
      userEmail: "alice@x.com",
      orgId: "org-A",
    });
    expect(inA.map((r) => r.id).sort()).toEqual(["in-a", "legacy"]);
  });

  it("does not leak private org-mate rows", async () => {
    await insertAuditEvent(
      makeEvent({ ownerEmail: "bob@x.com", orgId: "org-1" }), // private
    );
    const member = await queryAuditEvents({
      userEmail: "alice@x.com",
      orgId: "org-1",
    });
    expect(member).toHaveLength(0);
  });

  it("scopes getAuditEventById to the caller", async () => {
    await insertAuditEvent(makeEvent({ id: "x1", ownerEmail: "bob@x.com" }));
    const asBob = await getAuditEventById("x1", { userEmail: "bob@x.com" });
    expect(asBob?.id).toBe("x1");
    const asAlice = await getAuditEventById("x1", { userEmail: "alice@x.com" });
    expect(asAlice).toBeNull();
  });
});

describe("audit store filters + ordering", () => {
  it("filters by target, actor kind, status, and turn", async () => {
    await insertAuditEvent(
      makeEvent({
        targetType: "recording",
        targetId: "r1",
        actorKind: "agent",
        status: "success",
        turnId: "turn-9",
      }),
    );
    await insertAuditEvent(
      makeEvent({ targetType: "doc", actorKind: "human", status: "error" }),
    );

    expect(
      await queryAuditEvents(
        { userEmail: "alice@x.com" },
        { targetType: "recording" },
      ),
    ).toHaveLength(1);
    expect(
      await queryAuditEvents(
        { userEmail: "alice@x.com" },
        { actorKind: "human" },
      ),
    ).toHaveLength(1);
    expect(
      await queryAuditEvents({ userEmail: "alice@x.com" }, { status: "error" }),
    ).toHaveLength(1);
    expect(
      await queryAuditEvents(
        { userEmail: "alice@x.com" },
        { turnId: "turn-9" },
      ),
    ).toHaveLength(1);
  });

  it("returns newest first and respects the limit", async () => {
    await insertAuditEvent(makeEvent({ createdAt: 100 }));
    await insertAuditEvent(makeEvent({ createdAt: 300 }));
    await insertAuditEvent(makeEvent({ createdAt: 200 }));

    const rows = await queryAuditEvents({ userEmail: "alice@x.com" });
    expect(rows.map((r) => r.createdAt)).toEqual([300, 200, 100]);

    const limited = await queryAuditEvents(
      { userEmail: "alice@x.com" },
      { limit: 2 },
    );
    expect(limited).toHaveLength(2);
  });

  it("filters by sinceMs", async () => {
    await insertAuditEvent(makeEvent({ createdAt: 100 }));
    await insertAuditEvent(makeEvent({ createdAt: 500 }));
    const recent = await queryAuditEvents(
      { userEmail: "alice@x.com" },
      { sinceMs: 200 },
    );
    expect(recent).toHaveLength(1);
    expect(recent[0].createdAt).toBe(500);
  });
});

describe("input payload projection", () => {
  it("omits the input blob from list results but returns it from get-by-id", async () => {
    await insertAuditEvent(
      makeEvent({ id: "with-input", input: '{"title":"hi"}' }),
    );

    const list = await queryAuditEvents({ userEmail: "alice@x.com" });
    expect(list).toHaveLength(1);
    expect(list[0].input).toBeNull(); // not streamed in bulk

    const detail = await getAuditEventById("with-input", {
      userEmail: "alice@x.com",
    });
    expect(detail?.input).toBe('{"title":"hi"}'); // available on demand
  });
});

describe("audit retention purge", () => {
  it("deletes only rows older than the cutoff", async () => {
    await insertAuditEvent(makeEvent({ createdAt: 100 }));
    await insertAuditEvent(makeEvent({ createdAt: 900 }));
    const deleted = await deleteOldAuditEvents(500);
    expect(deleted).toBe(1);
    const remaining = await queryAuditEvents({ userEmail: "alice@x.com" });
    expect(remaining.map((r) => r.createdAt)).toEqual([900]);
  });
});
