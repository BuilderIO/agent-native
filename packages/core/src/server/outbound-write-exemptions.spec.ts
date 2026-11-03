import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActionExecutionFrame } from "../action-frame.js";

// What an action's own call does not count as a write: its analytics, its error
// reports, the answers a model gives it, and the transport a driver sends its
// statements over. Each test sends a real POST through the observed `fetch` from
// inside a frame and reads whether the frame saw it; the plain POST in the first
// test is the control that shows the frame would have.
const originalFetch = globalThis.fetch;

async function load() {
  vi.resetModules();
  const [frames, observation] = await Promise.all([
    import("../action-frame.js"),
    import("./outbound-write-observation.js"),
  ]);
  const sent = vi.fn(async (..._args: unknown[]) => new Response("{}"));
  globalThis.fetch = sent as unknown as typeof fetch;
  observation.observeOutboundWrites();
  return { ...frames, sent };
}

type Loaded = Awaited<ReturnType<typeof load>>;

/** The channel that saw a write while `run` ran in a frame, or null. */
async function observed(
  loaded: Loaded,
  run: () => unknown,
): Promise<string | null> {
  const frame: ActionExecutionFrame = {
    key: {},
    run: async () => undefined,
    handlerEntered: true,
    writeEntered: false,
    changeEntered: false,
    writeObserved: false,
  };
  if (!loaded.actionExecutionStorage) throw new Error("No AsyncLocalStorage.");
  await loaded.actionExecutionStorage.run(
    { frame, failures: new WeakMap() },
    async () => {
      await run();
    },
  );
  return frame.writeObserved ? (frame.writeObservedChannel ?? "?") : null;
}

const post = (url = "https://probe.test/send") =>
  fetch(url, { method: "POST", body: "{}" });

/** A provider whose events leave through `fetch`, as every built-in one does. */
function postingProvider(name: string, calls: string[] = []) {
  return {
    name,
    track: () => {
      calls.push("track");
      void post();
    },
    identify: () => {
      calls.push("identify");
      void post();
    },
    flush: async () => {
      calls.push("flush");
      await post();
    },
  };
}

afterEach(() => {
  Object.defineProperty(globalThis, "fetch", {
    value: originalFetch,
    writable: true,
    configurable: true,
    enumerable: true,
  });
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the control", () => {
  it("sees a POST that nothing exempted", async () => {
    const loaded = await load();
    expect(await observed(loaded, () => post())).toBe("http");
  });
});

describe("analytics", () => {
  it("does not count an event a provider sends", async () => {
    const loaded = await load();
    const { track, registerTrackingProvider, unregisterTrackingProvider } =
      await import("../tracking/registry.js");
    registerTrackingProvider(postingProvider("probe"));
    try {
      expect(await observed(loaded, () => track("probe_event", {}))).toBeNull();
    } finally {
      unregisterTrackingProvider("probe");
    }
    expect(loaded.sent).toHaveBeenCalledTimes(1);
  });

  it("does not count an event sent from a provider's own timer", async () => {
    const loaded = await load();
    const { track, registerTrackingProvider, unregisterTrackingProvider } =
      await import("../tracking/registry.js");
    registerTrackingProvider({
      name: "probe",
      track: () => {
        setTimeout(() => void post(), 0);
      },
    });
    try {
      expect(
        await observed(loaded, async () => {
          track("probe_event", {});
          await new Promise((resolve) => setTimeout(resolve, 20));
        }),
      ).toBeNull();
    } finally {
      unregisterTrackingProvider("probe");
    }
    expect(loaded.sent).toHaveBeenCalledTimes(1);
  });

  it("does not count an identify or a flush", async () => {
    const loaded = await load();
    const calls: string[] = [];
    const {
      identify,
      flushTracking,
      registerTrackingProvider,
      unregisterTrackingProvider,
    } = await import("../tracking/registry.js");
    registerTrackingProvider(postingProvider("probe", calls));
    try {
      expect(
        await observed(loaded, () => identify("u@example.com", {})),
      ).toBeNull();
      expect(await observed(loaded, () => flushTracking())).toBeNull();
    } finally {
      unregisterTrackingProvider("probe");
    }
    expect(calls).toEqual(["identify", "flush"]);
  });

  it("does not count the batch a built-in provider drains", async () => {
    vi.stubEnv("POSTHOG_API_KEY", "phc_test");
    vi.stubEnv("NETLIFY", "true");
    const loaded = await load();
    const { sendPostHogEvent } = await import("../tracking/providers.js");

    expect(
      await observed(loaded, () =>
        sendPostHogEvent("probe_event", {}, "u@example.com"),
      ),
    ).toBeNull();
    expect(String(loaded.sent.mock.calls[0]![0])).toContain("/capture/");
  });

  it("does not count a batch a later call's frame drains", async () => {
    vi.stubEnv("POSTHOG_API_KEY", "phc_test");
    const loaded = await load();
    const { sendPostHogEvent } = await import("../tracking/providers.js");
    sendPostHogEvent("queued_outside_a_call", {}, "u@example.com");
    expect(loaded.sent).not.toHaveBeenCalled();
    const { flushTracking, unregisterTrackingProvider } =
      await import("../tracking/registry.js");
    const { registerBuiltinProviders } =
      await import("../tracking/providers.js");
    registerBuiltinProviders();
    try {
      expect(await observed(loaded, () => flushTracking())).toBeNull();
    } finally {
      unregisterTrackingProvider("posthog");
    }
    expect(loaded.sent).toHaveBeenCalledTimes(1);
  });
});

describe("error reports", () => {
  it("does not count a report a capture provider sends", async () => {
    const loaded = await load();
    const { captureError, registerErrorCaptureProvider } =
      await import("./capture-error.js");
    const unregister = registerErrorCaptureProvider("probe", () => {
      void post();
    });
    try {
      expect(
        await observed(loaded, () => captureError(new Error("report me"))),
      ).toBeNull();
    } finally {
      unregister();
    }
    expect(loaded.sent).toHaveBeenCalledTimes(1);
  });
});

describe("model answers", () => {
  function fakeEngine(sent: () => Promise<unknown>) {
    return {
      name: "probe-engine",
      defaultModel: "probe-model",
      supportedModels: ["probe-model"],
      stream: async function* () {
        await sent();
        yield { type: "text-delta", text: "yes" };
        yield { type: "stop", reason: "end_turn" };
      },
    };
  }

  it("does not count a completion", async () => {
    const loaded = await load();
    const { completeText } = await import("./complete-text.js");
    const engine = fakeEngine(() => post("https://llm.test/v1/messages"));

    let text: string | undefined;
    expect(
      await observed(loaded, async () => {
        text = (
          await completeText({
            engine: engine as never,
            model: "probe-model",
            apiKey: "k",
            input: "hi",
          })
        ).text;
      }),
    ).toBeNull();
    expect(text).toBe("yes");
    expect(loaded.sent).toHaveBeenCalledTimes(1);
  });

  it("does not count a condition evaluated for an event", async () => {
    const loaded = await load();
    const { evaluateCondition } =
      await import("../triggers/condition-evaluator.js");
    const engine = fakeEngine(() => post("https://llm.test/v1/messages"));

    let verdict: boolean | undefined;
    expect(
      await observed(loaded, async () => {
        verdict = await evaluateCondition(
          "the order is paid",
          { paid: true },
          { userEmail: "u@example.com" },
          { engine: engine as never, resolvedModel: "probe-model" },
        );
      }),
    ).toBeNull();
    expect(verdict).toBe(true);
    expect(loaded.sent).toHaveBeenCalledTimes(1);
  });

  it("does not count an embedding", async () => {
    const loaded = await load();
    loaded.sent.mockImplementation(
      async () =>
        new Response(JSON.stringify({ embedding: { values: [0.1, 0.2] } })),
    );
    const { createGeminiEmbeddingFamily } =
      await import("../embeddings/index.js");

    let vectors: number[][] | undefined;
    expect(
      await observed(loaded, async () => {
        vectors = await createGeminiEmbeddingFamily("k", 2).embed(
          [{ text: "hello" }],
          "query",
        );
      }),
    ).toBeNull();
    expect(vectors).toEqual([[0.1, 0.2]]);
  });

  it("does not count a decision either provider answers", async () => {
    const loaded = await load();
    const { requestOpenAiDecision } =
      await import("../decisions/providers/openai.js");
    const { requestJevThroughBuilder } =
      await import("../decisions/providers/jev.js");

    expect(
      await observed(loaded, () =>
        requestOpenAiDecision({
          input: "text",
          questions: [],
          apiKey: "k",
          timeoutMs: 1000,
        }).catch(() => undefined),
      ),
    ).toBeNull();
    expect(
      await observed(loaded, () =>
        requestJevThroughBuilder(
          { authorization: "Bearer t" } as never,
          {},
        ).catch(() => undefined),
      ),
    ).toBeNull();
    expect(loaded.sent).toHaveBeenCalledTimes(2);
  });
});

describe("a database's transport", () => {
  it("does not count the POST a Neon HTTP query travels in, and still counts a write", async () => {
    const loaded = await load();
    const query = vi.fn(async () => {
      await post("https://ep-test.neon.tech/sql");
      return { rows: [], rowCount: 0 };
    });
    vi.doMock("@neondatabase/serverless", () => ({
      Pool: vi.fn(function MockPool() {
        return { end: vi.fn(async () => {}), on: vi.fn() };
      }),
      neon: vi.fn(() => ({ query, transaction: vi.fn() })),
      neonConfig: {},
    }));
    vi.stubGlobal("__AGENT_NATIVE_BACKGROUND_RUNTIME__", true);
    try {
      const { createDbExec } = await import("../db/client.js");
      const exec = await createDbExec({
        url: "postgresql://user:pass@ep-test.us-east-1.aws.neon.tech/db",
      });

      expect(
        await observed(loaded, () =>
          exec.execute("SELECT id FROM write_observation_probe"),
        ),
      ).toBeNull();
      expect(
        await observed(loaded, () =>
          exec.execute("INSERT INTO write_observation_probe (id) VALUES ('a')"),
        ),
      ).toBe("db");
      expect(loaded.sent).toHaveBeenCalledTimes(2);
    } finally {
      vi.doUnmock("@neondatabase/serverless");
    }
  });
});

describe("a command the caller runs", () => {
  it("counts a command, and not the version probe that asks whether it exists", async () => {
    const loaded = await load();
    const { ShellCliAdapter } =
      await import("../adapters/cli/shell-adapter.js");
    const adapter = new ShellCliAdapter({
      command: process.execPath,
      description: "node",
    });

    expect(await observed(loaded, () => adapter.isAvailable())).toBeNull();
    expect(await observed(loaded, () => adapter.execute(["--version"]))).toBe(
      "cli",
    );
  });
});
