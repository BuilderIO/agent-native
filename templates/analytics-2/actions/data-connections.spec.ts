import {
  arbitraryFromJsonSchema,
  checkActionProperties,
} from "@agent-native/core/action-properties";
import type { ProviderApiRequestArgs } from "@agent-native/core/provider-api";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SAMPLE_DATA_SOURCE_ID } from "../shared/sample-data-contract.js";

interface ConnectionRecord {
  id: string;
  provider: string;
  label: string;
  accountId: string | null;
  orgId: string | null;
  ownerEmail: string;
  config: Record<string, unknown>;
  allowedUsers: string[];
  allowedUserGroups: string[];
  allowedApps: string[];
  status: string;
  credentialRefs: { key: string; provider: string; scope: string }[];
}
const state = vi.hoisted(() => ({
  actor: { userEmail: "qa-owner@example.invalid", orgId: "qa-workspace" } as {
    userEmail: string;
    orgId: string;
  } | null,
  connections: new Map<string, ConnectionRecord>(),
  settings: new Map<string, Record<string, unknown>>(),
  credentials: new Map<string, string>(),
  deny: false,
  failWrite: false,
  providerError: false,
  datasetsDeniedDryRunOk: false,
  truncated: false,
  datasetRefusals: new Map<string, number>(),
  providerCalls: [] as ProviderApiRequestArgs[],
}));
vi.mock(import("@agent-native/core/server"), async (importOriginal) => ({
  ...(await importOriginal()),
  getRequestContext: () => state.actor,
  readOrgMemberRole: async () => (state.deny ? "member" : "owner"),
}));
vi.mock("@agent-native/core/credentials", () => ({
  resolveCredentialDetailed: async () => undefined,
  saveCredential: vi.fn(async (key: string, value: string) => {
    state.credentials.set(key, value);
  }),
  deleteCredential: vi.fn(async (key: string) => {
    state.credentials.delete(key);
  }),
}));
vi.mock("@agent-native/core/settings", () => ({
  getOrgSetting: async (org: string, key: string) =>
    state.settings.get(`org:${org}:${key}`) ?? null,
  putOrgSetting: async (
    org: string,
    key: string,
    value: Record<string, unknown>,
  ) => {
    state.settings.set(`org:${org}:${key}`, value);
  },
  mutateUserSetting: async (
    user: string,
    key: string,
    updater: (
      current: Record<string, unknown> | null,
    ) => Record<string, unknown>,
  ) => {
    const location = `user:${user}:${key}`;
    const next = await updater(state.settings.get(location) ?? null);
    state.settings.set(location, next);
    return next;
  },
  getUserSetting: async (user: string, key: string) =>
    state.settings.get(`user:${user}:${key}`) ?? null,
  putUserSetting: async (
    user: string,
    key: string,
    value: Record<string, unknown>,
  ) => {
    state.settings.set(`user:${user}:${key}`, value);
  },
  getSettingEntry: async (location: string) =>
    state.settings.has(location)
      ? { found: true, value: state.settings.get(location) }
      : { found: false },
  listOrgSettings: async (org: string, prefix = "") => {
    const scoped = `org:${org}:${prefix}`;
    const out: Record<string, Record<string, unknown>> = {};
    for (const [location, value] of state.settings) {
      if (!location.startsWith(scoped)) continue;
      out[location.slice(`org:${org}:`.length)] = value;
    }
    return out;
  },
  mutateOrgSetting: async (
    org: string,
    key: string,
    updater: (
      current: Record<string, unknown> | null,
    ) => Record<string, unknown>,
    _options?: unknown,
  ) => {
    const location = `org:${org}:${key}`;
    const next = updater(state.settings.get(location) ?? null);
    state.settings.set(location, next);
    return next;
  },
  deleteSetting: async (location: string) => state.settings.delete(location),
  deleteSettingIfValue: async (
    location: string,
    expected: Record<string, unknown>,
  ) => false && expected && state.settings.delete(location),
}));
vi.mock("@agent-native/core/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/db")>()),
  getDbExec: () => ({
    transaction: async (fn: (tx: unknown) => unknown) => fn({}),
  }),
  withDbExec: (_tx: unknown, run: () => unknown) => run(),
}));
vi.mock("../server/model/bigquery-credential-validation.js", () => ({
  createBigQueryCredentialValidator: () => async () => undefined,
}));
vi.mock("@agent-native/core/workspace-connections", () => ({
  createWorkspaceCredentialActions: () =>
    new Proxy({}, { get: () => ({ run: async () => undefined }) }),
  getWorkspaceConnection: async (id: string) => {
    const row = state.connections.get(id);
    return row?.orgId === state.actor?.orgId ? row : null;
  },
  listWorkspaceUserGroups: async () => [],
  assertWorkspaceUserGroupIds: async (groups: string[]) => groups,
  credentialKeyMatches: (
    _provider: string,
    requested: string,
    actual: string,
  ) => requested === actual,
  assertWorkspaceUserGroupManager: async () => {
    if (state.deny) throw new Error("Denied");
  },
  listWorkspaceConnections: async () =>
    [...state.connections.values()].filter(
      (c) => c.orgId === state.actor?.orgId,
    ),
  listWorkspaceConnectionsForApp: async () =>
    [...state.connections.values()].filter(
      (c) => c.orgId === state.actor?.orgId,
    ),
  upsertWorkspaceConnection: async (
    input: Omit<ConnectionRecord, "orgId" | "ownerEmail">,
  ) => {
    if (state.failWrite) throw new Error("Simulated persistence failure");
    const row = {
      ...input,
      orgId: state.actor?.orgId ?? null,
      ownerEmail: state.actor?.userEmail ?? "",
    };
    state.connections.set(row.id, row);
    return row;
  },
  upsertWorkspaceConnectionGrant: async () => ({}),
  resolveWorkspaceConnectionCredentialForApp: async ({
    key,
    connectionId,
  }: {
    key: string;
    connectionId: string;
  }) => {
    const row = state.connections.get(connectionId);
    const value =
      row?.orgId === state.actor?.orgId
        ? state.credentials.get(key)
        : undefined;
    return { available: !!value, value };
  },
}));
vi.mock("@agent-native/core/provider-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/provider-api")>()),
  createProviderApiRuntime: () => ({
    executeRequest: async (args: ProviderApiRequestArgs) => {
      state.providerCalls.push(args);
      if (state.truncated)
        return {
          response: { ok: true, status: 200, truncated: true, json: {} },
        };
      const dataset = args.path.match(/\/datasets\/([^/]+)\/tables$/)?.[1];
      if (dataset) {
        const status = state.datasetRefusals.get(dataset);
        return status !== undefined
          ? {
              response: {
                ok: false,
                status,
                json: { error: { errors: [{ reason: "accessDenied" }] } },
              },
            }
          : {
              response: {
                ok: true,
                status: 200,
                json: { kind: "bigquery#tableList" },
              },
            };
      }
      if (state.datasetsDeniedDryRunOk) {
        if (args.method === "POST" && args.path.endsWith("/jobs"))
          return {
            response: {
              ok: true,
              status: 200,
              json: {
                kind: "bigquery#job",
                configuration: { dryRun: true },
              },
            },
          };
        return {
          response: {
            ok: false,
            status: 403,
            json: {
              error: {
                errors: [{ reason: "accessDenied" }],
                message: "User does not have bigquery.datasets.get permission",
              },
            },
          },
        };
      }
      if (state.providerError)
        return {
          response: {
            ok: false,
            status: 403,
            json: { error: { message: "Do not return provider diagnostics" } },
          },
        };
      const query = args.query as { maxResults: number; pageToken?: string };
      const start = Number(query.pageToken ?? 0);
      const end = Math.min(start + query.maxResults, 66);
      return {
        response: {
          ok: true,
          status: 200,
          json: {
            kind: "bigquery#datasetList",
            datasets: Array.from({ length: end - start }, (_, i) => ({
              datasetReference: {
                projectId: "qa-project",
                datasetId: `dataset_${start + i + 1}`,
              },
            })),
            ...(end < 66 ? { nextPageToken: String(end) } : {}),
          },
        },
      };
    },
  }),
}));
import {
  configuredDatasetNames,
  getDataConnectionSaveResult,
  getDataConnectionForm,
  listConnectionDatasets,
  listDataConnections,
  resolveSavedBigQueryTestCredentials,
  saveDataConnection,
  setDefaultDataConnection,
} from "../server/model/data-connections";
import formAction from "./get-data-connection-form";
import resultAction from "./get-data-connection-save-result";
import datasetsAction from "./list-connection-datasets";
import schemaAction from "./list-data-connection-schemas";
import listAction from "./list-data-connections";
import saveAction from "./save-data-connection";
import defaultAction from "./set-default-data-connection";

const requestId = "b829e3ea-9b56-4737-a03c-749c9e7beb54";
const credential = JSON.stringify({
  client_email: "qa@qa-project.iam.gserviceaccount.com",
  private_key: "SYNTHETIC TEST FIXTURE",
  project_id: "qa-project",
});
const input = () => ({
  requestId,
  type: "bigquery" as const,
  values: {
    name: "QA warehouse",
    projectId: "qa-project",
    serviceAccount: credential,
    queryAccessGroupIds: ["workspace"],
  },
  draft: false,
});
beforeEach(() => {
  state.actor = {
    userEmail: "qa-owner@example.invalid",
    orgId: "qa-workspace",
  };
  state.connections.clear();
  state.settings.clear();
  state.credentials.clear();
  state.deny = false;
  state.failWrite = false;
  state.providerError = false;
  state.datasetsDeniedDryRunOk = false;
  state.truncated = false;
  state.datasetRefusals.clear();
  state.providerCalls = [];
});
describe("warehouse action boundary", () => {
  it("validates before persisting, returns only a safe DTO, reads back after remount and retries idempotently", async () => {
    state.providerError = true;
    await expect(saveDataConnection(input())).rejects.toThrow(
      "Error connecting to data source",
    );
    expect(state.connections.size).toBe(0);
    expect(state.credentials.size).toBe(0);
    state.providerError = false;
    const saved = await saveDataConnection(input());
    expect(saved.name).toBe("QA warehouse");
    expect(saved.shared).toBe(true);
    expect(JSON.stringify(saved)).not.toContain("SYNTHETIC");
    expect((await getDataConnectionSaveResult(requestId)).id).toBe(saved.id);
    expect((await listDataConnections()).map((c) => c.id)).toEqual([
      saved.id,
      SAMPLE_DATA_SOURCE_ID,
    ]);
    expect((await saveDataConnection(input())).id).toBe(saved.id);
    expect(state.connections.size).toBe(1);
    await expect(
      saveDataConnection({
        ...input(),
        values: { ...input().values, name: "Different request" },
      }),
    ).rejects.toThrow("already used");
    const record = [...state.connections.values()][0];
    expect(JSON.stringify(record?.config)).not.toContain("SYNTHETIC");
    expect(record?.credentialRefs).toHaveLength(1);
  });
  it("returns the 66th real provider fixture dataset across pages instead of applying an agent cap", async () => {
    const saved = await saveDataConnection(input());
    const first = await listConnectionDatasets({
      connectionId: saved.id,
      first: 50,
    });
    expect(first.items).toHaveLength(50);
    expect(first.hasNextPage).toBe(true);
    expect(first.endCursor).toBeTypeOf("string");
    const second = await listConnectionDatasets({
      connectionId: saved.id,
      first: 50,
      after: first.endCursor ?? undefined,
    });
    expect(second.items.at(-1)?.name).toBe("dataset_66");
    expect(second.items).toHaveLength(16);
    expect(second.hasNextPage).toBe(false);
    expect(state.providerCalls.at(-1)?.query).toEqual({
      maxResults: 50,
      pageToken: "50",
    });
    await expect(
      listConnectionDatasets({
        connectionId: saved.id,
        first: 50,
        after: Buffer.from(
          JSON.stringify({
            connectionId: "another",
            parentId: null,
            search: "",
            projectIndex: 0,
            pageToken: "50",
          }),
        ).toString("base64url"),
      }),
    ).rejects.toThrow("cursor is invalid");
  });
  it("treats absent, blank, and non-string dataset settings as unrestricted", () => {
    expect(configuredDatasetNames({})).toEqual([]);
    expect(configuredDatasetNames({ datasetNames: "" })).toEqual([]);
    expect(configuredDatasetNames({ datasetNames: "  ,  , " })).toEqual([]);
    expect(configuredDatasetNames({ datasetNames: 42 })).toEqual([]);
  });
  it("browses exactly the configured datasets even when the project is listable", async () => {
    const original = input();
    const saved = await saveDataConnection({
      ...original,
      values: {
        ...original.values,
        datasetNames: " dataset_2 ,, dataset_66, dataset_2, ",
      },
    });
    const first = await listConnectionDatasets({
      connectionId: saved.id,
      first: 1,
    });
    expect(first.items).toEqual([
      {
        id: "schema:qa-project:dataset_2",
        name: "dataset_2",
        kind: "schema",
        hasChildren: true,
      },
    ]);
    expect(first.hasNextPage).toBe(true);
    if (!first.endCursor) throw new Error("Expected a second dataset page");
    const next = await listConnectionDatasets({
      connectionId: saved.id,
      first: 1,
      after: first.endCursor,
    });
    const lastDataset = {
      id: "schema:qa-project:dataset_66",
      name: "dataset_66",
      kind: "schema",
      hasChildren: true,
    };
    expect(next).toEqual({
      items: [lastDataset],
      endCursor: null,
      hasNextPage: false,
    });
    state.providerError = true;
    await expect(
      listConnectionDatasets({ connectionId: saved.id, first: 50 }),
    ).resolves.toEqual({
      items: [...first.items, lastDataset],
      endCursor: null,
      hasNextPage: false,
    });
  });
  it("identifies each configured dataset the saved key cannot browse", async () => {
    const original = input();
    const saved = await saveDataConnection({
      ...original,
      values: {
        ...original.values,
        datasetNames: "dataset_2, restricted, private_dataset",
      },
    });
    state.datasetRefusals.set("restricted", 403);
    state.datasetRefusals.set("private_dataset", 404);
    await expect(
      listConnectionDatasets({ connectionId: saved.id, first: 50 }),
    ).rejects.toMatchObject({
      errorCode: "data_connection_dataset_unreadable",
      statusCode: 422,
      message:
        "Datasets: BigQuery could not list tables in restricted (HTTP 403, accessDenied), private_dataset (HTTP 404, accessDenied). Check the dataset IDs and service account access.",
    });
  });
  it("propagates authentication, provider, and incomplete response errors for a configured dataset", async () => {
    const original = input();
    const saved = await saveDataConnection({
      ...original,
      values: { ...original.values, datasetNames: "dataset_2" },
    });
    const browse = () =>
      listConnectionDatasets({ connectionId: saved.id, first: 50 });
    state.datasetRefusals.set("dataset_2", 401);
    await expect(browse()).rejects.toMatchObject({
      errorCode: "data_connection_rejected",
      statusCode: 403,
      details: { operation: "tables", providerStatus: 401 },
    });
    state.datasetRefusals.set("dataset_2", 500);
    await expect(browse()).rejects.toMatchObject({
      errorCode: "data_connection_rejected",
      statusCode: 502,
      details: { operation: "tables", providerStatus: 500 },
    });
    state.datasetRefusals.clear();
    state.truncated = true;
    await expect(browse()).rejects.toMatchObject({
      errorCode: "data_connection_incomplete",
      statusCode: 502,
    });
  });
  it("refuses unreadable provider pages, cross-workspace reads and nonmanager writes", async () => {
    const saved = await saveDataConnection(input());
    state.truncated = true;
    await expect(
      listConnectionDatasets({ connectionId: saved.id, first: 50 }),
    ).rejects.toThrow("incomplete response");
    state.truncated = false;
    state.actor = {
      userEmail: "qa-other@example.invalid",
      orgId: "another-workspace",
    };
    expect(
      (await listDataConnections()).map((connection) => connection.id),
    ).toEqual([SAMPLE_DATA_SOURCE_ID]);
    await expect(
      listConnectionDatasets({ connectionId: saved.id, first: 50 }),
    ).rejects.toThrow("not found");
    await expect(getDataConnectionSaveResult(requestId)).rejects.toThrow(
      "not completed",
    );
    state.actor = {
      userEmail: "qa-member@example.invalid",
      orgId: "qa-workspace",
    };
    state.deny = true;
    await expect(setDefaultDataConnection(saved.id)).rejects.toThrow(
      "Only workspace admins",
    );
  });
  it("sets and clears only a shared live workspace default; a draft stays a draft", async () => {
    const saved = await saveDataConnection(input());
    await expect(setDefaultDataConnection(saved.id)).resolves.toEqual({
      id: saved.id,
    });
    expect((await listDataConnections())[0]?.isDefault).toBe(true);
    await expect(setDefaultDataConnection(null)).resolves.toEqual({ id: null });
    const draft = await saveDataConnection({
      ...input(),
      requestId: "3395e631-98d9-4fb5-b371-3d5a4cb99a17",
      draft: true,
      values: { name: "QA draft" },
    });
    expect(draft.isDraft).toBe(true);
    await expect(setDefaultDataConnection(draft.id)).rejects.toThrow(
      "Only data connections shared",
    );
  });
  it("keeps a restricted audience on rename and reads safe edit values instead of sharing defaults", async () => {
    const saved = await saveDataConnection(input());
    const row = state.connections.get(saved.id);
    if (!row) throw new Error("Fixture missing");
    row.allowedUsers = ["qa-owner@example.invalid"];
    row.allowedUserGroups = ["finance"];
    row.config.queryAccessGroupIds = ["finance"];
    expect(
      (await getDataConnectionForm(saved.id)).values.queryAccessGroupIds,
    ).toEqual(["finance"]);
    await saveDataConnection({
      requestId: "d56909b1-e278-43d5-850d-2ba957958b3f",
      id: saved.id,
      type: "bigquery",
      draft: false,
      values: { name: "QA renamed" },
    });
    expect(state.connections.get(saved.id)?.allowedUserGroups).toEqual([
      "finance",
    ]);
    expect(state.connections.get(saved.id)?.allowedUsers).toEqual([
      "qa-owner@example.invalid",
    ]);
    expect(JSON.stringify(await getDataConnectionForm(saved.id))).not.toContain(
      "SYNTHETIC",
    );
    state.actor = {
      userEmail: "qa-second-admin@example.invalid",
      orgId: "qa-workspace",
    };
    await saveDataConnection({
      requestId: "b01fdb84-f684-4004-a30c-d3c9c7116b68",
      id: saved.id,
      type: "bigquery",
      draft: false,
      values: { name: "QA finance", queryAccessGroupIds: ["finance"] },
    });
    expect(state.connections.get(saved.id)?.allowedUsers).toEqual([
      "qa-owner@example.invalid",
      "qa-second-admin@example.invalid",
    ]);
  });
  it("honors the AI opt-out while keeping the browser connection visible", async () => {
    const saved = await saveDataConnection(input());
    const row = state.connections.get(saved.id);
    if (!row) throw new Error("Fixture missing");
    row.config.includeForAI = false;
    expect(
      (await listDataConnections()).map((connection) => connection.id),
    ).toContain(saved.id);
    expect(
      (await listDataConnections({ forAgent: true })).map(
        (connection) => connection.id,
      ),
    ).toEqual([SAMPLE_DATA_SOURCE_ID]);
    await expect(
      listConnectionDatasets(
        { connectionId: saved.id, first: 50 },
        { forAgent: true },
      ),
    ).rejects.toThrow();
    expect(
      (await listConnectionDatasets({ connectionId: saved.id, first: 50 }))
        .items,
    ).toHaveLength(50);
    expect(
      (await getDataConnectionForm(saved.id)).configuredCredentialFields,
    ).toContain("serviceAccount");
  });
  it("does not rotate a live credential when the following metadata write fails", async () => {
    const saved = await saveDataConnection(input());
    const row = state.connections.get(saved.id);
    if (!row) throw new Error("Fixture missing");
    const oldKey = row.credentialRefs[0]?.key;
    if (!oldKey) throw new Error("Fixture key missing");
    state.failWrite = true;
    await expect(
      saveDataConnection({
        ...input(),
        requestId: "4f3f388d-d09c-4110-b21d-ec114dd6ae08",
        id: saved.id,
        values: {
          ...input().values,
          serviceAccount: credential.replace(
            "SYNTHETIC TEST FIXTURE",
            "SYNTHETIC ROTATION",
          ),
        },
      }),
    ).rejects.toThrow("Simulated persistence failure");
    expect(state.connections.get(saved.id)?.credentialRefs[0]?.key).toBe(
      oldKey,
    );
    expect(state.credentials.get(oldKey)).toBe(credential);
    expect(state.credentials.size).toBe(1);
  });
  it("preserves the action contract on generated inputs while refusing anonymous identities", async () => {
    state.actor = null;
    for (const action of [
      listAction,
      schemaAction,
      datasetsAction,
      saveAction,
      resultAction,
      defaultAction,
      formAction,
    ])
      await checkActionProperties(action, {
        runs: 15,
        context: { caller: "agent" },
        overrides: {
          "/values": arbitraryFromJsonSchema({
            type: "object",
            properties: { name: { type: "string", maxLength: 20 } },
            required: ["name"],
            additionalProperties: false,
          }),
        },
      });
    expect(state.connections.size).toBe(0);
    expect(state.credentials.size).toBe(0);
    expect(state.providerCalls).toHaveLength(0);
  });

  it("resolves saved BigQuery test credentials for an existing connection and refuses unknown IDs or non-admins", async () => {
    const saved = await saveDataConnection(input());
    const resolved = await resolveSavedBigQueryTestCredentials(saved.id, {
      resolveServiceAccount: true,
      resolveDbtToken: false,
    });
    expect(resolved.runtime).toBeDefined();
    await expect(
      resolveSavedBigQueryTestCredentials("missing-connection-id", {
        resolveServiceAccount: true,
        resolveDbtToken: false,
      }),
    ).rejects.toMatchObject({
      errorCode: "data_connection_not_found",
      statusCode: 404,
    });
    state.deny = true;
    await expect(
      resolveSavedBigQueryTestCredentials(saved.id, {
        resolveServiceAccount: true,
        resolveDbtToken: false,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("saves and updates a least-privilege BigQuery connection when project dataset listing returns 403 but dry-run query succeeds", async () => {
    state.datasetsDeniedDryRunOk = true;
    const created = await saveDataConnection({
      ...input(),
      requestId: "84b175c0-6e89-4e7a-a8de-b52f71c48b2a",
      values: {
        ...input().values,
        driveAccess: true,
      },
    });
    expect(created.name).toBe("QA warehouse");
    expect(state.providerCalls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /projects/qa-project/datasets",
      "POST /projects/qa-project/jobs",
    ]);

    state.providerCalls = [];
    const updated = await saveDataConnection({
      requestId: "84b175c0-6e89-4e7a-a8de-b52f71c48b2b",
      id: created.id,
      type: "bigquery",
      draft: false,
      values: {
        name: "QA warehouse updated",
        projectId: "qa-project",
        driveAccess: true,
        queryAccessGroupIds: ["workspace"],
      },
    });
    expect(updated.name).toBe("QA warehouse updated");
    expect(state.providerCalls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /projects/qa-project/datasets",
      "POST /projects/qa-project/jobs",
    ]);
  });
});
