import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { closeDbExec, runMigrations } from "@agent-native/core/db";
import {
  ORG_MIGRATIONS,
  organizations,
  orgMembers,
} from "@agent-native/core/org";
import { runWithRequestContext } from "@agent-native/core/server";
import { getUserSetting, mutateUserSetting } from "@agent-native/core/settings";
import {
  ensureWorkspaceConnectionsTable,
  getWorkspaceConnection,
  upsertWorkspaceConnection,
} from "@agent-native/core/workspace-connections";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const state = vi.hoisted(() => ({
  failGrant: false,
  failAnnotation: false,
  failCredentialDelete: false,
  failFailedJournalWrite: false,
  capturePendingIntent: false,
  requestUnderTest: "",
  pendingIntentObservations: [] as {
    key: string;
    journal: Record<string, unknown> | null;
  }[],
  deleteGate: null as Promise<void> | null,
  onDeleteEntered: null as (() => void) | null,
  validationGate: null as Promise<void> | null,
  onValidationEntered: null as (() => void) | null,
  credentials: new Map<string, string>(),
}));

vi.mock("@agent-native/core/credentials", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/credentials")>()),
  saveCredential: async (
    key: string,
    value: string,
    scope?: { userEmail?: string; orgId?: string },
  ) => {
    if (state.capturePendingIntent) {
      const settings = await import("@agent-native/core/settings");
      const journal = await settings.getUserSetting(
        scope?.userEmail ?? "atomic-owner@example.test",
        `analytics.data.save:${scope?.orgId ?? "personal"}:${state.requestUnderTest}`,
        { bypassCache: true },
      );
      state.pendingIntentObservations.push({ key, journal });
    }
    state.credentials.set(key, value);
  },
  deleteCredential: async (key: string) => {
    if (state.failCredentialDelete)
      throw new Error("Simulated staged credential cleanup failure");
    state.credentials.delete(key);
  },
}));
vi.mock(
  "../server/model/data-connection-provider.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../server/model/data-connection-provider.js")
    >()),
    validateSubmittedServiceAccount: async () => {
      const gate = state.validationGate;
      state.onValidationEntered?.();
      if (gate) await gate;
    },
    validateBigQueryProjectAccess: async () => {},
    requestMetadata: async () => ({}),
  }),
);
vi.mock("@agent-native/core/workspace-connections", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/workspace-connections")
  >()),
  deleteWorkspaceConnection: async (
    ...args: Parameters<
      typeof import("@agent-native/core/workspace-connections").deleteWorkspaceConnection
    >
  ) => {
    const actual =
      await importOriginal<
        typeof import("@agent-native/core/workspace-connections")
      >();
    const gate = state.deleteGate;
    state.onDeleteEntered?.();
    if (gate) await gate;
    return actual.deleteWorkspaceConnection(...args);
  },
  upsertWorkspaceConnectionGrant: async (input: {
    connectionId: string;
    appId: string;
    provider: string;
  }) => {
    if (state.failGrant) throw new Error("Simulated grant failure");
    const actual =
      await importOriginal<
        typeof import("@agent-native/core/workspace-connections")
      >();
    return actual.upsertWorkspaceConnectionGrant(input);
  },
}));
vi.mock("@agent-native/core/settings", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/settings")>();
  return {
    ...actual,
    mutateUserSetting: async (
      email: string,
      key: string,
      updater: (
        current: Record<string, unknown> | null,
      ) => Record<string, unknown> | Promise<Record<string, unknown>>,
      options?: unknown,
    ) => {
      if (!state.failFailedJournalWrite)
        return actual.mutateUserSetting(email, key, updater, options as never);
      return actual.mutateUserSetting(
        email,
        key,
        async (current) => {
          const next = await updater(current);
          if (next.status === "failed")
            throw new Error("Simulated failed-journal persistence failure");
          return next;
        },
        options as never,
      );
    },
    mutateOrgSetting: async (
      orgId: string,
      key: string,
      updater: (
        current: Record<string, unknown> | null,
      ) => Record<string, unknown> | Promise<Record<string, unknown>>,
      options?: unknown,
    ) => {
      if (state.failAnnotation && key.includes("resource-metadata"))
        throw new Error("Simulated annotation failure");
      return actual.mutateOrgSetting(orgId, key, updater, options as never);
    },
  };
});

const {
  deleteDataConnection,
  getDataConnectionSaveResult,
  getDataConnectionForm,
  listDataConnections,
  saveDataConnection,
} = await import("../server/model/data-connections.js");
const { readConnectionAnnotationOverride, writeDataResourceMetadata } =
  await import("../server/model/data-resource-metadata.js");
const { getDb } = await import("../server/db/index.js");
const { ensureAnalyticsDatabase } = await import("../server/model/database.js");

const round = mkdtempSync(join(tmpdir(), "data-connection-atomic-"));
const previousDatabase = process.env.DATABASE_URL;
const orgA = `qa-atomic-${randomUUID()}`;
const owner = "atomic-owner@example.test";
const scopeA = { ownerEmail: owner, orgId: orgA };

function asOwner<T>(call: () => T) {
  return runWithRequestContext(
    {
      userEmail: owner,
      orgId: orgA,
      authUserId: owner,
      userName: "QA atomic account",
      isSyntheticTraffic: true,
    },
    call,
  );
}

function asPersonalOwner<T>(call: () => T) {
  return runWithRequestContext(
    {
      userEmail: owner,
      orgScope: "personal",
      authUserId: owner,
      userName: "QA personal atomic account",
      isSyntheticTraffic: true,
    },
    call,
  );
}

function journalKey(requestId: string) {
  return `analytics.data.save:${orgA}:${requestId}`;
}

const values = {
  name: "QA atomic warehouse",
  projectId: "qa-project",
  serviceAccount: "{}",
};

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${join(round, "database")}`;
  await runMigrations([...ORG_MIGRATIONS], {
    table: "qa_atomic_org_migrations",
  })(null);
  await ensureAnalyticsDatabase();
  await ensureWorkspaceConnectionsTable();
  await getDb().insert(organizations).values({
    id: orgA,
    name: "QA atomic workspace",
    createdBy: owner,
    createdAt: Date.now(),
  });
  await getDb().insert(orgMembers).values({
    id: randomUUID(),
    orgId: orgA,
    email: owner,
    role: "owner",
    joinedAt: Date.now(),
  });
});

afterAll(async () => {
  await closeDbExec();
  if (previousDatabase === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabase;
  const owned = resolve(round);
  if (
    owned !== resolve(tmpdir()) &&
    owned !== resolve(process.cwd()) &&
    owned.startsWith(resolve(tmpdir()) + "/data-connection-atomic-")
  ) {
    rmSync(owned, { recursive: true, force: true });
  } else {
    throw new Error("Refused cleanup outside this test round");
  }
});

beforeEach(() => {
  state.failGrant = false;
  state.failAnnotation = false;
  state.failCredentialDelete = false;
  state.failFailedJournalWrite = false;
  state.capturePendingIntent = false;
  state.requestUnderTest = "";
  state.pendingIntentObservations = [];
  state.deleteGate = null;
  state.onDeleteEntered = null;
  state.validationGate = null;
  state.onValidationEntered = null;
});

async function createConnection(requestId = randomUUID()) {
  return asOwner(() =>
    saveDataConnection({
      requestId,
      type: "bigquery",
      draft: false,
      values,
    }),
  );
}

describe("atomic successful save", () => {
  it("commits row, grant and completed journal together and returns the journal", async () => {
    const requestId = randomUUID();
    const saved = await createConnection(requestId);
    expect(saved.id).toBeTruthy();
    expect(saved.aiUsage).toBe("excluded");
    expect(await journalKeyStatus(requestId)).toBe("complete");
    expect((await asOwner(() => getWorkspaceConnection(saved.id)))?.label).toBe(
      "QA atomic warehouse",
    );
  });

  it("rolls the row back when the grant write fails and resumes with the same request id", async () => {
    const requestId = randomUUID();
    state.failGrant = true;
    await expect(createConnection(requestId)).rejects.toThrow(
      "Simulated grant failure",
    );
    const failed = await journalStatus(requestId);
    expect(failed?.status).not.toBe("complete");
    const connections = await asOwner(() => ownerConnections());
    expect(
      connections.some((row) => row.config.lastSaveRequestId === requestId),
    ).toBe(false);

    state.failGrant = false;
    const saved = await asOwner(() =>
      saveDataConnection({ requestId, type: "bigquery", draft: false, values }),
    );
    expect(await journalKeyStatus(requestId)).toBe("complete");
    expect((await asOwner(() => getWorkspaceConnection(saved.id)))?.label).toBe(
      values.name,
    );
  });

  it("rolls the row back when the canonical annotation write fails", async () => {
    // First create cleanly so an update can carry a dirty canonical field.
    const created = await createConnection(randomUUID());
    const form = await asOwner(() => getDataConnectionForm(created.id));
    const updateRequest = randomUUID();
    state.failAnnotation = true;
    await expect(
      asOwner(() =>
        saveDataConnection({
          requestId: updateRequest,
          id: created.id,
          type: "bigquery",
          draft: false,
          baseline: form.baseline,
          values: { ...values, description: "Dirty description" },
        }),
      ),
    ).rejects.toThrow("Simulated annotation failure");
    expect(await journalKeyStatus(updateRequest)).not.toBe("complete");
    expect(
      (await asOwner(() => getWorkspaceConnection(created.id)))?.label,
    ).toBe(values.name);
    expect(
      await asOwner(() => readConnectionAnnotationOverride(scopeA, created.id)),
    ).toBeNull();

    state.failAnnotation = false;
    const retried = await asOwner(() =>
      saveDataConnection({
        requestId: updateRequest,
        id: created.id,
        type: "bigquery",
        draft: false,
        baseline: form.baseline,
        values: { ...values, description: "Dirty description" },
      }),
    );
    expect(retried.description).toBe("Dirty description");
    expect(await journalKeyStatus(updateRequest)).toBe("complete");
  });

  it("skips an unchanged canonical field so a manager's header edit survives", async () => {
    const created = await createConnection(randomUUID());
    const form = await asOwner(() => getDataConnectionForm(created.id));
    await writeDataResourceMetadata(
      scopeA,
      created.id,
      { kind: "connection", id: created.id },
      { description: "Manager header" },
    );
    const saved = await asOwner(() =>
      saveDataConnection({
        requestId: randomUUID(),
        id: created.id,
        type: "bigquery",
        draft: false,
        baseline: form.baseline,
        values: { ...values, description: form.baseline.description },
      }),
    );
    expect(saved.description).toBe("Manager header");
  });

  it("refuses a dirty stale canonical field with 409 and changes nothing", async () => {
    const created = await createConnection(randomUUID());
    const form = await asOwner(() => getDataConnectionForm(created.id));
    await writeDataResourceMetadata(
      scopeA,
      created.id,
      { kind: "connection", id: created.id },
      { description: "Manager header" },
    );
    const requestId = randomUUID();
    await expect(
      asOwner(() =>
        saveDataConnection({
          requestId,
          id: created.id,
          type: "bigquery",
          draft: false,
          baseline: form.baseline,
          values: { ...values, description: "Stale admin edit" },
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(await journalKeyStatus(requestId)).not.toBe("complete");
    expect(
      (
        await asOwner(() =>
          readConnectionAnnotationOverride(scopeA, created.id),
        )
      )?.description,
    ).toBe("Manager header");
  });

  it("recovers a committed save after a lost response without duplicate writes", async () => {
    const requestId = randomUUID();
    const first = await createConnection(requestId);
    const beforeCount = (await asOwner(() => ownerConnections())).length;
    const revision = (
      await asOwner(() => readConnectionAnnotationOverride(scopeA, first.id))
    )?.revision;
    const second = await asOwner(() =>
      saveDataConnection({ requestId, type: "bigquery", draft: false, values }),
    );
    expect(second.id).toBe(first.id);
    const after = await asOwner(() =>
      readConnectionAnnotationOverride(scopeA, first.id),
    );
    expect(after?.revision ?? 0).toBe(revision ?? 0);
    const owned = await asOwner(() => ownerConnections());
    expect(owned).toHaveLength(beforeCount);
  });

  it("records a failed save and preserves the primary error when staged credential cleanup fails", async () => {
    const requestId = randomUUID();
    const priorKeys = new Set(state.credentials.keys());
    state.failGrant = true;
    state.failCredentialDelete = true;

    await expect
      .soft(createConnection(requestId))
      .rejects.toThrow("Simulated grant failure");
    expect.soft(await journalKeyStatus(requestId)).toBe("failed");
    await expect
      .soft(asOwner(() => getDataConnectionSaveResult(requestId)))
      .rejects.toMatchObject({
        errorCode: "data_connection_save_failed",
        statusCode: 409,
      });
    expect(
      (await asOwner(() => ownerConnections())).some(
        (row) => row.config.lastSaveRequestId === requestId,
      ),
    ).toBe(false);
    // The vault seam really failed: this attempt's key still needs cleanup.
    expect(
      [...state.credentials.keys()].filter((key) => !priorKeys.has(key)),
    ).toHaveLength(1);
  });

  it("persists personal description and AI inclusion across save result, form and list reads", async () => {
    const requestId = randomUUID();
    const saved = await asPersonalOwner(() =>
      saveDataConnection({
        requestId,
        type: "bigquery",
        draft: false,
        values: {
          ...values,
          description: "Personal warehouse context",
          includeForAI: true,
        },
      }),
    );
    expect.soft(saved.description).toBe("Personal warehouse context");
    expect.soft(saved.aiUsage).toBe("included");
    await expectPersonalPresentation(
      saved.id,
      requestId,
      "Personal warehouse context",
      true,
    );
  });

  it("updates and clears personal canonical fields and preserves them when omitted", async () => {
    const created = await asPersonalOwner(() =>
      upsertWorkspaceConnection({
        provider: "bigquery",
        label: "QA personal legacy warehouse",
        accountId: "qa-project",
        status: "disabled",
        allowedApps: ["analytics-2"],
        config: {
          projectId: "qa-project",
          draft: true,
          description: "Existing personal context",
          includeForAI: true,
        },
      }),
    );
    const form = await asPersonalOwner(() => getDataConnectionForm(created.id));
    const editRequest = randomUUID();
    await asPersonalOwner(() =>
      saveDataConnection({
        requestId: editRequest,
        id: created.id,
        type: "bigquery",
        draft: true,
        baseline: form.baseline,
        values: {
          name: "QA personal edited warehouse",
          description: "Edited personal context",
          includeForAI: false,
        },
      }),
    );
    await expectPersonalPresentation(
      created.id,
      editRequest,
      "Edited personal context",
      false,
    );

    const editedForm = await asPersonalOwner(() =>
      getDataConnectionForm(created.id),
    );
    const clearRequest = randomUUID();
    await asPersonalOwner(() =>
      saveDataConnection({
        requestId: clearRequest,
        id: created.id,
        type: "bigquery",
        draft: true,
        baseline: editedForm.baseline,
        values: {
          name: "QA personal cleared warehouse",
          description: "",
          includeForAI: false,
        },
      }),
    );
    await expectPersonalPresentation(created.id, clearRequest, "", false);

    const omittedRequest = randomUUID();
    await asPersonalOwner(() =>
      saveDataConnection({
        requestId: omittedRequest,
        id: created.id,
        type: "bigquery",
        draft: true,
        values: { name: "QA personal renamed warehouse" },
      }),
    );
    await expectPersonalPresentation(created.id, omittedRequest, "", false);
  });

  it("persists each staged credential intent before invoking the vault save", async () => {
    const requestId = randomUUID();
    state.capturePendingIntent = true;
    state.requestUnderTest = requestId;
    await asOwner(() =>
      saveDataConnection({
        requestId,
        type: "bigquery",
        draft: false,
        values: { ...values, dbtToken: "SYNTHETIC DBT FIXTURE" },
      }),
    );

    expect(state.pendingIntentObservations).toHaveLength(2);
    for (const { key, journal } of state.pendingIntentObservations) {
      expect(journal).toMatchObject({ status: "pending" });
      expect(journal?.attemptId).toEqual(expect.any(String));
      expect(journal?.stagedKeys).toContain(key);
    }
  });

  it("recovers an expired same-id save after its failed-journal write was unavailable", async () => {
    const requestId = randomUUID();
    const beforeKeys = new Set(state.credentials.keys());
    const beforeRows = (await asOwner(() => ownerConnections())).length;
    state.failGrant = true;
    state.failCredentialDelete = true;
    state.failFailedJournalWrite = true;
    await expect(createConnection(requestId)).rejects.toMatchObject({
      errorCode: "data_connection_save_recovery_unavailable",
      statusCode: 503,
    });
    const failedKeys = [...state.credentials.keys()].filter(
      (key) => !beforeKeys.has(key),
    );
    expect(failedKeys).toHaveLength(1);
    const pending = await journalStatus(requestId);
    expect(pending?.status).toBe("pending");
    expect
      .soft(pending?.stagedKeys)
      .toEqual(expect.arrayContaining(failedKeys));
    await expect(
      asOwner(() => getDataConnectionSaveResult(requestId)),
    ).rejects.toMatchObject({
      errorCode: "data_connection_save_pending",
      statusCode: 409,
    });

    await asOwner(() =>
      mutateUserSetting(owner, journalKey(requestId), (current) => ({
        ...current,
        reservedAtMs: Date.now() - 11 * 60_000,
      })),
    );
    state.failGrant = false;
    state.failCredentialDelete = false;
    state.failFailedJournalWrite = false;
    const recovered = await createConnection(requestId);
    expect(recovered.id).toBe(pending?.connectionId);
    expect(await journalKeyStatus(requestId)).toBe("complete");
    expect((await asOwner(() => ownerConnections())).length).toBe(
      beforeRows + 1,
    );
    for (const key of failedKeys)
      expect(state.credentials.has(key)).toBe(false);
    expect(
      (await asOwner(() => getDataConnectionSaveResult(requestId))).id,
    ).toBe(recovered.id);
  });

  it("fences an old provider attempt after an expired same-id takeover commits", async () => {
    const requestId = randomUUID();
    let validationEntered = false;
    let releaseValidation!: () => void;
    state.validationGate = new Promise<void>((resolve) => {
      releaseValidation = resolve;
    });
    state.onValidationEntered = () => {
      validationEntered = true;
    };
    const oldOutcome = createConnection(requestId).then(
      (saved) => ({ saved, error: undefined }),
      (error) => ({ saved: undefined, error }),
    );
    try {
      await vi.waitFor(() => expect(validationEntered).toBe(true), {
        timeout: 10_000,
      });
      const before = await journalStatus(requestId);
      await asOwner(() =>
        mutateUserSetting(owner, journalKey(requestId), (current) => ({
          ...current,
          reservedAtMs: Date.now() - 11 * 60_000,
        })),
      );
      state.validationGate = null;
      state.onValidationEntered = null;
      const winner = await createConnection(requestId);
      const winningJournal = await journalStatus(requestId);
      expect(winningJournal?.status).toBe("complete");
      expect(winningJournal?.attemptId).not.toBe(before?.attemptId);

      releaseValidation();
      const old = await oldOutcome;
      expect(old.saved).toBeUndefined();
      expect(old.error).toMatchObject({ statusCode: 409 });
      expect(await journalStatus(requestId)).toEqual(winningJournal);
      expect(
        (await asOwner(() => getDataConnectionSaveResult(requestId))).id,
      ).toBe(winner.id);
      expect(
        (await asOwner(() => ownerConnections())).filter(
          (row) => row.config.lastSaveRequestId === requestId,
        ),
      ).toHaveLength(1);
    } finally {
      state.validationGate = null;
      state.onValidationEntered = null;
      releaseValidation();
      await oldOutcome;
    }
  }, 30_000);

  it("rejects a personal save after deletion intent commits but before the row is removed", async () => {
    const priorKeys = new Set(state.credentials.keys());
    const created = await asPersonalOwner(() =>
      saveDataConnection({
        requestId: randomUUID(),
        type: "bigquery",
        draft: false,
        values,
      }),
    );
    const createdKeys = [...state.credentials.keys()].filter(
      (key) => !priorKeys.has(key),
    );
    expect(createdKeys).toHaveLength(1);
    const form = await asPersonalOwner(() => getDataConnectionForm(created.id));
    const originalRow = await asPersonalOwner(() =>
      getWorkspaceConnection(created.id),
    );
    const originalCredentials = [...state.credentials.entries()];
    let deleteEntered = false;
    let releaseDelete!: () => void;
    state.deleteGate = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    state.onDeleteEntered = () => {
      deleteEntered = true;
    };
    const deleteOutcome = asPersonalOwner(() =>
      deleteDataConnection({ id: created.id }),
    ).then(
      (deleted) => ({ deleted, error: undefined }),
      (error) => ({ deleted: undefined, error }),
    );
    try {
      await vi.waitFor(() => expect(deleteEntered).toBe(true), {
        timeout: 10_000,
      });
      expect(
        await asPersonalOwner(() =>
          getUserSetting(
            owner,
            `analytics.data.delete:personal:${created.id}`,
            { bypassCache: true },
          ),
        ),
      ).toMatchObject({
        connectionId: created.id,
        scope: "personal",
        status: "deleting",
      });
      expect(
        await asPersonalOwner(() => getWorkspaceConnection(created.id)),
      ).toEqual(originalRow);
      await expect(
        asPersonalOwner(() =>
          saveDataConnection({
            requestId: randomUUID(),
            id: created.id,
            type: "bigquery",
            draft: true,
            baseline: form.baseline,
            values: { name: "QA personal forbidden resurrection" },
          }),
        ),
      ).rejects.toMatchObject({
        statusCode: 409,
        errorCode: "data_connection_deleting",
      });
      expect(
        await asPersonalOwner(() => getWorkspaceConnection(created.id)),
      ).toEqual(originalRow);
      expect([...state.credentials.entries()]).toEqual(originalCredentials);
    } finally {
      state.deleteGate = null;
      state.onDeleteEntered = null;
      releaseDelete();
      const outcome = await deleteOutcome;
      expect(outcome.error).toBeUndefined();
      expect(outcome.deleted).toMatchObject({ id: created.id, deleted: true });
      expect(
        await asPersonalOwner(() => getWorkspaceConnection(created.id)),
      ).toBeNull();
      expect(
        (await asPersonalOwner(() => listDataConnections())).some(
          (row) => row.id === created.id,
        ),
      ).toBe(false);
      for (const key of createdKeys)
        expect(state.credentials.has(key)).toBe(false);
    }
  }, 30_000);

  it("does not retarget a failed edit request to another existing connection", async () => {
    const first = await createConnection(randomUUID());
    const second = await createConnection(randomUUID());
    const firstForm = await asOwner(() => getDataConnectionForm(first.id));
    const secondForm = await asOwner(() => getDataConnectionForm(second.id));
    const beforeFirst = await asOwner(() => getWorkspaceConnection(first.id));
    const beforeSecond = await asOwner(() => getWorkspaceConnection(second.id));
    const requestId = randomUUID();
    state.failGrant = true;
    await expect(
      asOwner(() =>
        saveDataConnection({
          requestId,
          id: first.id,
          type: "bigquery",
          draft: false,
          baseline: firstForm.baseline,
          values: { ...values, name: "QA first failed edit" },
        }),
      ),
    ).rejects.toThrow("Simulated grant failure");
    state.failGrant = false;
    const failedJournal = await journalStatus(requestId);
    expect(failedJournal).toMatchObject({
      status: "failed",
      connectionId: first.id,
    });
    await expect(
      asOwner(() =>
        saveDataConnection({
          requestId,
          id: second.id,
          type: "bigquery",
          draft: false,
          baseline: secondForm.baseline,
          values: { ...values, name: "QA forbidden retarget" },
        }),
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "data_connection_request_conflict",
    });
    expect(await asOwner(() => getWorkspaceConnection(first.id))).toEqual(
      beforeFirst,
    );
    expect(await asOwner(() => getWorkspaceConnection(second.id))).toEqual(
      beforeSecond,
    );
    expect(await journalStatus(requestId)).toEqual(failedJournal);
  });
});

async function expectPersonalPresentation(
  connectionId: string,
  requestId: string,
  description: string,
  includeForAI: boolean,
) {
  const row = await asPersonalOwner(() => getWorkspaceConnection(connectionId));
  expect.soft(row?.config).toMatchObject({ description, includeForAI });
  const form = await asPersonalOwner(() => getDataConnectionForm(connectionId));
  expect.soft(form.values).toMatchObject({ description, includeForAI });
  const expected = {
    id: connectionId,
    description,
    aiUsage: includeForAI ? "included" : "excluded",
  };
  expect
    .soft(await asPersonalOwner(() => getDataConnectionSaveResult(requestId)))
    .toMatchObject(expected);
  expect
    .soft(
      (await asPersonalOwner(() => listDataConnections())).find(
        (connection) => connection.id === connectionId,
      ),
    )
    .toMatchObject(expected);
}

async function ownerConnections() {
  const { listWorkspaceConnectionsForApp } =
    await import("@agent-native/core/workspace-connections");
  return listWorkspaceConnectionsForApp({
    appId: "analytics-2",
    provider: "bigquery",
  });
}

async function journalStatus(requestId: string) {
  return asOwner(() => getUserSetting(owner, journalKey(requestId)));
}

async function journalKeyStatus(requestId: string) {
  const status = await journalStatus(requestId);
  return status?.status;
}
