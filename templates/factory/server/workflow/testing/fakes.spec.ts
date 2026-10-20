import { describe, expect, it } from "vitest";

import { createRunBudget } from "../engine/run-budget.js";
import {
  FakeAiTurnRunner,
  FakeClock,
  FakeInbox,
  FakeItemStatusWriter,
  FakeOperationExecutor,
  FakeThreadReader,
  aiFailed,
  aiPerItem,
  aiRouter,
  aiWholeList,
  createIdSource,
  failure,
  ok,
} from "./fakes.js";
import { buildTestCatalog } from "./test-catalog.js";

const request = (operation = "test.read") => ({
  operation: buildTestCatalog().get(operation) as never,
  fields: {},
  credentialSlot: "test",
  mode: "live" as const,
  signal: new AbortController().signal,
});

describe("FakeOperationExecutor", () => {
  it("answers a queue in order, records calls, and throws once it is used up", async () => {
    const fake = new FakeOperationExecutor().script("test.read", ok(1), ok(2));

    expect(await fake.execute(request())).toEqual(ok(1));
    expect(await fake.execute(request())).toEqual(ok(2));
    await expect(fake.execute(request())).rejects.toThrow(
      /no answer left for test.read/,
    );
    expect(fake.callsTo("test.read")).toHaveLength(3);
  });

  it("falls back to an always-answer, and lets an answer be a function", async () => {
    const fake = new FakeOperationExecutor()
      .script("test.read", ok("first"))
      .always("test.read", (call) => ok(call.credentialSlot));

    expect(await fake.execute(request())).toEqual(ok("first"));
    expect(await fake.execute(request())).toEqual(ok("test"));
  });

  it("throws for an operation nobody scripted instead of inventing an answer", async () => {
    await expect(
      new FakeOperationExecutor().execute(request()),
    ).rejects.toThrow();
  });

  it("builds a failure that did nothing and is not retryable unless told", () => {
    expect(failure("provider_error")).toMatchObject({
      ok: false,
      retryable: false,
      sideEffect: "none",
    });
  });
});

describe("FakeAiTurnRunner", () => {
  const ask = (budget = createRunBudget(5)) => ({
    instruction: "x",
    items: [{ id: "a", item: {}, nodes: {} }],
    mode: "perItem" as const,
    resultSchemaFields: {},
    tools: [],
    maxRepairs: 1,
    budget,
    signal: new AbortController().signal,
    runId: "run-1",
  });

  it("draws a model call from the budget before answering, and answers budget when none is left", async () => {
    const budget = createRunBudget(1);
    const fake = new FakeAiTurnRunner().always(aiPerItem(() => ({ ok: true })));

    expect((await fake.run(ask(budget))).ok).toBe(true);
    expect(await fake.run(ask(budget))).toMatchObject({
      ok: false,
      code: "budget",
    });
    expect(budget.usedModelCalls()).toBe(1);
  });

  it("answers per item, for the whole list, or with a failure", async () => {
    const fake = new FakeAiTurnRunner().respond(
      aiPerItem((item) => (item.id === "a" ? { fail: "no_result" } : { v: 1 })),
      aiWholeList({ groups: [] }),
      aiFailed("timeout", "slow"),
    );

    expect(await fake.run(ask())).toMatchObject({
      mode: "perItem",
      results: [{ itemId: "a", ok: false, code: "no_result" }],
    });
    expect(await fake.run(ask())).toMatchObject({
      mode: "wholeList",
      fields: { groups: [] },
    });
    expect(await fake.run(ask())).toMatchObject({
      ok: false,
      code: "timeout",
      reason: "slow",
    });
    await expect(fake.run(ask())).rejects.toThrow(/no answer left/);
  });
});

describe("FakeClock", () => {
  it("moves by hand, and sleeping moves it and is remembered", async () => {
    const clock = new FakeClock("2026-10-19T12:00:00.000Z");

    clock.advance(1000);
    await clock.sleep(4000);

    expect(clock.now().toISOString()).toBe("2026-10-19T12:00:05.000Z");
    expect(clock.sleeps).toEqual([4000]);
    clock.set("2026-01-01T00:00:00.000Z");
    expect(clock.now().getUTCFullYear()).toBe(2026);
  });
});

describe("createIdSource", () => {
  it("counts each kind on its own, the same way every run", () => {
    const ids = createIdSource();
    expect([ids.next("lease"), ids.next("lease"), ids.next("run")]).toEqual([
      "lease-1",
      "lease-2",
      "run-1",
    ]);
  });
});

describe("FakeInbox and FakeItemStatusWriter", () => {
  it("answers per source and throws when a source has no answer", async () => {
    const inbox = new FakeInbox().script("status", { ok: true, items: [] });
    const settings = { source: "status", status: "x", takeLimit: 1 } as const;
    const take = () =>
      inbox.take({
        settings,
        mode: "live",
        signal: new AbortController().signal,
      });

    expect(await take()).toEqual({ ok: true, items: [] });
    await expect(take()).rejects.toThrow(/no answer left/);
  });

  it("records statuses, refuses on request, and reports an item's latest", async () => {
    const writer = new FakeItemStatusWriter().refuseNext("down");
    const set = (status: string) =>
      writer.setStatus({
        workflowId: "w",
        runId: "r",
        itemId: "a",
        status,
        signal: new AbortController().signal,
      });

    expect(await set("resolved")).toMatchObject({ ok: false, message: "down" });
    expect(await set("resolved")).toEqual({ ok: true });
    expect(await set("merged")).toEqual({ ok: true });
    expect(writer.statusOf("a")).toBe("merged");
    expect(writer.statusOf("zzz")).toBeUndefined();
  });
});

describe("FakeThreadReader", () => {
  const thread = { channelId: "C1", threadTs: "1.1" };
  const read = (
    fake: FakeThreadReader,
    over: Partial<Parameters<FakeThreadReader["readReplies"]>[0]> = {},
  ) =>
    fake.readReplies({
      thread,
      since: "2026-10-19T12:00:00.000Z",
      acceptFrom: "anyone",
      ackReaction: "white_check_mark",
      ownerEmail: "boss@example.test",
      signal: new AbortController().signal,
      ...over,
    });

  it("answers what a real host must: humans only, after `since`, from the people accepted", async () => {
    const fake = new FakeThreadReader().post(
      thread,
      { at: "2026-10-19T11:59:00.000Z", author: "early@example.test" },
      { at: "2026-10-19T12:01:00.000Z", author: "bot@example.test", bot: true },
      { at: "2026-10-19T12:02:00.000Z", author: "a@example.test", text: "hi" },
      {
        at: "2026-10-19T12:03:00.000Z",
        author: "b@example.test",
        reaction: "eyes",
      },
    );

    const anyone = await read(fake);
    expect(anyone).toMatchObject({ ok: true });
    expect(anyone.ok && anyone.replies.map((reply) => reply.author)).toEqual([
      "a@example.test",
    ]);
    const only = await read(fake, {
      acceptFrom: { emails: ["b@example.test"] },
    });
    expect(only.ok && only.replies).toEqual([]);
    const eyes = await read(fake, { ackReaction: "eyes" });
    expect(eyes.ok && eyes.replies.map((reply) => reply.kind)).toEqual([
      "message",
      "reaction",
    ]);
    const owner = await read(fake, { acceptFrom: "owner" });
    expect(owner.ok && owner.replies).toEqual([]);
  });

  it("is an empty thread for one nobody filed, and a failure only when told to fail", async () => {
    const fake = new FakeThreadReader().failNext(1, { message: "down" });

    expect(await read(fake)).toMatchObject({ ok: false, message: "down" });
    expect(await read(fake)).toEqual({ ok: true, replies: [] });
    expect(fake.requests).toHaveLength(2);
  });

  it("refuses a thread it cannot name", () => {
    expect(() =>
      new FakeThreadReader().post({}, { at: "x", author: "y" }),
    ).toThrow(/needs a channel and ts/);
  });
});

describe("aiRouter", () => {
  it("answers by what the instruction says, and throws for a turn nobody claimed", () => {
    const route = aiRouter([{ when: "Assess", respond: aiFailed("timeout") }]);
    const turn = (instruction: string) => ({ instruction, items: [] }) as never;

    expect(route(turn("Assess this report"))).toMatchObject({ ok: false });
    expect(() => route(turn("Group them"))).toThrow(/No AI route claims/);
  });
});
