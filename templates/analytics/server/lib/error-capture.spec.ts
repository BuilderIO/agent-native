import { createRequire } from "node:module";

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SqlStatement = string | { sql: string; args?: unknown[] };

function postgresSql(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => "$" + ++index);
}

async function execute(client: PGliteClient, statement: SqlStatement) {
  if (typeof statement === "string") {
    const results = [];
    for (const sql of statement
      .split(";")
      .map((value) => value.trim())
      .filter(Boolean)) {
      results.push(await client.query(postgresSql(sql)));
    }
    return results[results.length - 1];
  }
  return client.query(postgresSql(statement.sql), statement.args ?? []);
}

const getDbMock = vi.hoisted(() => vi.fn());
const recordChangeMock = vi.hoisted(() => vi.fn());
const notifyWithDeliveryMock = vi.hoisted(() => vi.fn(async () => undefined));
const getUserSettingMock = vi.hoisted(() => vi.fn());

vi.mock("../db/index.js", async () => {
  const actual =
    await vi.importActual<typeof import("../db/index.js")>("../db/index.js");
  return { ...actual, getDb: getDbMock };
});

vi.mock("@agent-native/core/server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/server")>();
  return { ...actual, recordChange: recordChangeMock };
});

vi.mock("@agent-native/core/notifications", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/notifications")>();
  return { ...actual, notifyWithDelivery: notifyWithDeliveryMock };
});

vi.mock("@agent-native/core/settings", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/settings")>();
  return { ...actual, getUserSetting: getUserSettingMock };
});

import { schema } from "../db/index.js";
import {
  candidateFingerprintsForConsole,
  captureTestError,
  culpritFromFrames,
  deriveConsoleExceptionIdentity,
  extractExceptionInput,
  fingerprint,
  getErrorIngestStats,
  getErrorIssue,
  ingestAnalyticsExceptionEvents,
  ingestException,
  isBenignBrowserAbortException,
  listErrorIssues,
  matchErrorIssuesBySignatures,
  normalizeFrameFile,
  parseStack,
  recordErrorIngestFailure,
  resetErrorIngestStateForTests,
  sourceContextFromText,
  titleFromException,
  trustedSourceRelativePath,
  type DerivedExceptionFields,
  type RawExceptionInput,
} from "./error-capture";

describe("parseStack", () => {
  it("parses V8/Chrome frames with function + location", () => {
    const frames = parseStack(
      [
        "TypeError: x is not a function",
        "    at doThing (https://app.example.com/assets/main.js:12:34)",
        "    at async handler (https://app.example.com/assets/main.js:40:1)",
        "    at https://cdn.example.com/vendor.js:1:1",
      ].join("\n"),
    );
    expect(frames[0]).toMatchObject({
      function: "doThing",
      file: "https://app.example.com/assets/main.js",
      lineno: 12,
      colno: 34,
      inApp: true,
    });
    expect(frames[1].function).toBe("handler");
    expect(frames[2].inApp).toBe(false);
  });

  it("parses Firefox/Safari `fn@location` frames", () => {
    const frames = parseStack(
      [
        "doThing@https://app.example.com/main.js:12:34",
        "@debugger eval code:1:1",
      ].join("\n"),
    );
    expect(frames[0]).toMatchObject({
      function: "doThing",
      file: "https://app.example.com/main.js",
      lineno: 12,
      colno: 34,
    });
    expect(frames[1].function).toBeNull();
  });

  it("returns an empty array for missing/blank stacks", () => {
    expect(parseStack(null)).toEqual([]);
    expect(parseStack(undefined)).toEqual([]);
    expect(parseStack("")).toEqual([]);
  });
});

describe("sourceContextFromText", () => {
  it("returns bounded source lines with the crashing line highlighted", () => {
    const context = sourceContextFromText(
      [
        "const a = 1;",
        "const b = 2;",
        "throw new Error('boom');",
        "done();",
      ].join("\n"),
      3,
      { before: 1, after: 1 },
    );

    expect(context).toEqual([
      { line: 2, text: "const b = 2;", highlight: false },
      { line: 3, text: "throw new Error('boom');", highlight: true },
      { line: 4, text: "done();", highlight: false },
    ]);
  });

  it("returns null when the requested line is outside the file", () => {
    expect(sourceContextFromText("one\ntwo", 3)).toBeNull();
    expect(sourceContextFromText("one\ntwo", 0)).toBeNull();
  });
});

describe("trustedSourceRelativePath", () => {
  it("allows Analytics app source paths from relative or URL path frames", () => {
    expect(trustedSourceRelativePath("app/pages/Dashboard.tsx")).toBe(
      "app/pages/Dashboard.tsx",
    );
    expect(trustedSourceRelativePath("/app/pages/Dashboard.tsx")).toBe(
      "app/pages/Dashboard.tsx",
    );
  });

  it("rejects client-controlled absolute, traversal, and non-app paths", () => {
    expect(
      trustedSourceRelativePath(
        "/Users/steve/Projects/builder/agent-native/framework/AGENTS.md",
      ),
    ).toBeNull();
    expect(trustedSourceRelativePath("../server/db/schema.ts")).toBeNull();
    expect(trustedSourceRelativePath("server/db/schema.ts")).toBeNull();
    expect(trustedSourceRelativePath("app/../server/db/schema.ts")).toBeNull();
  });
});

describe("normalizeFrameFile", () => {
  it("drops query/hash and reduces URLs to pathname", () => {
    expect(
      normalizeFrameFile("https://app.example.com/assets/main.js?v=123#x"),
    ).toBe("/assets/main.js");
  });

  it("strips bundler content hashes so small rebuilds don't split groups", () => {
    expect(normalizeFrameFile("/assets/main.4f3a2b1c.js")).toBe(
      "/assets/main.js",
    );
    expect(normalizeFrameFile("/assets/chunk-9a8b7c6d5e.js")).toBe(
      "/assets/chunk.js",
    );
    expect(normalizeFrameFile("/assets/entry-ClHrLGJQ.js")).toBe(
      "/assets/entry.js",
    );
    expect(normalizeFrameFile("/assets/entry-CVi_y2nS.js")).toBe(
      "/assets/entry.js",
    );
  });

  it("returns empty string for null", () => {
    expect(normalizeFrameFile(null)).toBe("");
  });
});

describe("fingerprint", () => {
  it("is stable across line/column changes to the top in-app frame", () => {
    const a = parseStack(
      "TypeError: boom\n    at doThing (https://app.example.com/main.a1b2c3d4.js:12:34)",
    );
    const b = parseStack(
      "TypeError: boom\n    at doThing (https://app.example.com/main.e5f6a7b8.js:99:1)",
    );
    expect(fingerprint("TypeError", a, "boom")).toBe(
      fingerprint("TypeError", b, "boom"),
    );
  });

  it("differs by error type", () => {
    const frames = parseStack(
      "Error: boom\n    at doThing (https://app.example.com/main.js:1:1)",
    );
    expect(fingerprint("TypeError", frames, "boom")).not.toBe(
      fingerprint("RangeError", frames, "boom"),
    );
    expect(fingerprint("Error", frames, "boom")).toBe(
      fingerprint("UnhandledRejection", frames, "boom"),
    );
  });

  it("separates different messages thrown through the same frame", () => {
    const frames = parseStack(
      "Error: boom\n    at runAction (https://app.example.com/assets/server.js:1:1)",
    );
    expect(
      fingerprint(
        "Error",
        frames,
        "A booking link with this slug already exists",
      ),
    ).not.toBe(
      fingerprint(
        "Error",
        frames,
        "Action update-visual-plan failed: Internal server error",
      ),
    );
  });

  it("groups the same logical error when only ids/values differ", () => {
    const frames = parseStack(
      "Error: boom\n    at runAction (https://app.example.com/assets/server.js:1:1)",
    );
    const same = (message: string) => fingerprint("Error", frames, message);
    expect(same("DB query timed out after 8000ms")).toBe(
      same("DB query timed out after 30000ms"),
    );
    expect(
      same(
        "Destructive structured replacement would remove 4 existing block IDs (phase4-h, phase6-h, seq-h, oq-h)",
      ),
    ).toBe(
      same(
        "Destructive structured replacement would remove 2 existing block IDs (current-state, status-matrix)",
      ),
    );
    expect(same(`Build step "react-router-build" failed`)).toBe(
      same(`Build step "netlify-deploy" failed`),
    );
    expect(same("Failed to read /Users/ada/app/src/main.ts")).toBe(
      same("Failed to read /Users/grace/other/lib/util.ts"),
    );
    expect(same("Can't find variable: EmptyRanges")).not.toBe(
      same("Can't find variable: __firefox__"),
    );
  });

  it("groups agent-chat failures that differ only by the opaque ERROR ID", () => {
    const frames = parseStack(
      "EngineError: boom\n    at Fa (https://analytics.example.com/assets/production-agent.mjs:140:12)",
    );
    const withId = (id: string) =>
      fingerprint(
        "EngineError",
        frames,
        `Sorry, we ran into an issue processing your request. ERROR ID: ${id}`,
      );
    const ids = [
      "a3f9c2d1",
      "7b1e0c4da9f23188",
      "0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f",
    ];
    expect(new Set(ids.map(withId)).size).toBe(1);
    expect(withId("a3f9c2d1")).not.toBe(
      fingerprint("EngineError", frames, "Builder gateway timed out"),
    );
  });

  it("keeps hex-shaped words that are not ids in their own group", () => {
    expect(fingerprint("Error", [], "decade decade")).not.toBe(
      fingerprint("Error", [], "deadbeef facade"),
    );
  });

  it("falls back to a normalized message when there is no usable stack", () => {
    expect(fingerprint("Error", [], "Failed to load id 1")).toBe(
      fingerprint("Error", [], "Failed to load id 2"),
    );
    expect(fingerprint("Error", [], "Failed to load id 1")).not.toBe(
      fingerprint("Error", [], "Totally different message"),
    );
  });
});

describe("titleFromException", () => {
  it("joins type and first message line", () => {
    expect(titleFromException("TypeError", "x is not a function\nmore")).toBe(
      "TypeError: x is not a function",
    );
  });

  it("uses just the type when there is no message", () => {
    expect(titleFromException("Error", "")).toBe("Error");
  });
});

describe("culpritFromFrames", () => {
  it("renders the top in-app frame as fn (basename:line)", () => {
    const frames = parseStack(
      "Error: boom\n    at doThing (https://app.example.com/assets/main.js:12:34)",
    );
    expect(culpritFromFrames(frames)).toBe("doThing (main.js:12)");
  });

  it("returns null when there are no frames", () => {
    expect(culpritFromFrames([])).toBeNull();
  });
});

describe("deriveConsoleExceptionIdentity", () => {
  it("splits a serialized `Name: message` console line back into type + message", () => {
    expect(
      deriveConsoleExceptionIdentity("TypeError: x is not a function"),
    ).toEqual({ type: "TypeError", message: "x is not a function" });
    expect(deriveConsoleExceptionIdentity("DOMException: aborted")).toEqual({
      type: "DOMException",
      message: "aborted",
    });
  });

  it("treats a spaced/plain prefix as a message, not a type", () => {
    expect(deriveConsoleExceptionIdentity("Failed to fetch: /x")).toEqual({
      type: "Error",
      message: "Failed to fetch: /x",
    });
    expect(deriveConsoleExceptionIdentity("just a message")).toEqual({
      type: "Error",
      message: "just a message",
    });
  });
});

describe("candidateFingerprintsForConsole", () => {
  const stack =
    "TypeError: x is not a function\n    at doThing (https://app.example.com/main.js:12:34)";

  it("matches the fingerprint ingest computes for the same underlying error", () => {
    const [fp] = candidateFingerprintsForConsole({
      key: "c1",
      source: "window-error",
      message: "TypeError: x is not a function",
      stack,
    });
    expect(fp).toBe(
      fingerprint("TypeError", parseStack(stack), "x is not a function"),
    );
  });

  it("is stable across line/column drift in the top in-app frame", () => {
    const a = candidateFingerprintsForConsole({
      key: "a",
      source: "window-error",
      message: "TypeError: x is not a function",
      stack:
        "TypeError: x is not a function\n    at doThing (https://app.example.com/main.4f3a2b1c.js:12:34)",
    });
    const b = candidateFingerprintsForConsole({
      key: "b",
      source: "window-error",
      message: "TypeError: x is not a function",
      stack:
        "TypeError: x is not a function\n    at doThing (https://app.example.com/main.9e8d7c6b.js:99:1)",
    });
    expect(a[0]).toBe(b[0]);
  });

  it("adds the UnhandledRejection variant for a plain-Error rejection", () => {
    const rejectionStack =
      "Error: boom\n    at doThing (https://app.example.com/main.js:1:1)";
    const fps = candidateFingerprintsForConsole({
      key: "r",
      source: "unhandledrejection",
      message: "Error: boom",
      stack: rejectionStack,
    });
    expect(fps).toContain(
      fingerprint("UnhandledRejection", parseStack(rejectionStack), "boom"),
    );
    expect(fps).toContain(
      fingerprint("Error", parseStack(rejectionStack), "boom"),
    );
  });
});

describe("extractExceptionInput", () => {
  it("normalizes and bounds a forked $exception payload", () => {
    const input = extractExceptionInput({
      exceptionType: "TypeError",
      exceptionMessage: "x is not a function",
      exceptionStack: "TypeError: x is not a function\n    at f (a.js:1:1)",
      handled: false,
      level: "error",
      sessionReplayId: "client-abc",
      breadcrumbs: [{ category: "nav", message: "/a" }],
      exceptionTags: { area: "checkout", count: 3 },
      exceptionExtra: { cartId: "c1" },
    });
    expect(input.type).toBe("TypeError");
    expect(input.handled).toBe(false);
    expect(input.clientRecordingId).toBe("client-abc");
    expect(input.tags).toEqual({ area: "checkout", count: "3" });
    expect(input.extra).toEqual({ cartId: "c1" });
    expect(input.breadcrumbs).toHaveLength(1);
  });

  it("defaults type to Error and coerces unknown levels", () => {
    const input = extractExceptionInput({ level: "not-a-level" });
    expect(input.type).toBe("Error");
    expect(input.level).toBe("error");
  });

  it("recognizes expected browser request cancellations", () => {
    expect(
      isBenignBrowserAbortException({
        type: "AbortError",
        message: "signal is aborted without reason",
      }),
    ).toBe(true);
    expect(
      isBenignBrowserAbortException({
        type: "AbortError",
        message: "The request was aborted by the server",
      }),
    ).toBe(false);
  });
});

function baseRaw(
  overrides: Partial<RawExceptionInput> = {},
): RawExceptionInput {
  return {
    type: "TypeError",
    message: "x is not a function",
    rawStack:
      "TypeError: x is not a function\n    at doThing (https://app.example.com/main.js:12:34)",
    handled: false,
    level: "error",
    release: null,
    environment: "test",
    clientRecordingId: null,
    tags: {},
    extra: {},
    breadcrumbs: [],
    ...overrides,
  };
}

function derivedFor(
  overrides: Partial<DerivedExceptionFields> = {},
): DerivedExceptionFields {
  return {
    app: "analytics",
    template: null,
    url: "https://app.example.com/dashboard",
    userId: null,
    anonymousId: "anon-1",
    userKey: "anon-1",
    sessionId: "sess-1",
    timestamp: "2026-07-08T12:00:00.000Z",
    testIdentity: false,
    ...overrides,
  };
}

const SCOPE = { ownerEmail: "alice@example.com", orgId: null };

async function createTables(client: PGliteClient): Promise<void> {
  await execute(
    client,
    `
    CREATE TABLE error_issues (
      id text PRIMARY KEY,
      fingerprint text NOT NULL,
      type text NOT NULL DEFAULT 'Error',
      title text NOT NULL,
      culprit text,
      level text NOT NULL DEFAULT 'error',
      status text NOT NULL DEFAULT 'unresolved',
      first_seen_at text NOT NULL,
      last_seen_at text NOT NULL,
      event_count integer NOT NULL DEFAULT 0,
      users_affected integer NOT NULL DEFAULT 0,
      sample_event_id text,
      last_session_recording_id text,
      assignee text,
      app text,
      template text,
      test_identity_only boolean NOT NULL DEFAULT false,
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      owner_email text NOT NULL DEFAULT 'local@localhost',
      org_id text,
      visibility text NOT NULL DEFAULT 'private'
    )
  `,
  );
  await execute(
    client,
    `
    CREATE TABLE error_issue_shares (
      id text PRIMARY KEY,
      resource_id text NOT NULL,
      principal_type text NOT NULL,
      principal_id text NOT NULL,
      role text NOT NULL DEFAULT 'viewer',
      created_by text NOT NULL,
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    ,
      notified_at TEXT)
  `,
  );
  await execute(
    client,
    `
    CREATE TABLE error_events (
      id text PRIMARY KEY,
      issue_id text NOT NULL,
      fingerprint text NOT NULL,
      type text NOT NULL DEFAULT 'Error',
      message text NOT NULL DEFAULT '',
      culprit text,
      level text NOT NULL DEFAULT 'error',
      stack text NOT NULL DEFAULT '[]',
      raw_stack text,
      handled BOOLEAN NOT NULL DEFAULT true,
      url text,
      user_id text,
      anonymous_id text,
      user_key text,
      session_id text,
      client_recording_id text,
      session_recording_id text,
      release text,
      environment text,
      tags text NOT NULL DEFAULT '{}',
      extra text NOT NULL DEFAULT '{}',
      breadcrumbs text NOT NULL DEFAULT '[]',
      occurred_at text NOT NULL,
      test_identity boolean NOT NULL DEFAULT false,
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP,
      owner_email text NOT NULL DEFAULT 'local@localhost',
      org_id text
    )
  `,
  );
  await execute(
    client,
    `
    CREATE TABLE session_recordings (
      id text PRIMARY KEY,
      client_recording_id text NOT NULL,
      owner_email text NOT NULL,
      org_id text,
      visibility text NOT NULL DEFAULT 'private'
    )
  `,
  );
  await execute(
    client,
    `
    CREATE TABLE session_recording_shares (
      id text PRIMARY KEY,
      resource_id text NOT NULL,
      principal_type text NOT NULL,
      principal_id text NOT NULL,
      role text NOT NULL DEFAULT 'viewer',
      created_by text NOT NULL,
      created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP
    ,
      notified_at TEXT)
  `,
  );
}

describe("ingestException", () => {
  let client: PGliteClient;

  beforeEach(async () => {
    client = await PGlite.create("memory://");
    await createTables(client);
    const db = drizzle(client, { schema });
    getDbMock.mockReturnValue(db);
    recordChangeMock.mockReset();
    notifyWithDeliveryMock.mockClear();
    getUserSettingMock.mockReset();
    getUserSettingMock.mockResolvedValue(null);
  });

  afterEach(async () => {
    await client.close();
  });

  async function loadIssues() {
    return (drizzle(client, { schema }) as any)
      .select()
      .from(schema.errorIssues);
  }

  it("creates a new grouped issue on first occurrence", async () => {
    const result = await ingestException(SCOPE, baseRaw(), derivedFor());
    expect(result.isNewIssue).toBe(true);

    const issues = await loadIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      status: "unresolved",
      eventCount: 1,
      usersAffected: 1,
      type: "TypeError",
      title: "TypeError: x is not a function",
      firstSeenAt: "2026-07-08T12:00:00.000Z",
      lastSeenAt: "2026-07-08T12:00:00.000Z",
    });
    expect(recordChangeMock).toHaveBeenCalledWith(
      expect.objectContaining({ source: "error-issues", type: "add" }),
    );
    expect(notifyWithDeliveryMock).toHaveBeenCalledTimes(1);
    expect(notifyWithDeliveryMock).toHaveBeenCalledWith(
      expect.objectContaining({ channels: ["inbox"] }),
      expect.anything(),
    );
  });

  it("sends error email only when the owner opts in", async () => {
    getUserSettingMock.mockResolvedValue({
      errorEmailNotifications: true,
    });

    await ingestException(SCOPE, baseRaw(), derivedFor());

    expect(notifyWithDeliveryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        channels: ["inbox", "email"],
        metadata: expect.objectContaining({
          emailRecipients: [SCOPE.ownerEmail],
        }),
      }),
      expect.anything(),
    );
  });

  it("bumps counts and first/last seen on repeat occurrences (same fingerprint)", async () => {
    const first = await ingestException(
      SCOPE,
      baseRaw(),
      derivedFor({ timestamp: "2026-07-08T12:00:00.000Z", userKey: "u1" }),
    );
    const second = await ingestException(
      SCOPE,
      baseRaw({
        rawStack:
          "TypeError: x is not a function\n    at doThing (https://app.example.com/main.js:99:1)",
      }),
      derivedFor({ timestamp: "2026-07-08T13:00:00.000Z", userKey: "u2" }),
    );

    expect(second.isNewIssue).toBe(false);
    expect(second.issueId).toBe(first.issueId);

    const issues = await loadIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      eventCount: 2,
      usersAffected: 2,
      firstSeenAt: "2026-07-08T12:00:00.000Z",
      lastSeenAt: "2026-07-08T13:00:00.000Z",
    });
    expect(notifyWithDeliveryMock).toHaveBeenCalledTimes(1);
  });

  it("counts only real identities as affected users", async () => {
    const anonymous = derivedFor({
      userId: null,
      anonymousId: null,
      userKey: null,
      sessionId: null,
    });
    await ingestException(SCOPE, baseRaw(), anonymous);
    await ingestException(SCOPE, baseRaw(), {
      ...anonymous,
      timestamp: "2026-07-08T12:00:01.000Z",
    });
    let issues = await loadIssues();
    expect(issues[0]).toMatchObject({ eventCount: 2, usersAffected: 0 });

    await ingestException(
      SCOPE,
      baseRaw(),
      derivedFor({ userId: null, anonymousId: null, userKey: null }),
    );
    issues = await loadIssues();
    expect(issues[0]).toMatchObject({ eventCount: 3, usersAffected: 1 });
  });

  it("keeps earliest firstSeen when an older occurrence arrives late", async () => {
    await ingestException(
      SCOPE,
      baseRaw(),
      derivedFor({ timestamp: "2026-07-08T12:00:00.000Z" }),
    );
    await ingestException(
      SCOPE,
      baseRaw(),
      derivedFor({ timestamp: "2026-07-01T00:00:00.000Z" }),
    );
    const issues = await loadIssues();
    expect(issues[0].firstSeenAt).toBe("2026-07-01T00:00:00.000Z");
    expect(issues[0].lastSeenAt).toBe("2026-07-08T12:00:00.000Z");
  });

  it("groups distinct error types into separate issues", async () => {
    await ingestException(SCOPE, baseRaw({ type: "TypeError" }), derivedFor());
    await ingestException(SCOPE, baseRaw({ type: "RangeError" }), derivedFor());
    const issues = await loadIssues();
    expect(issues).toHaveLength(2);
  });

  it("reopens a resolved issue when it recurs but keeps ignored issues muted", async () => {
    const first = await ingestException(SCOPE, baseRaw(), derivedFor());
    const db = drizzle(client, { schema }) as any;

    await db
      .update(schema.errorIssues)
      .set({ status: "resolved" })
      .where(eq(schema.errorIssues.id, first.issueId));
    await ingestException(SCOPE, baseRaw(), derivedFor());
    let issues = await loadIssues();
    expect(issues[0].status).toBe("unresolved");

    await db
      .update(schema.errorIssues)
      .set({ status: "ignored" })
      .where(eq(schema.errorIssues.id, first.issueId));
    await ingestException(SCOPE, baseRaw(), derivedFor());
    issues = await loadIssues();
    expect(issues[0].status).toBe("ignored");
  });

  it("scopes issues per owner (same fingerprint, different owner = new issue)", async () => {
    await ingestException(SCOPE, baseRaw(), derivedFor());
    await ingestException(
      { ownerEmail: "bob@example.com", orgId: null },
      baseRaw(),
      derivedFor(),
    );
    const issues = await loadIssues();
    expect(issues).toHaveLength(2);
    expect(new Set(issues.map((i: any) => i.ownerEmail))).toEqual(
      new Set(["alice@example.com", "bob@example.com"]),
    );
  });

  it("filters issues by matching occurrence user and session recording", async () => {
    const tim = await ingestException(
      SCOPE,
      baseRaw(),
      derivedFor({ userId: "tim-user-id", userKey: "tim@example.com" }),
    );
    const other = await ingestException(
      SCOPE,
      baseRaw({
        type: "RangeError",
        message: "another failure",
        rawStack:
          "RangeError: another failure\n    at otherThing (https://app.example.com/other.js:1:1)",
      }),
      derivedFor({ userId: "other-user-id", userKey: "other@example.com" }),
    );
    const db = drizzle(client, { schema }) as any;
    await execute(client, {
      sql: `
        INSERT INTO session_recordings
          (id, client_recording_id, owner_email, org_id, visibility)
        VALUES (?, ?, ?, ?, ?)
      `,
      args: ["sr_tim", "client-tim", SCOPE.ownerEmail, null, "private"],
    });
    await db
      .update(schema.errorEvents)
      .set({ clientRecordingId: "client-tim" })
      .where(eq(schema.errorEvents.id, tim.eventId!));
    await db
      .update(schema.errorEvents)
      .set({ sessionRecordingId: "sr_other" })
      .where(eq(schema.errorEvents.id, other.eventId!));

    const byRecording = await listErrorIssues(
      { userEmail: SCOPE.ownerEmail, orgId: null },
      { sessionRecordingId: "sr_tim" },
    );
    expect(byRecording.map((issue) => issue.id)).toEqual([tim.issueId]);

    const byUserId = await listErrorIssues(
      { userEmail: SCOPE.ownerEmail, orgId: null },
      { userId: "tim-user-id" },
    );
    expect(byUserId.map((issue) => issue.id)).toEqual([tim.issueId]);

    const byUserKey = await listErrorIssues(
      { userEmail: SCOPE.ownerEmail, orgId: null },
      { userId: "tim@example.com" },
    );
    expect(byUserKey.map((issue) => issue.id)).toEqual([tim.issueId]);
  });

  it("does not match an occurrence outside its issue owner scope", async () => {
    const tim = await ingestException(SCOPE, baseRaw(), derivedFor());
    const db = drizzle(client, { schema }) as any;
    await db
      .update(schema.errorEvents)
      .set({
        ownerEmail: "other@example.com",
        userId: "other@example.com",
        userKey: "other@example.com",
        sessionRecordingId: "sr_other",
      })
      .where(eq(schema.errorEvents.id, tim.eventId!));

    const issues = await listErrorIssues(
      { userEmail: SCOPE.ownerEmail, orgId: null },
      { userId: "other@example.com", sessionRecordingId: "sr_other" },
    );
    expect(issues).toEqual([]);
  });

  it("keeps real identities in list and detail reads", async () => {
    const result = await ingestException(
      SCOPE,
      baseRaw({
        message: "Checkout failed for customer@example.com",
        rawStack:
          "TypeError: customer@example.com\n    at doThing (https://app.example.com/main.js:12:34)",
        tags: { reporter: "support@example.com" },
        extra: { accountEmail: "customer@example.com" },
        breadcrumbs: [{ message: "Signed in as customer@example.com" }],
      }),
      derivedFor({
        userId: "customer@example.com",
        userKey: "customer@example.com",
        url: "https://app.example.com/checkout?email=customer@example.com",
      }),
    );
    const normalDetail = await getErrorIssue(
      { userEmail: SCOPE.ownerEmail, orgId: null },
      result.issueId,
    );
    expect(JSON.stringify(normalDetail)).toContain("customer@example.com");

    const issues = await listErrorIssues({
      userEmail: SCOPE.ownerEmail,
      orgId: null,
    });
    const detail = await getErrorIssue(
      { userEmail: SCOPE.ownerEmail, orgId: null },
      result.issueId,
    );
    const rendered = JSON.stringify({ issues, detail });

    expect(rendered).toContain("customer@example.com");
    expect(rendered).toContain("support@example.com");
    expect(detail.events[0]).toMatchObject({
      userId: "customer@example.com",
      userKey: "customer@example.com",
      url: "https://app.example.com/checkout?email=customer@example.com",
      tags: { reporter: "support@example.com" },
      extra: { accountEmail: "customer@example.com" },
    });
  });

  it("keeps a test identity's error queryable without alerting or counting the user", async () => {
    const result = await ingestException(
      SCOPE,
      baseRaw(),
      derivedFor({ userKey: "qa+autoz@builder.io", testIdentity: true }),
    );

    expect(result).toMatchObject({ isNewIssue: true, stored: true });
    expect(notifyWithDeliveryMock).not.toHaveBeenCalled();
    const [issue] = await loadIssues();
    expect(issue).toMatchObject({ testIdentityOnly: true, usersAffected: 0 });
    const detail = await getErrorIssue(
      { userEmail: SCOPE.ownerEmail, orgId: null },
      result.issueId,
    );
    expect(detail.issue.testIdentityOnly).toBe(true);
    expect(detail.events[0]?.testIdentity).toBe(true);
  });

  it("alerts once, on the first real occurrence of an issue a test identity found first", async () => {
    const qa = derivedFor({
      userKey: "qa+autoz@builder.io",
      testIdentity: true,
    });
    const first = await ingestException(SCOPE, baseRaw(), qa);
    await ingestException(SCOPE, baseRaw(), qa);
    expect(notifyWithDeliveryMock).not.toHaveBeenCalled();

    const real = await ingestException(
      SCOPE,
      baseRaw(),
      derivedFor({ userKey: "customer@example.com" }),
    );
    await ingestException(
      SCOPE,
      baseRaw(),
      derivedFor({ userKey: "other@example.com" }),
    );

    expect(real.issueId).toBe(first.issueId);
    expect(notifyWithDeliveryMock).toHaveBeenCalledTimes(1);
    expect(notifyWithDeliveryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ issueId: first.issueId }),
      }),
      expect.anything(),
    );
    const [issue] = await loadIssues();
    expect(issue).toMatchObject({
      testIdentityOnly: false,
      eventCount: 4,
      usersAffected: 2,
    });
  });

  it("stores and alerts the first real occurrence even when the issue is already sampled", async () => {
    resetErrorIngestStateForTests();
    const qaDerived = derivedFor({
      userKey: "qa+autoz@builder.io",
      testIdentity: true,
    });
    const qa = await ingestException(SCOPE, baseRaw(), qaDerived);
    await (drizzle(client, { schema }) as any)
      .update(schema.errorIssues)
      .set({ eventCount: 500 })
      .where(eq(schema.errorIssues.id, qa.issueId));
    // Primes the sampler, so an anonymous occurrence would only be counted.
    await ingestException(SCOPE, baseRaw(), qaDerived);

    const real = await ingestException(
      SCOPE,
      baseRaw(),
      derivedFor({ userKey: null, anonymousId: null, sessionId: null }),
    );

    expect(real.stored).toBe(true);
    expect(notifyWithDeliveryMock).toHaveBeenCalledTimes(1);
  });

  it("lists issues only test identities have hit just when asked, or to a test-identity viewer", async () => {
    const qa = await ingestException(
      SCOPE,
      baseRaw({ type: "RangeError" }),
      derivedFor({ userKey: "qa+autoz@builder.io", testIdentity: true }),
    );
    const real = await ingestException(SCOPE, baseRaw(), derivedFor());
    const reader = { userEmail: SCOPE.ownerEmail, orgId: null };

    expect((await listErrorIssues(reader)).map((issue) => issue.id)).toEqual([
      real.issueId,
    ]);
    const all = await listErrorIssues(reader, { includeTestIdentities: true });
    expect(
      all.map((issue) => [issue.id, issue.testIdentityOnly]).sort(),
    ).toEqual(
      [
        [qa.issueId, true],
        [real.issueId, false],
      ].sort(),
    );

    const qaOwner = { ownerEmail: "e2e+autoz@builder.io", orgId: null };
    const own = await captureTestError(
      { userEmail: qaOwner.ownerEmail, orgId: null },
      {},
    );
    expect(notifyWithDeliveryMock).toHaveBeenCalledTimes(1);
    expect(
      (
        await listErrorIssues({ userEmail: qaOwner.ownerEmail, orgId: null })
      ).map((issue) => issue.id),
    ).toEqual([own.issueId]);
  });

  it("does not expose private replay links through an org-shared issue", async () => {
    await execute(client, {
      sql: `
        INSERT INTO session_recordings
          (id, client_recording_id, owner_email, org_id, visibility)
        VALUES (?, ?, ?, ?, ?)
      `,
      args: [
        "sr_private",
        "client-private",
        "alice@example.com",
        "org_1",
        "private",
      ],
    });

    const result = await ingestException(
      { ownerEmail: "alice@example.com", orgId: "org_1" },
      baseRaw({ clientRecordingId: "client-private" }),
      derivedFor(),
    );

    const readerScope = { userEmail: "bob@example.com", orgId: "org_1" };
    const [summary] = await listErrorIssues(readerScope);
    expect(summary).toMatchObject({
      id: result.issueId,
      lastSessionRecordingId: null,
      lastSessionRecordingPath: null,
    });

    const detail = await getErrorIssue(readerScope, result.issueId);
    expect(detail.issue.lastSessionRecordingPath).toBeNull();
    expect(detail.events[0].sessionRecordingId).toBeNull();
    expect(detail.events[0].sessionRecordingPath).toBeNull();
    expect(detail.sessions).toEqual([]);
  });
});

describe("matchErrorIssuesBySignatures", () => {
  let client: PGliteClient;

  beforeEach(async () => {
    client = await PGlite.create("memory://");
    await createTables(client);
    const db = drizzle(client, { schema });
    getDbMock.mockReturnValue(db);
    recordChangeMock.mockReset();
    notifyWithDeliveryMock.mockClear();
    getUserSettingMock.mockReset();
    getUserSettingMock.mockResolvedValue(null);
  });

  afterEach(() => {
    client.close();
  });

  it("resolves a session console error line to its captured issue", async () => {
    const ingested = await ingestException(SCOPE, baseRaw(), derivedFor());

    const matches = await matchErrorIssuesBySignatures(
      { userEmail: SCOPE.ownerEmail, orgId: null },
      [
        {
          key: "console-1",
          source: "window-error",
          message: "TypeError: x is not a function",
          stack: baseRaw().rawStack,
          app: "analytics",
        },
        {
          key: "console-2",
          source: "console",
          message: "just a log line",
        },
      ],
    );

    expect(matches["console-1"]).toMatchObject({
      issueId: ingested.issueId,
      status: "unresolved",
      title: "TypeError: x is not a function",
    });
    expect(matches["console-2"]).toBeUndefined();
  });

  it("does not resolve issues owned by a different, unshared user", async () => {
    await ingestException(SCOPE, baseRaw(), derivedFor());
    const matches = await matchErrorIssuesBySignatures(
      { userEmail: "mallory@example.com", orgId: null },
      [
        {
          key: "console-1",
          source: "window-error",
          message: "TypeError: x is not a function",
          stack: baseRaw().rawStack,
          app: "analytics",
        },
      ],
    );
    expect(matches["console-1"]).toBeUndefined();
  });
});

describe("parseStack message headers", () => {
  it("never turns a database error's params line into a frame", () => {
    const frames = parseStack(
      [
        'Error: Failed query: insert into "users" ("email") values ($1)',
        "params: ada.lovelace@example.com,second@example.com",
        "    at runQuery (/var/task/_chunks/db.mjs:10:5)",
      ].join("\n"),
    );
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ function: "runQuery", lineno: 10 });
    expect(culpritFromFrames(frames)).toBe("runQuery (db.mjs:10)");
  });

  it("rejects a Gecko-style line whose location is not a location", () => {
    expect(parseStack("params: ada@example.com,x@y.z")).toEqual([]);
    expect(parseStack("run@[native code]")).toHaveLength(1);
  });

  it("does not count extension, GTM, or vendor frames as app code", () => {
    const frames = parseStack(
      [
        "TypeError: x",
        "    at e (chrome-extension://abc/executors/200.js:1:2)",
        "    at t (https://www.googletagmanager.com/gtm.js?id=GTM-1:210:5)",
        "    at p (https://cdn.vector.co/pixel.js:2:9)",
      ].join("\n"),
    );
    expect(frames.map((frame) => frame.inApp)).toEqual([false, false, false]);
  });
});

describe("culprit attribution", () => {
  it("skips our own fetch wrappers to reach the code that issued the call", () => {
    const frames = parseStack(
      [
        "TypeError: Failed to fetch",
        "    at window.fetch (https://slides.agent-native.com/assets/api-path-Bx1.js:1:2210)",
        "    at loadDashboard (https://slides.agent-native.com/assets/Dashboard-3f2a9c1d.js:10:2)",
      ].join("\n"),
    );
    expect(culpritFromFrames(frames)).toBe("loadDashboard (Dashboard.js:10)");
  });
});

describe("stable fingerprints", () => {
  const server = (
    fn: string,
    file = "/var/task/_chunks/production-agent.mjs",
  ) => parseStack(`Error: x\n    at ${fn} (${file}:140:12)`);

  it("groups one server error across deploys that rename the minified function", () => {
    const message =
      "MissingAuthSecretError: [agent-native] production configuration errors:";
    const names = [
      "kn",
      "Tn",
      "An",
      "Mn",
      "xn",
      "wn",
      "bn",
      "En",
      "Dn",
      "mm",
      "hm",
      "vm",
    ];
    const fingerprints = names.map((fn) =>
      fingerprint("MissingAuthSecretError", server(fn), message),
    );
    expect(new Set(fingerprints).size).toBe(1);
  });

  it("groups generic messages by file but not by minified function name", () => {
    const generic = "Cannot read properties of undefined (reading 'map')";
    const a = fingerprint(
      "TypeError",
      server("Po", "/assets/Home-9f2a1c3d.js"),
      generic,
    );
    const b = fingerprint(
      "TypeError",
      server("Ga", "/assets/Home-77aa00bb.js"),
      generic,
    );
    const other = fingerprint(
      "TypeError",
      server("Po", "/assets/Editor-9f2a1c3d.js"),
      generic,
    );
    expect(a).toBe(b);
    expect(a).not.toBe(other);
    // A readable function name still distinguishes two call sites in one file.
    expect(
      fingerprint("TypeError", server("renderRow", "/assets/Home.js"), generic),
    ).not.toBe(
      fingerprint(
        "TypeError",
        server("renderHeader", "/assets/Home.js"),
        generic,
      ),
    );
  });

  it("keeps messageless and generic network errors apart by their first-party frame", () => {
    const a = parseStack(
      "TypeError: x\n    at load (https://a.test/assets/Dashboard.js:1:1)",
    );
    const b = parseStack(
      "TypeError: x\n    at load (https://a.test/assets/Settings.js:1:1)",
    );
    expect(fingerprint("TypeError", a, "Failed to fetch")).not.toBe(
      fingerprint("TypeError", b, "Failed to fetch"),
    );
    expect(fingerprint("Error", a, "")).not.toBe(fingerprint("Error", b, ""));
  });

  it("is not split by wrapper frames in front of the real caller", () => {
    const direct = parseStack(
      "TypeError: x\n    at load (https://a.test/assets/Dashboard.js:1:1)",
    );
    const wrapped = parseStack(
      [
        "TypeError: x",
        "    at window.fetch (https://a.test/assets/api-path-Bx1.js:1:1)",
        "    at load (https://a.test/assets/Dashboard.js:1:1)",
      ].join("\n"),
    );
    expect(fingerprint("TypeError", wrapped, "Failed to fetch")).toBe(
      fingerprint("TypeError", direct, "Failed to fetch"),
    );
  });

  it("strips emails from the grouped message so each user does not get an issue", () => {
    expect(
      fingerprint("Error", [], "No account for ada.lovelace@example.com"),
    ).toBe(fingerprint("Error", [], "No account for grace.hopper@example.org"));
  });

  it("adds errorCode and failureClass to the grouping when present", () => {
    const frames = server("Fa");
    const plain = fingerprint("Error", frames, "Background automation ended");
    const missing = fingerprint(
      "Error",
      frames,
      "Background automation ended",
      {
        errorCode: "missing_tools",
      },
    );
    const timeout = fingerprint(
      "Error",
      frames,
      "Background automation ended",
      {
        errorCode: "run_timeout",
      },
    );
    expect(new Set([plain, missing, timeout]).size).toBe(3);
    expect(
      fingerprint("Error", frames, "Background automation ended", {}),
    ).toBe(plain);
  });
});

describe("fingerprints keep bugs apart that a bare message cannot", () => {
  const react418 =
    "Minified React error #418; visit https://react.dev/errors/418?args[]=text for the full message or use the non-minified dev environment for full errors and additional helpful warnings.";
  const react185 =
    "Minified React error #185; visit https://react.dev/errors/185 for the full message or use the non-minified dev environment for full errors and additional helpful warnings.";
  const reactStack = (host: string, fn: string) =>
    parseStack(
      `Error: Minified React error\n    at ${fn} (https://${host}/assets/index-AbC12345.js:1:2)`,
    );

  it("never merges two React error numbers, in one app or across apps", () => {
    const stack = reactStack("slides.agent-native.com", "kn");
    expect(fingerprint("Error", stack, react418, { app: "slides" })).not.toBe(
      fingerprint("Error", stack, react185, { app: "slides" }),
    );
    expect(fingerprint("Error", stack, react418, { app: "slides" })).not.toBe(
      fingerprint(
        "Error",
        reactStack("design.agent-native.com", "Po"),
        react185,
        { app: "design" },
      ),
    );
  });

  it("keeps one React error number grouped across deploys that rename the minified function", () => {
    const a = fingerprint(
      "Error",
      reactStack("slides.agent-native.com", "kn"),
      react418,
      { app: "slides" },
    );
    const b = fingerprint(
      "Error",
      reactStack("slides.agent-native.com", "Po"),
      react418,
      { app: "slides" },
    );
    expect(a).toBe(b);
  });

  it("splits a bare `fetch failed` by the first-party call site, past node internals", () => {
    const stack = (caller: string, file: string) =>
      parseStack(
        [
          "TypeError: fetch failed",
          "    at node:internal/deps/undici/undici:13502:13",
          "    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)",
          `    at async ${caller} (file://${file}:10:1)`,
        ].join("\n"),
      );
    const gmail = fingerprint(
      "TypeError",
      stack("fetchGmail", "/var/task/server/gmail.mjs"),
      "fetch failed",
      { app: "mail" },
    );
    const llm = fingerprint(
      "TypeError",
      stack("callProvider", "/var/task/server/llm.mjs"),
      "fetch failed",
      { app: "mail" },
    );
    expect(gmail).not.toBe(llm);
  });

  it.each([
    "terminated",
    "This operation was aborted",
    "Request failed with status code 502",
    "Internal Server Error",
  ])("splits `%s` by call site", (message) => {
    const at = (file: string) =>
      parseStack(`Error: x\n    at loadThing (file://${file}:1:1)`);
    expect(
      fingerprint("Error", at("/var/task/a.mjs"), message, { app: "mail" }),
    ).not.toBe(
      fingerprint("Error", at("/var/task/b.mjs"), message, { app: "mail" }),
    );
  });

  it("still groups status-code variants from one call site", () => {
    const frames = parseStack(
      "Error: x\n    at loadThing (file:///var/task/a.mjs:1:1)",
    );
    expect(
      fingerprint("Error", frames, "Request failed with status code 502"),
    ).toBe(fingerprint("Error", frames, "Request failed with status code 504"));
  });

  it("never merges one message across two apps", () => {
    const frames = parseStack(
      "Error: x\n    at loadThing (file:///var/task/a.mjs:1:1)",
    );
    const message = "Configuration is missing";
    expect(fingerprint("Error", frames, message, { app: "mail" })).not.toBe(
      fingerprint("Error", frames, message, { app: "slides" }),
    );
    expect(fingerprint("Error", frames, message, { app: "Mail " })).toBe(
      fingerprint("Error", frames, message, { app: "mail" }),
    );
  });

  it("opens one issue per app for the same message, and lets console matching find each", async () => {
    const client = await PGlite.create("memory://");
    try {
      await createTables(client);
      getDbMock.mockReturnValue(drizzle(client, { schema }));
      recordChangeMock.mockReset();
      notifyWithDeliveryMock.mockClear();
      getUserSettingMock.mockReset();
      getUserSettingMock.mockResolvedValue(null);

      const raw = baseRaw({ message: "Configuration is missing" });
      const mail = await ingestException(
        SCOPE,
        raw,
        derivedFor({ app: "mail" }),
      );
      const slides = await ingestException(
        SCOPE,
        raw,
        derivedFor({ app: "slides" }),
      );
      expect(mail.isNewIssue).toBe(true);
      expect(slides.isNewIssue).toBe(true);
      expect(slides.issueId).not.toBe(mail.issueId);

      const scope = { userEmail: SCOPE.ownerEmail, orgId: null };
      const signature = {
        key: "c1",
        source: "window-error",
        message: "TypeError: Configuration is missing",
        stack: raw.rawStack,
      };
      const forMail = await matchErrorIssuesBySignatures(scope, [
        { ...signature, app: "mail" },
      ]);
      const forSlides = await matchErrorIssuesBySignatures(scope, [
        { ...signature, app: "slides" },
      ]);
      expect(forMail.c1?.issueId).toBe(mail.issueId);
      expect(forSlides.c1?.issueId).toBe(slides.issueId);
    } finally {
      await client.close();
    }
  });
});

describe("extractExceptionInput PII", () => {
  it("drops the bound parameters from the message and the raw stack", () => {
    const input = extractExceptionInput({
      exceptionType: "Error",
      exceptionMessage:
        "Failed query: select 1 where email = $1\nparams: mwang@builder.io",
      exceptionStack:
        "Error: Failed query: select 1 where email = $1\nparams: mwang@builder.io\n    at q (/var/task/db.mjs:1:1)",
    });
    expect(input.message).toBe("Failed query: select 1 where email = $1");
    expect(input.rawStack).not.toContain("mwang");
    expect(titleFromException(input.type, input.message)).not.toContain("@");
  });
});

describe("error ingest flood control", () => {
  let client: PGliteClient;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-01T12:00:00.000Z"));
    resetErrorIngestStateForTests();
    client = await PGlite.create("memory://");
    await createTables(client);
    getDbMock.mockReturnValue(drizzle(client, { schema }));
    recordChangeMock.mockReset();
    notifyWithDeliveryMock.mockClear();
    getUserSettingMock.mockReset();
    getUserSettingMock.mockResolvedValue(null);
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await client.close();
  });

  const db = () => drizzle(client, { schema }) as any;
  const issues = () => db().select().from(schema.errorIssues);
  const events = () => db().select().from(schema.errorEvents);

  function exceptionProperties(overrides: Record<string, unknown> = {}) {
    return {
      exceptionType: "UnhandledRejection",
      exceptionMessage: "Domain not allowed",
      exceptionStack:
        "Error: Domain not allowed\n    at https://cdn.vector.co/pixel.js:2:15234",
      handled: false,
      level: "error",
      ...overrides,
    };
  }

  it("counts, but never creates an issue for, third-party noise", async () => {
    const result = await ingestAnalyticsExceptionEvents(SCOPE, [
      { properties: exceptionProperties(), derived: derivedFor() },
      {
        properties: exceptionProperties({
          exceptionType: "Error",
          exceptionMessage: "Script error.",
          exceptionStack: undefined,
        }),
        derived: derivedFor(),
      },
      {
        properties: exceptionProperties({
          exceptionType: "TypeError",
          exceptionMessage:
            "Failed to fetch dynamically imported module: https://a.test/assets/Panel-3f.js",
          exceptionStack:
            "TypeError: Failed to fetch dynamically imported module: https://a.test/assets/Panel-3f.js",
        }),
        derived: derivedFor(),
      },
    ]);

    expect(result).toMatchObject({ ingested: 0, suppressed: 3, failed: 0 });
    expect(await issues()).toHaveLength(0);
    expect(getErrorIngestStats().suppressed).toEqual({
      "third-party-origin": 1,
      "opaque-script-error": 1,
      "stale-chunk": 1,
    });
  });

  it("never applies browser noise rules to a server event", async () => {
    const result = await ingestAnalyticsExceptionEvents(SCOPE, [
      {
        properties: {
          exceptionType: "TypeError",
          exceptionMessage: "Failed to fetch",
          handled: true,
          level: "error",
          runtime: "node",
          source: "server",
        },
        derived: derivedFor({ url: null }),
      },
    ]);
    expect(result.ingested).toBe(1);
    expect(await issues()).toHaveLength(1);
  });

  it("ingests an access-control failure only when the sender marked it as a real failure", async () => {
    const forbidden = (tags?: Record<string, string>) => ({
      properties: {
        exceptionType: "ForbiddenError",
        exceptionMessage: "Automation grant was revoked",
        exceptionTags: tags,
        handled: true,
        level: "error",
        runtime: "node",
        source: "server",
      },
      derived: derivedFor({ url: null }),
    });

    const unmarked = await ingestAnalyticsExceptionEvents(SCOPE, [forbidden()]);
    expect(unmarked).toMatchObject({ ingested: 0, suppressed: 1 });
    expect(getErrorIngestStats().suppressed).toEqual({ "access-control": 1 });

    const marked = await ingestAnalyticsExceptionEvents(SCOPE, [
      forbidden({ reportExpected: "true" }),
    ]);
    expect(marked).toMatchObject({ ingested: 1, suppressed: 0 });
    expect(await issues()).toHaveLength(1);
  });

  it("ingests a stackless browser network failure whose sender named its origin", async () => {
    const networkFailure = (tags?: Record<string, string>) => ({
      properties: exceptionProperties({
        exceptionType: "TypeError",
        exceptionMessage: "Load failed",
        exceptionStack: undefined,
        exceptionTags: tags,
      }),
      derived: derivedFor(),
    });

    expect(
      await ingestAnalyticsExceptionEvents(SCOPE, [networkFailure()]),
    ).toMatchObject({ ingested: 0, suppressed: 1 });
    expect(
      await ingestAnalyticsExceptionEvents(SCOPE, [
        networkFailure({ context: "agent-native-chat" }),
      ]),
    ).toMatchObject({ ingested: 1, suppressed: 0 });
  });

  it("drops the fuzz-harness label for CLI events", async () => {
    const result = await ingestAnalyticsExceptionEvents(SCOPE, [
      {
        properties: {
          exceptionType: "Error",
          exceptionMessage: "fuzz-intercepted-process-exit",
          runtime: "cli",
          source: "cli",
        },
        derived: derivedFor({ url: null }),
      },
    ]);
    expect(result).toMatchObject({ ingested: 0, suppressed: 1 });
  });

  it("always counts, but stores at most one sample a minute once an issue is hot", async () => {
    const user = (n: number) =>
      derivedFor({
        userKey: "same-user",
        anonymousId: "same-user",
        sessionId: `s${n}`,
      });
    for (let i = 0; i < 20; i += 1) {
      await ingestException(SCOPE, baseRaw(), user(i));
    }
    expect(await events()).toHaveLength(20);

    // Past the free allowance: the first sample is stored, the flood is only counted.
    for (let i = 20; i < 120; i += 1) {
      await ingestException(SCOPE, baseRaw(), user(i));
    }
    let [issue] = await issues();
    expect(issue.eventCount).toBe(120);
    expect(await events()).toHaveLength(21);
    expect(getErrorIngestStats().sampledOut).toBe(99);

    vi.setSystemTime(new Date("2026-10-01T12:01:01.000Z"));
    await ingestException(SCOPE, baseRaw(), user(121));
    [issue] = await issues();
    expect(issue.eventCount).toBe(121);
    expect(await events()).toHaveLength(22);
  });

  it("still stores the first event from each new user so usersAffected keeps growing", async () => {
    for (let i = 0; i < 25; i += 1) {
      await ingestException(
        SCOPE,
        baseRaw(),
        derivedFor({ userKey: "u-first", anonymousId: "u-first" }),
      );
    }
    await ingestException(
      SCOPE,
      baseRaw(),
      derivedFor({ userKey: "u-late", anonymousId: "u-late" }),
    );
    const [issue] = await issues();
    expect(issue).toMatchObject({ eventCount: 26, usersAffected: 2 });
  });

  it("keeps the issue open and fresh while sampling", async () => {
    for (let i = 0; i < 22; i += 1) {
      await ingestException(SCOPE, baseRaw(), derivedFor({ userKey: "u" }));
    }
    await db().update(schema.errorIssues).set({ status: "resolved" });
    recordChangeMock.mockClear();
    const result = await ingestException(
      SCOPE,
      baseRaw(),
      derivedFor({ userKey: "u", timestamp: "2026-09-30T00:00:00.000Z" }),
    );
    const [issue] = await issues();
    expect(result.stored).toBe(false);
    expect(issue.status).toBe("unresolved");
    expect(issue.eventCount).toBe(23);
    // The reopen goes through the sampled path, which must still refresh the list.
    expect(recordChangeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "error-issues",
        type: "change",
        key: issue.id,
      }),
    );

    // A plain count bump on an open issue does not.
    recordChangeMock.mockClear();
    await ingestException(SCOPE, baseRaw(), derivedFor({ userKey: "u" }));
    expect(recordChangeMock).not.toHaveBeenCalled();
  });

  it("always stores the pipeline test event", async () => {
    for (let i = 0; i < 30; i += 1) {
      await captureTestError({ userEmail: SCOPE.ownerEmail, orgId: null });
    }
    const result = await captureTestError({
      userEmail: SCOPE.ownerEmail,
      orgId: null,
    });
    expect(result.eventId).toEqual(expect.stringMatching(/^errev_/));
    expect(await events()).toHaveLength(31);
  });

  it("surfaces dropped ingests with a distinguishable error-level log and a counter", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    getDbMock.mockImplementation(() => {
      throw new Error("password authentication failed for user 'neondb_owner'");
    });

    const result = await ingestAnalyticsExceptionEvents(SCOPE, [
      {
        properties: exceptionProperties({
          exceptionStack: "Error: x\n    at f (https://a.test/a.js:1:1)",
        }),
        derived: derivedFor(),
      },
      {
        properties: exceptionProperties({
          exceptionMessage: "another",
          exceptionStack: "Error: x\n    at f (https://a.test/a.js:1:1)",
        }),
        derived: derivedFor(),
      },
    ]);

    expect(result).toMatchObject({ ingested: 0, failed: 2 });
    expect(getErrorIngestStats().failed).toBe(2);
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(String(errorLog.mock.calls[0][0])).toContain(
      "[error-capture] INGEST_DROPPED",
    );

    // The log is throttled so an outage does not turn into a log flood.
    recordErrorIngestFailure(5, new Error("still down"));
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(getErrorIngestStats().failed).toBe(7);
    vi.setSystemTime(new Date("2026-10-01T12:01:00.000Z"));
    recordErrorIngestFailure(1, new Error("still down"));
    expect(errorLog).toHaveBeenCalledTimes(2);
    expect(String(errorLog.mock.calls[1][0])).toContain('"dropped":7');
  });
});
