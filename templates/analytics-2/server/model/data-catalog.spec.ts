import { ActionContractError } from "@agent-native/core/action";
import { checkActionProperties } from "@agent-native/core/action-properties";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * Fixtures stand in for the existing approved provider seam and the app's
 * transaction guard. No network or database call is made here; the real
 * transaction guard is exercised separately when available.
 */
interface CatalogState {
  actor: { userEmail: string; orgId: string } | null;
  manager: boolean;
  explorer: boolean;
  aiIncluded: boolean;
  excludedResourceIds: Set<string>;
  descendantPolicyRevision: number;
  policyRevision: number;
  projectId: string;
  additionalProjectIds: string;
  datasetNames: string;
  nativeRevision: string | undefined;
  credentialKey: string;
  readable: Set<string>;
  readableAny: boolean;
  settings: Map<string, unknown>;
  corruptRaw: Set<string>;
  tombstones: Map<string, "deleting" | "deleted">;
  datasetCount: number;
  generation: number;
  stuckCursor: boolean;
  cycleCursors: string[] | null;
  listError: { errorCode: string; message: string } | null;
  datasetCalls: { connectionId: string; first: number; after?: string }[];
  readCalls: string[];
  settingReads: number;
  settingWrites: number;
  blockCall: number | null;
  failWriteAt: number | null;
  blocked: { promise: Promise<void>; resolve: () => void } | null;
}

const state = vi.hoisted(
  () =>
    ({
      actor: { userEmail: "qa-owner@example.invalid", orgId: "qa-workspace" },
      manager: true,
      explorer: true,
      aiIncluded: true,
      excludedResourceIds: new Set<string>(),
      descendantPolicyRevision: 0,
      policyRevision: 0,
      projectId: "qa-project",
      additionalProjectIds: "",
      datasetNames: "",
      nativeRevision: undefined,
      credentialKey: "DATA_CONNECTION_QA_SERVICE_ACCOUNT",
      readable: new Set<string>(),
      readableAny: false,
      settings: new Map<string, unknown>(),
      corruptRaw: new Set<string>(),
      tombstones: new Map<string, "deleting" | "deleted">(),
      datasetCount: 0,
      generation: 1,
      stuckCursor: false,
      cycleCursors: null,
      listError: null,
      datasetCalls: [],
      readCalls: [],
      settingReads: 0,
      settingWrites: 0,
      blockCall: null,
      failWriteAt: null,
      blocked: null,
    }) as CatalogState,
);

function keyLocation(orgId: string, connectionId: string) {
  return `o:${orgId}:analytics.catalog:v1:${encodeURIComponent(connectionId)}`;
}

vi.mock("@agent-native/core/settings", () => ({
  getSettingEntry: async (location: string) => {
    state.settingReads += 1;
    if (state.corruptRaw.has(location))
      throw new SyntaxError("Invalid prepared statement");
    if (!state.settings.has(location)) return { found: false as const };
    return { found: true as const, value: state.settings.get(location) };
  },
  mutateOrgSetting: async (
    orgId: string,
    key: string,
    updater: (current: unknown | null) => Record<string, unknown>,
    options?: { validateStoredValue?: (value: unknown) => void },
  ) => {
    state.settingWrites += 1;
    if (state.failWriteAt === state.settingWrites)
      throw new Error("connection reset by peer");
    const location = `o:${orgId}:${key}`;
    if (state.corruptRaw.has(location))
      throw new SyntaxError("Invalid prepared statement");
    const present = state.settings.has(location);
    const current = present ? (state.settings.get(location) ?? null) : null;
    if (present) options?.validateStoredValue?.(current);
    const next = updater(current);
    state.settings.set(location, next);
    return next;
  },
  deleteSetting: async (location: string) => state.settings.delete(location),
  deleteSettingIfValue: async (
    location: string,
    expected: Record<string, unknown>,
  ) => {
    if (
      !state.settings.has(location) ||
      JSON.stringify(state.settings.get(location)) !== JSON.stringify(expected)
    )
      return false;
    state.settings.delete(location);
    return true;
  },
}));

vi.mock("../lib/workspace-access.js", () => ({
  requireCurrentWorkspace: async () => {
    if (!state.actor) {
      const { fail } = await import("@agent-native/core/action");
      fail("Sign in to continue.", {
        statusCode: 401,
        errorCode: "sign_in_required",
      });
    }
    const actor = state.actor!;
    return { ownerEmail: actor.userEmail, orgId: actor.orgId };
  },
  currentWorkspaceCapabilities: async () => ({
    isManagerOrAbove: state.manager,
    allows: () => state.explorer || state.manager,
  }),
}));

vi.mock("./data-connection-mutations.js", () => ({
  withConnectionGuard: async (
    _scope: unknown,
    _id: string,
    run: (tx: unknown) => Promise<unknown>,
  ) => run("qa-transaction"),
  metadataOptions: () => ({ bypassCache: true }),
}));

vi.mock("./data-resource-metadata.js", () => ({
  readResourcePolicyRevision: async () => state.descendantPolicyRevision,
  readDataResourceMetadata: async (
    _scope: unknown,
    connectionId: string,
    refs: { kind: string; id: string }[],
  ) => ({
    connectionId,
    resources: refs.map((ref) => ({
      ...ref,
      connectionId,
      description: "",
      statusId: null,
      categoryIds: [],
      aiUsage: state.excludedResourceIds.has(ref.id) ? "excluded" : null,
    })),
  }),
  readConnectionDeletionState: async (
    scope: { orgId: string },
    connectionId: string,
  ) => state.tombstones.get(`${scope.orgId}:${connectionId}`) ?? null,
}));

vi.mock("./data-connections.js", () => ({
  readBrowsableDataConnection: async (id: string) => {
    state.readCalls.push(id);
    const orgId = state.actor?.orgId ?? "";
    if (!state.readableAny && !state.readable.has(`${orgId}:${id}`)) {
      const { fail } = await import("@agent-native/core/action");
      fail("Data connection not found.", {
        statusCode: 404,
        errorCode: "data_connection_not_found",
      });
    }
    return {
      id,
      provider: "bigquery",
      status: "connected",
      accountId: state.projectId,
      config: {
        projectId: state.projectId,
        additionalProjectIds: state.additionalProjectIds,
        datasetNames: state.datasetNames,
      },
      credentialRefs: [
        { key: state.credentialKey, provider: "bigquery", scope: "org" },
      ],
      nativeRevision: state.nativeRevision,
    };
  },
  connectionIncludedForAgent: async () => state.aiIncluded,
  connectionPresentation: async () => ({
    description: "",
    effectiveAiUsage: state.aiIncluded ? "included" : "excluded",
    descriptionInitialized: false,
    aiUsageInitialized: false,
    annotationRevision: state.policyRevision,
  }),
  listConnectionDatasets: async (input: {
    connectionId: string;
    first: number;
    after?: string;
  }) => {
    state.datasetCalls.push({ ...input });
    const call = state.datasetCalls.length;
    const offset = input.after ? Number(input.after) : 0;
    const total = state.datasetCount;
    const generation = state.generation;
    if (state.blockCall === call && state.blocked) await state.blocked.promise;
    if (state.listError)
      throw new ActionContractError(state.listError.message, {
        errorCode: state.listError.errorCode,
      });
    const end = Math.min(offset + input.first, total);
    const items = Array.from({ length: end - offset }, (_, index) => ({
      id: `schema:qa-project:gen${generation}_dataset_${offset + index + 1}`,
      name: `gen${generation}_dataset_${offset + index + 1}`,
      kind: "schema" as const,
      hasChildren: true,
    }));
    if (state.cycleCursors) {
      const cursor =
        state.cycleCursors[call % state.cycleCursors.length] ?? "cycle";
      return { items: items.slice(0, 1), endCursor: cursor, hasNextPage: true };
    }
    if (state.stuckCursor)
      return { items, endCursor: "stuck", hasNextPage: true };
    return {
      items,
      endCursor: end < total ? String(end) : null,
      hasNextPage: end < total,
    };
  },
}));

import getCatalogAction from "../../actions/get-data-browser-catalog";
import refreshCatalogAction from "../../actions/refresh-data-browser-catalog";
import {
  DATA_CATALOG_MAX_PAGE,
  refreshDataBrowserCatalogSchema,
} from "../../app/lib/model/data-catalog-contracts";
import { refreshWarehouseCatalog } from "../../e2e/phase1/warehouse-fixtures.js";
import {
  DATA_CATALOG_REFRESH_LOCK_MS,
  clearDataBrowserCatalog,
  readDataBrowserCatalog,
  refreshDataBrowserCatalog,
} from "./data-browser-catalog";

const connection = "qa-connection";
const org = "qa-workspace";
const scope = { ownerEmail: "qa-owner@example.invalid", orgId: org };

function deferred() {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve: () => resolve?.() };
}

function makeReadable(connectionId = connection, orgId = org) {
  state.readable.add(`${orgId}:${connectionId}`);
}

function settingsKey(connectionId = connection, orgId = org) {
  return keyLocation(orgId, connectionId);
}

function storedValue(connectionId = connection, orgId = org) {
  return state.settings.get(settingsKey(connectionId, orgId));
}

async function readAll(input: { search?: string } = {}) {
  const resources: { id: string; name: string }[] = [];
  let after: string | undefined;
  let pages = 0;
  for (;;) {
    const page = await readDataBrowserCatalog(
      {
        connectionId: connection,
        first: 100,
        ...input,
        ...(after ? { after } : {}),
      },
      "frontend",
    );
    resources.push(...page.resources);
    pages += 1;
    expect(page.totalCount).toBeGreaterThanOrEqual(page.resources.length);
    if (!page.hasNextPage) break;
    if (!page.endCursor)
      throw new Error("A page claims more rows without a cursor");
    after = page.endCursor;
    if (pages > 100) throw new Error("Catalog paging did not terminate");
  }
  return { resources, pages };
}

async function waitForCall(count: number) {
  while (state.datasetCalls.length < count) await Promise.resolve();
}

beforeEach(() => {
  state.nativeRevision = undefined;
  state.actor = { userEmail: "qa-owner@example.invalid", orgId: org };
  state.manager = true;
  state.explorer = true;
  state.excludedResourceIds.clear();
  state.descendantPolicyRevision = 0;
  state.aiIncluded = true;
  state.policyRevision = 0;
  state.projectId = "qa-project";
  state.additionalProjectIds = "";
  state.datasetNames = "";
  state.credentialKey = "DATA_CONNECTION_QA_SERVICE_ACCOUNT";
  state.readable.clear();
  state.readableAny = false;
  state.settings.clear();
  state.corruptRaw.clear();
  state.tombstones.clear();
  state.datasetCount = 0;
  state.generation = 1;
  state.stuckCursor = false;
  state.cycleCursors = null;
  state.listError = null;
  state.datasetCalls = [];
  state.readCalls = [];
  state.settingReads = 0;
  state.settingWrites = 0;
  state.blockCall = null;
  state.failWriteAt = null;
  state.blocked = deferred();
  makeReadable();
});

describe("saved public schema catalog", () => {
  it("reads every provider page for a 1001-schema connection and pages the whole saved catalog", async () => {
    state.datasetCount = 1001;
    const refreshed = await refreshCatalogAction.run({
      connectionId: connection,
    });
    expect(refreshed.refreshState).toBe("ready");
    expect(refreshed.totalCount).toBe(1001);
    expect(state.datasetCalls.map((call) => call.first)).toEqual([1000, 1000]);
    expect(state.datasetCalls).toHaveLength(2);

    const writesAfterRefresh = state.settingWrites;
    const { resources, pages } = await readAll();
    expect(resources).toHaveLength(1001);
    expect(resources.at(-1)?.name).toBe("gen1_dataset_1001");
    expect(pages).toBe(11);
    expect(state.settingWrites).toBe(writesAfterRefresh);
    expect(state.settingReads).toBeGreaterThan(0);
  });

  it("reports the subset count for a search instead of the page length", async () => {
    state.datasetCount = 1001;
    await refreshCatalogAction.run({ connectionId: connection });
    const page = await getCatalogAction.run({
      connectionId: connection,
      search: "gen1_dataset_100",
      first: 1,
    });
    expect(page.resources).toHaveLength(1);
    expect(page.totalCount).toBe(3);
    expect(page.hasNextPage).toBe(true);
    expect(page.endCursor).toBeTypeOf("string");
  });

  it("keeps one workspace's snapshot out of the same account's other workspace", async () => {
    state.datasetCount = 3;
    await refreshCatalogAction.run({ connectionId: connection });
    expect(state.settings.has(settingsKey())).toBe(true);

    const otherOrg = "other-workspace";
    makeReadable(connection, otherOrg);
    state.actor = { userEmail: "qa-owner@example.invalid", orgId: otherOrg };
    const isolated = await getCatalogAction.run({ connectionId: connection });
    expect(isolated.refreshState).toBe("never");
    expect(isolated.resources).toEqual([]);
    expect(isolated.totalCount).toBe(0);

    await refreshCatalogAction.run({ connectionId: connection });
    expect(state.settings.has(settingsKey(connection, otherOrg))).toBe(true);
    expect(state.settings.has(settingsKey())).toBe(true);
  });

  it("denies refresh to a non-manager and read to a viewer before any cache or provider work", async () => {
    state.manager = false;
    await expect(
      refreshCatalogAction.run({ connectionId: connection }),
    ).rejects.toThrow("Only workspace managers");
    expect(state.settingWrites).toBe(0);
    expect(state.settingReads).toBe(0);
    expect(state.datasetCalls).toHaveLength(0);
    expect(state.readCalls).toHaveLength(0);

    state.explorer = false;
    await expect(
      getCatalogAction.run({ connectionId: connection }),
    ).rejects.toThrow("do not have permission");
    expect(state.settingReads).toBe(0);
  });

  it("returns not found for an unreadable connection before reading or writing its cache", async () => {
    state.readable.clear();
    await expect(
      getCatalogAction.run({ connectionId: "unreadable-connection" }),
    ).rejects.toThrow("not found");
    expect(state.settingReads).toBe(0);
    await expect(
      refreshCatalogAction.run({ connectionId: "unreadable-connection" }),
    ).rejects.toThrow("not found");
    expect(state.settingWrites).toBe(0);
    expect(state.datasetCalls).toHaveLength(0);
  });

  it("refuses a repeated cursor and keeps the previous good catalog", async () => {
    state.datasetCount = 3;
    await refreshCatalogAction.run({ connectionId: connection });
    state.stuckCursor = true;
    await expect(
      refreshCatalogAction.run({ connectionId: connection }),
    ).rejects.toThrow("repeated a catalog cursor");

    const page = await getCatalogAction.run({ connectionId: connection });
    expect(page.refreshState).toBe("failed");
    expect(page.refreshError?.code).toBe("data_catalog_refresh_cursor_stuck");
    expect(page.totalCount).toBe(3);
    expect(page.resources.map((resource) => resource.name)).toEqual([
      "gen1_dataset_1",
      "gen1_dataset_2",
      "gen1_dataset_3",
    ]);
  });

  it("keeps the last good catalog and no provider text when the provider fails", async () => {
    state.datasetCount = 3;
    await refreshCatalogAction.run({ connectionId: connection });
    state.listError = {
      errorCode: "data_connection_provider_error",
      message: "providerdetail must not be stored",
    };
    await expect(
      refreshCatalogAction.run({ connectionId: connection }),
    ).rejects.toThrow("The catalog could not be refreshed");

    const page = await getCatalogAction.run({ connectionId: connection });
    expect(page.refreshState).toBe("failed");
    expect(page.refreshError).toEqual({
      code: "data_catalog_refresh_failed",
      message:
        "The catalog could not be refreshed. The last saved catalog is still available.",
    });
    expect(page.totalCount).toBe(3);
    expect(JSON.stringify([...state.settings.values()])).not.toContain(
      "providerdetail",
    );
    expect(JSON.stringify(page)).not.toContain("providerdetail");
  });

  it("reports a failed save of a fully read catalog as a save failure, not a provider failure", async () => {
    state.datasetCount = 3;
    await refreshCatalogAction.run({ connectionId: connection });
    state.failWriteAt = state.settingWrites + 2;
    await expect(
      refreshCatalogAction.run({ connectionId: connection }),
    ).rejects.toMatchObject({
      errorCode: "data_catalog_state_persist_failed",
      statusCode: 500,
    });
    expect(state.datasetCalls.length).toBeGreaterThan(1);

    const page = await getCatalogAction.run({ connectionId: connection });
    expect(page.refreshError?.code).toBe("data_catalog_state_persist_failed");
    expect(page.totalCount).toBe(3);
  });

  it("does not let a stale completion overwrite a newer refresh", async () => {
    state.datasetCount = 5;
    state.generation = 1;
    state.blockCall = 1;
    const stale = refreshDataBrowserCatalog(connection, { caller: "frontend" });
    await waitForCall(1);

    const stored = storedValue() as Record<string, unknown>;
    state.settings.set(settingsKey(), {
      ...stored,
      heartbeatAt: Date.now() - DATA_CATALOG_REFRESH_LOCK_MS - 1,
    });

    state.datasetCount = 2;
    state.generation = 2;
    const fresh = await refreshCatalogAction.run({ connectionId: connection });
    expect(fresh.totalCount).toBe(2);

    state.blocked?.resolve();
    const staleResult = await stale;

    expect(staleResult.totalCount).toBe(2);
    const page = await getCatalogAction.run({ connectionId: connection });
    expect(page.totalCount).toBe(2);
    expect(page.resources.map((resource) => resource.name)).toEqual([
      "gen2_dataset_1",
      "gen2_dataset_2",
    ]);
  });

  it("refuses two live refreshes for the same connection before the second provider call", async () => {
    state.datasetCount = 2;
    state.blockCall = 1;
    const first = refreshDataBrowserCatalog(connection, { caller: "frontend" });
    await waitForCall(1);
    await expect(
      refreshCatalogAction.run({ connectionId: connection }),
    ).rejects.toThrow("already running");
    expect(state.datasetCalls).toHaveLength(1);
    state.blocked?.resolve();
    await first;
  });

  it("rejects a page cursor from a different connection", async () => {
    state.datasetCount = 120;
    await refreshCatalogAction.run({ connectionId: connection });
    makeReadable("another-connection");
    const first = await getCatalogAction.run({
      connectionId: connection,
      first: 50,
    });
    if (!first.endCursor) throw new Error("Expected a cursor");
    await expect(
      getCatalogAction.run({
        connectionId: "another-connection",
        after: first.endCursor,
      }),
    ).rejects.toThrow("cursor is invalid");
    await expect(
      getCatalogAction.run({
        connectionId: connection,
        parentId: "schema:x:y",
      }),
    ).rejects.toThrow("top-level schemas only");
  });

  it("accepts the largest allowed page but never a larger one", async () => {
    state.datasetCount = 1001;
    await refreshCatalogAction.run({ connectionId: connection });
    const page = await getCatalogAction.run({
      connectionId: connection,
      first: DATA_CATALOG_MAX_PAGE,
    });
    expect(page.resources).toHaveLength(DATA_CATALOG_MAX_PAGE);
    await expect(
      getCatalogAction.run({
        connectionId: connection,
        first: DATA_CATALOG_MAX_PAGE + 1,
      }),
    ).rejects.toThrow();
  });

  it("removes only this connection's saved catalog on cleanup", async () => {
    state.datasetCount = 1;
    makeReadable("second-connection");
    await refreshCatalogAction.run({ connectionId: connection });
    await refreshCatalogAction.run({ connectionId: "second-connection" });
    await clearDataBrowserCatalog(scope, connection);
    expect(state.settings.has(settingsKey())).toBe(false);
    expect(state.settings.has(settingsKey("second-connection"))).toBe(true);
    // Internal cleanup does not require the deleted connection to be visible.
    state.readable.clear();
    await clearDataBrowserCatalog(scope, "second-connection");
    expect(state.settings.has(settingsKey("second-connection"))).toBe(false);
  });

  it("keeps both action contracts on generated inputs", async () => {
    state.readableAny = true;
    state.aiIncluded = true;
    state.settings.clear();
    state.datasetCount = 2;
    await checkActionProperties(getCatalogAction, {
      runs: 15,
      context: { caller: "http" },
    });
    await checkActionProperties(refreshCatalogAction, {
      runs: 15,
      context: { caller: "http" },
    });
    const page = await getCatalogAction.run({ connectionId: connection });
    expect(page.scope).toBe("root-schemas");
  });
});

describe("catalog source binding", () => {
  it("keeps the last good browser rows until a new native revision is ready", async () => {
    state.nativeRevision = "credential-v1";
    state.datasetCount = 2;
    await refreshCatalogAction.run({ connectionId: connection });
    const input = { connectionId: connection };
    const frontend = { caller: "frontend" as const };
    const original = await getCatalogAction.run(input, frontend);
    state.nativeRevision = "credential-v2";
    state.generation = 2;
    expect(await getCatalogAction.run(input, frontend)).toMatchObject({
      resources: original.resources,
      revision: original.revision,
      hasSuccessfulSnapshot: true,
    });

    state.blockCall = 2;
    const refresh = refreshDataBrowserCatalog(connection, frontend);
    await waitForCall(2);
    expect(await getCatalogAction.run(input, frontend)).toMatchObject({
      resources: original.resources,
      refreshState: "refreshing",
    });
    state.blocked?.resolve();
    await refresh;
    expect(
      (await getCatalogAction.run(input, frontend)).resources.map(
        (row) => row.name,
      ),
    ).toEqual(["gen2_dataset_1", "gen2_dataset_2"]);
  });

  it("keeps previous browser schemas and gives the reason a dataset selection failed", async () => {
    state.nativeRevision = "credential-v1";
    state.datasetCount = 2;
    await refreshCatalogAction.run({ connectionId: connection });
    const input = { connectionId: connection };
    const frontend = { caller: "frontend" as const };
    const original = await getCatalogAction.run(input, frontend);
    state.nativeRevision = "credential-v2";
    state.datasetNames = "restricted";
    const message =
      "Datasets: BigQuery could not read restricted (HTTP 403, accessDenied).";
    state.listError = {
      errorCode: "data_connection_dataset_unreadable",
      message,
    };
    await expect(
      refreshDataBrowserCatalog(connection, frontend),
    ).rejects.toThrow(message);
    expect(await getCatalogAction.run(input, frontend)).toMatchObject({
      refreshState: "failed",
      refreshError: { message },
      resources: original.resources,
    });
    expect((await getCatalogAction.run(input)).resources).toEqual([]);
  });

  it("keeps schemas from a preexisting native catalog after a dataset list edit", async () => {
    state.nativeRevision = "credential-v1";
    state.datasetNames = "previous_dataset";
    state.datasetCount = 2;
    await refreshCatalogAction.run({ connectionId: connection });
    const cache = storedValue();
    if (!cache || typeof cache !== "object")
      throw new Error("Expected a saved catalog");
    state.settings.set(
      settingsKey(),
      Object.fromEntries(
        Object.entries(cache).filter(([key]) => key !== "warehouseFingerprint"),
      ),
    );
    const input = { connectionId: connection };
    const frontend = { caller: "frontend" as const };
    const original = await getCatalogAction.run(input, frontend);
    state.datasetNames = "next_dataset";
    state.nativeRevision = "credential-v2";
    expect(await getCatalogAction.run(input, frontend)).toMatchObject({
      resources: original.resources,
      refreshState: "stale",
    });

    state.projectId = "repointed-project";
    expect(await getCatalogAction.run(input, frontend)).toMatchObject({
      resources: [],
      hasSuccessfulSnapshot: false,
    });
  });

  it("refreshes only the confirmed credential revision", async () => {
    state.nativeRevision = "credential-v2";
    state.datasetCount = 2;
    await expect(
      refreshCatalogAction.run({
        connectionId: connection,
        revision: "credential-v1",
      }),
    ).rejects.toMatchObject({ errorCode: "data_catalog_source_changed" });
    expect(state.datasetCalls).toHaveLength(0);

    const result = await refreshCatalogAction.run({
      connectionId: connection,
      revision: "credential-v2",
    });
    expect(result.refreshState).toBe("ready");
    expect(
      (await getCatalogAction.run({ connectionId: connection })).totalCount,
    ).toBe(2);
  });

  it("refreshes a saved warehouse catalog using the connection form revision", async () => {
    state.nativeRevision = "credential-v1";
    state.datasetCount = 2;
    const input = { connectionId: connection };
    const frontend = { caller: "frontend" as const };
    await refreshCatalogAction.run(input, frontend);
    const catalog = await getCatalogAction.run(input, frontend);
    const revision = z.string().min(1).parse(catalog.revision);

    state.nativeRevision = "credential-v2";
    state.datasetCount = 0;
    const action = async <T>(name: string, params: object): Promise<T> => {
      if (name === "get-data-connection-form") {
        expect(params).toEqual({ id: connection });
        return { nativeRevision: state.nativeRevision } as T;
      }
      if (name === "get-data-browser-catalog")
        return (await getCatalogAction.run(input, frontend)) as T;
      if (name === "refresh-data-browser-catalog")
        return (await refreshCatalogAction.run(
          refreshDataBrowserCatalogSchema.parse(params),
          frontend,
        )) as T;
      throw new Error(`Unexpected action ${name}`);
    };

    await expect(
      refreshCatalogAction.run({ ...input, revision }, frontend),
    ).rejects.toMatchObject({
      statusCode: 409,
      errorCode: "data_catalog_source_changed",
    });
    await expect(
      refreshWarehouseCatalog({ action }, connection),
    ).resolves.toMatchObject({
      refreshState: "ready",
      totalCount: 0,
    });
    expect(await getCatalogAction.run(input, frontend)).toMatchObject({
      hasSuccessfulSnapshot: true,
      resources: [],
    });
  });

  it("lets the confirmed credential refresh replace an older in-flight revision", async () => {
    state.nativeRevision = "credential-v1";
    state.datasetCount = 2;
    state.blockCall = 1;
    const blocked = deferred();
    state.blocked = blocked;
    const refreshing = refreshDataBrowserCatalog(connection, {
      caller: "frontend",
    });
    await waitForCall(1);
    state.nativeRevision = "credential-v2";
    state.generation = 2;
    const current = await refreshCatalogAction.run({
      connectionId: connection,
      revision: "credential-v2",
    });
    expect(current.refreshState).toBe("ready");
    blocked.resolve();
    await expect(refreshing).rejects.toMatchObject({
      errorCode: "data_catalog_source_changed",
    });
    const snapshot = await getCatalogAction.run({ connectionId: connection });
    expect(snapshot.resources.map((item) => item.name)).toEqual([
      "gen2_dataset_1",
      "gen2_dataset_2",
    ]);
  });

  it("does not carry a former source's success marker into a failed replacement", async () => {
    state.datasetCount = 2;
    await refreshCatalogAction.run({ connectionId: connection });
    const ready = await getCatalogAction.run({ connectionId: connection });
    expect(ready.lastRefreshed).not.toBeNull();
    state.projectId = "qa-repointed-project";
    const stale = await getCatalogAction.run({ connectionId: connection });
    expect(stale.lastRefreshed).toBeNull();
    expect(stale.hasSuccessfulSnapshot).toBe(false);
    expect(stale.revision).toBeNull();
    state.listError = {
      errorCode: "provider_unavailable",
      message: "Provider unavailable",
    };
    await expect(
      refreshCatalogAction.run({ connectionId: connection }),
    ).rejects.toThrow();
    const failed = await getCatalogAction.run({ connectionId: connection });
    expect(failed.refreshState).toBe("failed");
    expect(failed.resources).toEqual([]);
    expect(failed.totalCount).toBe(0);
    expect(failed.lastRefreshed).toBeNull();
    expect(failed.hasSuccessfulSnapshot).toBe(false);
  });

  it("distinguishes successful empty cache from an unsuccessful first refresh", async () => {
    const initial = await getCatalogAction.run({ connectionId: connection });
    expect(initial.hasSuccessfulSnapshot).toBe(false);
    state.datasetCount = 0;
    await refreshCatalogAction.run({ connectionId: connection });
    const empty = await getCatalogAction.run({ connectionId: connection });
    expect(empty.hasSuccessfulSnapshot).toBe(true);
    expect(empty.resources).toEqual([]);
    state.listError = {
      errorCode: "provider_unavailable",
      message: "Provider unavailable",
    };
    await expect(
      refreshCatalogAction.run({ connectionId: connection }),
    ).rejects.toThrow();
    const retained = await getCatalogAction.run({ connectionId: connection });
    expect(retained.hasSuccessfulSnapshot).toBe(true);
    expect(retained.revision).toBe(empty.revision);
    expect(retained.lastRefreshed).toBe(empty.lastRefreshed);
    expect(retained.totalCount).toBe(0);
  });

  it.each([
    ["projectId", "qa-project", "qa-project-renamed"],
    ["datasetNames", "", "agent_native_qa"],
    ["datasetNames", "agent_native_qa", ""],
  ] as const)(
    "marks changed %s from %s to %s stale at GET and refuses to page old names",
    async (field, before, after) => {
      state[field] = before;
      state.datasetCount = 30;
      await refreshCatalogAction.run({ connectionId: connection });
      const first = await getCatalogAction.run({
        connectionId: connection,
        first: 10,
      });
      if (!first.endCursor) throw new Error("Expected a cursor");

      state[field] = after;
      const stale = await getCatalogAction.run({ connectionId: connection });
      expect(stale.refreshState).toBe("stale");
      expect(stale.resources).toEqual([]);
      expect(stale.totalCount).toBe(0);
      expect(stale.refreshError?.code).toBe("data_catalog_source_changed");
      await expect(
        getCatalogAction.run({
          connectionId: connection,
          after: first.endCursor,
        }),
      ).rejects.toThrow("Restart from the first page");
    },
  );

  it("aborts a refresh when the source changes between provider pages", async () => {
    state.datasetCount = 1001;
    state.blockCall = 2;
    const refresh = refreshDataBrowserCatalog(connection, {
      caller: "frontend",
    });
    await waitForCall(2);
    state.projectId = "qa-project-renamed";
    state.blocked?.resolve();
    await expect(refresh).rejects.toThrow("connection source changed");
    const page = await getCatalogAction.run({ connectionId: connection });
    expect(page.refreshState).toBe("stale");
    expect(page.resources).toEqual([]);
    expect(page.refreshError?.code).toBe("data_catalog_source_changed");
  });

  it("invalidates a cursor when a newer snapshot replaces the saved one", async () => {
    state.datasetCount = 30;
    await refreshCatalogAction.run({ connectionId: connection });
    const first = await getCatalogAction.run({
      connectionId: connection,
      first: 10,
    });
    if (!first.endCursor) throw new Error("Expected a cursor");
    await refreshCatalogAction.run({ connectionId: connection });
    await expect(
      getCatalogAction.run({
        connectionId: connection,
        after: first.endCursor,
      }),
    ).rejects.toThrow("Restart from the first page");
  });

  it("normalizes search when binding a cursor", async () => {
    state.datasetCount = 30;
    await refreshCatalogAction.run({ connectionId: connection });
    const first = await getCatalogAction.run({
      connectionId: connection,
      search: "  GEN1_DATASET_1 ",
      first: 2,
    });
    if (!first.endCursor) throw new Error("Expected a cursor");
    const second = await getCatalogAction.run({
      connectionId: connection,
      search: "gen1_dataset_1",
      first: 2,
      after: first.endCursor,
    });
    expect(second.resources).toHaveLength(2);
    expect(second.resources[0]?.name).not.toBe(first.resources[0]?.name);
  });
});

describe("catalog snapshot integrity", () => {
  it.each([
    ["a present null", null],
    ["a scalar", 7],
    ["an array", [1, 2]],
  ])("refuses %s without overwriting it", async (_label, value) => {
    state.settings.set(settingsKey(), value);
    await expect(
      getCatalogAction.run({ connectionId: connection }),
    ).rejects.toThrow("could not be read as a catalog");
    await expect(
      refreshCatalogAction.run({ connectionId: connection }),
    ).rejects.toThrow("could not be read as a catalog");
    expect(state.settings.get(settingsKey())).toBe(value);
    expect(state.datasetCalls).toHaveLength(0);
  });

  it("refuses invalid stored JSON without overwriting it", async () => {
    state.corruptRaw.add(settingsKey());
    await expect(
      getCatalogAction.run({ connectionId: connection }),
    ).rejects.toThrow("could not be read as a catalog");
    await expect(
      refreshCatalogAction.run({ connectionId: connection }),
    ).rejects.toThrow("could not be read as a catalog");
    expect(state.corruptRaw.has(settingsKey())).toBe(true);
    expect(state.datasetCalls).toHaveLength(0);
  });

  it("reports a stale lease on GET without writing or taking over", async () => {
    state.datasetCount = 2;
    state.blockCall = 1;
    const refresh = refreshDataBrowserCatalog(connection, {
      caller: "frontend",
    });
    await waitForCall(1);
    const writesBefore = state.settingWrites;
    const stored = storedValue() as Record<string, unknown>;
    state.settings.set(settingsKey(), {
      ...stored,
      heartbeatAt: Date.now() - DATA_CATALOG_REFRESH_LOCK_MS - 1,
    });
    const page = await getCatalogAction.run({ connectionId: connection });
    expect(page.refreshState).toBe("refreshing");
    expect(page.refreshStale).toBe(true);
    expect(state.settingWrites).toBe(writesBefore);
    state.blocked?.resolve();
    await refresh;
  });

  it("does not recreate an absent row when a continuation loses it", async () => {
    state.datasetCount = 1001;
    state.blockCall = 2;
    const refresh = refreshDataBrowserCatalog(connection, {
      caller: "frontend",
    });
    await waitForCall(2);
    state.settings.delete(settingsKey());
    state.blocked?.resolve();
    await expect(refresh).rejects.toThrow("changed or was removed");
    expect(state.settings.has(settingsKey())).toBe(false);
  });

  it("blocks a late completion after a deletion tombstone", async () => {
    state.datasetCount = 2;
    state.blockCall = 1;
    const refresh = refreshDataBrowserCatalog(connection, {
      caller: "frontend",
    });
    await waitForCall(1);
    state.tombstones.set(`${org}:${connection}`, "deleted");
    state.blocked?.resolve();
    await expect(refresh).rejects.toThrow("changed or was removed");
    const stored = storedValue() as Record<string, unknown>;
    expect(stored.refreshState).not.toBe("ready");
    await clearDataBrowserCatalog(scope, connection);
    expect(state.settings.has(settingsKey())).toBe(false);
  });

  it("keeps the completed writer when deletion follows it", async () => {
    state.datasetCount = 2;
    await refreshCatalogAction.run({ connectionId: connection });
    state.tombstones.set(`${org}:${connection}`, "deleted");
    await expect(
      getCatalogAction.run({ connectionId: connection }),
    ).rejects.toThrow("was deleted");
    await clearDataBrowserCatalog(scope, connection);
    expect(state.settings.has(settingsKey())).toBe(false);
  });
});

describe("catalog AI policy", () => {
  it("gates agent reads and refreshes on the current root policy", async () => {
    state.datasetCount = 2;
    state.aiIncluded = false;
    await expect(
      getCatalogAction.run({ connectionId: connection }),
    ).rejects.toThrow("not included for AI");
    expect(state.settingReads).toBe(0);
    await expect(
      refreshCatalogAction.run({ connectionId: connection }),
    ).rejects.toThrow("not included for AI");
    expect(state.settingWrites).toBe(0);
    expect(state.datasetCalls).toHaveLength(0);
    await expect(
      readDataBrowserCatalog({ connectionId: connection, first: 50 }),
    ).rejects.toThrow("not included for AI");
  });

  it("allows a frontend reader on an opted-out connection", async () => {
    state.datasetCount = 2;
    state.aiIncluded = false;
    const refreshed = await refreshDataBrowserCatalog(connection, {
      caller: "frontend",
    });
    expect(refreshed.refreshState).toBe("ready");
    const page = await readDataBrowserCatalog(
      { connectionId: connection, first: 50 },
      "frontend",
    );
    expect(page.totalCount).toBe(2);
  });
});

describe("catalog cursor cycles", () => {
  it("detects a non-immediate opaque cursor cycle", async () => {
    state.datasetCount = 1000;
    state.cycleCursors = ["a", "b"];
    await expect(
      refreshCatalogAction.run({ connectionId: connection }),
    ).rejects.toThrow("repeated a catalog cursor");
    const page = await getCatalogAction.run({ connectionId: connection });
    expect(page.refreshState).toBe("failed");
    expect(page.refreshError?.code).toBe("data_catalog_refresh_cursor_stuck");
  });
});

describe("catalog descendant policy", () => {
  it("filters excluded names and counts before paging and revokes old cursors", async () => {
    state.datasetCount = 5;
    await refreshDataBrowserCatalog(connection, { caller: "frontend" });
    const first = await readDataBrowserCatalog({
      connectionId: connection,
      first: 1,
    });
    expect(first.totalCount).toBe(5);
    if (!first.endCursor) throw new Error("Expected catalog cursor");
    state.excludedResourceIds.add("schema:qa-project:gen1_dataset_2");
    state.descendantPolicyRevision += 1;
    const filtered = await readDataBrowserCatalog({
      connectionId: connection,
      first: 5,
    });
    expect(filtered.totalCount).toBe(4);
    expect(filtered.resources.some((row) => row.id.endsWith("dataset_2"))).toBe(
      false,
    );
    await expect(
      readDataBrowserCatalog({
        connectionId: connection,
        first: 1,
        after: first.endCursor,
      }),
    ).rejects.toMatchObject({ errorCode: "data_catalog_cursor_stale" });
    const frontend = await readDataBrowserCatalog(
      { connectionId: connection, first: 5 },
      "frontend",
    );
    expect(frontend.totalCount).toBe(5);
  });
});

it("keeps the shared catalog complete while projecting an agent refresh through child consent", async () => {
  state.datasetCount = 5;
  state.excludedResourceIds.add("schema:qa-project:gen1_dataset_2");
  state.descendantPolicyRevision = 1;
  const result = await refreshDataBrowserCatalog(connection);
  expect(result.totalCount).toBe(4);
  expect(result.refreshProgress).toBeNull();
  const frontend = await readDataBrowserCatalog(
    { connectionId: connection, first: 10 },
    "frontend",
  );
  expect(frontend.totalCount).toBe(5);
  expect(frontend.resources).toHaveLength(5);
});

it("reads and refreshes the authorized builtin root catalog without a provider snapshot", async () => {
  const id = "builtin-sample-data";
  makeReadable(id);
  const page = await readDataBrowserCatalog({ connectionId: id, first: 50 });
  expect(page).toMatchObject({
    connectionId: id,
    resources: [
      {
        id: "schema:PUBLIC",
        name: "PUBLIC",
        kind: "schema",
        hasChildren: true,
      },
    ],
    refreshState: "ready",
    hasSuccessfulSnapshot: true,
    totalCount: 1,
    hasNextPage: false,
    endCursor: null,
  });
  expect(await refreshDataBrowserCatalog(id)).toMatchObject({
    refreshState: "ready",
    totalCount: 1,
    refreshError: null,
  });
  expect(state.settingReads).toBe(0);
  expect(state.settingWrites).toBe(0);
  expect(state.datasetCalls).toEqual([]);
  await expect(
    readDataBrowserCatalog({
      connectionId: id,
      parentId: "schema:PUBLIC",
      first: 50,
    }),
  ).rejects.toMatchObject({ errorCode: "data_catalog_scope_root_only" });
  state.aiIncluded = false;
  await expect(
    readDataBrowserCatalog({ connectionId: id, first: 50 }),
  ).rejects.toMatchObject({ errorCode: "data_connection_ai_disabled" });
  state.aiIncluded = true;
  state.actor = null;
  await expect(
    readDataBrowserCatalog({ connectionId: id, first: 50 }),
  ).rejects.toMatchObject({ errorCode: "sign_in_required" });
});
