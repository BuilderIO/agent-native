import { describe, expect, it, vi } from "vitest";

import {
  ActionReceiptValidationError,
  assertActionDomainEvent,
  assertActionReceipt,
  commitAction,
  createActionDomainEvent,
  parseActionDomainEvent,
  parseActionReceipt,
  serializeActionDomainEvent,
  serializeActionReceipt,
  type ActionAtomicAdapter,
  type ActionDomainEvent,
} from "./action-receipt.js";

const NOW = new Date("2026-10-03T03:00:00.000Z");

function sequence(...ids: string[]): () => string {
  return () => {
    const id = ids.shift();
    if (!id) throw new Error("id sequence exhausted");
    return id;
  };
}

function adapter(log: string[]): ActionAtomicAdapter<{ writes: string[] }> {
  return {
    transaction: async (operation) => {
      log.push("begin");
      const result = await operation({ writes: [] });
      log.push("commit");
      return result;
    },
    stageActionOutcome: async (transaction, outcome) => {
      log.push(`stage:${outcome.events.length}`);
      transaction.writes.push(outcome.receipt.receiptId);
      transaction.writes.push(...outcome.events.map((event) => event.id));
    },
  };
}

describe("action receipt atomic seam", () => {
  it("stages mutation events before commit and returns only references", async () => {
    const log: string[] = [];
    const result = await commitAction({
      adapter: adapter(log),
      action: "create-lead",
      source: "https://agency.example/actions/create-lead",
      context: {
        caller: "mcp",
        appId: "site",
        runId: "run-1",
        toolCallId: "call-1",
      },
      correlationId: "corr-1",
      causationId: "request-1",
      idempotencyKey: "idem-1",
      now: () => NOW,
      idFactory: sequence("event-1", "receipt-1"),
      mutate: async ({ transaction, emit }) => {
        transaction.writes.push("lead-1");
        emit({
          type: "com.example.lead.created.v1",
          subject: "lead-1",
          data: { leadId: "lead-1" },
        });
        return { id: "lead-1", created: true };
      },
    });

    expect(log).toEqual(["begin", "stage:1", "commit"]);
    expect(result).toEqual({
      schemaVersion: "1",
      receiptId: "receipt-1",
      action: "create-lead",
      status: "committed",
      committedAt: NOW.toISOString(),
      provenance: {
        caller: "mcp",
        appId: "site",
        runId: "run-1",
        toolCallId: "call-1",
        correlationId: "corr-1",
        causationId: "request-1",
        idempotencyKey: "idem-1",
      },
      result: { id: "lead-1", created: true },
      events: [
        {
          id: "event-1",
          source: "https://agency.example/actions/create-lead",
          type: "com.example.lead.created.v1",
          time: NOW.toISOString(),
          subject: "lead-1",
        },
      ],
    });
    expect("data" in result.events[0]!).toBe(false);
  });

  it("stages the receipt even when the action emits no events", async () => {
    const log: string[] = [];
    const stage = vi.fn(adapter(log).stageActionOutcome);
    const receipt = await commitAction({
      adapter: { ...adapter(log), stageActionOutcome: stage },
      action: "update-setting",
      source: "urn:agent-native:test",
      now: () => NOW,
      idFactory: sequence("receipt-1"),
      mutate: () => ({ updated: true }),
    });
    expect(stage).toHaveBeenCalledOnce();
    expect(stage.mock.calls[0]![1]).toMatchObject({
      receipt: { receiptId: "receipt-1" },
      events: [],
    });
    expect(receipt.events).toEqual([]);
    expect(receipt.provenance).toEqual({ caller: "cli" });
  });

  it("rejects instead of returning a receipt when event staging fails", async () => {
    const transaction = vi.fn(
      async (operation: (tx: object) => Promise<unknown>) => operation({}),
    );
    await expect(
      commitAction({
        adapter: {
          transaction,
          stageActionOutcome: async () => {
            throw new Error("outbox unavailable");
          },
        },
        action: "create-lead",
        source: "https://example.test/actions/create-lead",
        now: () => NOW,
        idFactory: sequence("event-1", "receipt-1"),
        mutate: ({ emit }) => {
          emit({ type: "test.created.v1", data: { id: "1" } });
          return { id: "1" };
        },
      }),
    ).rejects.toThrow("outbox unavailable");
  });

  it("rejects non-JSON results and duplicate event ids before commit", async () => {
    await expect(
      commitAction({
        adapter: adapter([]),
        action: "bad-result",
        source: "urn:test:action",
        now: () => NOW,
        idFactory: sequence("receipt-1"),
        mutate: () => ({ value: Number.NaN }) as never,
      }),
    ).rejects.toThrow("Invalid result.value");

    await expect(
      commitAction({
        adapter: adapter([]),
        action: "duplicate-events",
        source: "urn:test:action",
        now: () => NOW,
        idFactory: sequence("same", "same"),
        mutate: ({ emit }) => {
          emit({ type: "test.one.v1", data: {} });
          emit({ type: "test.two.v1", data: {} });
          return { ok: true };
        },
      }),
    ).rejects.toThrow("Duplicate domain event id: same");
  });
});

describe("domain event contract", () => {
  it("creates and round-trips a CloudEvents 1.0-compatible JSON event", () => {
    const event = createActionDomainEvent(
      {
        type: "com.example.changed.v1",
        subject: "thing-1",
        data: { id: "thing-1" },
      },
      {
        source: "https://example.test/actions/change-thing",
        now: () => NOW,
        idFactory: () => "event-1",
      },
    );
    expect(event).toMatchObject({
      specversion: "1.0",
      datacontenttype: "application/json",
      id: "event-1",
      time: NOW.toISOString(),
    });
    expect(parseActionDomainEvent(serializeActionDomainEvent(event))).toEqual(
      event,
    );
  });

  it.each([
    [{}, "specversion"],
    [{ specversion: "0.3" }, "specversion"],
    [
      {
        specversion: "1.0",
        id: "event-1",
        source: "/relative",
        type: "test.v1",
        time: NOW.toISOString(),
        datacontenttype: "application/json",
        data: {},
      },
      "source",
    ],
  ])("rejects invalid events %#", (value, message) => {
    expect(() => assertActionDomainEvent(value)).toThrow(message);
  });

  it("rejects unknown fields and invalid explicit timestamps", () => {
    expect(() =>
      assertActionDomainEvent({
        specversion: "1.0",
        id: "event-1",
        source: "urn:test:event",
        type: "test.v1",
        time: NOW.toISOString(),
        datacontenttype: "application/json",
        data: {},
        secret: "not-part-of-contract",
      }),
    ).toThrow("unexpected secret");
    expect(() =>
      createActionDomainEvent(
        { id: "event-1", type: "test.v1", time: "yesterday", data: {} },
        { source: "urn:test:event" },
      ),
    ).toThrow("event.time");
  });
});

describe("receipt serialization and validation", () => {
  const receipt = {
    schemaVersion: "1" as const,
    receiptId: "receipt-1",
    action: "create-lead",
    status: "committed" as const,
    committedAt: NOW.toISOString(),
    provenance: { caller: "webmcp" as const, correlationId: "corr-1" },
    result: { z: 1, a: { y: true, b: null } },
    events: [],
  };

  it("serializes deterministically and round-trips", () => {
    const serialized = serializeActionReceipt(receipt);
    expect(serialized).toBe(
      '{"action":"create-lead","committedAt":"2026-10-03T03:00:00.000Z","events":[],"provenance":{"caller":"webmcp","correlationId":"corr-1"},"receiptId":"receipt-1","result":{"a":{"b":null,"y":true},"z":1},"schemaVersion":"1","status":"committed"}',
    );
    expect(parseActionReceipt(serialized)).toEqual(receipt);
  });

  it.each([
    ["not json", "JSON"],
    [JSON.stringify({ ...receipt, schemaVersion: "2" }), "schemaVersion"],
    [JSON.stringify({ ...receipt, status: "failed" }), "status"],
    [
      JSON.stringify({ ...receipt, provenance: { caller: "unknown" } }),
      "caller",
    ],
    [JSON.stringify({ ...receipt, extra: true }), "unexpected extra"],
  ])("rejects invalid receipt payloads %#", (value, message) => {
    expect(() => parseActionReceipt(value)).toThrow(message);
  });

  it("uses a distinct validation error type", () => {
    expect(() => assertActionReceipt(null)).toThrow(
      ActionReceiptValidationError,
    );
  });
});
