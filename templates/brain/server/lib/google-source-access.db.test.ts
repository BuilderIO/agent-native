import { AsyncLocalStorage } from "node:async_hooks";

import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BrainSettings } from "../../shared/types.js";
import type { getDb } from "../db/index.js";
import * as schema from "../db/schema.js";
import type { JevClassificationOutcome } from "./jev-classifier.js";
import type { ProviderApiRequestArgs } from "./provider-api.js";

const state = vi.hoisted(() => ({
  db: undefined as ReturnType<typeof getDb> | undefined,
  transactionScope: undefined as
    | AsyncLocalStorage<ReturnType<typeof getDb>>
    | undefined,
  request: vi.fn<(request: ProviderApiRequestArgs) => Promise<unknown>>(),
  connection: vi.fn(),
  classify: vi.fn<() => Promise<JevClassificationOutcome>>(),
  settings: {} as Partial<BrainSettings>,
  assertAccess: vi.fn(),
}));
vi.mock("../db/index.js", async () => ({
  schema: await import("../db/schema.js"),
  getDb: () => {
    const db = state.transactionScope?.getStore() ?? state.db;
    if (!db) throw new Error("Test database is not ready");
    return db;
  },
}));
vi.mock(
  "@agent-native/core/server/request-context",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@agent-native/core/server/request-context")
    >()),
    getRequestUserEmail: () => "qa-fleet@builder.io",
    getRequestOrgId: () => null,
  }),
);
vi.mock("@agent-native/core/sharing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/sharing")>()),
  accessFilter: () => sql`true`,
  assertAccess: state.assertAccess,
}));

vi.mock("@agent-native/core/settings", () => ({
  getOrgSetting: async () => null,
  mutateOrgSetting: async () => undefined,
  getSetting: async () => state.settings,
}));
vi.mock("./jev-classifier.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./jev-classifier.js")>()),
  classifyWithJev: state.classify,
}));
vi.mock("./provider-api.js", () => ({
  executeProviderApiRequest: state.request,
}));
vi.mock("@agent-native/core/workspace-connections", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/workspace-connections")
  >()),
  resolveWorkspaceConnectionForApp: state.connection,
}));
import updateSource from "../../actions/update-source.js";
import { googleSourceScopeKey } from "../../shared/google-source-config.js";
import { listAccessibleAudienceIds } from "./audiences.js";
import { parseJson } from "./brain.js";
import { runConnectorSync } from "./connectors.js";
import {
  invalidateGoogleCaptureAudiences,
  invalidateGoogleSourceAudiences,
} from "./google-source-access.js";

let database: PGlite;
beforeEach(async () => {
  vi.clearAllMocks();
  state.request.mockReset();
  state.classify.mockReset().mockResolvedValue({ configured: false });
  state.settings = {
    privacyClassifier: "deterministic",
    captureSanitizationEnabled: false,
  };
  state.transactionScope = new AsyncLocalStorage<ReturnType<typeof getDb>>();
  state.connection.mockResolvedValue({
    available: true,
    appAccess: {},
    connection: {
      id: "qa-google",
      accountId: "qa-fleet@builder.io",
      ownerEmail: "qa-fleet@builder.io",
    },
  });
  state.assertAccess.mockImplementation(async (_type: string, id: string) => {
    const db = state.transactionScope?.getStore() ?? state.db;
    if (!db) throw new Error("Test database is not ready");
    const rows = await db
      .select()
      .from(schema.brainSources)
      .where(sql`${schema.brainSources.id} = ${id}`)
      .limit(1);
    return { resource: rows.find((row) => row.id === id), role: "editor" };
  });
  database = new PGlite();
  const rootDb = drizzle(database, { schema });
  state.db = new Proxy(rootDb, {
    get(target, property, receiver) {
      if (property === "transaction") {
        return async (
          callback: (tx: ReturnType<typeof getDb>) => Promise<unknown>,
        ) =>
          target.transaction(async (tx) => {
            const scope = state.transactionScope;
            if (!scope) throw new Error("Transaction scope is not ready");
            const scoped = tx as unknown as ReturnType<typeof getDb>;
            return scope.run(scoped, () => callback(scoped));
          });
      }
      return Reflect.get(target, property, receiver);
    },
  }) as unknown as ReturnType<typeof getDb>;
  await database.exec(`
    CREATE TABLE brain_sources (id text PRIMARY KEY, title text DEFAULT 'QA source', provider text DEFAULT 'google_drive', owner_email text DEFAULT 'qa-fleet@builder.io', org_id text, visibility text DEFAULT 'private', config_json text DEFAULT '{}', source_key text, ingest_token_hash text, created_at text DEFAULT '', cursor_json text DEFAULT '{}', last_error text, status text DEFAULT 'active', updated_at text, last_synced_at text);
    CREATE TABLE brain_sensitivity_events (id text PRIMARY KEY, source_id text, locator_hmac text, policy_version text, disposition text);
    CREATE TABLE brain_sync_runs (id text PRIMARY KEY, source_id text, active_source_id text UNIQUE, provider text, status text, stats_json text, error text, lease_token text, lease_expires_at text, started_at text, completed_at text);
    CREATE TABLE brain_audiences (id text PRIMARY KEY, source_id text, membership_state text, updated_at text);
    CREATE TABLE brain_audience_members (audience_id text, principal_type text, principal_id text, status text);
    CREATE TABLE brain_raw_captures (id text PRIMARY KEY, source_id text, external_id text);
    CREATE TABLE brain_capture_audiences (audience_id text, capture_id text);
    CREATE TABLE brain_audience_dependencies (audience_id text, depends_on_audience_id text);
    CREATE TABLE brain_audience_source_dependencies (audience_id text, source_id text);
    INSERT INTO brain_sources (id) VALUES ('google-source'), ('unrelated-source');
    INSERT INTO brain_audiences VALUES ('file-one', 'google-source', 'current', ''), ('file-two', 'google-source', 'current', ''), ('derived', 'google-source', 'current', ''), ('unrelated', 'unrelated-source', 'current', '');
    INSERT INTO brain_audience_members VALUES ('file-one', 'user', 'qa-fleet@builder.io', 'active'), ('file-two', 'user', 'qa-fleet@builder.io', 'active'), ('derived', 'user', 'qa-fleet@builder.io', 'active'), ('unrelated', 'user', 'qa-fleet@builder.io', 'active');
    INSERT INTO brain_raw_captures VALUES ('capture-one', 'google-source', 'google_drive:one'), ('capture-two', 'google-source', 'google_drive:two');
    INSERT INTO brain_capture_audiences VALUES ('file-one', 'capture-one'), ('file-two', 'capture-two');
    INSERT INTO brain_audience_dependencies VALUES ('derived', 'file-one'), ('derived', 'file-two');
    INSERT INTO brain_audience_source_dependencies VALUES ('derived', 'google-source');
  `);
  await state.db
    .update(schema.brainSources)
    .set(source())
    .where(sql`${schema.brainSources.id} = 'google-source'`);
});
afterEach(async () => {
  state.db = undefined;
  await database.close();
});

function source(
  ownerEmail = "qa-fleet@builder.io",
): typeof schema.brainSources.$inferSelect {
  return {
    id: "google-source",
    provider: "google_drive",
    title: "QA Drive",
    ownerEmail,
    visibility: "private",
    orgId: null,
    configJson: JSON.stringify({
      workspaceConnectionId: "qa-google",
      google: { fileIds: ["approved-doc"] },
    }),
    cursorJson: "{}",
    createdAt: "2026-11-18T00:00:00Z",
    updatedAt: "2026-11-18T00:00:00Z",
    status: "active",
    sourceKey: null,
    ingestTokenHash: null,
    lastSyncedAt: null,
    lastError: null,
  };
}

function deferred<T>() {
  let resolveValue: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolveValue = resolve;
  });
  return {
    promise,
    resolve(value: T) {
      if (!resolveValue) throw new Error("Deferred promise not initialized");
      resolveValue(value);
    },
  };
}
async function persistedSource() {
  if (!state.db) throw new Error("Test database is not ready");
  const rows = await state.db
    .select()
    .from(schema.brainSources)
    .where(sql`${schema.brainSources.id} = 'google-source'`);
  const row = rows.find((item) => item.id === "google-source");
  if (!row) throw new Error("Expected persisted source");
  return row;
}

async function seededGmail(continuation = false) {
  if (!state.db) throw new Error("Test database is not ready");
  const input = {
    ...source(),
    provider: "gmail" as const,
    configJson: JSON.stringify({
      workspaceConnectionId: "qa-google",
      google: { query: "newer_than:30d" },
    }),
  };
  if (continuation)
    input.cursorJson = JSON.stringify({
      configKey:
        googleSourceScopeKey(
          "gmail",
          parseJson<Record<string, unknown>>(input.configJson, {}),
        ) + ":qa-fleet@builder.io",
      pageToken: "continuation",
    });
  await state.db
    .update(schema.brainSources)
    .set(input)
    .where(sql`${schema.brainSources.id} = 'google-source'`);
  await database.exec(
    "UPDATE brain_raw_captures SET external_id='gmail:one' WHERE id='capture-one'; UPDATE brain_raw_captures SET external_id='gmail:two' WHERE id='capture-two'",
  );
  return input;
}

describe("Google source access revalidation", () => {
  it.each([
    ["paused", false],
    ["archived", false],
    ["paused", true],
    ["archived", true],
  ] as const)(
    "rejects initially %s sources without reads or withdrawal (staleActiveSnapshot=%s)",
    async (status, staleActiveSnapshot) => {
      if (!state.db) throw new Error("Test database is not ready");
      const input = { ...source(), status };
      await state.db
        .update(schema.brainSources)
        .set(input)
        .where(sql`${schema.brainSources.id} = 'google-source'`);
      await expect(
        runConnectorSync(
          staleActiveSnapshot ? { ...input, status: "active" } : input,
        ),
      ).rejects.toMatchObject({ errorCode: "google_source_inactive" });
      expect(state.request).not.toHaveBeenCalled();
      expect(state.connection).not.toHaveBeenCalled();
      expect(
        (await database.query("SELECT id FROM brain_sync_runs")).rows,
      ).toEqual([]);
      expect((await listAccessibleAudienceIds()).sort()).toEqual([
        "derived",
        "file-one",
        "file-two",
        "unrelated",
      ]);
    },
  );

  it.each(["paused", "archived"] as const)(
    "discards a prepared continuation after %s alone without withdrawing healthy prior evidence",
    async (status) => {
      const input = await seededGmail(true);
      state.settings = {
        privacyClassifier: "jev",
        captureSanitizationEnabled: false,
      };
      const requested = deferred<void>();
      const classification = deferred<JevClassificationOutcome>();
      state.classify.mockImplementationOnce(() => {
        requested.resolve();
        return classification.promise;
      });
      state.request.mockResolvedValueOnce({
        response: {
          status: 200,
          ok: true,
          truncated: false,
          json: { messages: [{ id: "new-message" }] },
        },
      });
      state.request.mockResolvedValueOnce({
        response: {
          status: 200,
          ok: true,
          truncated: false,
          json: {
            id: "new-message",
            payload: {
              headers: [{ name: "Subject", value: "Project plan" }],
              mimeType: "text/plain",
              body: {
                data: Buffer.from(
                  "Company project plan for the beta release.",
                ).toString("base64url"),
              },
            },
          },
        },
      });
      const syncing = runConnectorSync(input);
      await requested.promise;
      await updateSource.run({ id: input.id, status });
      classification.resolve({
        configured: true,
        decision: {
          disposition: "allowed",
          categories: [],
          confidenceBand: "high",
          policyVersion: "qa-classifier-v1",
          safeSegments: [],
          safeContent: "Screened company project plan.",
          classifier: "jev",
        },
      });
      expect(await syncing).toMatchObject({
        status: "error",
        capturesCreated: 0,
        captures: [],
        stats: { sourceChanged: true },
      });
      expect((await persistedSource()).status).toBe(status);
      expect((await persistedSource()).cursorJson).toBe(input.cursorJson);
      expect(
        (await database.query("SELECT id FROM brain_raw_captures ORDER BY id"))
          .rows,
      ).toEqual([{ id: "capture-one" }, { id: "capture-two" }]);
      expect((await listAccessibleAudienceIds()).sort()).toEqual([
        "derived",
        "file-one",
        "file-two",
        "unrelated",
      ]);
    },
  );

  it.each(["revoked", "oversized"] as const)(
    "commits only known %s item withdrawal if pause arrives before phase one",
    async (unavailable) => {
      const input = await seededGmail();
      const requested = deferred<void>();
      const detail = deferred<unknown>();
      state.request.mockResolvedValueOnce({
        response: {
          status: 200,
          ok: true,
          truncated: false,
          json: { messages: [{ id: "one" }, { id: "two" }] },
        },
      });
      state.request.mockResolvedValueOnce({
        response: {
          status: unavailable === "revoked" ? 404 : 200,
          ok: unavailable !== "revoked",
          truncated: unavailable === "oversized",
          json: {},
        },
      });
      state.request.mockImplementationOnce(() => {
        requested.resolve();
        return detail.promise;
      });
      const syncing = runConnectorSync(input);
      await requested.promise;
      await updateSource.run({ id: input.id, status: "paused" });
      detail.resolve({
        response: {
          status: 200,
          ok: true,
          truncated: false,
          json: { id: "two", snippet: "Company project plan" },
        },
      });
      expect(await syncing).toMatchObject({
        status: "error",
        capturesCreated: 0,
        captures: [],
        stats: { sourceChanged: true },
      });
      expect(state.classify).not.toHaveBeenCalled();
      expect((await persistedSource()).status).toBe("paused");
      expect((await persistedSource()).cursorJson).toBe(input.cursorJson);
      expect((await listAccessibleAudienceIds()).sort()).toEqual([
        "file-two",
        "unrelated",
      ]);
      expect(
        (await database.query("SELECT id FROM brain_raw_captures ORDER BY id"))
          .rows,
      ).toEqual([{ id: "capture-one" }, { id: "capture-two" }]);
    },
  );

  it.each(["revoked", "oversized"] as const)(
    "withdraws a known %s item before a healthy sibling's classifier completes",
    async (unavailable) => {
      if (!state.db) throw new Error("Test database is not ready");
      state.settings = {
        privacyClassifier: "jev",
        captureSanitizationEnabled: false,
      };
      const input = {
        ...source(),
        provider: "gmail" as const,
        configJson: JSON.stringify({
          workspaceConnectionId: "qa-google",
          google: { query: "newer_than:30d" },
        }),
      };
      input.cursorJson = JSON.stringify({
        configKey:
          googleSourceScopeKey(
            "gmail",
            parseJson<Record<string, unknown>>(input.configJson, {}),
          ) + ":qa-fleet@builder.io",
        pageToken: "continuation",
      });
      await state.db
        .update(schema.brainSources)
        .set(input)
        .where(sql`${schema.brainSources.id} = 'google-source'`);
      await database.exec(
        "UPDATE brain_raw_captures SET external_id='gmail:one' WHERE id='capture-one'; UPDATE brain_raw_captures SET external_id='gmail:two' WHERE id='capture-two'",
      );
      const requested = deferred<void>();
      const classification = deferred<JevClassificationOutcome>();
      state.classify.mockImplementationOnce(() => {
        requested.resolve();
        return classification.promise;
      });
      state.request.mockResolvedValueOnce({
        response: {
          status: 200,
          ok: true,
          truncated: false,
          json: { messages: [{ id: "one" }, { id: "two" }] },
        },
      });
      state.request.mockResolvedValueOnce({
        response: {
          status: unavailable === "revoked" ? 404 : 200,
          ok: unavailable !== "revoked",
          truncated: unavailable === "oversized",
          json: {},
        },
      });
      state.request.mockResolvedValueOnce({
        response: {
          status: 200,
          ok: true,
          truncated: false,
          json: {
            id: "two",
            payload: {
              headers: [{ name: "Subject", value: "Project plan" }],
              mimeType: "text/plain",
              body: {
                data: Buffer.from(
                  "Company project plan for the beta release.",
                ).toString("base64url"),
              },
            },
          },
        },
      });
      const syncing = runConnectorSync(input);
      await requested.promise;
      expect((await listAccessibleAudienceIds()).sort()).toEqual([
        "file-two",
        "unrelated",
      ]);
      await updateSource.run({
        id: input.id,
        config: { google: { query: "label:current" } },
      });
      classification.resolve({
        configured: true,
        decision: {
          disposition: "allowed",
          categories: [],
          confidenceBand: "high",
          policyVersion: "qa-classifier-v1",
          safeSegments: [],
          safeContent: "Screened company project plan.",
          classifier: "jev",
        },
      });
      expect(await syncing).toMatchObject({
        status: "error",
        capturesCreated: 0,
        captures: [],
        stats: { sourceChanged: true },
      });
      expect(await listAccessibleAudienceIds()).toEqual(["unrelated"]);
    },
  );

  it("does not hold the source lock while classifying and discards a prepared old-scope result", async () => {
    state.settings = {
      privacyClassifier: "jev",
      captureSanitizationEnabled: false,
    };
    const requested = deferred<void>();
    const classification = deferred<JevClassificationOutcome>();
    state.classify.mockImplementationOnce(() => {
      requested.resolve();
      return classification.promise;
    });
    state.request.mockResolvedValueOnce({
      response: {
        status: 200,
        ok: true,
        truncated: false,
        json: {
          id: "approved-doc",
          name: "Project plan",
          mimeType: "text/plain",
        },
      },
    });
    state.request.mockResolvedValueOnce({
      response: {
        status: 200,
        ok: true,
        truncated: false,
        text: "Company project plan for the beta release.",
      },
    });
    const syncing = runConnectorSync(source());
    await requested.promise;
    expect(await listAccessibleAudienceIds()).toEqual(["unrelated"]);
    expect(
      (await database.query("SELECT id FROM brain_raw_captures ORDER BY id"))
        .rows,
    ).toEqual([{ id: "capture-one" }, { id: "capture-two" }]);
    await updateSource.run({ id: "google-source", status: "paused" });
    expect((await persistedSource()).status).toBe("paused");
    await updateSource.run({
      id: "google-source",
      config: { google: { fileIds: ["replacement-doc"] } },
    });
    expect(await listAccessibleAudienceIds()).toEqual(["unrelated"]);
    classification.resolve({
      configured: true,
      decision: {
        disposition: "allowed",
        categories: [],
        confidenceBand: "high",
        policyVersion: "qa-classifier-v1",
        safeSegments: [],
        safeContent: "Screened company project plan.",
        classifier: "jev",
      },
    });
    expect(await syncing).toMatchObject({
      status: "error",
      capturesCreated: 0,
      captures: [],
      stats: { sourceChanged: true },
    });
    expect(
      (await database.query("SELECT id FROM brain_raw_captures ORDER BY id"))
        .rows,
    ).toEqual([{ id: "capture-one" }, { id: "capture-two" }]);
    expect((await persistedSource()).status).toBe("paused");
    expect(await listAccessibleAudienceIds()).toEqual(["unrelated"]);
  });

  it("rejects prepared content when global screening settings change before commit", async () => {
    state.settings = {
      privacyClassifier: "jev",
      captureSanitizationEnabled: false,
    };
    const requested = deferred<void>();
    const classification = deferred<JevClassificationOutcome>();
    state.classify.mockImplementationOnce(() => {
      requested.resolve();
      return classification.promise;
    });
    state.request.mockResolvedValueOnce({
      response: {
        status: 200,
        ok: true,
        truncated: false,
        json: {
          id: "approved-doc",
          name: "Project plan",
          mimeType: "text/plain",
        },
      },
    });
    state.request.mockResolvedValueOnce({
      response: {
        status: 200,
        ok: true,
        truncated: false,
        text: "Company project plan for the beta release.",
      },
    });
    const syncing = runConnectorSync(source());
    await requested.promise;
    state.settings = { ...state.settings, autoRedactEmails: false };
    classification.resolve({
      configured: true,
      decision: {
        disposition: "allowed",
        categories: [],
        confidenceBand: "high",
        policyVersion: "qa-classifier-v1",
        safeSegments: [],
        safeContent: "Screened company project plan.",
        classifier: "jev",
      },
    });
    const result = await syncing;
    expect(result).toMatchObject({
      status: "error",
      capturesCreated: 0,
      captures: [],
    });
    expect(result.message).toContain("screening context changed");
    expect(
      (await database.query("SELECT id FROM brain_raw_captures ORDER BY id"))
        .rows,
    ).toEqual([{ id: "capture-one" }, { id: "capture-two" }]);
    expect(await listAccessibleAudienceIds()).toEqual(["unrelated"]);
  });

  it.each([false, true])(
    "discards old-scope in-flight results after the owner narrows file IDs (providerFailure=%s)",
    async (providerFailure) => {
      const input = source();
      const requested = deferred<void>();
      const response = deferred<unknown>();
      state.request.mockImplementationOnce(() => {
        requested.resolve();
        return response.promise;
      });
      if (!providerFailure)
        state.request.mockResolvedValueOnce({
          response: {
            status: 200,
            ok: true,
            truncated: false,
            text: "Old scope body must not be saved",
          },
        });
      const syncing = runConnectorSync(input);
      await requested.promise;
      await updateSource.run({
        id: input.id,
        config: { google: { fileIds: ["replacement-doc"] } },
      });
      const current = await persistedSource();
      expect(await listAccessibleAudienceIds()).toEqual(["unrelated"]);
      response.resolve({
        response: {
          status: providerFailure ? 429 : 200,
          ok: !providerFailure,
          truncated: false,
          json: {
            id: "approved-doc",
            name: "Old scope document",
            mimeType: "text/plain",
          },
        },
      });
      const result = await syncing;
      expect(result).toMatchObject({
        status: "error",
        capturesCreated: 0,
        captures: [],
        stats: { sourceChanged: true },
      });
      expect((await persistedSource()).configJson).toBe(current.configJson);
      expect((await persistedSource()).cursorJson).toBe(current.cursorJson);
      expect((await persistedSource()).status).toBe("active");
      expect(await listAccessibleAudienceIds()).toEqual(["unrelated"]);
      expect(
        (await database.query("SELECT id FROM brain_raw_captures ORDER BY id"))
          .rows,
      ).toEqual([{ id: "capture-one" }, { id: "capture-two" }]);
    },
  );

  it("preserves an owner cursor reset after an in-flight failure without retaining old audiences", async () => {
    const input = source();
    const requested = deferred<void>();
    const response = deferred<unknown>();
    state.request.mockImplementationOnce(() => {
      requested.resolve();
      return response.promise;
    });
    const syncing = runConnectorSync(input);
    await requested.promise;
    await updateSource.run({ id: input.id, cursor: { pageToken: "" } });
    const current = await persistedSource();
    expect(await listAccessibleAudienceIds()).toEqual(["unrelated"]);
    response.resolve({
      response: { status: 429, ok: false, truncated: false, json: {} },
    });
    expect(await syncing).toMatchObject({
      status: "error",
      capturesCreated: 0,
      stats: { sourceChanged: true },
    });
    expect((await persistedSource()).cursorJson).toBe(current.cursorJson);
    expect(await listAccessibleAudienceIds()).toEqual(["unrelated"]);
  });

  it("withdraws audiences for a stricter policy-only edit before discarding an old permission failure", async () => {
    const input = source();
    const requested = deferred<void>();
    const response = deferred<unknown>();
    state.request.mockImplementationOnce(() => {
      requested.resolve();
      return response.promise;
    });
    const syncing = runConnectorSync(input);
    await requested.promise;
    await updateSource.run({ id: input.id, policy: { reviewRequired: true } });
    const current = await persistedSource();
    expect(await listAccessibleAudienceIds()).toEqual(["unrelated"]);
    expect(
      parseJson<Record<string, unknown>>(current.configJson, {}),
    ).toMatchObject({ answerPolicy: { reviewRequired: true } });
    response.resolve({
      response: { status: 403, ok: false, truncated: false, json: {} },
    });
    expect(await syncing).toMatchObject({
      status: "error",
      capturesCreated: 0,
      stats: { sourceChanged: true },
    });
    expect((await persistedSource()).configJson).toBe(current.configJson);
    expect((await persistedSource()).cursorJson).toBe(current.cursorJson);
    expect(await listAccessibleAudienceIds()).toEqual(["unrelated"]);
  });

  it.each([
    ["paused", 200],
    ["archived", 200],
    ["paused", 401],
    ["archived", 401],
    ["paused", 429],
    ["archived", 429],
  ] as const)(
    "preserves %s and rejects an in-flight Google page (HTTP %s)",
    async (status, providerStatus) => {
      if (!state.db) throw new Error("Test database is not ready");
      const input = { ...source(), provider: "gmail" as const };
      await state.db
        .update(schema.brainSources)
        .set(input)
        .where(sql`${schema.brainSources.id} = 'google-source'`);
      const requested = deferred<void>();
      const response = deferred<unknown>();
      state.request.mockImplementationOnce(() => {
        requested.resolve();
        return response.promise;
      });
      const syncing = runConnectorSync(input);
      await requested.promise;
      await updateSource.run({ id: input.id, status });
      response.resolve({
        response: {
          status: providerStatus,
          ok: providerStatus === 200,
          truncated: false,
          json: { messages: [] },
        },
      });
      expect(await syncing).toMatchObject({
        status: "error",
        capturesCreated: 0,
        captures: [],
        stats: { sourceChanged: true },
      });
      expect((await persistedSource()).status).toBe(status);
      expect((await persistedSource()).cursorJson).toBe(input.cursorJson);
      expect((await listAccessibleAudienceIds()).sort()).toEqual(
        providerStatus === 200
          ? ["derived", "file-one", "file-two", "unrelated"]
          : ["unrelated"],
      );
    },
  );

  it("withdraws only the oversized item's prior audience on a continuation page and records its visible skip", async () => {
    if (!state.db) throw new Error("Test database is not ready");
    const input = { ...source(), provider: "gmail" as const };
    input.cursorJson = JSON.stringify({
      configKey:
        googleSourceScopeKey(
          "gmail",
          parseJson<Record<string, unknown>>(input.configJson, {}),
        ) + ":qa-fleet@builder.io",
      pageToken: "continuation",
    });
    await state.db
      .update(schema.brainSources)
      .set(input)
      .where(sql`${schema.brainSources.id} = 'google-source'`);
    await database.exec(
      "UPDATE brain_raw_captures SET external_id='gmail:one' WHERE id='capture-one'",
    );
    state.request.mockResolvedValueOnce({
      response: {
        status: 200,
        ok: true,
        truncated: false,
        json: { messages: [{ id: "one" }] },
      },
    });
    state.request.mockResolvedValueOnce({
      response: { status: 200, ok: true, truncated: true },
    });
    const result = await runConnectorSync(input);
    expect(result).toMatchObject({
      status: "success",
      capturesCreated: 0,
      stats: { skippedOversized: 1 },
    });
    expect(result.message).toContain("Skipped 1 oversized");
    expect((await persistedSource()).lastError).toContain(
      "Skipped 1 oversized",
    );
    expect((await listAccessibleAudienceIds()).sort()).toEqual([
      "file-two",
      "unrelated",
    ]);
    const stats = (
      await database.query<{ stats_json: string }>(
        "SELECT stats_json FROM brain_sync_runs",
      )
    ).rows.find((_row, index) => index === 0);
    if (!stats) throw new Error("Expected persisted sync statistics");
    const persistedStats: unknown = JSON.parse(stats.stats_json);
    expect(persistedStats).toMatchObject({ skippedOversized: 1 });
  });

  it("restarts revalidation after a transient later-page failure without reviving unreturned evidence", async () => {
    if (!state.db) throw new Error("Test database is not ready");
    const input = { ...source(), provider: "gmail" as const };
    input.cursorJson = JSON.stringify({
      configKey:
        googleSourceScopeKey(
          "gmail",
          parseJson<Record<string, unknown>>(input.configJson, {}),
        ) + ":qa-fleet@builder.io",
      pageToken: "page-two",
    });
    await state.db
      .update(schema.brainSources)
      .set(input)
      .where(sql`${schema.brainSources.id} = 'google-source'`);
    state.request.mockResolvedValueOnce({
      response: { status: 429, ok: false, truncated: false, json: {} },
    });
    expect((await runConnectorSync(input)).status).toBe("error");
    expect(
      state.request.mock.calls.find((_call, index) => index === 0)?.[0].query,
    ).toHaveProperty("pageToken", "page-two");
    expect(await listAccessibleAudienceIds()).toEqual(["unrelated"]);
    const failed = await persistedSource();
    expect(JSON.parse(failed.cursorJson)).toEqual({
      transientRetryAt: expect.any(String),
    });
    state.request.mockResolvedValueOnce({
      response: {
        status: 200,
        ok: true,
        truncated: false,
        json: { messages: [] },
      },
    });
    expect((await runConnectorSync(failed)).status).toBe("success");
    const retryRequest = state.request.mock.calls.find(
      (_call, index) => index === 1,
    )?.[0];
    if (!retryRequest) throw new Error("Expected a retry provider request");
    expect(retryRequest.query).not.toHaveProperty("pageToken");
    expect(await listAccessibleAudienceIds()).toEqual(["unrelated"]);
    expect((await persistedSource()).status).toBe("active");
  });

  it.each([
    ["gmail", "paused"],
    ["gmail", "archived"],
    ["google_calendar", "paused"],
    ["google_calendar", "archived"],
    ["google_drive", "paused"],
    ["google_drive", "archived"],
  ] as const)(
    "allows the owner to set %s to %s after its grant is disconnected",
    async (provider, status) => {
      if (!state.db) throw new Error("Test database is not ready");
      await state.db
        .update(schema.brainSources)
        .set({ ...source(), provider })
        .where(sql`${schema.brainSources.id} = 'google-source'`);
      state.connection.mockResolvedValue({
        available: false,
        connection: null,
      });
      const before = (
        await database.query(
          "SELECT config_json, cursor_json FROM brain_sources WHERE id='google-source'",
        )
      ).rows;
      const result = await updateSource.run({ id: "google-source", status });
      expect(result.source.status).toBe(status);
      expect(
        (
          await database.query(
            "SELECT status FROM brain_sources WHERE id='google-source'",
          )
        ).rows,
      ).toEqual([{ status }]);
      expect(
        (
          await database.query(
            "SELECT config_json, cursor_json FROM brain_sources WHERE id='google-source'",
          )
        ).rows,
      ).toEqual(before);
      expect(state.connection).not.toHaveBeenCalled();
      expect(state.request).not.toHaveBeenCalled();
    },
  );

  it("allows a disconnected source to pause with unchanged echoed configuration", async () => {
    if (!state.db) throw new Error("Test database is not ready");
    await state.db
      .update(schema.brainSources)
      .set(source())
      .where(sql`${schema.brainSources.id} = 'google-source'`);
    state.connection.mockResolvedValue({ available: false, connection: null });
    const result = await updateSource.run({
      id: "google-source",
      status: "paused",
      config: {
        google: { fileIds: ["approved-doc"] },
        workspaceConnectionId: "qa-google",
      },
    });
    expect(result.source.status).toBe("paused");
    expect(state.connection).not.toHaveBeenCalled();
  });

  it("still rejects a disconnected Google binding edit before any source or audience write", async () => {
    if (!state.db) throw new Error("Test database is not ready");
    await state.db
      .update(schema.brainSources)
      .set(source())
      .where(sql`${schema.brainSources.id} = 'google-source'`);
    state.connection.mockResolvedValue({ available: false, connection: null });
    const before = (
      await database.query("SELECT * FROM brain_sources ORDER BY id")
    ).rows;
    const audiences = (
      await database.query("SELECT * FROM brain_audiences ORDER BY id")
    ).rows;
    await expect(
      updateSource.run({
        id: "google-source",
        config: { workspaceConnectionId: "revoked-grant" },
      }),
    ).rejects.toMatchObject({
      errorCode: "google_source_connection_unavailable",
    });
    expect(
      (await database.query("SELECT * FROM brain_sources ORDER BY id")).rows,
    ).toEqual(before);
    expect(
      (await database.query("SELECT * FROM brain_audiences ORDER BY id")).rows,
    ).toEqual(audiences);
  });

  it("still rejects a non-owner status edit even when generic editor access is present", async () => {
    if (!state.db) throw new Error("Test database is not ready");
    await state.db
      .update(schema.brainSources)
      .set(source("another-owner@example.test"))
      .where(sql`${schema.brainSources.id} = 'google-source'`);
    await expect(
      updateSource.run({ id: "google-source", status: "paused" }),
    ).rejects.toMatchObject({ errorCode: "google_source_owner_required" });
    expect(
      (
        await database.query(
          "SELECT status FROM brain_sources WHERE id='google-source'",
        )
      ).rows,
    ).toEqual([{ status: "active" }]);
    expect(state.connection).not.toHaveBeenCalled();
  });

  it("rejects an authorized non-owner editor before leases, source writes, or audience invalidation", async () => {
    const beforeSources = await database.query(
      "SELECT * FROM brain_sources ORDER BY id",
    );
    const beforeAudiences = await database.query(
      "SELECT * FROM brain_audiences ORDER BY id",
    );
    await expect(
      runConnectorSync(source("another-owner@example.test")),
    ).rejects.toMatchObject({ errorCode: "google_source_owner_required" });
    expect(
      (await database.query("SELECT * FROM brain_sync_runs")).rows,
    ).toEqual([]);
    expect(
      (await database.query("SELECT * FROM brain_sources ORDER BY id")).rows,
    ).toEqual(beforeSources.rows);
    expect(
      (await database.query("SELECT * FROM brain_audiences ORDER BY id")).rows,
    ).toEqual(beforeAudiences.rows);
    expect(state.request).not.toHaveBeenCalled();
  });

  it("records quota failure and a bounded retry while withdrawing prior evidence", async () => {
    state.request.mockResolvedValueOnce({
      response: {
        json: { error: { errors: [{ reason: "rateLimitExceeded" }] } },
        status: 403,
        ok: false,
        truncated: false,
      },
    });
    const result = await runConnectorSync(source());
    expect(result).toMatchObject({
      status: "error",
      capturesCreated: 0,
      stats: { retryable: true },
    });
    expect(await listAccessibleAudienceIds()).toEqual(["unrelated"]);
    const persisted = (
      await database.query<{
        status: string;
        cursor_json: string;
        last_error: string;
      }>(
        "SELECT status, cursor_json, last_error FROM brain_sources WHERE id='google-source'",
      )
    ).rows.find((_row, index) => index === 0);
    if (!persisted) throw new Error("Expected persisted Google source");
    expect(persisted.status).toBe("error");
    expect(persisted.last_error).toContain("403");
    const cursor: unknown = JSON.parse(persisted.cursor_json);
    expect(cursor).toEqual({ transientRetryAt: expect.any(String) });
    expect(
      (await database.query("SELECT status FROM brain_sync_runs")).rows,
    ).toEqual([{ status: "error" }]);
  });

  it("removes a revoked file and multi-file derived audience until access is restored", async () => {
    expect((await listAccessibleAudienceIds()).sort()).toEqual([
      "derived",
      "file-one",
      "file-two",
      "unrelated",
    ]);
    await invalidateGoogleCaptureAudiences("google-source", [
      "google_drive:one",
    ]);
    expect((await listAccessibleAudienceIds()).sort()).toEqual([
      "file-two",
      "unrelated",
    ]);
    await database.exec(
      "UPDATE brain_audiences SET membership_state = 'current' WHERE id = 'file-one'",
    );
    expect((await listAccessibleAudienceIds()).sort()).toEqual([
      "derived",
      "file-one",
      "file-two",
      "unrelated",
    ]);
  });

  it("fails closed for every prior capture and derivative on source configuration or credential changes", async () => {
    await invalidateGoogleSourceAudiences("google-source");
    expect(await listAccessibleAudienceIds()).toEqual(["unrelated"]);
    await database.exec(
      "UPDATE brain_audiences SET membership_state = 'current' WHERE id = 'file-two'",
    );
    expect((await listAccessibleAudienceIds()).sort()).toEqual([
      "file-two",
      "unrelated",
    ]);
    await database.exec(
      "UPDATE brain_audiences SET membership_state = 'current' WHERE id = 'file-one'",
    );
    expect((await listAccessibleAudienceIds()).sort()).toEqual([
      "derived",
      "file-one",
      "file-two",
      "unrelated",
    ]);
  });
});
