import { loadActionsFromStaticRegistry } from "@agent-native/core/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A source's position moves the way the engine moves it: saved only from a
// live run, sent on the next one. The provider is a fake that honours the
// request it is sent, and everything between the two is the real guarded call.
const providerMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../packages/core/dist/audit/store.js", async (original) => ({
  ...(await original<object>()),
  insertAuditEvent: async () => {},
}));
vi.mock("../lib/require-factory-automation.js", () => ({
  requireFactoryAutomation: async () => {},
}));
vi.mock("../lib/require-workspace-member.js", () => ({
  requireWorkspaceMember: async () => ({
    userEmail: "owner@example.test",
    orgId: "org-1",
    role: "member",
  }),
  workspaceMemberIdentityFromContext: () => ({
    userEmail: "owner@example.test",
    orgId: "org-1",
  }),
}));
vi.mock("../lib/factory-automation-resources.js", () => ({
  factoryIdFromAutomationName: (name: string) =>
    name.match(/^factories\/([^/]+)\//)?.[1] ?? null,
}));
vi.mock("../lib/provider-api.js", () => ({
  FACTORY_APP_ID: "factory",
  executeProviderApiRequest: providerMock,
}));

import * as runWorkflowOperation from "../../actions/run-workflow-operation.js";
import type { OperationRequest } from "../workflow/adapter.js";
import { OPERATION_CATALOG } from "../workflow/catalog/index.js";
import { createOperationExecutor } from "./operation-executor.js";

const registry = loadActionsFromStaticRegistry({
  "run-workflow-operation": runWorkflowOperation,
});

const executor = createOperationExecutor({
  owner: "owner@example.test",
  orgId: "org-1",
  factoryId: "support-triage",
  automation: {
    triggerId: "job-1",
    triggerName: "factories/support-triage/flow",
  },
  runId: "run-1",
  signal: new AbortController().signal,
  deps: { actions: async () => registry },
});

const leads = OPERATION_CATALOG.get("hubspot.newLeads")!;

interface Contact {
  id: string;
  createdAt: string;
  properties: Record<string, string>;
}

const contact = (id: number): Contact => ({
  id: String(id),
  createdAt: "2026-10-19T10:00:00.000Z",
  properties: { email: `lead${id}@example.com` },
});

/** HubSpot's contact search as far as the catalog's request uses it. */
function serve(everyone: () => readonly Contact[]) {
  providerMock.mockImplementation(async (call: { body: unknown }) => {
    const body = call.body as {
      filterGroups: { filters: { propertyName: string; value: string }[] }[];
      sorts: { direction: string }[];
      limit: number;
    };
    const since = body.filterGroups[0].filters.find(
      (filter) => filter.propertyName === "hs_object_id",
    )?.value;
    const newer = everyone().filter(
      (row) => since === undefined || Number(row.id) > Number(since),
    );
    const ordered =
      body.sorts[0].direction === "ASCENDING" ? newer : [...newer].reverse();
    return {
      request: { method: "POST", path: "/crm/v3/objects/contacts/search" },
      response: {
        status: 200,
        ok: true,
        truncated: false,
        size: 10,
        json: { results: ordered.slice(0, body.limit) },
      },
    };
  });
}

/** One live tick of the source: the stored position goes in, the position it hands back is saved. */
function liveSource(limit: number) {
  let stored: string | undefined;
  return {
    get stored() {
      return stored;
    },
    async tick() {
      const request: OperationRequest = {
        operation: leads,
        fields: stored === undefined ? {} : { since: stored },
        credentialSlot: "hubspot",
        mode: "live",
        signal: new AbortController().signal,
        limit,
      };
      const result = await executor.execute(request);
      if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
      if (result.cursor !== undefined) stored = result.cursor;
      return result.items?.map((item) => item.externalId) ?? [];
    },
  };
}

beforeEach(() => {
  providerMock.mockReset();
});

describe("enabling a workflow over a provider with nothing in it yet", () => {
  it("processes the first lead that arrives, instead of priming over it", async () => {
    let everyone: Contact[] = [];
    serve(() => everyone);
    const source = liveSource(50);

    expect(await source.tick()).toEqual([]);
    expect(source.stored).toBeDefined();

    everyone = [contact(1)];
    expect(await source.tick()).toEqual(["1"]);
  });

  it("still skips the backlog that was there when it was enabled", async () => {
    const everyone = [contact(1), contact(2), contact(3)];
    serve(() => everyone);
    const source = liveSource(50);

    expect(await source.tick()).toEqual([]);
    expect(source.stored).toBe("3");

    everyone.push(contact(4));
    expect(await source.tick()).toEqual(["4"]);
  });
});

describe("a burst bigger than one tick takes", () => {
  it("reaches every lead exactly once, oldest first", async () => {
    const everyone: Contact[] = [contact(1)];
    serve(() => everyone);
    const source = liveSource(50);
    expect(await source.tick()).toEqual([]);

    for (let id = 2; id <= 130; id += 1) everyone.push(contact(id));
    const seen: string[] = [];
    for (let ticks = 0; ticks < 5; ticks += 1)
      seen.push(...(await source.tick()));

    expect(seen).toEqual(everyone.slice(1).map((row) => row.id));
  });
});
