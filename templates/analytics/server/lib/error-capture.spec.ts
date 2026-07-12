import { createClient, type Client } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());
const recordChangeMock = vi.hoisted(() => vi.fn());
const appStateGetMock = vi.hoisted(() => vi.fn());
const notifyWithDeliveryMock = vi.hoisted(() => vi.fn(async () => undefined));

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

vi.mock("@agent-native/core/application-state", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@agent-native/core/application-state")
    >();
  return {
    ...actual,
    appStateGet: appStateGetMock,
  };
});

vi.mock("@agent-native/core/notifications", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/notifications")>();
  return { ...actual, notifyWithDelivery: notifyWithDeliveryMock };
});

import { schema } from "../db/index.js";
import {
  anonymizeErrorReportingEmails,
  candidateFingerprintsForConsole,
  culpritFromFrames,
  deriveConsoleExceptionIdentity,
  extractExceptionInput,
  fingerprint,
  getErrorIssue,
  ingestException,
  listErrorIssues,
  matchErrorIssuesBySignatures,
  normalizeFrameFile,
  parseStack,
  sourceContextFromText,
  titleFromException,
  trustedSourceRelativePath,
  type DerivedExceptionFields,
  type RawExceptionInput,
} from "./error-capture";

beforeEach(() => {
  appStateGetMock.mockReset();
  appStateGetMock.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

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
    // `async ` prefix is stripped from the function name.
    expect(frames[1].function).toBe("handler");
    // cdn/vendor files are flagged not-in-app.
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
  });

  it("falls back to a normalized message when there is no usable stack", () => {
    // Numbers/urls/uuids are normalized so "id 1" and "id 2" group together.
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
    // "Failed to fetch: /x" has a space in the prefix → not an error name.
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

describe("anonymizeErrorReportingEmails", () => {
  it("replaces emails throughout error details, including URLs and identities", () => {
    expect(
      anonymizeErrorReportingEmails({
        title: "Failure for alice@example.com",
        events: [
          {
            userId: "alice@example.com",
            userKey: "alice@example.com",
            url: "https://app.example.com/error?email=alice@example.com",
            tags: { reporter: "bob@example.com" },
            breadcrumbs: [{ message: "Signed in as bob@example.com" }],
          },
        ],
      }),
    ).toEqual({
      title: "Failure for anonymous@builder.io",
      events: [
        {
          userId: "anonymous@builder.io",
          userKey: "anonymous@builder.io",
          url: "https://app.example.com/error?email=anonymous@builder.io",
          tags: { reporter: "anonymous@builder.io" },
          breadcrumbs: [{ message: "Signed in as anonymous@builder.io" }],
        },
      ],
    });
  });
});

describe("candidateFingerprintsForConsole", () => {
  const stack =
    "TypeError: x is not a function\n    at doThing (https://app.example.com/main.js:12:34)";

  it("matches the fingerprint ingest computes for the same underlying error", () => {
    // The recorder serializes a window error as `${name}: ${message}` + stack;
    // resolving that must land on the exact fingerprint ingest filed it under.
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
    // The SDK renames a bare `Error` reason to `UnhandledRejection` at capture,
    // so the resolver offers both candidates for reliable matching.
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
    // tag values are coerced to strings.
    expect(input.tags).toEqual({ area: "checkout", count: "3" });
    expect(input.extra).toEqual({ cartId: "c1" });
    expect(input.breadcrumbs).toHaveLength(1);
  });

  it("defaults type to Error and coerces unknown levels", () => {
    const input = extractExceptionInput({ level: "not-a-level" });
    expect(input.type).toBe("Error");
    expect(input.level).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// ingestException upsert behavior (real in-memory libsql DB)
// ---------------------------------------------------------------------------

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
    ...overrides,
  };
}

const SCOPE = { ownerEmail: "alice@example.com", orgId: null };

async function createTables(client: Client): Promise<void> {
  await client.execute(`
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
      created_at text NOT NULL DEFAULT (datetime('now')),
      updated_at text NOT NULL DEFAULT (datetime('now')),
      owner_email text NOT NULL DEFAULT 'local@localhost',
      org_id text,
      visibility text NOT NULL DEFAULT 'private'
    )
  `);
  await client.execute(`
    CREATE TABLE error_issue_shares (
      id text PRIMARY KEY,
      resource_id text NOT NULL,
      principal_type text NOT NULL,
      principal_id text NOT NULL,
      role text NOT NULL DEFAULT 'viewer',
      created_by text NOT NULL,
      created_at text NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await client.execute(`
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
      handled integer NOT NULL DEFAULT 1,
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
      created_at text NOT NULL DEFAULT (datetime('now')),
      owner_email text NOT NULL DEFAULT 'local@localhost',
      org_id text
    )
  `);
}

describe("ingestException", () => {
  let client: Client;

  beforeEach(async () => {
    client = createClient({ url: ":memory:" });
    await createTables(client);
    const db = drizzle(client, { schema });
    getDbMock.mockReturnValue(db);
    recordChangeMock.mockReset();
    notifyWithDeliveryMock.mockClear();
  });

  afterEach(() => {
    client.close();
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
    // A brand new issue raises a best-effort notification.
    expect(notifyWithDeliveryMock).toHaveBeenCalledTimes(1);
  });

  it("bumps counts and first/last seen on repeat occurrences (same fingerprint)", async () => {
    const first = await ingestException(
      SCOPE,
      baseRaw(),
      derivedFor({ timestamp: "2026-07-08T12:00:00.000Z", userKey: "u1" }),
    );
    const second = await ingestException(
      SCOPE,
      // Same top in-app frame but different line/col → same fingerprint.
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
    // Only the first (new) issue notifies.
    expect(notifyWithDeliveryMock).toHaveBeenCalledTimes(1);
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
    await db
      .update(schema.errorEvents)
      .set({ sessionRecordingId: "sr_tim" })
      .where(eq(schema.errorEvents.id, tim.eventId));
    await db
      .update(schema.errorEvents)
      .set({ sessionRecordingId: "sr_other" })
      .where(eq(schema.errorEvents.id, other.eventId));

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
      .where(eq(schema.errorEvents.id, tim.eventId));

    const issues = await listErrorIssues(
      { userEmail: SCOPE.ownerEmail, orgId: null },
      { userId: "other@example.com", sessionRecordingId: "sr_other" },
    );
    expect(issues).toEqual([]);
  });

  it("anonymizes list and detail reads at the server seam in demo mode", async () => {
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

    appStateGetMock.mockResolvedValue({ enabled: true });

    const issues = await listErrorIssues({
      userEmail: SCOPE.ownerEmail,
      orgId: null,
    });
    const detail = await getErrorIssue(
      { userEmail: SCOPE.ownerEmail, orgId: null },
      result.issueId,
    );
    const rendered = JSON.stringify({ issues, detail });

    expect(appStateGetMock).toHaveBeenCalledWith(SCOPE.ownerEmail, "demo-mode");
    expect(rendered).toContain("anonymous@builder.io");
    expect(rendered).not.toContain("customer@example.com");
    expect(rendered).not.toContain("support@example.com");
    expect(detail.events[0]).toMatchObject({
      userId: "anonymous@builder.io",
      userKey: "anonymous@builder.io",
      url: "https://app.example.com/checkout?email=anonymous@builder.io",
      tags: { reporter: "anonymous@builder.io" },
      extra: { accountEmail: "anonymous@builder.io" },
    });
  });
});

describe("matchErrorIssuesBySignatures", () => {
  let client: Client;

  beforeEach(async () => {
    client = createClient({ url: ":memory:" });
    await createTables(client);
    const db = drizzle(client, { schema });
    getDbMock.mockReturnValue(db);
    recordChangeMock.mockReset();
    notifyWithDeliveryMock.mockClear();
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
        },
        // A non-captured line resolves to nothing (no link rendered).
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
        },
      ],
    );
    expect(matches["console-1"]).toBeUndefined();
  });
});
