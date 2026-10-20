import { describe, expect, it } from "vitest";

import { createCapturingTripwireSink } from "../tripwire/testing.js";
import { OPERATION_CATALOG } from "../workflow/catalog/index.js";
import type { OperationDefinition } from "../workflow/operations.js";
import {
  ProviderOperationError,
  buildProviderRequest,
  parseProviderResponse,
} from "./provider-request.js";

const SCOPE = { orgId: "org-1", factoryId: "factory-1" };

function op(id: string): OperationDefinition {
  const def = OPERATION_CATALOG.get(id);
  if (!def) throw new Error(`${id} is not in the catalog`);
  return def;
}

function failureOf(run: () => unknown): ProviderOperationError {
  try {
    run();
  } catch (error) {
    if (error instanceof ProviderOperationError) return error;
    throw error;
  }
  throw new Error("Expected a ProviderOperationError.");
}

interface Contact {
  id: string;
  createdAt?: string;
  properties: Record<string, string | null>;
}

const contact = (
  id: string,
  properties: Contact["properties"] = { email: `${id}@example.com` },
  createdAt: string | null = "2026-10-19T10:00:00.000Z",
): Contact => ({
  id,
  ...(createdAt === null ? {} : { createdAt }),
  properties,
});

describe("one record that lacks a field does not fail the page", () => {
  const leads = op("hubspot.newLeads");

  it("falls back from email to a name, then the company, then the id", () => {
    const parsed = parseProviderResponse(
      leads,
      {
        results: [
          contact("30", { email: "a@x.test" }),
          contact("20", { email: null, firstname: "Ada", lastname: "Byron" }),
          contact("19", { email: "  ", firstname: "Grace", lastname: null }),
          contact("18", { lastname: "Hopper" }),
          contact("17", { email: null, company: "Acme" }),
          contact("16", { email: null }),
        ],
      },
      { scope: SCOPE, limit: 50 },
    );
    expect(parsed.items?.map((item) => item.title)).toEqual([
      "a@x.test",
      "Ada Byron",
      "Grace",
      "Hopper",
      "Acme",
      "Lead 16",
    ]);
    expect(parsed.skippedRows).toBeUndefined();
  });

  it("falls back to the subscription's customer, then the subscription", () => {
    const subscriptions = op("stripe.newSubscriptions");
    const row = (id: string, customer: unknown) => ({
      id,
      created: 1_760_000_000,
      customer,
    });
    const parsed = parseProviderResponse(
      subscriptions,
      {
        data: [
          row("sub_1", { id: "cus_1", email: "a@x.test", name: "Ada" }),
          row("sub_2", { id: "cus_2", email: null, name: "Grace Hopper" }),
          row("sub_3", { id: "cus_3", email: null, name: null }),
          row("sub_4", "cus_4"),
        ],
      },
      { scope: SCOPE },
    );
    expect(parsed.items?.map((item) => item.title)).toEqual([
      "a@x.test",
      "Grace Hopper",
      "Customer cus_3",
      "Subscription sub_4",
    ]);
  });

  it("skips a row with no readable time, counts it, and reports it", () => {
    const { sink, events } = createCapturingTripwireSink();
    const parsed = parseProviderResponse(
      leads,
      {
        results: [
          contact("30"),
          contact("20", { email: "b@x.test" }, null),
          contact("10"),
        ],
      },
      { scope: SCOPE, limit: 50, observe: { tripwire: sink, status: 200 } },
    );
    expect(parsed.items?.map((item) => item.externalId)).toEqual(["30", "10"]);
    expect(parsed.skippedRows).toBe(1);
    expect(parsed.output).toMatchObject({ itemCount: 2, skippedRows: 1 });
    expect(JSON.stringify(events[0].details)).not.toContain("b@x.test");
  });

  it("still fails a page where no row can be read: that is a changed response, not a bad record", () => {
    const error = failureOf(() =>
      parseProviderResponse(
        leads,
        {
          results: [
            contact("2", { email: "a@x.test" }, null),
            contact("1", { email: "b@x.test" }, null),
          ],
        },
        { scope: SCOPE, limit: 50 },
      ),
    );
    expect(error.code).toBe("unexpected_response");
  });

  it("still fails a row with no id: it cannot be tracked", () => {
    const row = { ...contact("1"), id: undefined };
    const error = failureOf(() =>
      parseProviderResponse(
        leads,
        { results: [contact("2"), row] },
        { scope: SCOPE, limit: 50 },
      ),
    );
    expect(error.code).toBe("unexpected_response");
    expect(error.message).toContain("item 1");
  });
});

/** A provider that honours the request it is sent: the cursor filter, the sort direction and its page size. */
function hubspotPage(
  all: readonly Contact[],
  built: ReturnType<typeof buildProviderRequest>,
) {
  const body = built.body as {
    filterGroups: { filters: { propertyName: string; value: string }[] }[];
    sorts: { direction: string }[];
    limit: number;
  };
  const since = body.filterGroups[0].filters.find(
    (filter) => filter.propertyName === "hs_object_id",
  )?.value;
  const newer = all.filter(
    (row) => since === undefined || Number(row.id) > Number(since),
  );
  const ordered =
    body.sorts[0].direction === "ASCENDING" ? newer : [...newer].reverse();
  return { results: ordered.slice(0, body.limit) };
}

describe("a page cut at the limit continues next tick", () => {
  const leads = op("hubspot.newLeads");
  const everyone = Array.from({ length: 120 }, (_, index) =>
    contact(String(index + 1)),
  );

  function tick(cursor: string | undefined, limit: number) {
    const built = buildProviderRequest(leads, { fields: {}, cursor });
    return {
      built,
      parsed: parseProviderResponse(leads, hubspotPage(everyone, built), {
        scope: SCOPE,
        limit,
        cursor,
      }),
    };
  }

  it("asks for the oldest rows once a position is stored, and the newest on the first run", () => {
    const direction = (cursor: string | undefined) =>
      (
        buildProviderRequest(leads, { fields: {}, cursor }).body as {
          sorts: { direction: string }[];
        }
      ).sorts[0].direction;
    expect(direction(undefined)).toBe("DESCENDING");
    expect(direction("50")).toBe("ASCENDING");
  });

  it("returns every row exactly once, in order, however small the limit", () => {
    const seen: string[] = [];
    let cursor: string | undefined = "0";
    for (let ticks = 0; ticks < 10; ticks += 1) {
      const { parsed } = tick(cursor, 50);
      seen.push(...(parsed.items ?? []).map((item) => item.externalId));
      if (parsed.cursor === undefined) break;
      cursor = parsed.cursor;
    }
    expect(seen).toEqual(everyone.map((row) => row.id));
  });

  it("hands back the position of the last row it kept", () => {
    const { parsed } = tick("0", 50);
    expect(parsed.items).toHaveLength(50);
    expect(parsed.truncated).toBe(true);
    expect(parsed.totalAvailable).toBe(100);
    expect(parsed.cursor).toBe("50");
  });

  it("holds no position for an empty page, so the stored one stays", () => {
    const { parsed } = tick("120", 50);
    expect(parsed.items).toEqual([]);
    expect(parsed.cursor).toBeUndefined();
  });

  it("fails a row that has no position to continue from", () => {
    const row = { ...contact("7"), id: undefined };
    const forward = {
      ...leads,
      itemMapping: { ...leads.itemMapping!, dedupeKey: "properties.email" },
    };
    const error = failureOf(() =>
      parseProviderResponse(
        forward,
        { results: [{ ...row, properties: { email: "a@x.test" } }] },
        { scope: SCOPE, cursor: "1" },
      ),
    );
    expect(error.code).toBe("unexpected_response");
  });
});

describe("priming over an empty page is remembered", () => {
  it.each(["hubspot.newLeads", "stripe.newSubscriptions", "pylon.newTickets"])(
    "%s records where a source with nothing yet starts",
    (id) => {
      const def = op(id);
      const empty =
        def.itemMapping?.itemsPath === undefined
          ? []
          : { [def.itemMapping.itemsPath]: [] };
      const parsed = parseProviderResponse(def, empty, {
        scope: SCOPE,
        prime: true,
      });
      expect(parsed.items).toEqual([]);
      expect(parsed.primed).toBe(true);
      expect(parsed.cursor).toBe(def.cursor?.origin);
      expect(parsed.cursor).toBeDefined();
    },
  );

  it("processes the first lead that arrives after an empty priming pass", () => {
    const leads = op("hubspot.newLeads");
    const primed = parseProviderResponse(
      leads,
      { results: [] },
      { scope: SCOPE, prime: true },
    );
    const cursor = primed.cursor;
    expect(cursor).toBeDefined();

    // The next tick sends the stored position, so it is no longer a priming run.
    const built = buildProviderRequest(leads, { fields: {}, cursor });
    const next = parseProviderResponse(
      leads,
      hubspotPage([contact("1")], built),
      { scope: SCOPE, limit: 50, cursor },
    );
    expect(next.primed).toBeUndefined();
    expect(next.items?.map((item) => item.externalId)).toEqual(["1"]);
    expect(next.cursor).toBe("1");
  });

  it("still primes a page that has rows: the newest position and no items", () => {
    const leads = op("hubspot.newLeads");
    const parsed = parseProviderResponse(
      leads,
      { results: [contact("9"), contact("8")] },
      { scope: SCOPE, prime: true },
    );
    expect(parsed.items).toEqual([]);
    expect(parsed.cursor).toBe("9");
  });
});
