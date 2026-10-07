import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../../a2a/test-pglite.js";
import type { AuditEvent } from "../types.js";

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

vi.mock("../../db/client.js", () => ({
  getDbExec: () => rawClient,
  isProductionServerlessFunctionRuntime: () => false,
  retryOnDdlRace: (fn: () => any) => fn(),
}));

const { insertAuditEvent, __resetAuditInitForTests } =
  await import("../store.js");
const exportAuditOcsf = (await import("./export-audit-ocsf.js")).default;

const ORG = "org-a";
const admin = { userEmail: "admin@example.test", orgId: ORG };

async function addMember(email: string, role: string, orgId = ORG) {
  await pglite.query(
    `INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES (?, ?, ?, ?, ?)`,
    [`${orgId}:${email}`, orgId, email, role, Date.now()],
  );
}

let seq = 0;
function makeEvent(over: Partial<AuditEvent> = {}): AuditEvent {
  seq += 1;
  return {
    id: over.id ?? `evt-${String(seq).padStart(3, "0")}`,
    createdAt: over.createdAt ?? 1_000 + seq,
    action: over.action ?? "set-thing",
    caller: over.caller ?? "http",
    actorKind: over.actorKind ?? "human",
    actorEmail: over.actorEmail ?? "admin@example.test",
    orgId: over.orgId === undefined ? ORG : over.orgId,
    threadId: over.threadId ?? null,
    turnId: over.turnId ?? null,
    targetType: over.targetType ?? "thing",
    targetId: over.targetId ?? "t1",
    status: over.status ?? "success",
    summary: over.summary ?? null,
    input: over.input ?? null,
    errorCode: over.errorCode ?? null,
    ownerEmail: over.ownerEmail ?? "admin@example.test",
    visibility: over.visibility ?? "admins",
    ...(over.runId ? { runId: over.runId } : {}),
  };
}

beforeEach(async () => {
  pglite = await createTestPglite();
  __resetAuditInitForTests();
  seq = 0;
  await pglite.exec(`CREATE TABLE org_members (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL,
    joined_at BIGINT NOT NULL,
    federation_removal_pending_at BIGINT
  )`);
  await addMember("admin@example.test", "admin");
  await addMember("member@example.test", "member");
});

afterEach(async () => {
  await pglite.close();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("export-audit-ocsf", () => {
  it("refuses members and callers with no organization", async () => {
    await expect(
      exportAuditOcsf.run({}, { userEmail: "member@example.test", orgId: ORG }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      exportAuditOcsf.run({}, { userEmail: "admin@example.test" }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("exports the org's admins and org events, not private or other orgs", async () => {
    await insertAuditEvent(makeEvent({ id: "admins", visibility: "admins" }));
    await insertAuditEvent(makeEvent({ id: "org", visibility: "org" }));
    await insertAuditEvent(makeEvent({ id: "private", visibility: "private" }));
    await insertAuditEvent(
      makeEvent({ id: "other-org", orgId: "org-b", visibility: "admins" }),
    );

    const result = await exportAuditOcsf.run({}, admin);

    expect(result.events.map((e) => e.metadata.uid)).toEqual(["admins", "org"]);
    expect(result.events[0]).toMatchObject({
      class_uid: 6003,
      metadata: { tenant_uid: ORG },
    });
    expect(result.hasMore).toBe(false);
  });

  it("includes lineage recorded on the row", async () => {
    await insertAuditEvent({
      ...makeEvent({ id: "lineage" }),
      runId: "run-1",
      taskId: "task-2",
      parentTaskId: "task-1",
    });
    const result = await exportAuditOcsf.run({}, admin);
    expect(result.events[0].unmapped).toMatchObject({
      run_id: "run-1",
      task_id: "task-2",
      parent_task_id: "task-1",
    });
  });

  it("pages oldest first with a cursor that skips nothing and repeats nothing", async () => {
    // Same timestamp on three rows: the cursor must tie-break on id.
    await insertAuditEvent(makeEvent({ id: "a", createdAt: 100 }));
    await insertAuditEvent(makeEvent({ id: "b", createdAt: 100 }));
    await insertAuditEvent(makeEvent({ id: "c", createdAt: 100 }));
    await insertAuditEvent(makeEvent({ id: "d", createdAt: 200 }));
    await insertAuditEvent(makeEvent({ id: "e", createdAt: 300 }));

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 5; i++) {
      const page = await exportAuditOcsf.run({ limit: 2, cursor }, admin);
      seen.push(...page.events.map((e) => e.metadata.uid));
      if (!page.hasMore) break;
      cursor = page.nextCursor ?? undefined;
    }
    expect(seen).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("replays the overlap while idle and picks up later events", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    await insertAuditEvent(makeEvent({ id: "first", createdAt: 900_000 }));
    const first = await exportAuditOcsf.run({}, admin);
    const idle = await exportAuditOcsf.run(
      { cursor: first.nextCursor ?? undefined },
      admin,
    );
    expect(idle.events.map((event) => event.metadata.uid)).toEqual(["first"]);
    expect(idle.nextCursor).toBe(first.nextCursor);

    now += 10_000;
    await insertAuditEvent(makeEvent({ id: "second", createdAt: now - 6_000 }));
    const next = await exportAuditOcsf.run(
      { cursor: idle.nextCursor ?? undefined },
      admin,
    );
    expect(next.events.map((e) => e.metadata.uid)).toEqual(["first", "second"]);
  });

  it("catches a late committed row inside the overlap and uses stable UIDs for dedupe", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    await insertAuditEvent(makeEvent({ id: "existing", createdAt: 900_000 }));
    const first = await exportAuditOcsf.run({}, admin);

    now += 10_000;
    await insertAuditEvent(makeEvent({ id: "late", createdAt: 900_001 }));
    const next = await exportAuditOcsf.run(
      { cursor: first.nextCursor ?? undefined },
      admin,
    );

    expect(next.events.map((event) => event.metadata.uid)).toEqual([
      "existing",
      "late",
    ]);
    expect([
      ...new Set(
        [...first.events, ...next.events].map((event) => event.metadata.uid),
      ),
    ]).toEqual(["existing", "late"]);
  });

  it("continues a cursor issued before overlap-aware cursor pagination", async () => {
    await insertAuditEvent(makeEvent({ id: "first", createdAt: 100 }));
    await insertAuditEvent(makeEvent({ id: "second", createdAt: 200 }));
    const legacyCursor = Buffer.from(JSON.stringify([100, "first"])).toString(
      "base64url",
    );

    const result = await exportAuditOcsf.run({ cursor: legacyCursor }, admin);

    expect(result.events.map((event) => event.metadata.uid)).toEqual([
      "second",
    ]);
  });

  it("filters by since and until as ISO strings or epoch ms", async () => {
    await insertAuditEvent(makeEvent({ id: "old", createdAt: 1000 }));
    await insertAuditEvent(
      makeEvent({ id: "mid", createdAt: Date.parse("2025-06-01T00:00:00Z") }),
    );
    await insertAuditEvent(
      makeEvent({ id: "new", createdAt: Date.parse("2025-07-01T00:00:00Z") }),
    );

    const window = await exportAuditOcsf.run(
      { since: "2025-01-01T00:00:00Z", until: "2025-06-15T00:00:00Z" },
      admin,
    );
    expect(window.events.map((e) => e.metadata.uid)).toEqual(["mid"]);

    const fromMs = await exportAuditOcsf.run(
      { since: String(Date.parse("2025-06-15T00:00:00Z")) },
      admin,
    );
    expect(fromMs.events.map((e) => e.metadata.uid)).toEqual(["new"]);
  });

  it("holds back events newer than the settle window", async () => {
    await insertAuditEvent(makeEvent({ id: "settled", createdAt: 1000 }));
    await insertAuditEvent(makeEvent({ id: "fresh", createdAt: Date.now() }));
    const result = await exportAuditOcsf.run({}, admin);
    expect(result.events.map((e) => e.metadata.uid)).toEqual(["settled"]);
  });

  it("rejects an unparseable time or a foreign cursor with a 400", async () => {
    await expect(
      exportAuditOcsf.run({ since: "yesterday-ish" }, admin),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      exportAuditOcsf.run({ cursor: "not-a-cursor" }, admin),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
