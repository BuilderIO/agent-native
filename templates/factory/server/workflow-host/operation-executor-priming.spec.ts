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

const pylonTickets = OPERATION_CATALOG.get("pylon.newTickets")!;

interface Ticket {
  id: string;
  created_at: string;
  title: string;
  link: string;
  requester: { email: string };
  state: string;
}

/** The nth minute of a quiet afternoon, written the way Pylon writes a time. */
const minute = (n: number) =>
  new Date(Date.UTC(2026, 9, 19, 12, n)).toISOString().replace(".000Z", "Z");

const ticket = (id: string, createdAt: string): Ticket => ({
  id,
  created_at: createdAt,
  title: `Ticket ${id}`,
  link: `https://app.usepylon.com/issues/${id}`,
  requester: { email: `${id}@customer.example.test` },
  state: "new",
});

type Order = "newest first" | "oldest first" | "scrambled";

/**
 * Pylon's issue search as far as the catalog's request uses it: a `created_at`
 * filter and a page size. The docs name no sort, so the order is a parameter of
 * the test, and a page that is not everything says so in `pagination`.
 */
function servePylon(everyone: () => readonly Ticket[], order: Order) {
  providerMock.mockImplementation(async (call: { body: unknown }) => {
    const body = call.body as {
      filter?: { field: string; operator: string; value: string };
      limit: number;
    };
    if (body.filter) {
      expect(body.filter).toMatchObject({
        field: "created_at",
        operator: "time_is_after",
      });
    }
    const after = body.filter?.value;
    const matching = everyone()
      .filter(
        (row) =>
          after === undefined || Date.parse(row.created_at) > Date.parse(after),
      )
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    const ordered =
      order === "oldest first"
        ? matching
        : order === "newest first"
          ? [...matching].reverse()
          : [
              ...matching.filter((_, index) => index % 2 === 1),
              ...matching.filter((_, index) => index % 2 === 0).reverse(),
            ];
    const page = ordered.slice(0, body.limit);
    return {
      request: { method: "POST", path: "/issues/search" },
      response: {
        status: 200,
        ok: true,
        truncated: false,
        size: 10,
        json: {
          data: page,
          ...(matching.length > page.length
            ? { pagination: { cursor: "next", has_next_page: true } }
            : {}),
        },
      },
    };
  });
}

/** The same live tick over Pylon's search, which also says how many tickets the page held when it kept fewer. */
function livePylonSource(limit: number) {
  let stored: string | undefined;
  let totalAvailable: number | undefined;
  return {
    get stored() {
      return stored;
    },
    get totalAvailable() {
      return totalAvailable;
    },
    async tick() {
      const request: OperationRequest = {
        operation: pylonTickets,
        fields: stored === undefined ? {} : { since: stored },
        credentialSlot: "pylon",
        mode: "live",
        signal: new AbortController().signal,
        limit,
      };
      // raw-sql-ok: not SQL; this runs a workflow operation against a faked provider
      const result = await executor.execute(request);
      if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
      totalAvailable = result.totalAvailable;
      if (result.cursor !== undefined) stored = result.cursor;
      return result.items?.map((item) => item.externalId) ?? [];
    },
  };
}

describe.each<Order>(["newest first", "oldest first", "scrambled"])(
  "a burst of Pylon tickets bigger than one tick takes (a search that answers %s)",
  (order) => {
    const burst = Array.from({ length: 20 }, (_, index) =>
      ticket(`t${index + 1}`, minute(index + 1)),
    );

    it("reaches every ticket exactly once, oldest first, across ticks", async () => {
      const everyone: Ticket[] = [ticket("t0", minute(0))];
      servePylon(() => everyone, order);
      const source = livePylonSource(8);
      expect(await source.tick()).toEqual([]);

      everyone.push(...burst);
      const ticks: string[][] = [];
      for (let run = 0; run < 5; run += 1) ticks.push(await source.tick());

      expect(ticks.map((taken) => taken.length)).toEqual([8, 8, 4, 0, 0]);
      expect(ticks.flat()).toEqual(burst.map((row) => row.id));
    });

    it("says how many the page held when a tick took fewer, and moves its position to the last ticket it took", async () => {
      const everyone: Ticket[] = [ticket("t0", minute(0)), ...burst];
      servePylon(() => everyone, order);
      const source = livePylonSource(8);
      await source.tick();
      expect(source.stored).toBe(minute(20));

      everyone.push(
        ...Array.from({ length: 12 }, (_, index) =>
          ticket(`u${index + 1}`, minute(30 + index)),
        ),
      );
      await source.tick();
      expect(source.totalAvailable).toBe(12);
      expect(source.stored).toBe(minute(37));
      await source.tick();
      expect(source.totalAvailable).toBeUndefined();
      expect(source.stored).toBe(minute(41));
    });
  },
);

describe("a Pylon page that is only part of the tickets", () => {
  it("fails the run and leaves the position where it was, never takes a smaller page", async () => {
    const everyone: Ticket[] = [ticket("t0", minute(0))];
    servePylon(() => everyone, "newest first");
    const source = livePylonSource(8);
    await source.tick();
    const before = source.stored;

    everyone.push(
      ...Array.from({ length: 150 }, (_, index) =>
        ticket(`t${index + 1}`, minute(index + 1)),
      ),
    );
    await expect(source.tick()).rejects.toThrow(
      /holds only part of the rows newer than the stored position/,
    );
    expect(source.stored).toBe(before);
  });
});

describe("Pylon tickets that share one created_at", () => {
  const same = minute(7);

  it("are never split by a tick that takes fewer than the page", async () => {
    const everyone: Ticket[] = [ticket("t0", minute(0))];
    servePylon(() => everyone, "newest first");
    const source = livePylonSource(8);
    await source.tick();
    everyone.push(
      ...Array.from({ length: 6 }, (_, index) =>
        ticket(`t${index + 1}`, minute(index + 1)),
      ),
      ticket("a", same),
      ticket("b", same),
      ticket("c", same),
      ticket("d", minute(9)),
    );

    const first = await source.tick();
    const second = await source.tick();

    expect(first).toEqual(["t1", "t2", "t3", "t4", "t5", "t6"]);
    expect(second.sort()).toEqual(["a", "b", "c", "d"]);
    expect(await source.tick()).toEqual([]);
  });

  it("fail loudly when more of them than a tick takes cannot be told apart by time", async () => {
    const everyone: Ticket[] = [ticket("t0", minute(0))];
    servePylon(() => everyone, "newest first");
    const source = livePylonSource(8);
    await source.tick();
    everyone.push(
      ...Array.from({ length: 9 }, (_, index) => ticket(`s${index}`, same)),
    );

    await expect(source.tick()).rejects.toThrow(
      /more rows at one time than a run takes/,
    );
  });
});
