import { describe, expect, it } from "vitest";

import { createCapturingTripwireSink } from "../tripwire/testing.js";
import { OPERATION_CATALOG } from "../workflow/catalog/index.js";
import {
  ProviderOperationError,
  buildProviderRequest,
  parseProviderResponse,
} from "./provider-request.js";

const SCOPE = { orgId: "org-1", factoryId: "factory-1" };
const def = OPERATION_CATALOG.get("stripe.newSubscriptions")!;
const PAGE_SIZE = 100;
const BASE = 1_760_000_000;

interface Subscription {
  id: string;
  created: number;
  customer: { id: string; email: string };
}

const subscription = (index: number, created: number): Subscription => ({
  id: `sub_${String(index).padStart(4, "0")}`,
  created,
  customer: { id: `cus_${index}`, email: `person.${index}@example.test` },
});

/**
 * Stripe's list as the catalog asks for it: newest first, no way to sort,
 * `created[gte]` inclusive, a page of at most `limit`, and `has_more` when the
 * filter matched more than that.
 */
function stripeList(
  rows: readonly Subscription[],
  query: Record<string, string | string[]>,
) {
  const since = query["created[gte]"];
  const matching = rows
    .filter((row) => since === undefined || row.created >= Number(since))
    .sort((a, b) => b.created - a.created || (a.id < b.id ? 1 : -1));
  const limit = Number(query.limit);
  return {
    object: "list",
    data: matching.slice(0, limit),
    has_more: matching.length > limit,
    url: "/v1/subscriptions",
  };
}

/** One run of the source, as the engine drives it: the stored position goes in, the position it hands back is kept. */
function tick(
  rows: readonly Subscription[],
  cursor: string | undefined,
  limit: number,
  prime = false,
) {
  const built = buildProviderRequest(def, { fields: {}, cursor });
  return parseProviderResponse(def, stripeList(rows, built.query), {
    scope: SCOPE,
    limit,
    cursor,
    prime,
  });
}

/**
 * Runs ticks until one has nothing new to do. A row handled on an earlier tick
 * is left out, as the inbox leaves out one that already ended; it still holds
 * the place it was offered in.
 */
function drain(
  rows: readonly Subscription[],
  start: string | undefined,
  limit: number,
  maxTicks = 40,
) {
  const handled = new Set<string>();
  const order: string[] = [];
  let cursor = start;
  let ticks = 0;
  for (; ticks < maxTicks; ticks += 1) {
    const parsed = tick(rows, cursor, limit);
    const open = (parsed.items ?? []).filter(
      (item) => !handled.has(item.externalId),
    );
    if (open.length === 0) break;
    for (const item of open) {
      handled.add(item.externalId);
      order.push(item.externalId);
    }
    if (parsed.cursor !== undefined) cursor = parsed.cursor;
  }
  return { order, cursor, ticks };
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

describe("stripe.newSubscriptions when a burst is larger than a run takes", () => {
  const burst = Array.from({ length: 80 }, (_, index) =>
    subscription(index + 1, BASE + (index + 1) * 60),
  );

  it("is primed on an empty account, then takes a burst of 80 with a limit of 30 exactly once, oldest first", () => {
    const primed = tick([], undefined, 30, true);
    expect(primed.primed).toBe(true);
    expect(primed.cursor).toBe(def.cursor?.origin);

    const { order, ticks } = drain(burst, primed.cursor, 30);

    expect(order).toEqual(burst.map((row) => row.id));
    expect(ticks).toBeLessThanOrEqual(4);
  });

  it("hands back the position of the last subscription it kept, and says it cut", () => {
    const parsed = tick(burst, "0", 30);

    expect(parsed.items?.map((item) => item.externalId)).toEqual(
      burst.slice(0, 30).map((row) => row.id),
    );
    expect(parsed.truncated).toBe(true);
    expect(parsed.totalAvailable).toBe(80);
    expect(parsed.cursor).toBe(String(BASE + 30 * 60));
  });

  it("moves the position to the newest subscription when it took every one", () => {
    const parsed = tick(burst, "0", 100);

    expect(parsed.items).toHaveLength(80);
    expect(parsed.truncated).toBe(false);
    expect(parsed.cursor).toBe(String(BASE + 80 * 60));
  });

  it("keeps the stored position when nothing is new", () => {
    expect(tick([], "1760000600", 30).cursor).toBeUndefined();
  });

  it("takes subscriptions that share a second whole, however the cut falls", () => {
    const fourPerSecond = Array.from({ length: 40 }, (_, index) =>
      subscription(index + 1, BASE + Math.floor(index / 4) * 60),
    );

    const { order } = drain(fourPerSecond, "0", 10);

    expect([...order].sort()).toEqual(fourPerSecond.map((row) => row.id));
    const createdOf = new Map(
      fourPerSecond.map((row) => [row.id, row.created]),
    );
    const seconds = order.map((id) => createdOf.get(id)!);
    expect(seconds).toEqual([...seconds].sort((a, b) => a - b));
  });

  it("takes a subscription made in the stored position's own second after the page was read", () => {
    const first = Array.from({ length: 5 }, (_, index) =>
      subscription(index + 1, BASE + index * 60),
    );
    const afterFirstRun = drain(first, "0", 30);
    expect(afterFirstRun.order).toHaveLength(5);

    const late = subscription(6, BASE + 4 * 60);
    const next = tick([...first, late], afterFirstRun.cursor, 30);

    expect(next.items?.map((item) => item.externalId)).toContain(late.id);
  });

  it("fails when a whole second holds more than a run takes, rather than skip the rest", () => {
    const crowded = Array.from({ length: 12 }, (_, index) =>
      subscription(index + 1, BASE),
    );

    const error = failureOf(() => tick(crowded, "0", 8));

    expect(error.code).toBe("unexpected_response");
    expect(error.message).toContain("more rows at one time than a run takes");
  });
});

describe("stripe.newSubscriptions when Stripe sends only part of what is new", () => {
  const rows = Array.from({ length: PAGE_SIZE + 20 }, (_, index) =>
    subscription(index + 1, BASE + (index + 1) * 60),
  );

  it("fails the run and reports it, because the oldest subscriptions are not on the page", () => {
    const { sink, events } = createCapturingTripwireSink();
    const built = buildProviderRequest(def, { fields: {}, cursor: "0" });

    const error = failureOf(() =>
      parseProviderResponse(def, stripeList(rows, built.query), {
        scope: SCOPE,
        limit: 50,
        cursor: "0",
        observe: { tripwire: sink, status: 200 },
      }),
    );

    expect(error.code).toBe("unexpected_response");
    expect(error.message).toContain("has_more");
    expect(events.map((event) => event.details?.reason)).toEqual([
      "page_partial",
    ]);
  });

  it("still primes over a long history, on the newest subscription Stripe sent", () => {
    const primed = tick(rows, undefined, 50, true);

    expect(primed.items).toEqual([]);
    expect(primed.primed).toBe(true);
    expect(primed.cursor).toBe(String(BASE + (PAGE_SIZE + 20) * 60));
  });

  it("reads a flag that is neither true nor false as a changed response", () => {
    const built = buildProviderRequest(def, { fields: {}, cursor: "0" });
    const page = {
      ...stripeList(rows.slice(0, 5), built.query),
      has_more: "no",
    };

    expect(
      failureOf(() =>
        parseProviderResponse(def, page, {
          scope: SCOPE,
          limit: 50,
          cursor: "0",
        }),
      ).code,
    ).toBe("unexpected_response");
  });

  it("fails a subscription whose created is not whole epoch seconds, naming the row and not the value", () => {
    const page = {
      object: "list",
      has_more: false,
      data: [{ ...subscription(1, BASE), created: "last tuesday" }],
    };

    const error = failureOf(() =>
      parseProviderResponse(def, page, {
        scope: SCOPE,
        limit: 50,
        cursor: "0",
      }),
    );

    expect(error.message).toContain("item 0");
    expect(error.message).not.toContain("last tuesday");
  });
});
