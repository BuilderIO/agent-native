import type { ProviderApiRequestArgs } from "@agent-native/core/provider-api";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  failCredentialDelete: false,
  providerError: false,
  truncated: false,
  rejectDbt: false,
  dbtVaultError: false,
  dbtValidations: [] as { values: Record<string, unknown>; token: string }[],
  providerCalls: [] as ProviderApiRequestArgs[],
}));
vi.mock("../server/model/data-dbt.js", () => ({
  validateDbtConfiguration: async (
    values: Record<string, unknown>,
    token: string,
  ) => {
    state.dbtValidations.push({ values, token });
    if (state.rejectDbt)
      throw new Error("The integration credential was rejected.");
  },
}));
vi.mock(import("@agent-native/core/server"), async (importOriginal) => ({
  ...(await importOriginal()),
  getRequestContext: () => state.actor,
  readOrgMemberRole: async () => (state.deny ? "member" : "owner"),
}));
vi.mock("@agent-native/core/credentials", () => ({
  resolveCredentialDetailed: async () => undefined,
  resolveCredentialForScope: async (key: string) => state.credentials.get(key),
  saveCredential: vi.fn(async (key: string, value: string) => {
    state.credentials.set(key, value);
  }),
  deleteCredential: vi.fn(async (key: string) => {
    if (state.failCredentialDelete)
      throw new Error("Synthetic credential cleanup failure");
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
vi.mock("@agent-native/core/workspace-connections", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/workspace-connections")
  >()),
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
    if (key.endsWith("_DBT") && state.dbtVaultError)
      return { available: false, status: "error" };
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
      if (state.providerError)
        return {
          response: {
            ok: false,
            status: 403,
            json: { error: { message: "Do not return provider diagnostics" } },
          },
        };
      if (state.truncated)
        return {
          response: { ok: true, status: 200, truncated: true, json: {} },
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
  getDataConnectionSaveResult,
  getDataConnectionForm,
  listDataConnections,
  saveDataConnection,
  setDefaultDataConnection,
} from "../server/model/data-connections";

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
  state.failCredentialDelete = false;
  state.providerError = false;
  state.truncated = false;
  state.rejectDbt = false;
  state.dbtVaultError = false;
  state.dbtValidations = [];
  state.providerCalls = [];
});
describe("warehouse action boundary", () => {
  it("keeps a committed save recoverable when obsolete credential cleanup fails", async () => {
    const saved = await saveDataConnection({
      ...input(),
      values: { ...input().values, dbtToken: "integration-old-fixture" },
    });
    const originalKey = String(
      state.connections.get(saved.id)?.config.dbtCredentialKey,
    );
    const update = {
      ...input(),
      id: saved.id,
      requestId: "7f631c93-ded8-4416-bfd6-581022640d29",
      values: {
        name: "QA rotated integration",
        dbtToken: "integration-new-fixture",
      },
    };
    state.failCredentialDelete = true;
    await expect(saveDataConnection(update)).rejects.toThrow(
      "connection was saved but",
    );
    expect(state.connections.size).toBe(1);
    expect(state.connections.get(saved.id)?.config.dbtCredentialKey).not.toBe(
      originalKey,
    );
    await expect(getDataConnectionSaveResult(update.requestId)).rejects.toThrow(
      "cleanup is pending",
    );
    state.failCredentialDelete = false;
    expect((await saveDataConnection(update)).id).toBe(saved.id);
    expect(state.credentials.has(originalKey)).toBe(false);
    expect(state.connections.size).toBe(1);
  });
  it("cleans replaced integration credentials while preserving keys referenced by sibling connections", async () => {
    const saved = await saveDataConnection({
      ...input(),
      values: { ...input().values, dbtToken: "integration-first-fixture" },
    });
    const original = state.connections.get(saved.id)!;
    const firstKey = String(original.config.dbtCredentialKey);
    state.connections.set("qa-sibling", {
      ...original,
      id: "qa-sibling",
      credentialRefs: [...original.credentialRefs],
    });
    await saveDataConnection({
      ...input(),
      id: saved.id,
      requestId: "b6c75b20-f6c1-48b3-b468-95ac0ef5693f",
      values: { name: "QA rotate", dbtToken: "integration-second-fixture" },
    });
    expect(state.credentials.has(firstKey)).toBe(true);
    const secondKey = String(
      state.connections.get(saved.id)?.config.dbtCredentialKey,
    );
    expect(secondKey).not.toBe(firstKey);
    await saveDataConnection({
      ...input(),
      id: saved.id,
      requestId: "d1c42cb7-9084-473d-9d1b-26c9ee3154e3",
      values: {
        name: "QA disabled integration",
        hasDbtMetadata: false,
        dbtToken: "hidden-disabled-fixture",
      },
    });
    expect(state.credentials.has(secondKey)).toBe(false);
    expect(state.credentials.has(firstKey)).toBe(true);
    expect([...state.credentials.values()]).not.toContain(
      "hidden-disabled-fixture",
    );
    expect(
      state.connections.get(saved.id)?.config.dbtCredentialKey,
    ).toBeUndefined();
  });
  it("reports a saved integration vault outage as retryable instead of asking for a missing token", async () => {
    const saved = await saveDataConnection({
      ...input(),
      values: {
        ...input().values,
        dbtToken: "integration-service-fixture",
        hasDbtMetadata: true,
        dbtVersion: "current",
        dbtEnvironmentId: "123",
        dbtCloudHostname: "cloud.getdbt.com",
      },
    });
    state.dbtVaultError = true;
    await expect(
      saveDataConnection({
        ...input(),
        id: saved.id,
        requestId: "6d1b369f-983b-46a2-90b6-f992d678e6f8",
        values: { name: "QA vault outage" },
      }),
    ).rejects.toMatchObject({
      statusCode: 503,
      errorCode: "data_connection_integration_credentials_unreadable",
    });
  });
  it("validates active integration credentials before saving, skips validation for drafts, and revalidates saved credentials on edits", async () => {
    const values = {
      ...input().values,
      hasDbtMetadata: true,
      dbtVersion: "current" as const,
      dbtCloudHostname: "cloud.getdbt.com",
      dbtEnvironmentId: "123",
      dbtToken: "integration-service-fixture",
    };
    state.rejectDbt = true;
    await expect(saveDataConnection({ ...input(), values })).rejects.toThrow(
      "integration credential was rejected",
    );
    expect(state.connections.size).toBe(0);
    expect(state.credentials.size).toBe(0);
    expect(state.dbtValidations).toHaveLength(1);
    const draft = await saveDataConnection({ ...input(), values, draft: true });
    expect(draft.isDraft).toBe(true);
    expect(state.dbtValidations).toHaveLength(1);
    state.rejectDbt = false;
    const {
      dbtToken: _submittedToken,
      serviceAccount: _submittedServiceAccount,
      ...savedValues
    } = values;
    await saveDataConnection({
      ...input(),
      id: draft.id,
      requestId: "669835dc-aa61-4ce4-8039-de25f5e2509d",
      values: savedValues,
    });
    expect(state.dbtValidations).toHaveLength(2);
    expect(state.dbtValidations.at(-1)?.token).toBe(
      "integration-service-fixture",
    );
  });
  it("promotes an existing restricted connection through the workspace sharing control before making it default", async () => {
    const saved = await saveDataConnection({
      ...input(),
      values: { ...input().values, queryAccessGroupIds: [] },
    });
    expect(saved.shared).toBe(false);
    await expect(setDefaultDataConnection(saved.id)).rejects.toThrow(
      "Only data connections shared",
    );
    const shared = await saveDataConnection({
      ...input(),
      requestId: "6caa720d-1bc4-489d-b9ed-119aee855056",
      id: saved.id,
      values: { name: "QA shared warehouse", shareWithWorkspace: true },
    });
    expect(shared.shared).toBe(true);
    expect(state.connections.get(saved.id)?.allowedUsers).toEqual([]);
    expect(state.connections.get(saved.id)?.allowedUserGroups).toEqual([]);
    expect(
      (await getDataConnectionForm(saved.id)).values.queryAccessGroupIds,
    ).toEqual(["workspace"]);
    await setDefaultDataConnection(saved.id);
    expect((await listDataConnections())[0]?.isDefault).toBe(true);
  });
  it("grants the selected connection access to its saved integration credential without exposing the token", async () => {
    const saved = await saveDataConnection({
      ...input(),
      values: { ...input().values, dbtToken: "integration-service-fixture" },
    });
    const connection = state.connections.get(saved.id);
    expect(connection?.credentialRefs).toContainEqual({
      key: connection?.config.dbtCredentialKey,
      provider: "bigquery",
      scope: "org",
    });
    expect(
      state.credentials.get(String(connection?.config.dbtCredentialKey)),
    ).toBe("integration-service-fixture");
    expect(JSON.stringify(await getDataConnectionForm(saved.id))).not.toContain(
      "integration-service-fixture",
    );
  });
});
