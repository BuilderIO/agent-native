import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";
import type { AuditEvent } from "./types.js";

let pglite: Awaited<ReturnType<typeof createTestPglite>>;

const rawClient = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    if (typeof input === "string") {
      await pglite.exec(input);
      return { rows: [], rowsAffected: 0 };
    }
    const stmt = await pglite.prepare(input.sql);
    const args = (input.args ?? []) as unknown[];
    if (/^\s*select/i.test(input.sql)) {
      return { rows: await stmt.all(...args), rowsAffected: 0 };
    }
    const info = await stmt.run(...args);
    return { rows: [], rowsAffected: info.changes };
  }),
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => rawClient,
  isProductionServerlessFunctionRuntime: () => false,
  retryOnDdlRace: (fn: () => any) => fn(),
}));

const {
  ensureAuditTables,
  insertAuditEvent,
  queryAuditEvents,
  queryAuditEventPage,
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
  pglite = await createTestPglite();
  __resetAuditInitForTests();
  await ensureAuditTables();
  seq = 0;
});

afterEach(async () => {
  await pglite.close();
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

describe("organization admin trail", () => {
  async function seedOrgTrail() {
    await insertAuditEvent(
      makeEvent({
        id: "admin-change",
        ownerEmail: "admin@x.com",
        orgId: "org-1",
        visibility: "admins",
      }),
    );
    await insertAuditEvent(
      makeEvent({
        id: "member-refused",
        ownerEmail: "member@x.com",
        orgId: "org-1",
        visibility: "admins",
        status: "denied",
      }),
    );
    await insertAuditEvent(
      makeEvent({
        id: "shared",
        ownerEmail: "member@x.com",
        orgId: "org-1",
        visibility: "org",
      }),
    );
    await insertAuditEvent(
      makeEvent({ id: "personal", ownerEmail: "member@x.com", orgId: "org-1" }),
    );
    await insertAuditEvent(
      makeEvent({
        id: "other-org",
        ownerEmail: "someone@y.com",
        orgId: "org-2",
        visibility: "admins",
      }),
    );
  }

  it("shows admins-visible rows to owners and admins, never private ones", async () => {
    await seedOrgTrail();
    const admin = await queryAuditEvents({
      userEmail: "admin@x.com",
      orgId: "org-1",
      orgAdmin: true,
    });
    expect(admin.map((r) => r.id).sort()).toEqual([
      "admin-change",
      "member-refused",
      "shared",
    ]);
  });

  it("shows a member their own admins-visible rows and nobody else's", async () => {
    await seedOrgTrail();
    const member = await queryAuditEvents({
      userEmail: "member@x.com",
      orgId: "org-1",
    });
    expect(member.map((r) => r.id).sort()).toEqual([
      "member-refused",
      "personal",
      "shared",
    ]);
    expect(
      await getAuditEventById("admin-change", {
        userEmail: "member@x.com",
        orgId: "org-1",
      }),
    ).toBeNull();
    expect(
      (
        await getAuditEventById("member-refused", {
          userEmail: "admin@x.com",
          orgId: "org-1",
          orgAdmin: true,
        })
      )?.id,
    ).toBe("member-refused");
  });

  it("reads only the org's shared trail with trail 'organization'", async () => {
    await seedOrgTrail();
    await insertAuditEvent(
      makeEvent({ id: "admin-personal", ownerEmail: "admin@x.com" }),
    );
    const trail = await queryAuditEvents({
      userEmail: "admin@x.com",
      orgId: "org-1",
      orgAdmin: true,
      trail: "organization",
    });
    expect(trail.map((r) => r.id).sort()).toEqual([
      "admin-change",
      "member-refused",
      "shared",
    ]);
    expect(
      await queryAuditEvents({
        userEmail: "admin@x.com",
        orgId: null,
        orgAdmin: true,
        trail: "organization",
      }),
    ).toEqual([]);
  });
});

describe("app, date range, and paging", () => {
  it("stores the app and filters by it", async () => {
    await insertAuditEvent({ ...makeEvent({ id: "m" }), app: "mail" });
    await insertAuditEvent({ ...makeEvent({ id: "c" }), app: "clips" });
    await insertAuditEvent(makeEvent({ id: "legacy" }));

    const mail = await queryAuditEvents(
      { userEmail: "alice@x.com" },
      { app: "mail" },
    );
    expect(mail.map((r) => [r.id, r.app])).toEqual([["m", "mail"]]);
    const all = await queryAuditEvents({ userEmail: "alice@x.com" });
    expect(all.find((r) => r.id === "legacy")?.app).toBeNull();
  });

  it("bounds the range with sinceMs (inclusive) and beforeMs (exclusive)", async () => {
    for (const createdAt of [100, 200, 300, 400]) {
      await insertAuditEvent(makeEvent({ createdAt }));
    }
    const window = await queryAuditEvents(
      { userEmail: "alice@x.com" },
      { sinceMs: 200, beforeMs: 400 },
    );
    expect(window.map((r) => r.createdAt)).toEqual([300, 200]);
  });

  it("pages with offset and reports whether more rows exist", async () => {
    for (const createdAt of [100, 200, 300, 400, 500]) {
      await insertAuditEvent(makeEvent({ createdAt }));
    }
    const first = await queryAuditEventPage(
      { userEmail: "alice@x.com" },
      { limit: 2 },
    );
    expect(first.events.map((r) => r.createdAt)).toEqual([500, 400]);
    expect(first).toMatchObject({ hasMore: true, nextOffset: 2 });

    const last = await queryAuditEventPage(
      { userEmail: "alice@x.com" },
      { limit: 2, offset: 4 },
    );
    expect(last.events.map((r) => r.createdAt)).toEqual([100]);
    expect(last).toMatchObject({ hasMore: false, nextOffset: null });
  });

  it("keeps offset pages stable when rows share a timestamp", async () => {
    for (const id of ["a", "b", "c", "d"]) {
      await insertAuditEvent(makeEvent({ id, createdAt: 100 }));
    }
    const seen: string[] = [];
    let offset: number | null = 0;
    while (offset !== null) {
      const page = await queryAuditEventPage(
        { userEmail: "alice@x.com" },
        { limit: 3, offset },
      );
      seen.push(...page.events.map((r) => r.id));
      offset = page.nextOffset;
    }
    expect(seen).toEqual(["d", "c", "b", "a"]);
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
