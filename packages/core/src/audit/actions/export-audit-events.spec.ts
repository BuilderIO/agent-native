import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuditEvent } from "../types.js";

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
  intType: () => "INTEGER",
  isPostgres: () => false,
  retryOnDdlRace: (fn: () => any) => fn(),
}));

const { insertAuditEvent, __resetAuditInitForTests } =
  await import("../store.js");
const exportAuditEvents = (await import("./export-audit-events.js")).default;

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
  seq = 0;
});

afterEach(() => {
  sqlite.close();
  vi.clearAllMocks();
});

describe("export-audit-events", () => {
  it("exports CSV with a header row and escapes special characters", async () => {
    await insertAuditEvent(
      makeEvent({
        id: "e1",
        createdAt: 100,
        summary: 'has "quotes", a comma, and\na newline',
      }),
    );

    const result = await exportAuditEvents.run(
      { format: "csv" },
      { userEmail: "alice@x.com" },
    );

    expect(result.format).toBe("csv");
    expect(result.rowCount).toBe(1);
    expect(result.truncated).toBe(false);
    const lines = result.content.split("\n");
    expect(lines[0]).toBe(
      "id,created_at,action,caller,actor_kind,actor_email,org_id,thread_id,turn_id,target_type,target_id,status,summary,error_code,owner_email,visibility",
    );
    // The escaped summary field embeds a real newline inside its quotes, so
    // it spans two lines of the joined CSV string.
    expect(result.content).toContain(
      '"has ""quotes"", a comma, and\na newline"',
    );
  });

  it("exports NDJSON that parses line-by-line", async () => {
    await insertAuditEvent(makeEvent({ id: "n1", createdAt: 100 }));
    await insertAuditEvent(makeEvent({ id: "n2", createdAt: 200 }));

    const result = await exportAuditEvents.run(
      { format: "ndjson" },
      { userEmail: "alice@x.com" },
    );

    expect(result.format).toBe("ndjson");
    expect(result.rowCount).toBe(2);
    const lines = result.content.split("\n");
    expect(lines).toHaveLength(2);
    const parsed = lines.map((line) => JSON.parse(line));
    expect(parsed.map((e) => e.id).sort()).toEqual(["n1", "n2"]);
    // Newest first, same ordering as list-audit-events.
    expect(parsed[0].id).toBe("n2");
  });

  it("never exports another user's or org's events", async () => {
    await insertAuditEvent(
      makeEvent({ id: "mine", ownerEmail: "alice@x.com" }),
    );
    await insertAuditEvent(
      makeEvent({ id: "theirs", ownerEmail: "bob@x.com" }),
    );
    await insertAuditEvent(
      makeEvent({
        id: "other-org",
        ownerEmail: "carol@x.com",
        orgId: "org-2",
        visibility: "org",
      }),
    );

    const result = await exportAuditEvents.run(
      { format: "ndjson" },
      { userEmail: "alice@x.com", orgId: "org-1" },
    );

    const ids = result.content.split("\n").map((line) => JSON.parse(line).id);
    expect(ids).toEqual(["mine"]);
  });

  it("marks truncated: true when rows exceed maxRows", async () => {
    for (let i = 0; i < 5; i++) {
      await insertAuditEvent(makeEvent({ createdAt: 1000 + i }));
    }

    const result = await exportAuditEvents.run(
      { format: "ndjson", maxRows: 3 },
      { userEmail: "alice@x.com" },
    );

    expect(result.rowCount).toBe(3);
    expect(result.truncated).toBe(true);
  });

  it("does not truncate when maxRows exactly covers all matching rows", async () => {
    for (let i = 0; i < 3; i++) {
      await insertAuditEvent(makeEvent({ createdAt: 1000 + i }));
    }

    const result = await exportAuditEvents.run(
      { format: "ndjson", maxRows: 3 },
      { userEmail: "alice@x.com" },
    );

    expect(result.rowCount).toBe(3);
    expect(result.truncated).toBe(false);
  });

  it("applies filters like actorKind", async () => {
    await insertAuditEvent(
      makeEvent({ id: "agent-evt", actorKind: "agent", createdAt: 100 }),
    );
    await insertAuditEvent(
      makeEvent({ id: "human-evt", actorKind: "human", createdAt: 200 }),
    );

    const result = await exportAuditEvents.run(
      { format: "ndjson", actorKind: "human" },
      { userEmail: "alice@x.com" },
    );

    expect(result.rowCount).toBe(1);
    expect(JSON.parse(result.content).id).toBe("human-evt");
  });
});
