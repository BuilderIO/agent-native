// Read-side action contracts. The record/read-through cases stay mocked — they
// are about which adapter is consulted — while the list, navigation, and
// view-screen cases run against a real libsql database with the app's own
// migrations, because what they protect (the resolved ownership scope bounding
// the returned rows, a saved view's grouping, a query-string flag) cannot be
// observed through a stubbed query builder.

import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import {
  beforeEach,
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const store = vi.hoisted(() => ({
  getCrmOverview: vi.fn(),
  getCrmRecord: vi.fn(),
  getCrmRecordReadContext: vi.fn(),
  getReadThroughRelationshipSummaries: vi.fn(),
  listCrmProposals: vi.fn(),
  listCrmRecords: vi.fn(),
  listCrmSavedViews: vi.fn(),
  listCrmSignals: vi.fn(),
  listCrmTasks: vi.fn(),
}));
const adapters = vi.hoisted(() => ({ createAdapter: vi.fn() }));
const nativeAdapters = vi.hoisted(() => ({
  createAdapter: vi.fn(),
  resolveScopeCalls: [] as Array<{ connectionId: string; objectType: string }>,
}));
const applicationState = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));

vi.mock("../server/db/crm-store.js", () => store);
vi.mock("../server/crm/adapter.js", () => ({
  createConnectedCrmAdapter: adapters.createAdapter,
  isConnectedCrmProvider: (provider: string) =>
    provider === "hubspot" || provider === "salesforce",
}));
// The connected-adapter factory is stubbed, but scope resolution is the real
// thing: a mock that answers "which scope?" cannot prove the scope bounds rows.
vi.mock("../server/crm/native-adapter.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/crm/native-adapter.js")>();
  return {
    ...actual,
    createNativeCrmAdapter: nativeAdapters.createAdapter,
    resolveNativeCrmAccessScope: (input: {
      connectionId: string;
      objectType: string;
    }) => {
      nativeAdapters.resolveScopeCalls.push(input);
      return actual.resolveNativeCrmAccessScope(input);
    },
  };
});
vi.mock("@agent-native/core/application-state", () => ({
  readAppStateForCurrentTab: applicationState.read,
  writeAppStateForCurrentTab: applicationState.write,
}));

import getCrmOverview from "./get-crm-overview.js";
import getCrmRecord from "./get-crm-record.js";
import listCrmLists from "./list-crm-lists.js";
import listCrmProposals from "./list-crm-proposals.js";
import listCrmRecords from "./list-crm-records.js";
import listCrmSavedViews from "./list-crm-saved-views.js";
import listCrmTasks from "./list-crm-tasks.js";
import navigate from "./navigate.js";
import viewScreen from "./view-screen.js";

const TEST_DB_PATH = join(
  tmpdir(),
  `crm-read-actions-test-${process.pid}-${Date.now()}.sqlite`,
);

const OWNER = "owner@example.test";
const ORG = "org_read";
const CONNECTION = "conn_read";
const SCOPE_KEY = `native:${CONNECTION}`;
const LIST_ID = "list_read";
const VIEW_ID = "view_read";

const SCOPE = {
  key: SCOPE_KEY,
  actorId: OWNER,
  mode: "native",
  objectReadable: true,
  objectCreateable: true,
  objectUpdateable: true,
  objectDeleteable: true,
  recordVisibility: "workspace",
} as const;

/** A scope the connection no longer grants — the row must be withheld. */
const STALE_SCOPE = { ...SCOPE, key: "native:previous-grant" };

const ownership = {
  ownerEmail: OWNER,
  orgId: ORG,
  visibility: "org" as const,
};

const ownerCtx = { caller: "frontend" as const, userEmail: OWNER, orgId: ORG };

function asOwner<T>(fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext(
    { userEmail: OWNER, orgId: ORG },
    fn,
  ) as Promise<T>;
}

let getDb: () => any;
let schema: typeof import("../server/db/schema.js");

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = await import("../server/db/schema.js");
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);

  const now = new Date().toISOString();
  const db = getDb();
  await db.insert(schema.crmConnections).values({
    id: CONNECTION,
    provider: "native",
    label: "Native",
    mode: "native",
    accessScopeKey: SCOPE_KEY,
    accessScopeJson: JSON.stringify(SCOPE),
    ...ownership,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.crmObjects).values({
    id: "obj_read",
    connectionId: CONNECTION,
    provider: "native",
    objectType: "accounts",
    kind: "account",
    label: "Account",
    pluralLabel: "Accounts",
    ...ownership,
    createdAt: now,
    updatedAt: now,
  });
  for (const [id, displayName, scope] of [
    ["rec_1", "Acme", SCOPE],
    ["rec_2", "Bravo", SCOPE],
    ["rec_3", "Withheld", STALE_SCOPE],
  ] as const) {
    await db.insert(schema.crmRecords).values({
      id,
      connectionId: CONNECTION,
      provider: "native",
      objectType: "accounts",
      kind: "account",
      remoteId: id,
      displayName,
      accessScopeKey: scope.key,
      accessScopeJson: JSON.stringify(scope),
      ...ownership,
      createdAt: now,
      updatedAt: now,
    });
  }
  await db.insert(schema.crmLists).values({
    id: LIST_ID,
    connectionId: CONNECTION,
    name: "Renewals",
    apiSlug: "renewals",
    parentObjectType: "accounts",
    ...ownership,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.crmSavedViews).values({
    id: VIEW_ID,
    name: "Renewal board",
    kind: "account",
    viewKind: "board",
    targetKind: "list",
    targetId: LIST_ID,
    groupByAttributeId: "attr_stage",
    ...ownership,
    createdAt: now,
    updatedAt: now,
  });
}, 120_000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

describe("CRM read actions", () => {
  beforeEach(() => {
    store.getCrmOverview.mockReset();
    store.getCrmRecord.mockReset();
    store.getCrmRecordReadContext.mockReset();
    store.getReadThroughRelationshipSummaries.mockReset();
    store.listCrmProposals.mockReset();
    store.listCrmRecords.mockReset();
    store.listCrmSavedViews.mockReset();
    store.listCrmSavedViews.mockResolvedValue([]);
    store.listCrmSignals.mockReset();
    store.listCrmSignals.mockResolvedValue([]);
    store.listCrmTasks.mockReset();
    adapters.createAdapter.mockReset();
    nativeAdapters.createAdapter.mockReset();
    nativeAdapters.resolveScopeCalls.length = 0;
    applicationState.read.mockReset();
    applicationState.write.mockReset();
  });

  it("keeps every read action GET-only", () => {
    for (const action of [
      getCrmOverview,
      getCrmRecord,
      listCrmLists,
      listCrmProposals,
      listCrmRecords,
      listCrmSavedViews,
      listCrmTasks,
    ]) {
      expect(action.http).toMatchObject({ method: "GET" });
      expect(action.readOnly).toBe(true);
    }
  });

  it("bounds the list page and rejects an oversized limit", async () => {
    expect(listCrmRecords.schema.parse({ kind: "account" }).limit).toBe(50);
    expect(
      listCrmRecords.schema.safeParse({ kind: "account", limit: 101 }).success,
    ).toBe(false);

    const page = (await asOwner(() =>
      listCrmRecords.run(
        listCrmRecords.schema.parse({ kind: "account", limit: 1 }) as never,
        ownerCtx as never,
      ),
    )) as any;

    expect(page.records).toHaveLength(1);
    expect(page.complete).toBe(false);
    expect(page.nextCursor).toBeTruthy();
  });

  it("validates Native SQL list rows through the native ownership scope", async () => {
    const page = (await asOwner(() =>
      listCrmRecords.run(
        listCrmRecords.schema.parse({ kind: "account" }) as never,
        ownerCtx as never,
      ),
    )) as any;

    // rec_3 stores a scope the connection no longer grants, so the resolved
    // scope — not the row's own access filter — is what withholds it.
    expect(page.records.map((record: any) => record.id)).toEqual([
      "rec_1",
      "rec_2",
    ]);
    expect(nativeAdapters.resolveScopeCalls).toEqual([
      { connectionId: CONNECTION, objectType: "accounts" },
    ]);
    expect(adapters.createAdapter).not.toHaveBeenCalled();
  });

  it("reads an archived-lists flag from a query string", async () => {
    const parse = (value: unknown) =>
      listCrmLists.schema.parse(
        value === undefined ? {} : { includeArchived: value },
      ).includeArchived;

    expect(parse(undefined)).toBe(false);
    expect(parse("false")).toBe(false);
    expect(parse("0")).toBe(false);
    expect(parse("true")).toBe(true);
    expect(parse("1")).toBe(true);
    expect(parse(true)).toBe(true);
    expect(
      listCrmLists.schema.safeParse({ includeArchived: "yes" }).success,
    ).toBe(false);
  });

  it("does not reveal a missing record as a successful empty result", async () => {
    store.getCrmRecordReadContext.mockResolvedValue(null);

    await expect(
      getCrmRecord.run({ recordId: "missing" }),
    ).rejects.toMatchObject({
      message: "CRM record not found",
      statusCode: 404,
    });
  });

  it("bounds provider relationship calls during a read-through refresh", async () => {
    const scope = {
      key: "hubspot:grant",
      actorId: "owner@example.test",
      grantId: "grant",
      mode: "user",
      objectReadable: true,
      objectCreateable: false,
      objectUpdateable: false,
      objectDeleteable: false,
      recordVisibility: "actor",
    } as const;
    store.getCrmRecordReadContext.mockResolvedValue({
      id: "record-1",
      connectionId: "crm-connection",
      workspaceConnectionId: "hubspot-connection",
      provider: "hubspot",
      objectType: "companies",
      kind: "account",
      remoteId: "company-1",
      accessScopeJson: JSON.stringify(scope),
      fieldPolicies: [],
    });
    const listRelationships = vi.fn().mockResolvedValue({
      relationships: [],
      complete: true,
    });
    adapters.createAdapter.mockResolvedValue({
      connection: { connectionId: "hubspot-connection" },
      getAccessScope: () => scope,
      getRecord: vi.fn().mockResolvedValue({
        ref: {
          connectionId: "hubspot-connection",
          provider: "hubspot",
          objectType: "companies",
          kind: "account",
          remoteId: "company-1",
        },
        displayName: "Northstar",
        fields: {},
        remoteRevision: "live-revision",
        deleted: false,
        accessScope: scope,
        provenance: [],
      }),
      listRelationships,
    });
    store.getReadThroughRelationshipSummaries.mockResolvedValue([]);
    store.getCrmRecord.mockResolvedValue({ id: "record-1" });

    await expect(getCrmRecord.run({ recordId: "record-1" })).resolves.toEqual({
      id: "record-1",
    });
    expect(listRelationships).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100 }),
    );
    expect(store.getCrmRecord).toHaveBeenCalledWith(
      "record-1",
      expect.objectContaining({ remoteRevision: "live-revision" }),
    );
  });

  it("reads Native SQL records with the local access scope and no provider connection", async () => {
    const scope = {
      key: "native:crm-connection",
      actorId: "owner@example.test",
      mode: "native",
      objectReadable: true,
      objectCreateable: true,
      objectUpdateable: true,
      objectDeleteable: true,
      recordVisibility: "workspace",
    } as const;
    store.getCrmRecordReadContext.mockResolvedValue({
      id: "record-native",
      connectionId: "crm-connection",
      workspaceConnectionId: null,
      provider: "native",
      objectType: "accounts",
      kind: "account",
      remoteId: "native-account-1",
      accessScopeJson: JSON.stringify(scope),
      fieldPolicies: [
        {
          fieldName: "name",
          storagePolicy: "local-authoritative",
          readable: true,
          sensitive: false,
        },
      ],
    });
    nativeAdapters.createAdapter.mockResolvedValue({
      connection: { connectionId: "crm-connection", provider: "native" },
      getAccessScope: () => scope,
      getRecord: vi.fn().mockResolvedValue({
        ref: {
          connectionId: "crm-connection",
          provider: "native",
          objectType: "accounts",
          kind: "account",
          remoteId: "native-account-1",
          localId: "record-native",
        },
        displayName: "Native account",
        fields: {},
        remoteRevision: "1",
        deleted: false,
        accessScope: scope,
        provenance: [],
      }),
      listRelationships: vi.fn().mockResolvedValue({
        relationships: [],
        complete: true,
      }),
    });
    store.getReadThroughRelationshipSummaries.mockResolvedValue([]);
    store.getCrmRecord.mockResolvedValue({ id: "record-native" });

    await expect(
      getCrmRecord.run({ recordId: "record-native" }),
    ).resolves.toEqual({ id: "record-native" });
    expect(nativeAdapters.createAdapter).toHaveBeenCalledWith({
      connectionId: "crm-connection",
      accessTier: "viewer",
    });
    expect(adapters.createAdapter).not.toHaveBeenCalled();
  });

  it("uses the same live provider proof for a visible record", async () => {
    const scope = {
      key: "hubspot:grant",
      actorId: "owner@example.test",
      grantId: "grant",
      mode: "user",
      objectReadable: true,
      objectCreateable: false,
      objectUpdateable: false,
      objectDeleteable: false,
      recordVisibility: "actor",
    } as const;
    applicationState.read.mockImplementation(async (key: string) => {
      if (key === "navigation") return { view: "record", recordId: "record-1" };
      return null;
    });
    store.getCrmRecordReadContext.mockResolvedValue({
      id: "record-1",
      connectionId: "crm-connection",
      workspaceConnectionId: "hubspot-connection",
      provider: "hubspot",
      objectType: "companies",
      kind: "account",
      remoteId: "company-1",
      accessScopeJson: JSON.stringify(scope),
      fieldPolicies: [
        {
          fieldName: "name",
          storagePolicy: "mirrored",
          readable: true,
          sensitive: false,
        },
      ],
    });
    adapters.createAdapter.mockResolvedValue({
      connection: { connectionId: "hubspot-connection", provider: "hubspot" },
      getAccessScope: () => scope,
      getRecord: vi.fn().mockResolvedValue({
        ref: {
          connectionId: "hubspot-connection",
          provider: "hubspot",
          objectType: "companies",
          kind: "account",
          remoteId: "company-1",
        },
        displayName: "Northstar",
        fields: { name: "Northstar" },
        remoteRevision: "live-revision",
        deleted: false,
        accessScope: scope,
        provenance: [],
      }),
      listRelationships: vi.fn().mockResolvedValue({
        relationships: [],
        complete: true,
      }),
    });
    store.getReadThroughRelationshipSummaries.mockResolvedValue([]);
    store.getCrmRecord.mockResolvedValue({ id: "record-1" });

    const screen = (await viewScreen.run({}, {
      userEmail: OWNER,
    } as never)) as any;

    expect(screen.record).toMatchObject({ id: "record-1" });
    // No path was published, so an absent list/view id is unknown, not empty.
    expect(screen.selection).toMatchObject({
      pathReadable: false,
      recordId: "record-1",
    });
    expect(adapters.createAdapter).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "hubspot",
        connectionId: "hubspot-connection",
        userEmail: OWNER,
      }),
    );
    expect(store.getCrmRecord).toHaveBeenCalledWith(
      "record-1",
      expect.objectContaining({
        fields: { name: "Northstar" },
        remoteRevision: "live-revision",
      }),
    );
  });
});

describe("navigate", () => {
  beforeEach(() => {
    applicationState.write.mockReset();
  });

  const cases: Array<[Record<string, unknown>, string]> = [
    [{ view: "work" }, "/"],
    [{ view: "records" }, "/records"],
    [{ view: "records", kind: "person" }, "/records?kind=person"],
    [{ view: "record", recordId: "rec 1" }, "/records/rec%201"],
    [{ view: "lists" }, "/lists"],
    [{ view: "lists", listId: "l1" }, "/views?list=l1"],
    [{ view: "views" }, "/views"],
    [{ view: "views", viewId: "v1" }, "/views?view=v1"],
    [{ view: "board", listId: "l1" }, "/views?list=l1&mode=board"],
    [{ view: "board", viewId: "v1" }, "/views?view=v1&mode=board"],
    [{ view: "dashboard", dashboardId: "d1" }, "/dashboard?id=d1"],
    [{ view: "settings" }, "/settings"],
    [
      { view: "settings", settingsSection: "connection" },
      "/settings/connection",
    ],
    [{ view: "settings", settingsSection: "fields" }, "/settings/fields"],
    [{ view: "settings", settingsSection: "lists" }, "/settings/lists"],
    [
      { view: "settings", settingsSection: "intelligence" },
      "/settings/intelligence",
    ],
    [{ view: "settings", settingsSection: "advanced" }, "/settings/advanced"],
  ];

  it.each(cases)("routes %j to %s", async (input, expected) => {
    const parsed = navigate.schema.parse(input);
    await expect(navigate.run(parsed as never)).resolves.toEqual({
      navigatingTo: expected,
    });
    expect(applicationState.write).toHaveBeenCalledWith(
      "navigate",
      expect.objectContaining({ path: expected }),
    );
  });

  it("refuses a destination the UI cannot open", async () => {
    await expect(
      navigate.run(navigate.schema.parse({ view: "record" }) as never),
    ).rejects.toThrow(/recordId is required/);
    // /views on its own is the index, so a board with no target would look like
    // a successful navigation to a board that never opened.
    await expect(
      navigate.run(navigate.schema.parse({ view: "board" }) as never),
    ).rejects.toThrow(/listId or viewId is required/);
    expect(applicationState.write).not.toHaveBeenCalled();
  });

  it("rejects an unknown settings section", () => {
    expect(
      navigate.schema.safeParse({ view: "settings", settingsSection: "nope" })
        .success,
    ).toBe(false);
  });
});

describe("view-screen surfaces", () => {
  beforeEach(() => {
    store.listCrmSavedViews.mockReset();
    store.listCrmSavedViews.mockResolvedValue([]);
    applicationState.read.mockReset();
  });

  function onScreen(navigation: Record<string, unknown>) {
    applicationState.read.mockImplementation(async (key: string) =>
      key === "navigation" ? navigation : null,
    );
    return asOwner(() => viewScreen.run({}, ownerCtx as never)) as Promise<any>;
  }

  it("reports the record grid for the kind tab in the path", async () => {
    const screen = await onScreen({ view: "records", path: "/records" });
    expect(screen.selection).toMatchObject({ pathReadable: true });
    expect(screen.records.records.map((record: any) => record.id)).toEqual([
      "rec_1",
      "rec_2",
    ]);

    const people = await onScreen({
      view: "records",
      path: "/records?kind=person",
    });
    expect(people.selection.kind).toBe("person");
    expect(people.records.records).toEqual([]);
  });

  it("reports the visible lists", async () => {
    const screen = await onScreen({ view: "lists", path: "/lists" });
    expect(screen.lists).toEqual([
      expect.objectContaining({ id: LIST_ID, name: "Renewals" }),
    ]);
  });

  it("reports the selected list and board mode", async () => {
    const screen = await onScreen({
      view: "views",
      path: `/views?list=${LIST_ID}&mode=board`,
    });
    expect(screen.selection).toMatchObject({
      listId: LIST_ID,
      mode: "board",
    });
    expect(screen.activeList).toMatchObject({
      id: LIST_ID,
      parentObjectType: "accounts",
    });
  });

  it("reports a selected list that is not visible as null, not missing", async () => {
    const screen = await onScreen({
      view: "views",
      path: "/views?list=list_gone",
    });
    expect(screen.selection.listId).toBe("list_gone");
    expect(screen.activeList).toBeNull();
  });

  it("reports the active saved view with its board grouping and rows", async () => {
    const screen = await onScreen({
      view: "board",
      path: `/views?view=${VIEW_ID}&mode=board`,
    });
    expect(screen.selection).toMatchObject({ viewId: VIEW_ID, mode: "board" });
    expect(screen.activeView).toMatchObject({
      id: VIEW_ID,
      viewKind: "board",
      targetKind: "list",
      targetId: LIST_ID,
      groupByAttributeId: "attr_stage",
    });
    expect(screen.records.records.map((record: any) => record.id)).toEqual([
      "rec_1",
      "rec_2",
    ]);
  });

  it("reports the settings tab that is open", async () => {
    const screen = await onScreen({
      view: "settings",
      path: "/settings/lists",
    });
    expect(screen.selection.settingsSection).toBe("lists");
    expect(screen.connections).toEqual([
      expect.objectContaining({ id: CONNECTION }),
    ]);
  });
});
