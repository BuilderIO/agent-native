import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestPglite } from "../a2a/test-pglite.js";

const mockSession = vi.hoisted(() => ({
  value: { email: "alice@example.test", orgId: "org-a" } as {
    email: string;
    orgId?: string;
  } | null,
}));

const pgliteRef = vi.hoisted(() => ({
  value: null as Awaited<ReturnType<typeof createTestPglite>> | null,
}));

const rawClient = {
  execute: vi.fn(async (input: string | { sql: string; args?: unknown[] }) => {
    const db = pgliteRef.value;
    if (!db) throw new Error("Test database is unavailable");
    if (typeof input === "string") {
      await db.exec(input);
      return { rows: [], rowsAffected: 0 };
    }
    const stmt = await db.prepare(input.sql);
    const args = (input.args ?? []) as unknown[];
    if (/^\s*select/i.test(input.sql)) {
      return { rows: await stmt.all(...args), rowsAffected: 0 };
    }
    const result = await stmt.run(...args);
    return { rows: [], rowsAffected: result.changes };
  }),
};

vi.mock("h3", () => ({
  defineEventHandler: (handler: (event: unknown) => unknown) => handler,
  getQuery: (event: { query?: Record<string, unknown> }) => event.query ?? {},
  setResponseStatus: () => {},
  createEventStream: (event: Record<string, unknown>) => ({
    push: (data: unknown) => {
      (event.pushed as unknown[]).push(data);
    },
    onClosed: (callback: () => void) => {
      event.close = callback;
    },
    close: async () => {
      event.close?.();
    },
    send: () => ({ stream: true }),
  }),
}));

vi.mock("../db/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/client.js")>();
  return { ...actual, getDbExec: () => rawClient };
});

vi.mock("../db/ddl-guard.js", () => ({
  ensureIndexExists: vi.fn().mockResolvedValue(undefined),
  ensureColumnExists: vi.fn().mockResolvedValue(undefined),
  ensureTableExists: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../db/widen-columns.js", () => ({
  widenIntColumnsToBigInt: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./auth.js", () => ({
  getSession: async () => mockSession.value,
}));

beforeEach(async () => {
  process.env.AGENT_NATIVE_SYNC_EVENTS_DISABLE = "1";
  pgliteRef.value = await createTestPglite();
  await pgliteRef.value.exec(`
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `);
  await pgliteRef.value.exec(`
    CREATE TABLE resources (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      owner TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT 'text/markdown',
      size BIGINT NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL DEFAULT 'user',
      visibility TEXT NOT NULL DEFAULT 'workspace',
      thread_id TEXT,
      run_id TEXT,
      expires_at BIGINT,
      metadata TEXT,
      UNIQUE(path, owner)
    )
  `);
});

afterEach(async () => {
  delete process.env.AGENT_NATIVE_SYNC_EVENTS_DISABLE;
  delete process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS;
  await pgliteRef.value?.close();
  pgliteRef.value = null;
  vi.resetModules();
});

describe("settings change feed scope", () => {
  it("keeps user, org, and personal seed changes within their scope", async () => {
    const { AppSyncState } = await import("./poll.js");
    const { createPollHandler } = await import("./poll.js");
    const { getSettingsEmitter } = await import("../settings/store.js");
    const { putUserSetting, mutateUserSetting, deleteUserSetting } =
      await import("../settings/user-settings.js");
    const {
      putOrgSetting,
      mutateOrgSetting,
      deleteOrgSetting,
      deleteAllOrgSettings,
    } = await import("../settings/org-settings.js");
    const { putSetting, deleteSettingIfValue, deleteSettingsByPrefix } =
      await import("../settings/store.js");
    const { ensurePersonalDefaults } = await import("../resources/store.js");
    const { createPollEventsHandler } = await import("./poll-events.js");
    const state = new AppSyncState({
      getDb: () => ({ execute: rawClient.execute }) as never,
    });
    state.wireLocalEmitters();
    expect(getSettingsEmitter().listenerCount("settings")).toBeGreaterThan(0);

    const poll = createPollHandler(state);
    const aliceStreamEvent = {
      pushed: [] as unknown[],
      close: undefined as (() => void) | undefined,
    };
    const bobStreamEvent = {
      pushed: [] as unknown[],
      close: undefined as (() => void) | undefined,
    };
    mockSession.value = { email: "alice@example.test", orgId: "org-a" };
    await (createPollEventsHandler(state) as (event: unknown) => unknown)(
      aliceStreamEvent,
    );
    mockSession.value = { email: "bob@example.test", orgId: "org-b" };
    await (createPollEventsHandler(state) as (event: unknown) => unknown)(
      bobStreamEvent,
    );

    await putUserSetting(
      "alice@example.test",
      "theme",
      { mode: "dark" },
      { requestSource: "alice-user-put" },
    );
    await mutateUserSetting(
      "alice@example.test",
      "mutated",
      () => ({ ok: true }),
      { requestSource: "alice-user-mutate" },
    );
    await putUserSetting(
      "alice@example.test",
      "deleted",
      { value: true },
      { requestSource: "alice-user-delete-setup" },
    );
    await deleteUserSetting("alice@example.test", "deleted", {
      requestSource: "alice-user-delete",
    });
    await putSetting(
      "u:alice@example.test:conditional",
      { value: true },
      {
        owner: "alice@example.test",
        requestSource: "alice-user-conditional-setup",
      },
    );
    await deleteSettingIfValue(
      "u:alice@example.test:conditional",
      { value: true },
      {
        owner: "alice@example.test",
        requestSource: "alice-user-conditional-delete",
      },
    );
    await putUserSetting(
      "alice@example.test",
      "prefix:item",
      { value: true },
      { requestSource: "alice-user-prefix-setup" },
    );
    await deleteSettingsByPrefix("u:alice@example.test:prefix:", {
      owner: "alice@example.test",
      requestSource: "alice-user-prefix-delete",
    });
    await putOrgSetting(
      "org-a",
      "workspace-name",
      { name: "A" },
      {
        requestSource: "alice-org-put",
      },
    );
    await mutateOrgSetting("org-a", "mutated", () => ({ ok: true }), {
      requestSource: "alice-org-mutate",
    });
    await putOrgSetting(
      "org-a",
      "deleted",
      { value: true },
      {
        requestSource: "alice-org-delete-setup",
      },
    );
    await deleteOrgSetting("org-a", "deleted", {
      requestSource: "alice-org-delete",
    });
    await putOrgSetting(
      "org-a",
      "prefix:item",
      { value: true },
      {
        requestSource: "alice-org-prefix-setup",
      },
    );
    await deleteAllOrgSettings("org-a", {
      requestSource: "alice-org-prefix-delete",
    });
    await putUserSetting(
      "bob@example.test",
      "theme",
      { mode: "light" },
      {
        requestSource: "bob-user-put",
      },
    );
    await putOrgSetting(
      "org-b",
      "workspace-name",
      { name: "B" },
      {
        requestSource: "bob-org-put",
      },
    );
    const beforeSeedVersion = state.getVersion();
    await ensurePersonalDefaults("alice@example.test");
    const personalSeedEvents = state.getChangesSinceForUser(
      beforeSeedVersion,
      "alice@example.test",
      "org-a",
    ).events;
    expect(
      personalSeedEvents.some((event) => event.owner === "alice@example.test"),
    ).toBe(true);
    expect(
      personalSeedEvents.some((event) => event.owner === "bob@example.test"),
    ).toBe(false);
    await ensurePersonalDefaults("bob@example.test");

    mockSession.value = { email: "alice@example.test", orgId: "org-a" };
    const alicePoll = (
      await (
        poll as (event: unknown) => Promise<{
          events: unknown[];
        }>
      )({ query: { since: "0" } })
    ).events;
    mockSession.value = { email: "bob@example.test", orgId: "org-b" };
    const bobPoll = (
      await (
        poll as (event: unknown) => Promise<{
          events: unknown[];
        }>
      )({ query: { since: "0" } })
    ).events;
    const settingsEvents = (events: unknown[]) =>
      events.filter(
        (event): event is Record<string, unknown> =>
          !!event &&
          typeof event === "object" &&
          (event as Record<string, unknown>).source === "settings",
      );
    const aliceSettings = settingsEvents(alicePoll);
    const bobSettings = settingsEvents(bobPoll);
    const sources = (events: Record<string, unknown>[]) =>
      events.map((event) => event.requestSource);
    const aliceExpectedSources = [
      "alice-user-put",
      "alice-user-mutate",
      "alice-user-delete-setup",
      "alice-user-delete",
      "alice-user-conditional-setup",
      "alice-user-conditional-delete",
      "alice-user-prefix-setup",
      "alice-user-prefix-delete",
      "alice-org-put",
      "alice-org-mutate",
      "alice-org-delete-setup",
      "alice-org-delete",
      "alice-org-prefix-setup",
      "alice-org-prefix-delete",
    ];
    expect(sources(aliceSettings)).toEqual(
      expect.arrayContaining(aliceExpectedSources),
    );
    expect(sources(bobSettings)).toEqual(
      expect.arrayContaining(["bob-user-put", "bob-org-put"]),
    );
    for (const source of aliceExpectedSources) {
      expect(sources(bobSettings)).not.toContain(source);
    }
    expect(sources(aliceSettings)).not.toContain("bob-user-put");
    expect(sources(aliceSettings)).not.toContain("bob-org-put");
    expect(
      aliceSettings.some((event) => event.owner === "alice@example.test"),
    ).toBe(true);
    expect(
      aliceSettings.some(
        (event) =>
          event.owner === "alice@example.test" &&
          event.requestSource === undefined,
      ),
    ).toBe(true);
    expect(aliceSettings.some((event) => event.orgId === "org-a")).toBe(true);
    expect(
      aliceSettings.some((event) => event.owner === "bob@example.test"),
    ).toBe(false);
    expect(aliceSettings.some((event) => event.orgId === "org-b")).toBe(false);
    expect(
      bobSettings.some((event) => event.owner === "bob@example.test"),
    ).toBe(true);
    expect(
      bobSettings.some(
        (event) =>
          event.owner === "bob@example.test" &&
          event.requestSource === undefined,
      ),
    ).toBe(true);
    expect(bobSettings.some((event) => event.orgId === "org-b")).toBe(true);
    expect(
      bobSettings.some((event) => event.owner === "alice@example.test"),
    ).toBe(false);
    expect(bobSettings.some((event) => event.orgId === "org-a")).toBe(false);
    expect(aliceSettings.every((event) => event.key === "*")).toBe(true);
    expect(bobSettings.every((event) => event.key === "*")).toBe(true);

    const streamEvents = (stream: { pushed: unknown[] }) =>
      stream.pushed
        .filter((value): value is string => typeof value === "string")
        .map((value) => JSON.parse(value) as Record<string, unknown>);
    const aliceStream = streamEvents(aliceStreamEvent).filter(
      (event) => event.source === "settings",
    );
    const bobStream = streamEvents(bobStreamEvent).filter(
      (event) => event.source === "settings",
    );
    expect(sources(aliceStream)).toEqual(
      expect.arrayContaining(aliceExpectedSources),
    );
    expect(sources(bobStream)).toEqual(
      expect.arrayContaining(["bob-user-put", "bob-org-put"]),
    );
    for (const source of aliceExpectedSources) {
      expect(sources(bobStream)).not.toContain(source);
    }
    expect(sources(aliceStream)).not.toContain("bob-user-put");
    expect(sources(aliceStream)).not.toContain("bob-org-put");
    expect(
      aliceStream.some((event) => event.owner === "alice@example.test"),
    ).toBe(true);
    expect(
      aliceStream.some(
        (event) =>
          event.owner === "alice@example.test" &&
          event.requestSource === undefined,
      ),
    ).toBe(true);
    expect(aliceStream.some((event) => event.orgId === "org-a")).toBe(true);
    expect(
      aliceStream.some((event) => event.owner === "bob@example.test"),
    ).toBe(false);
    expect(aliceStream.some((event) => event.orgId === "org-b")).toBe(false);
    expect(bobStream.some((event) => event.owner === "bob@example.test")).toBe(
      true,
    );
    expect(
      bobStream.some(
        (event) =>
          event.owner === "bob@example.test" &&
          event.requestSource === undefined,
      ),
    ).toBe(true);
    expect(bobStream.some((event) => event.orgId === "org-b")).toBe(true);
    expect(
      bobStream.some((event) => event.owner === "alice@example.test"),
    ).toBe(false);
    expect(bobStream.some((event) => event.orgId === "org-a")).toBe(false);
    expect(aliceStream.every((event) => event.key === "*")).toBe(true);
    expect(bobStream.every((event) => event.key === "*")).toBe(true);
    aliceStreamEvent.close?.();
    bobStreamEvent.close?.();
  });

  it("drops legacy durable rows without stored scope", async () => {
    delete process.env.AGENT_NATIVE_SYNC_EVENTS_DISABLE;
    process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS = "1";
    const { AppSyncState } = await import("./poll.js");
    await pgliteRef.value?.exec(`
      CREATE TABLE sync_events (
        id TEXT PRIMARY KEY,
        version BIGINT NOT NULL,
        event_json TEXT NOT NULL,
        source TEXT NOT NULL,
        type TEXT NOT NULL,
        event_key TEXT,
        owner TEXT,
        org_id TEXT,
        resource_type TEXT,
        resource_id TEXT,
        created_at BIGINT NOT NULL
      )
    `);
    const rows = [
      {
        id: "legacy-null-scope",
        version: 2,
        event: {
          source: "settings",
          type: "change",
          key: "u:bob@example.test:nested:u:alice@example.test:private:part",
          owner: "alice@example.test",
          orgId: "org-a",
        },
        owner: null,
        orgId: null,
      },
      {
        id: "explicit-public",
        version: 3,
        event: {
          source: "settings",
          type: "change",
          key: "email@example.test:private-key",
          visibility: "public",
        },
        owner: null,
        orgId: null,
      },
      {
        id: "explicit-alice",
        version: 4,
        event: {
          source: "settings",
          type: "change",
          key: "u:alice@example.test:nested:u:bob@example.test:private:part",
          owner: "bob@example.test",
        },
        owner: "alice@example.test",
        orgId: null,
      },
      {
        id: "explicit-org-a",
        version: 5,
        event: {
          source: "settings",
          type: "change",
          key: "o:org-a:nested:o:org-b:private:part",
        },
        owner: null,
        orgId: "org-a",
      },
      {
        id: "explicit-bob",
        version: 6,
        event: {
          source: "settings",
          type: "change",
          key: "u:bob@example.test:nested:u:alice@example.test:private:part",
        },
        owner: "bob@example.test",
        orgId: null,
      },
    ];
    for (const row of rows) {
      await rawClient.execute({
        sql: `INSERT INTO sync_events
          (id, version, event_json, source, type, event_key, owner, org_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          row.id,
          row.version,
          JSON.stringify(row.event),
          "settings",
          "change",
          row.event.key,
          row.owner,
          row.orgId,
          row.version,
        ],
      });
    }
    const state = new AppSyncState({
      getDb: () => ({ execute: rawClient.execute }) as never,
    });

    const result = await state.getDurableChangesSinceForUser(
      1,
      "alice@example.test",
      "org-a",
    );
    const bobResult = await state.getDurableChangesSinceForUser(
      1,
      "bob@example.test",
      "org-b",
    );

    expect(result.events).toMatchObject([
      { source: "settings", visibility: "public", key: "*" },
      { source: "settings", owner: "alice@example.test", key: "*" },
      { source: "settings", orgId: "org-a", key: "*" },
    ]);
    expect(bobResult.events).toMatchObject([
      { source: "settings", visibility: "public", key: "*" },
      { source: "settings", owner: "bob@example.test", key: "*" },
    ]);
    expect(JSON.stringify(result.events)).not.toContain("bob@example.test");
    expect(JSON.stringify(result.events)).not.toContain("org-b");
    expect(JSON.stringify(bobResult.events)).not.toContain(
      "alice@example.test",
    );
    expect(JSON.stringify(bobResult.events)).not.toContain("org-a");
    expect(JSON.stringify(result.events)).not.toContain("private-key");
    expect(JSON.stringify(result.events)).not.toContain("nested:");
  });

  it("matches normalized caller emails in the durable owner prefilter", async () => {
    delete process.env.AGENT_NATIVE_SYNC_EVENTS_DISABLE;
    process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS = "1";
    const { AppSyncState } = await import("./poll.js");
    const state = new AppSyncState({
      getDb: () => ({ execute: rawClient.execute }) as never,
    });
    await pgliteRef.value?.exec(`CREATE TABLE sync_events (
      id TEXT PRIMARY KEY, version BIGINT NOT NULL, event_json TEXT NOT NULL,
      source TEXT NOT NULL, type TEXT NOT NULL, event_key TEXT, owner TEXT,
      org_id TEXT, resource_type TEXT, resource_id TEXT, created_at BIGINT NOT NULL
    )`);
    await rawClient.execute({
      sql: `INSERT INTO sync_events (id, version, event_json, source, type, owner, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "normalized-owner",
        2,
        JSON.stringify({
          source: "settings",
          type: "change",
          key: "u:alice@example.test:private",
        }),
        "settings",
        "change",
        "alice@example.test",
        2,
      ],
    });
    const result = await state.getDurableChangesSinceForUser(
      1,
      "  Alice@Example.TEST  ",
      undefined,
    );
    expect(result.events).toMatchObject([
      { cursorId: "normalized-owner", key: "*", owner: "alice@example.test" },
    ]);
    expect(
      (
        await state.getDurableChangesSinceForUser(
          1,
          "bob@example.test",
          undefined,
        )
      ).events,
    ).toEqual([]);
  });

  it("delivers explicitly public scoped events through the durable prefilter", async () => {
    delete process.env.AGENT_NATIVE_SYNC_EVENTS_DISABLE;
    process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS = "1";
    const { AppSyncState } = await import("./poll.js");
    const state = new AppSyncState({
      getDb: () => ({ execute: rawClient.execute }) as never,
    });
    await pgliteRef.value?.exec(`CREATE TABLE sync_events (
      id TEXT PRIMARY KEY, version BIGINT NOT NULL, event_json TEXT NOT NULL,
      source TEXT NOT NULL, type TEXT NOT NULL, event_key TEXT, owner TEXT,
      org_id TEXT, resource_type TEXT, resource_id TEXT, created_at BIGINT NOT NULL
    )`);
    await rawClient.execute({
      sql: `INSERT INTO sync_events (id, version, event_json, source, type, owner, org_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        "scoped-public",
        2,
        JSON.stringify({
          source: "settings",
          type: "change",
          key: "private-key",
          visibility: "public",
        }),
        "settings",
        "change",
        "alice@example.test",
        "org-a",
        2,
      ],
    });
    const result = await state.getDurableChangesSinceForUser(
      1,
      "bob@example.test",
      "org-b",
    );
    expect(result.events).toMatchObject([
      { cursorId: "scoped-public", visibility: "public", key: "*" },
    ]);
    expect(JSON.stringify(result.events)).not.toContain("alice@example.test");
    expect(JSON.stringify(result.events)).not.toContain("private-key");
  });

  it("rejects unscoped settings mutations before persisting or publishing", async () => {
    const {
      putSetting,
      mutateSetting,
      deleteSetting,
      deleteSettingIfValue,
      deleteSettingsByPrefix,
      getSetting,
      getSettingsEmitter,
    } = await import("../settings/store.js");
    await putSetting("scoped", { value: 1 }, { owner: "alice@example.test" });
    const listener = vi.fn();
    getSettingsEmitter().on("settings", listener);
    const updater = vi.fn(() => ({ value: 2 }));
    try {
      for (const write of [
        () => putSetting("unscoped", { value: 1 }),
        () => mutateSetting("scoped", updater),
        () => deleteSetting("scoped"),
        () => deleteSettingIfValue("scoped", { value: 1 }),
        () => deleteSettingsByPrefix("scoped"),
        () => putSetting("blank-owner", {}, { owner: "  " }),
      ]) {
        await expect(write()).rejects.toMatchObject({
          name: "SettingsEventScopeError",
          code: "SETTINGS_SCOPE_REQUIRED",
        });
      }
      expect(updater).not.toHaveBeenCalled();
      expect(listener).not.toHaveBeenCalled();
      expect(await getSetting("scoped")).toEqual({ value: 1 });
      expect(await getSetting("unscoped")).toBeNull();
    } finally {
      getSettingsEmitter().off("settings", listener);
    }
  });

  it("keeps a replacement access check in flight when its stale predecessor settles", async () => {
    const { AppSyncState } = await import("./poll.js");
    const resolvers: Array<(value: null) => void> = [];
    const resolveAccess = vi.fn(
      () => new Promise<null>((resolve) => resolvers.push(resolve)),
    );
    const state = new AppSyncState({ resolveAccess });
    const event = { resourceType: "document", resourceId: "doc-1" };
    expect(
      state.getChangeVisibilityForUser(event, "alice@example.test", undefined),
    ).toBe("pending");
    state.invalidateCollabAccessCache("document", "doc-1");
    expect(
      state.getChangeVisibilityForUser(event, "alice@example.test", undefined),
    ).toBe("pending");
    resolvers[0]?.(null);
    await Promise.resolve();
    await Promise.resolve();
    expect(
      state.getChangeVisibilityForUser(event, "alice@example.test", undefined),
    ).toBe("pending");
    expect(resolveAccess).toHaveBeenCalledTimes(2);
    resolvers[1]?.(null);
    await expect(
      state.resolveChangeVisibilityForUser(
        event,
        "alice@example.test",
        undefined,
        1000,
      ),
    ).resolves.toBe("hidden");
  });

  it.each(["malformed-shape", "malformed-json", "unreadable-resource"])(
    "resumes beyond an unreadable durable event (%s)",
    async (kind) => {
      delete process.env.AGENT_NATIVE_SYNC_EVENTS_DISABLE;
      process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS = "1";
      await pgliteRef.value?.exec(`
      CREATE TABLE sync_events (
        id TEXT PRIMARY KEY,
        version BIGINT NOT NULL,
        event_json TEXT NOT NULL,
        source TEXT NOT NULL,
        type TEXT NOT NULL,
        event_key TEXT,
        owner TEXT,
        org_id TEXT,
        resource_type TEXT,
        resource_id TEXT,
        created_at BIGINT NOT NULL
      )
    `);
      await rawClient.execute({
        sql: `INSERT INTO sync_events
        (id, version, event_json, source, type, owner, resource_type, resource_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          "malformed-shape",
          2,
          kind === "malformed-json"
            ? "{invalid json"
            : kind === "unreadable-resource"
              ? JSON.stringify({ source: "resource", type: "change" })
              : JSON.stringify({
                  type: "change",
                  key: "private@example.test:key",
                }),
          "settings",
          "change",
          kind === "unreadable-resource" ? null : "alice@example.test",
          kind === "unreadable-resource" ? "document" : null,
          kind === "unreadable-resource" ? "private-doc" : null,
          2,
        ],
      });
      const { AppSyncState, createPollHandler } = await import("./poll.js");
      const state = new AppSyncState({
        getDb: () => ({ execute: rawClient.execute }) as never,
        resolveAccess: async () => {
          throw new Error("resolver unavailable");
        },
      });
      if (kind === "unreadable-resource") {
        await expect(
          state.resolveChangeVisibilityForUser(
            { resourceType: "document", resourceId: "private-doc" },
            "alice@example.test",
            undefined,
            1000,
          ),
        ).resolves.toBe("unreadable");
      }

      await expect(
        state.getDurableChangesSinceForUser(1, "alice@example.test", undefined),
      ).rejects.toMatchObject({
        cursor: expect.any(String),
        name: "SyncEventReadError",
        code: "SYNC_EVENT_READ_UNAVAILABLE",
        message:
          "A sync event could not be read; clients must refresh their data.",
      });
      vi.spyOn(state, "seedVersionFromDb").mockResolvedValue(undefined);
      vi.spyOn(state, "checkExternalDbChanges").mockResolvedValue(undefined);
      mockSession.value = { email: "alice@example.test" };
      const poll = createPollHandler(state) as (
        event: unknown,
      ) => Promise<{ error?: string; cursor?: string; events?: unknown[] }>;
      const response = await poll({ query: { since: "1", cursor: "1." } });
      expect(response).toEqual({
        error: "SYNC_EVENT_READ_UNAVAILABLE",
        cursor: "2.malformed-shape",
      });
      const resume = response.cursor;
      expect(resume).toBe("2.malformed-shape");
      await rawClient.execute({
        sql: `INSERT INTO sync_events (id, version, event_json, source, type, owner, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          "next-valid",
          2,
          JSON.stringify({
            source: "settings",
            type: "change",
            key: "private-next-key",
          }),
          "settings",
          "change",
          "alice@example.test",
          2,
        ],
      });
      const next = await state.getDurableChangesSinceForUser(
        2,
        "alice@example.test",
        undefined,
        {
          version: Number(resume?.split(".")[0]),
          id: resume?.split(".").slice(1).join(".") ?? "",
        },
      );
      expect(next.events).toMatchObject([{ cursorId: "next-valid", key: "*" }]);
      expect(JSON.stringify(next.events)).not.toContain("private-next-key");
      expect(
        (await poll({ query: { since: "2", cursor: resume } })).events,
      ).toMatchObject([{ cursorId: "next-valid", key: "*" }]);
    },
  );

  it("distinguishes an access denial from a failed access resolver", async () => {
    const { AppSyncState } = await import("./poll.js");
    const event = {
      source: "resource",
      type: "change",
      resourceType: "document",
      resourceId: "doc-1",
    };
    const denied = new AppSyncState({ resolveAccess: async () => null });
    const unreadable = new AppSyncState({
      resolveAccess: async () => {
        throw new Error("resolver details are not returned");
      },
    });

    await expect(
      denied.resolveChangeVisibilityForUser(
        event,
        "alice@example.test",
        undefined,
        1_000,
      ),
    ).resolves.toBe("hidden");
    await expect(
      unreadable.resolveChangeVisibilityForUser(
        event,
        "alice@example.test",
        undefined,
        1_000,
      ),
    ).resolves.toBe("unreadable");
  });

  it("delivers explicit global feature-flag writes to both open streams and polls", async () => {
    const { AppSyncState, createPollHandler } = await import("./poll.js");
    const { createPollEventsHandler } = await import("./poll-events.js");
    const { registerFeatureFlags } =
      await import("../feature-flags/registry.js");
    const { replaceFeatureFlagRules, mutateFeatureFlagRules } =
      await import("../feature-flags/store.js");
    registerFeatureFlags([{ key: "review.globalDelivery" }]);
    const state = new AppSyncState({
      getDb: () => ({ execute: rawClient.execute }) as never,
    });
    state.wireLocalEmitters();
    const alice = {
      pushed: [] as unknown[],
      close: undefined as (() => void) | undefined,
    };
    const bob = {
      pushed: [] as unknown[],
      close: undefined as (() => void) | undefined,
    };
    mockSession.value = { email: "alice@example.test", orgId: "org-a" };
    await (createPollEventsHandler(state) as (event: unknown) => unknown)(
      alice,
    );
    mockSession.value = { email: "bob@example.test", orgId: "org-b" };
    await (createPollEventsHandler(state) as (event: unknown) => unknown)(bob);

    await replaceFeatureFlagRules(
      "review.globalDelivery",
      {},
      { mode: "on", emails: [], orgIds: [], percentage: 0 },
    );
    await mutateFeatureFlagRules("review.globalDelivery", {}, (current) => ({
      ...current,
      mode: "off",
    }));

    const read = (events: unknown[]) =>
      events.flatMap((value) => {
        const event =
          typeof value === "string"
            ? (JSON.parse(value) as Record<string, unknown>)
            : value;
        return event &&
          typeof event === "object" &&
          (event as Record<string, unknown>).source === "settings"
          ? [event as Record<string, unknown>]
          : [];
      });
    const aliceEvents = state.getChangesSinceForUser(
      0,
      "alice@example.test",
      "org-a",
    ).events;
    const bobEvents = state.getChangesSinceForUser(
      0,
      "bob@example.test",
      "org-b",
    ).events;
    expect(
      read(aliceEvents).filter((event) => event.visibility === "public"),
    ).toHaveLength(4);
    expect(
      read(bobEvents).filter((event) => event.visibility === "public"),
    ).toHaveLength(4);
    expect(
      read(alice.pushed).filter((event) => event.visibility === "public"),
    ).toHaveLength(4);
    expect(
      read(bob.pushed).filter((event) => event.visibility === "public"),
    ).toHaveLength(4);
    expect(JSON.stringify(aliceEvents)).not.toContain("alice@example.test");
    expect(JSON.stringify(bobEvents)).not.toContain("bob@example.test");

    const poll = createPollHandler(state);
    mockSession.value = { email: "alice@example.test", orgId: "org-a" };
    const alicePoll = await (
      poll as (event: unknown) => Promise<{ events: unknown[] }>
    )({ query: { since: "0" } });
    mockSession.value = { email: "bob@example.test", orgId: "org-b" };
    const bobPoll = await (
      poll as (event: unknown) => Promise<{ events: unknown[] }>
    )({ query: { since: "0" } });
    expect(
      read(alicePoll.events).filter((event) => event.visibility === "public"),
    ).toHaveLength(4);
    expect(
      read(bobPoll.events).filter((event) => event.visibility === "public"),
    ).toHaveLength(4);
    alice.close?.();
    bob.close?.();
  });

  it("redacts transactional settings keys before persistence and SSE delivery", async () => {
    delete process.env.AGENT_NATIVE_SYNC_EVENTS_DISABLE;
    process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS = "1";
    const { AppSyncState } = await import("./poll.js");
    const { createPollEventsHandler } = await import("./poll-events.js");
    await pgliteRef.value?.exec(`
      CREATE TABLE sync_events (
        id TEXT PRIMARY KEY,
        version BIGINT NOT NULL,
        event_json TEXT NOT NULL,
        source TEXT NOT NULL,
        type TEXT NOT NULL,
        event_key TEXT,
        owner TEXT,
        org_id TEXT,
        resource_type TEXT,
        resource_id TEXT,
        created_at BIGINT NOT NULL
      )
    `);
    const state = new AppSyncState({
      getDb: () => ({ execute: rawClient.execute }) as never,
    });
    const stream = {
      pushed: [] as unknown[],
      close: undefined as (() => void) | undefined,
    };
    mockSession.value = { email: "alice@example.test", orgId: "org-a" };
    await (createPollEventsHandler(state) as (event: unknown) => unknown)(
      stream,
    );
    const prepared = await state.prepareTransactionalChange({
      source: "settings",
      type: "change",
      key: "u:alice@example.test:private",
      owner: "alice@example.test",
    });
    await rawClient.execute({ sql: "BEGIN" });
    await prepared.persist({ execute: rawClient.execute } as never);
    await rawClient.execute({ sql: "COMMIT" });
    prepared.publish();

    const stored = await pgliteRef.value?.query<{
      event_key: string;
      event_json: string;
    }>(
      "SELECT event_key, event_json FROM sync_events ORDER BY version DESC LIMIT 1",
    );
    expect(stored?.rows[0]?.event_key).toBe("*");
    expect(stored?.rows[0]?.event_json).not.toContain(
      "u:alice@example.test:private",
    );
    const pushed = stream.pushed
      .filter((value): value is string => typeof value === "string")
      .map((value) => JSON.parse(value) as Record<string, unknown>);
    expect(pushed).toContainEqual(
      expect.objectContaining({ source: "settings", key: "*" }),
    );
    expect(JSON.stringify(pushed)).not.toContain(
      "u:alice@example.test:private",
    );
    stream.close?.();
  });

  it("rejects conflicting options on scoped settings wrappers", async () => {
    const { putUserSetting } = await import("../settings/user-settings.js");
    const { putOrgSetting } = await import("../settings/org-settings.js");
    const { SettingsScopeError } = await import("../settings/store.js");
    await expect(
      putUserSetting("alice@example.test", "key", {}, {
        global: true,
      } as never),
    ).rejects.toMatchObject({ code: "SETTINGS_SCOPE_CONFLICT" });
    await expect(
      putUserSetting("alice@example.test", "key", {}, {
        owner: "bob@example.test",
      } as never),
    ).rejects.toBeInstanceOf(SettingsScopeError);
    await expect(
      putUserSetting("alice@example.test", "key", {}, {
        orgId: "org-a",
      } as never),
    ).rejects.toBeInstanceOf(SettingsScopeError);
    await expect(
      putOrgSetting("org-a", "key", {}, { orgId: "org-b" } as never),
    ).rejects.toBeInstanceOf(SettingsScopeError);
    await expect(
      putOrgSetting("org-a", "key", {}, { global: true } as never),
    ).rejects.toBeInstanceOf(SettingsScopeError);
    await expect(
      putOrgSetting("org-a", "key", {}, {
        owner: "alice@example.test",
      } as never),
    ).rejects.toBeInstanceOf(SettingsScopeError);
  });
});
