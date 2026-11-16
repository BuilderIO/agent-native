import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  defineAction,
  fail,
  invocationEffect,
  runActionWithExecutionOutcome,
  type ActionExecutionOutcome,
  type ActionRunContext,
} from "./action.js";
import { createProviderApiRequestAction } from "./provider-api/actions/provider-api.js";
import { completeText } from "./server/complete-text.js";
import {
  registerTrackingProvider,
  track,
  unregisterTrackingProvider,
} from "./tracking/registry.js";

// A failed write is read by what the framework saw it send. Over HTTP that is
// every request that is not a plain read, so these run real actions against a
// stubbed `fetch` and read what the dispatcher would: the effect of the failure.
const originalFetch = globalThis.fetch;
const tool: ActionRunContext = { caller: "tool", actionName: "probe-action" };

function stubFetch() {
  const sent = vi.fn(
    async (..._args: unknown[]) => new Response("{}", { status: 200 }),
  );
  globalThis.fetch = sent as unknown as typeof fetch;
  return sent;
}

const methodOf = (call: unknown[]) =>
  String((call[1] as { method?: string } | undefined)?.method ?? "GET");

type Run = Parameters<typeof runActionWithExecutionOutcome>[0];

/** Runs `entry` as a dispatcher does and reads the effect of its failure. */
async function failureEffect(
  entry: { run: Run },
  args: unknown = {},
  ctx: ActionRunContext = tool,
) {
  const outcome: ActionExecutionOutcome = { refused: false };
  const error = await runActionWithExecutionOutcome(
    entry.run,
    args,
    ctx,
    outcome,
    entry,
  ).then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(error).toBeDefined();
  return {
    outcome,
    effect: invocationEffect(entry as object, outcome, { failed: { error } }),
  };
}

const write = (
  run: (args: unknown, ctx?: ActionRunContext) => Promise<unknown>,
) => defineAction({ description: "Write", schema: z.object({}), run });

afterEach(() => {
  Object.defineProperty(globalThis, "fetch", {
    value: originalFetch,
    writable: true,
    configurable: true,
    enumerable: true,
  });
  unregisterTrackingProvider("probe");
  vi.restoreAllMocks();
});

describe("a write action that fails after sending over HTTP", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "is unknown after a %s, so the agent does not repeat it",
    async (method) => {
      const sent = stubFetch();
      const action = write(async () => {
        await fetch("https://api.test/send", { method });
        fail("Failed after the provider accepted it.");
      });

      const { effect, outcome } = await failureEffect(action);

      expect(effect).toEqual({ effect: "unknown", changed: true });
      expect(outcome.evidence).toMatchObject({ writeObserved: true });
      expect(outcome.evidence?.nestedWriteObserved).toBeFalsy();
      expect(sent).toHaveBeenCalledTimes(1);
    },
  );

  it("is unknown when the request itself rejected", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const action = write(async () => {
      await fetch("https://api.test/send", { method: "POST" });
    });

    expect((await failureEffect(action)).effect).toMatchObject({
      effect: "unknown",
    });
  });

  it("is unknown when the write was sent by a call nested in it", async () => {
    stubFetch();
    const child = write(async () => {
      await fetch("https://api.test/send", { method: "POST" });
      return "sent";
    });
    const parent = write(async (_args, ctx) => {
      await child.run({}, ctx);
      fail("Failed after the child sent.");
    });

    const { effect, outcome } = await failureEffect(parent);

    expect(effect).toMatchObject({ effect: "unknown" });
    expect(outcome.evidence).toMatchObject({ nestedWriteObserved: true });
  });
});

describe("a write action that fails without having written", () => {
  it.each(["GET", "HEAD", "OPTIONS"])(
    "is none after a %s, so the agent may retry",
    async (method) => {
      const sent = stubFetch();
      const action = write(async () => {
        await fetch("https://api.test/read", { method });
        fail("Nothing matched.");
      });

      expect((await failureEffect(action)).effect).toEqual({
        effect: "none",
        changed: true,
      });
      expect(sent).toHaveBeenCalledTimes(1);
    },
  );

  it("is none when it was refused before it sent anything", async () => {
    const sent = stubFetch();
    const action = defineAction({
      description: "Send",
      schema: z.object({ to: z.string() }),
      run: async ({ to }) => {
        if (!to.includes("@")) fail("Not an address.");
        await fetch("https://api.test/send", { method: "POST" });
        return "sent";
      },
    });

    expect((await failureEffect(action, { to: "nobody" })).effect).toEqual({
      effect: "none",
      changed: true,
    });
    expect(sent).not.toHaveBeenCalled();
  });

  it("is none when it only reported analytics and asked a model, before failing", async () => {
    const sent = stubFetch();
    registerTrackingProvider({
      name: "probe",
      track: () => {
        void fetch("https://analytics.test/capture", { method: "POST" });
      },
    });
    const engine = {
      name: "probe-engine",
      defaultModel: "probe-model",
      supportedModels: ["probe-model"],
      stream: async function* () {
        await fetch("https://llm.test/v1/messages", { method: "POST" });
        yield { type: "text-delta", text: "a draft" };
        yield { type: "stop", reason: "end_turn" };
      },
    };
    const action = write(async () => {
      track("probe_event", { step: "drafting" });
      await completeText({
        engine: engine as never,
        model: "probe-model",
        apiKey: "k",
        input: "Write a subject line.",
      });
      fail("The draft had no subject.");
    });

    const { effect, outcome } = await failureEffect(action);

    expect(effect).toEqual({ effect: "none", changed: true });
    expect(outcome.evidence).toMatchObject({ writeObserved: false });
    // The wrapper saw every one of these as a POST: the lifecycle's started and
    // failed events, the handler's own, and the model's.
    const posts = sent.mock.calls.filter((call) => methodOf(call) === "POST");
    expect(posts.length).toBeGreaterThanOrEqual(4);
    expect(posts.some(([url]) => String(url).includes("llm.test"))).toBe(true);
  });

  it("is unknown when a real POST came with that analytics", async () => {
    stubFetch();
    registerTrackingProvider({
      name: "probe",
      track: () => {
        void fetch("https://analytics.test/capture", { method: "POST" });
      },
    });
    const action = write(async () => {
      track("probe_event", {});
      await fetch("https://api.test/send", { method: "POST" });
      fail("Failed after sending.");
    });

    expect((await failureEffect(action)).effect).toMatchObject({
      effect: "unknown",
    });
  });

  it("keeps its own bookkeeping out of the evidence the dispatcher reads", async () => {
    // The lifecycle's `failed` event is emitted after the handler threw and
    // before the dispatcher reads the frame, so it is the event that would flip
    // it. It is the only event here: the handler reports nothing itself.
    const sent = stubFetch();
    registerTrackingProvider({
      name: "probe",
      track: (event) => {
        void fetch("https://analytics.test/capture", {
          method: "POST",
          body: JSON.stringify({ event: event.name }),
        });
      },
    });
    const action = write(async () => fail("Rejected."));

    const { effect } = await failureEffect(action);

    expect(effect).toEqual({ effect: "none", changed: true });
    const events = sent.mock.calls.map((call) =>
      String(JSON.parse(String((call[1] as RequestInit).body)).event),
    );
    expect(events.some((name) => /failed/.test(name))).toBe(true);
  });
});

describe("installing the observation", () => {
  it("wraps fetch when a call is run directly, without a dispatcher", async () => {
    const stub = stubFetch();
    const action = write(async () => "done");

    await action.run({}, { caller: "cli" });

    expect(globalThis.fetch).not.toBe(stub);
    await fetch("https://api.test/read");
    expect(stub).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed write unknown when fetch cannot be wrapped, since its writes go unseen", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    Object.defineProperty(globalThis, "fetch", {
      value: vi.fn(async () => new Response("{}")),
      writable: false,
      configurable: true,
    });
    const action = write(async () => {
      fail("Nothing matched.");
    });

    expect((await failureEffect(action)).effect).toEqual({
      effect: "unknown",
      changed: true,
    });
  });
});

describe("provider-api-request", () => {
  const request = (executeRequest: () => Promise<never>) =>
    createProviderApiRequestAction({ executeRequest });

  it("is none when a read-only POST fails after sending", async () => {
    const sent = stubFetch();
    const action = request(async () => {
      await fetch(
        "https://analyticsdata.googleapis.com/v1beta/properties/1:runReport",
        { method: "POST", body: "{}" },
      );
      throw new Error("Quota exhausted.");
    });

    const { effect, outcome } = await failureEffect(action, {
      provider: "ga4",
      method: "POST",
      path: "/v1beta/properties/1:runReport",
      body: {},
    });

    expect(effect).toMatchObject({ effect: "none" });
    expect(outcome.evidence).toMatchObject({ writeEntered: false });
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it("is unknown when a write fails after the request was sent", async () => {
    stubFetch();
    const action = request(async () => {
      await fetch("https://api.github.com/repos/o/r/issues/1", {
        method: "PATCH",
        body: "{}",
      });
      throw new Error("Connection reset.");
    });

    const { effect } = await failureEffect(action, {
      provider: "github",
      method: "PATCH",
      path: "/repos/o/r/issues/1",
      body: {},
    });

    expect(effect).toMatchObject({ effect: "unknown" });
  });

  it("is none when a write is refused before anything is sent", async () => {
    const sent = stubFetch();
    const action = request(async () => {
      throw new Error("Host is not allowed for this provider.");
    });

    const { effect } = await failureEffect(action, {
      provider: "github",
      method: "PATCH",
      path: "/repos/o/r/issues/1",
      body: {},
    });

    expect(effect).toMatchObject({ effect: "none" });
    expect(sent).not.toHaveBeenCalled();
  });
});
