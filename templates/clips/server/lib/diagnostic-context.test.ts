import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import { eq } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { z } from "zod";

import * as schema from "../db/schema.js";
import { DIAGNOSTIC_CONTEXT_MIGRATION_SQL } from "./diagnostic-context-migration.js";

const state = vi.hoisted(() => ({
  db: null as unknown as PgDatabase<PgQueryResultHKT, typeof schema>,
  email: "capture@example.com",
  orgId: "org-a",
  flag: true,
  members: new Set<string>(),
  blobs: new Map<string, Uint8Array>(),
  tokens: new Map<string, { resourceKind: string; resourceId: string }>(),
  deleteFails: false,
  readHook: null as (() => Promise<void>) | null,
}));
vi.mock("../db/index.js", async () => ({
  getDb: () => state.db,
  schema: await import("../db/schema.js"),
}));
vi.mock("@agent-native/core/org", () => ({
  isOrgMember: async (org: string, email: string) =>
    org === "org-a" && state.members.has(email),
}));
vi.mock("@agent-native/core/feature-flags", () => ({
  isFeatureFlagEnabled: async () => state.flag,
}));
vi.mock("@agent-native/core/server", () => ({
  getRequestUserEmail: () => state.email,
  getRequestOrgId: () => state.orgId,
  signScopedAgentAccessToken: (scope: {
    resourceKind: string;
    resourceId: string;
  }) => {
    const token = randomUUID();
    state.tokens.set(token, scope);
    return token;
  },
  verifyScopedAgentAccessToken: (
    token: string,
    scope: { resourceKind: string; resourceId: string },
  ) => ({
    ok:
      state.tokens.get(token)?.resourceKind === scope.resourceKind &&
      state.tokens.get(token)?.resourceId === scope.resourceId,
  }),
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: async () => ({
    role: "editor",
    resource: {
      orgId: "org-a",
      expiresAt: null,
      trashedAt: null,
      archivedAt: null,
    },
  }),
}));
vi.mock("./recording-leases.js", () => ({
  claimLease: async () => ({
    key: "diagnostic-context-cleanup",
    token: "test-lease",
    expiresAt: Date.now() + 60_000,
  }),
  releaseLease: async () => {},
  renewLease: async () => true,
}));
vi.mock("@agent-native/core/private-blob", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@agent-native/core/private-blob")>();
  return {
    ...original,
    putPrivateBlob: async ({ data }: { data: Uint8Array }) => {
      const id = randomUUID();
      state.blobs.set(id, data);
      return { id, provider: "test-private", opaque: true, encrypted: true };
    },
    readPrivateBlob: async (handle: { id: string }) => {
      await state.readHook?.();
      const data = state.blobs.get(handle.id);
      if (!data) throw new original.PrivateBlobError("missing", "not_found");
      return { data, handle };
    },
    deletePrivateBlob: async (handle: { id: string }) => {
      if (state.deleteFails) return { deleted: false, reason: "unavailable" };
      state.blobs.delete(handle.id);
      return { deleted: true };
    },
  };
});

import createGrant from "../../actions/create-recording-diagnostic-grant.js";
import revokeGrant from "../../actions/revoke-recording-diagnostic-grant.js";
import shareContext from "../../actions/share-recording-diagnostic-context.js";
import unshareContext from "../../actions/unshare-recording-diagnostic-context.js";
import {
  authorizeDiagnosticCapture,
  checkDiagnosticCaptureAuthorization,
  cleanupDiagnosticContexts,
  createDiagnosticGrant,
  readDiagnosticContext,
  removeDiagnosticContext,
  resolveRecordingDiagnosticAccess,
  saveDiagnosticContext,
  sealRecordingDiagnostics,
} from "./diagnostic-context.js";

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
let client: Awaited<ReturnType<typeof PGlite.create>>;
let start = Date.now() - 10000;
const iso = (ms: number) => new Date(ms).toISOString();

function requireTestValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected test fixture value.");
  return value;
}

async function capture() {
  const captureId = randomUUID();
  const approval = await authorizeDiagnosticCapture("video", true, captureId);
  return {
    recordingId: "video",
    captureId,
    contextVersion: 1,
    consent: true as const,
    captureAuthorization: approval.captureAuthorization,
    recordingStartedAt: iso(start),
    requestedWindow: { from: iso(start - 30000), to: iso(start + 5000) },
    captured: "partial" as const,
    coverage: [
      { documentId: "doc", from: iso(start - 1000), to: iso(start + 5000) },
    ],
    gaps: [
      { from: iso(start - 30000), to: iso(start - 1000), reason: "retention" },
    ],
    pauses: [] as Array<{ from: string; to: string }>,
    droppedEvents: 2,
    activity: {
      sources: [
        { documentId: "doc", app: "private app", build: "secret-build" },
      ],
      sourceCoverage: [
        { documentId: "doc", fromMs: start - 1000, toMs: start + 5000 },
      ],
      collectionOutcomes: [
        { atMs: start, status: "denied", reason: "outside" },
        { atMs: start + 1000, status: "ready", reason: "inside" },
      ],
      app: "private app",
      build: "secret-build",
      recordingStartedAtMs: start,
      requestedWindow: { fromMs: start - 30000, toMs: start + 5000 },
      watchedAtMs: start + 4500,
      pendingAtMs: start + 4500,
      coverage: [{ fromElapsedMs: -1000, toElapsedMs: 5000 }],
      dropped: 2,
      events: [
        {
          documentId: "doc",
          seq: 1,
          timestampMs: start,
          elapsedMs: 0,
          type: "action",
          name: "outside",
          ok: false,
        },
        {
          documentId: "doc",
          seq: 2,
          timestampMs: start + 1000,
          elapsedMs: 1000,
          type: "action",
          name: "inside",
        },
        {
          documentId: "doc",
          seq: 3,
          timestampMs: start + 1000,
          elapsedMs: 1000,
          type: "action",
          name: "same-ms",
        },
      ],
      watched: { selection: "private state" },
      pending: [{ type: "action", name: "private pending", ageMs: 100 }],
    },
    browserDiagnostics: {
      pageUrl: "https://private.example.com",
      consoleLogs: [
        { elapsedMs: 0, message: "outside" },
        { elapsedMs: 1000, message: "inside" },
      ],
      networkRequests: [],
      summary: { consoleCount: 400 },
    },
    hostMetadata: {
      url: "https://private.example.com",
      authorization: "never store",
    },
  };
}

beforeAll(async () => {
  client = await PGlite.create("memory://");
  await client.exec(
    `CREATE TABLE recordings (id TEXT PRIMARY KEY,owner_email TEXT NOT NULL DEFAULT 'capture@example.com',org_id TEXT NOT NULL DEFAULT 'org-a',expires_at TEXT,trashed_at TEXT,archived_at TEXT);CREATE TABLE recording_browser_diagnostics (recording_id TEXT PRIMARY KEY,app_activity_blob_json TEXT);CREATE TABLE recording_bug_reports (recording_id TEXT PRIMARY KEY);INSERT INTO recordings(id) VALUES ('video');${DIAGNOSTIC_CONTEXT_MIGRATION_SQL}`,
  );
  state.db = drizzle(client, { schema });
});
afterAll(async () => client.close());
beforeEach(async () => {
  await client.exec(
    "TRUNCATE recording_diagnostic_contexts,recording_diagnostic_grants,recording_diagnostic_context_shares,recording_diagnostic_cleanup,recording_browser_diagnostics,recording_bug_reports",
  );
  state.email = "capture@example.com";
  state.orgId = "org-a";
  state.flag = true;
  state.members = new Set([
    state.email,
    "editor@example.com",
    "reader@example.com",
  ]);
  state.blobs.clear();
  state.tokens.clear();
  state.deleteFails = false;
  state.readHook = null;
  start = Date.now() - 10000;
});

describe("private diagnostic evidence", () => {
  it("keeps bearer grant creation and named sharing UI-only", () => {
    expect(createGrant.agentTool).toBe(false);
    expect(shareContext.agentTool).toBe(false);
  });

  it("saves without a browser row, binds owner to the collector, and retries immutable payload idempotently", async () => {
    const input = await capture();
    const saved = await saveDiagnosticContext(input);
    state.flag = false;
    expect(await saveDiagnosticContext(input)).toEqual(saved);
    expect(state.blobs.size).toBe(1);
    await expect(
      saveDiagnosticContext({ ...input, droppedEvents: 9 }),
    ).rejects.toMatchObject({ errorCode: "diagnostic_capture_conflict" });
    expect(
      await state.db.select().from(schema.recordingDiagnosticContexts),
    ).toMatchObject([
      { ownerEmail: "capture@example.com", recordingId: "video" },
    ]);
  });

  it("clips fractional source coverage at the approved stop time", async () => {
    const input = await capture();
    input.activity.sourceCoverage = input.activity.sourceCoverage.map(
      (span) => ({ ...span, toMs: start + 5000.6 }),
    );
    const saved = await saveDiagnosticContext(input);
    const row = requireTestValue(
      (
        await state.db
          .select()
          .from(schema.recordingDiagnosticContexts)
          .where(eq(schema.recordingDiagnosticContexts.id, saved.contextId))
      )[0],
    );
    const blob = JSON.parse(row.blobJson) as { id: string };
    const data = state.blobs.get(blob.id);
    if (!data) throw new Error("Expected saved private context blob.");
    const payload = JSON.parse(new TextDecoder().decode(data)) as {
      activity: { sourceCoverage: Array<{ toMs: number }> };
    };
    expect(payload.activity.sourceCoverage).toMatchObject([
      { toMs: start + 5000 },
    ]);
  });

  it("rejects receipt transfer to another editor or organization before evidence can save", async () => {
    const input = await capture();
    state.email = "editor@example.com";
    await expect(
      checkDiagnosticCaptureAuthorization(
        "video",
        input.captureId,
        input.captureAuthorization,
      ),
    ).rejects.toMatchObject({
      errorCode: "diagnostic_capture_authorization_invalid",
    });
    await expect(saveDiagnosticContext(input)).rejects.toMatchObject({
      errorCode: "diagnostic_capture_authorization_invalid",
    });
    state.email = "capture@example.com";
    state.orgId = "other-org";
    await expect(saveDiagnosticContext(input)).rejects.toMatchObject({
      errorCode: "diagnostic_capture_authorization_invalid",
    });
    expect(state.blobs.size).toBe(0);
  });

  it("does not use video editor or organization membership as diagnostic authority", async () => {
    const saved = await saveDiagnosticContext(await capture());
    state.email = "editor@example.com";
    await expect(
      resolveRecordingDiagnosticAccess({ recordingId: "video" }),
    ).rejects.toMatchObject({ errorCode: "diagnostic_denied" });
    await state.db
      .update(schema.recordingDiagnosticContexts)
      .set({ visibility: "org" })
      .where(eq(schema.recordingDiagnosticContexts.id, saved.contextId));
    await expect(
      resolveRecordingDiagnosticAccess({ contextId: saved.contextId }),
    ).rejects.toMatchObject({ errorCode: "diagnostic_denied" });
  });

  it("enforces named same-org shares and revocation independently of video", async () => {
    const saved = await saveDiagnosticContext(await capture());
    await shareContext.run(
      { contextId: saved.contextId, email: "READER@EXAMPLE.COM" },
      { caller: "frontend" },
    );
    state.email = "reader@example.com";
    expect(
      (await resolveRecordingDiagnosticAccess({ contextId: saved.contextId }))
        .canManage,
    ).toBe(false);
    await expect(
      createDiagnosticGrant({
        contextId: saved.contextId,
        label: "no",
        scopes: ["events"],
      }),
    ).rejects.toMatchObject({ errorCode: "diagnostic_owner_required" });
    state.email = "capture@example.com";
    await expect(
      shareContext.run(
        { contextId: saved.contextId, email: "outside@example.com" },
        { caller: "frontend" },
      ),
    ).rejects.toMatchObject({
      errorCode: "diagnostic_recipient_membership_required",
    });
    await unshareContext.run(
      { contextId: saved.contextId, email: "reader@example.com" },
      { caller: "frontend" },
    );
    state.email = "reader@example.com";
    await expect(
      resolveRecordingDiagnosticAccess({ contextId: saved.contextId }),
    ).rejects.toMatchObject({ errorCode: "diagnostic_denied" });
  });

  it("filters scopes and interval before counts and samples while preserving identical-time events", async () => {
    const saved = await saveDiagnosticContext(await capture());
    const grant = await createDiagnosticGrant({
      contextId: saved.contextId,
      label: "bounded",
      scopes: ["summary", "events", "state", "browser-diagnostics"],
      fromMs: 1000,
      toMs: 2000,
    });
    state.email = "";
    const access = await resolveRecordingDiagnosticAccess({
      contextId: saved.contextId,
      diagnosticAccess: grant.diagnosticAccess,
    });
    const page = await readDiagnosticContext(access, { maxEvents: 1 });
    expect(page).toMatchObject({
      summary: { eventCount: 2, failureCount: 0, failures: [] },
      events: [{ seq: 2, name: "inside" }],
      matchedCount: 2,
      truncated: true,
      nextStart: 1,
      browserDiagnostics: {
        consoleLogs: [{ elapsedMs: 1000, message: "inside" }],
      },
    });
    for (const field of ["watched", "pending", "hostMetadata"])
      expect(page).not.toHaveProperty(field);
    expect(page.context).not.toHaveProperty("gaps");
    expect(page.context).not.toHaveProperty("ownerEmail");
    expect(page.summary).not.toHaveProperty("app");
    const next = await readDiagnosticContext(access, {
      start: 1,
      maxEvents: 1,
    });
    expect(next.events).toMatchObject([{ seq: 3, name: "same-ms" }]);
  });

  it("paginates each approved browser stream and recomputes counts inside the grant interval", async () => {
    const input = {
      ...(await capture()),
      browserDiagnostics: {
        consoleLogs: [
          { elapsedMs: 0, level: "error", message: "outside" },
          ...Array.from({ length: 5 }, (_, index) => ({
            elapsedMs: 1000 + index,
            level: "error",
            message: `inside-${index}`,
          })),
        ],
        networkRequests: Array.from({ length: 4 }, (_, index) => ({
          elapsedMs: 1000 + index,
          status: 500,
          url: `https://example.com/${index}`,
        })),
      },
    };
    const saved = await saveDiagnosticContext(input),
      grant = await createDiagnosticGrant({
        contextId: saved.contextId,
        label: "browser",
        scopes: ["browser-diagnostics"],
        fromMs: 1000,
        toMs: 2000,
      });
    const access = await resolveRecordingDiagnosticAccess({
      diagnosticAccess: grant.diagnosticAccess,
    });
    const first = await readDiagnosticContext(access, { maxEvents: 2 });
    expect(first).toMatchObject({
      browserDiagnostics: {
        consoleLogs: [{ message: "inside-0" }, { message: "inside-1" }],
        networkRequests: [{ status: 500 }, { status: 500 }],
        pages: {
          consoleLogs: { matchedCount: 5, truncated: true, nextStart: 2 },
          networkRequests: { matchedCount: 4, truncated: true, nextStart: 2 },
        },
        summary: {
          consoleCount: 5,
          consoleErrorCount: 5,
          networkCount: 4,
          networkFailureCount: 4,
        },
      },
    });
    expect(first).not.toHaveProperty("events");
    expect(first).not.toHaveProperty("hostMetadata");
    expect(
      await readDiagnosticContext(access, { start: 2, maxEvents: 2 }),
    ).toMatchObject({
      browserDiagnostics: {
        consoleLogs: [{ message: "inside-2" }, { message: "inside-3" }],
        networkRequests: [{ status: 500 }, { status: 500 }],
        pages: { networkRequests: { matchedCount: 4, truncated: false } },
      },
    });
  });

  it("clamps broad browser grants to the approved absolute capture interval before counts or pagination", async () => {
    const input = {
      ...(await capture()),
      browserDiagnostics: {
        consoleLogs: [
          { elapsedMs: -30001, message: "unapproved history" },
          { elapsedMs: 1000, message: "approved" },
          { elapsedMs: 5001, message: "after capture" },
        ],
        networkRequests: [],
      },
    };
    const saved = await saveDiagnosticContext(input),
      grant = await createDiagnosticGrant({
        contextId: saved.contextId,
        label: "whole approved capture",
        scopes: ["browser-diagnostics"],
      });
    const result = await readDiagnosticContext(
      await resolveRecordingDiagnosticAccess({
        diagnosticAccess: grant.diagnosticAccess,
      }),
      { maxEvents: 1 },
    );
    expect(result).toMatchObject({
      browserDiagnostics: {
        consoleLogs: [{ message: "approved" }],
        pages: { consoleLogs: { matchedCount: 1, truncated: false } },
        summary: { consoleCount: 1 },
      },
    });
    const owner = await readDiagnosticContext(
      await resolveRecordingDiagnosticAccess({ contextId: saved.contextId }),
      {},
    );
    expect(owner.context).toHaveProperty("coverage");
  });

  it("rejects malformed browser events instead of saving a successful empty stream", async () => {
    const input = await capture();
    await expect(
      saveDiagnosticContext({
        ...input,
        browserDiagnostics: { consoleLogs: [{ elapsedMs: "invalid" }] },
      }),
    ).rejects.toMatchObject({ errorCode: "diagnostic_input_invalid" });
    expect(state.blobs.size).toBe(0);
  });

  it("uses the media clock after pauses for timestamped state and respects category-only grants", async () => {
    const input = await capture();
    input.pauses = [{ from: iso(start + 1000), to: iso(start + 3000) }];
    const saved = await saveDiagnosticContext(input);
    const stateGrant = await createDiagnosticGrant({
      contextId: saved.contextId,
      label: "after pause",
      scopes: ["state"],
      fromMs: 2400,
      toMs: 2600,
    });
    const statePage = await readDiagnosticContext(
      await resolveRecordingDiagnosticAccess({
        diagnosticAccess: stateGrant.diagnosticAccess,
      }),
      {},
    );
    expect(statePage).toMatchObject({
      watched: { selection: "private state" },
      watchedAtMs: start + 4500,
    });
    expect(statePage).not.toHaveProperty("events");
    expect(statePage).not.toHaveProperty("summary");
    const eventsGrant = await createDiagnosticGrant({
      contextId: saved.contextId,
      label: "events",
      scopes: ["events"],
    });
    const eventsPage = await readDiagnosticContext(
      await resolveRecordingDiagnosticAccess({
        diagnosticAccess: eventsGrant.diagnosticAccess,
      }),
      {},
    );
    for (const key of [
      "summary",
      "watched",
      "pending",
      "hostMetadata",
      "browserDiagnostics",
    ])
      expect(eventsPage).not.toHaveProperty(key);
    expect(eventsPage.context).not.toHaveProperty("coverage");
  });

  it("denies revoked, expired, replaced and offboarded grants on the next read", async () => {
    const input = await capture();
    const saved = await saveDiagnosticContext(input);
    const revoked = await createDiagnosticGrant({
      contextId: saved.contextId,
      label: "revoke",
      scopes: ["events"],
    });
    await revokeGrant.run({ grantId: revoked.grantId }, { caller: "frontend" });
    await expect(
      resolveRecordingDiagnosticAccess({
        diagnosticAccess: revoked.diagnosticAccess,
      }),
    ).rejects.toMatchObject({ errorCode: "diagnostic_revoked" });
    const expired = await createDiagnosticGrant({
      contextId: saved.contextId,
      label: "expiry",
      scopes: ["events"],
    });
    await state.db
      .update(schema.recordingDiagnosticGrants)
      .set({ expiresAt: iso(Date.now() - 1) })
      .where(eq(schema.recordingDiagnosticGrants.id, expired.grantId));
    await expect(
      resolveRecordingDiagnosticAccess({
        diagnosticAccess: expired.diagnosticAccess,
      }),
    ).rejects.toMatchObject({ errorCode: "diagnostic_expired" });
    const replaced = await createDiagnosticGrant({
      contextId: saved.contextId,
      label: "replace",
      scopes: ["events"],
    });
    await saveDiagnosticContext({ ...input, contextVersion: 2 });
    await expect(
      resolveRecordingDiagnosticAccess({
        diagnosticAccess: replaced.diagnosticAccess,
      }),
    ).rejects.toMatchObject({ errorCode: "diagnostic_revoked" });
    const latest = await resolveRecordingDiagnosticAccess({
      recordingId: "video",
    });
    const offboarded = await createDiagnosticGrant({
      contextId: latest.context.id,
      label: "offboard",
      scopes: ["events"],
    });
    state.members.delete("capture@example.com");
    await expect(
      resolveRecordingDiagnosticAccess({
        diagnosticAccess: offboarded.diagnosticAccess,
      }),
    ).rejects.toMatchObject({ errorCode: "diagnostic_membership_required" });
  });

  it("reauthorizes after storage reads and never falls back to a global summary when evidence is missing", async () => {
    const saved = await saveDiagnosticContext(await capture());
    const grant = await createDiagnosticGrant({
      contextId: saved.contextId,
      label: "read",
      scopes: ["summary"],
    });
    const access = await resolveRecordingDiagnosticAccess({
      diagnosticAccess: grant.diagnosticAccess,
    });
    state.readHook = async () => {
      await state.db
        .update(schema.recordingDiagnosticGrants)
        .set({ revokedAt: iso(Date.now()) })
        .where(eq(schema.recordingDiagnosticGrants.id, grant.grantId));
    };
    await expect(readDiagnosticContext(access, {})).rejects.toMatchObject({
      errorCode: "diagnostic_revoked",
    });
    state.readHook = null;
    const owner = await resolveRecordingDiagnosticAccess({
      contextId: saved.contextId,
    });
    state.blobs.clear();
    await expect(readDiagnosticContext(owner, {})).rejects.toMatchObject({
      errorCode: "diagnostic_storage_not_found",
    });
  });

  it("reports corrupt payloads and stored metadata distinctly from absent evidence", async () => {
    const saved = await saveDiagnosticContext(await capture());
    const access = await resolveRecordingDiagnosticAccess({
      contextId: saved.contextId,
    });
    const handle = z
      .object({ id: z.string() })
      .parse(JSON.parse(access.context.blobJson));
    state.blobs.set(handle.id, new TextEncoder().encode("null"));
    await expect(readDiagnosticContext(access, {})).rejects.toMatchObject({
      errorCode: "diagnostic_storage_corrupt",
      statusCode: 503,
    });
    await state.db
      .update(schema.recordingDiagnosticContexts)
      .set({ captured: "invented" })
      .where(eq(schema.recordingDiagnosticContexts.id, saved.contextId));
    await expect(readDiagnosticContext(access, {})).rejects.toMatchObject({
      errorCode: "diagnostic_metadata_corrupt",
      statusCode: 503,
    });
  });

  it("shows bounded source identity and read outcomes only in approved categories and intervals", async () => {
    const saved = await saveDiagnosticContext(await capture());
    const owner = await readDiagnosticContext(
      await resolveRecordingDiagnosticAccess({ contextId: saved.contextId }),
      {},
    );
    expect(owner).toMatchObject({
      sources: [
        { documentId: "doc", app: "private app", build: "secret-build" },
      ],
      collectionOutcomes: [{ reason: "outside" }, { reason: "inside" }],
    });
    const grant = await createDiagnosticGrant({
      contextId: saved.contextId,
      label: "outcomes",
      scopes: ["summary"],
      fromMs: 1000,
      toMs: 2000,
    });
    const page = await readDiagnosticContext(
      await resolveRecordingDiagnosticAccess({
        diagnosticAccess: grant.diagnosticAccess,
      }),
      {},
    );
    expect(page).toMatchObject({ collectionOutcomes: [{ reason: "inside" }] });
    expect(page).not.toHaveProperty("sources");
  });

  it("atomically revokes every capture owner and persists cleanup when its recording is permanently removed", async () => {
    const saved = await saveDiagnosticContext(await capture());
    const grant = await createDiagnosticGrant({
      contextId: saved.contextId,
      label: "removed video",
      scopes: ["events"],
    });
    await state.db.transaction(async (tx) => {
      await sealRecordingDiagnostics(tx, "video");
      await tx
        .delete(schema.recordings)
        .where(eq(schema.recordings.id, "video"));
    });
    await expect(
      resolveRecordingDiagnosticAccess({
        diagnosticAccess: grant.diagnosticAccess,
      }),
    ).rejects.toMatchObject({ errorCode: "diagnostic_revoked" });
    expect(
      await state.db.select().from(schema.recordingDiagnosticCleanup),
    ).toHaveLength(1);
    await client.exec("INSERT INTO recordings(id) VALUES('video')");
  });

  it("cleans orphaned and newly expired recording evidence while preserving reversible trash", async () => {
    const input = await capture();
    let saved = await saveDiagnosticContext(input);
    await state.db
      .update(schema.recordings)
      .set({ trashedAt: iso(Date.now()) })
      .where(eq(schema.recordings.id, "video"));
    expect(await cleanupDiagnosticContexts()).toMatchObject({
      expired: 0,
      deleted: 0,
    });
    await state.db
      .update(schema.recordings)
      .set({ trashedAt: null, expiresAt: iso(Date.now() - 1) })
      .where(eq(schema.recordings.id, "video"));
    expect(await cleanupDiagnosticContexts()).toMatchObject({
      expired: 1,
      deleted: 1,
    });
    await state.db
      .update(schema.recordings)
      .set({ expiresAt: null })
      .where(eq(schema.recordings.id, "video"));
    saved = await saveDiagnosticContext(await capture());
    await state.db
      .delete(schema.recordings)
      .where(eq(schema.recordings.id, "video"));
    expect(await cleanupDiagnosticContexts()).toMatchObject({
      expired: 1,
      deleted: 1,
    });
    expect(
      await state.db
        .select()
        .from(schema.recordingDiagnosticContexts)
        .where(eq(schema.recordingDiagnosticContexts.id, saved.contextId)),
    ).toMatchObject([{ removedAt: expect.any(String) }]);
    await client.exec("INSERT INTO recordings(id) VALUES('video')");
  });

  it("preserves a same-organization editor's context when the recording owner differs", async () => {
    state.email = "editor@example.com";
    await saveDiagnosticContext(await capture());

    expect(await cleanupDiagnosticContexts()).toMatchObject({ expired: 0 });
    expect(
      await state.db.select().from(schema.recordingDiagnosticContexts),
    ).toMatchObject([{ ownerEmail: "editor@example.com", removedAt: null }]);
  });

  it.each(["2000-01-01T00:00:00Z", "not-a-date"])(
    "denies private evidence when its recording expiry cannot authorize access: %s",
    async (expiresAt) => {
      const saved = await saveDiagnosticContext(await capture());
      await state.db
        .update(schema.recordings)
        .set({ expiresAt })
        .where(eq(schema.recordings.id, "video"));
      await expect(
        resolveRecordingDiagnosticAccess({ contextId: saved.contextId }),
      ).rejects.toMatchObject({
        errorCode: "diagnostic_recording_unavailable",
        statusCode: 410,
      });
      await state.db
        .update(schema.recordings)
        .set({ expiresAt: null })
        .where(eq(schema.recordings.id, "video"));
    },
  );

  it("never deletes an active blob queued by an uncertain commit outcome", async () => {
    const saved = await saveDiagnosticContext(await capture());
    const context = (
      await state.db
        .select()
        .from(schema.recordingDiagnosticContexts)
        .where(eq(schema.recordingDiagnosticContexts.id, saved.contextId))
    )
      .values()
      .next().value;
    if (!context) throw new Error("Expected saved context.");
    await state.db
      .insert(schema.recordingDiagnosticCleanup)
      .values({ contextId: context.id, blobJson: context.blobJson });
    expect(await cleanupDiagnosticContexts()).toMatchObject({
      deleted: 0,
      pending: 0,
    });
    expect(state.blobs.size).toBe(1);
    expect(
      await readDiagnosticContext(
        await resolveRecordingDiagnosticAccess({ contextId: context.id }),
        {},
      ),
    ).toMatchObject({
      events: [{ name: "outside" }, { name: "inside" }, { name: "same-ms" }],
    });
  });

  it("rejects backwards, out-of-window, and overlapping pause metadata before saving", async () => {
    const input = await capture();
    for (const invalid of [
      {
        ...input,
        coverage: [
          { documentId: "doc", from: iso(start + 5000), to: iso(start) },
        ],
      },
      {
        ...input,
        gaps: [{ from: iso(start - 40000), to: iso(start), reason: "invalid" }],
      },
      {
        ...input,
        pauses: [
          { from: iso(start + 1000), to: iso(start + 3000) },
          { from: iso(start + 2000), to: iso(start + 4000) },
        ],
      },
    ])
      await expect(saveDiagnosticContext(invalid)).rejects.toThrow();
    expect(state.blobs.size).toBe(0);
  });

  it("removes access before deletion, retains failed cleanup and retries it durably", async () => {
    const saved = await saveDiagnosticContext(await capture());
    const grant = await createDiagnosticGrant({
      contextId: saved.contextId,
      label: "cleanup",
      scopes: ["events"],
    });
    await removeDiagnosticContext(saved.contextId);
    state.deleteFails = true;
    expect(await cleanupDiagnosticContexts()).toMatchObject({
      deleted: 0,
      pending: 1,
    });
    await expect(
      resolveRecordingDiagnosticAccess({
        diagnosticAccess: grant.diagnosticAccess,
      }),
    ).rejects.toMatchObject({ errorCode: "diagnostic_revoked" });
    expect(
      await state.db.select().from(schema.recordingDiagnosticCleanup),
    ).toMatchObject([{ attempts: 1 }]);
    state.deleteFails = false;
    await state.db
      .update(schema.recordingDiagnosticCleanup)
      .set({ nextAttemptAt: iso(Date.now() - 1) })
      .where(eq(schema.recordingDiagnosticCleanup.contextId, saved.contextId));
    expect(await cleanupDiagnosticContexts()).toMatchObject({
      deleted: 1,
      pending: 0,
    });
    expect(state.blobs.size).toBe(0);
    expect(await client.query("SELECT id FROM recordings")).toMatchObject({
      rows: [{ id: "video" }],
    });
  });

  it("queues expired legacy diagnostic blobs for private deletion and purges legacy reports", async () => {
    const handle = {
      id: randomUUID(),
      provider: "test-private",
      opaque: true,
      encrypted: true,
    };
    state.blobs.set(handle.id, new Uint8Array([1, 2, 3]));
    await client.query(
      "INSERT INTO recordings(id,expires_at) VALUES ('expired-video',$1)",
      [iso(Date.now() - 1000)],
    );
    await client.query(
      "INSERT INTO recording_browser_diagnostics(recording_id,app_activity_blob_json) VALUES ('expired-video',$1)",
      [JSON.stringify(handle)],
    );
    await client.query(
      "INSERT INTO recording_bug_reports(recording_id) VALUES ('expired-video')",
    );

    expect(await cleanupDiagnosticContexts()).toMatchObject({
      deleted: 1,
      pending: 0,
    });
    expect(state.blobs.has(handle.id)).toBe(false);
    expect(
      await client.query(
        "SELECT recording_id FROM recording_browser_diagnostics UNION ALL SELECT recording_id FROM recording_bug_reports",
      ),
    ).toMatchObject({ rows: [] });
  });
});
