import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActionExecutionFrame } from "./action-frame.js";

// Each test loads its own copy of the modules, so the frame storage the wrapper
// writes to is the one the test reads. `fetch` is a stub that records what
// reached it, so what is asserted is what was sent and whether it was seen first.
const originalFetch = globalThis.fetch;

async function load() {
  vi.resetModules();
  const [frames, observation] = await Promise.all([
    import("./action-frame.js"),
    import("./outbound-write-observation.js"),
  ]);
  return { ...frames, ...observation };
}

type Loaded = Awaited<ReturnType<typeof load>>;

function frameFor(): ActionExecutionFrame {
  return {
    key: {},
    run: async () => undefined,
    handlerEntered: true,
    writeEntered: false,
    changeEntered: false,
    writeObserved: false,
  };
}

/** The frame a call runs in, to read what it was seen to do. */
async function inFrame(
  loaded: Loaded,
  run: () => unknown,
  frame = frameFor(),
): Promise<ActionExecutionFrame> {
  if (!loaded.actionExecutionStorage) throw new Error("No AsyncLocalStorage.");
  await loaded.actionExecutionStorage.run(
    { frame, failures: new WeakMap() },
    async () => {
      await run();
    },
  );
  return frame;
}

function stubFetch() {
  const stub = vi.fn(async (..._args: unknown[]) => new Response("ok"));
  globalThis.fetch = stub as unknown as typeof fetch;
  return stub;
}

afterEach(() => {
  Object.defineProperty(globalThis, "fetch", {
    value: originalFetch,
    writable: true,
    configurable: true,
    enumerable: true,
  });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("which requests count as writes", () => {
  it.each(["GET", "get", "HEAD", "OPTIONS"])("does not count %s", async (m) => {
    const loaded = await load();
    stubFetch();
    expect(loaded.observeOutboundWrites()).toBe("observing");
    const frame = await inFrame(loaded, () =>
      fetch("https://api.test/x", { method: m }),
    );
    expect(frame.writeObserved).toBe(false);
  });

  it.each(["POST", "PUT", "PATCH", "DELETE", "post", "PROPFIND", "purge"])(
    "counts %s",
    async (m) => {
      const loaded = await load();
      stubFetch();
      loaded.observeOutboundWrites();
      const frame = await inFrame(loaded, () =>
        fetch("https://api.test/x", { method: m }),
      );
      expect(frame.writeObserved).toBe(true);
      expect(frame.writeObservedChannel).toBe("http");
    },
  );

  it("treats a request with no method as a read, whatever its first argument", async () => {
    const loaded = await load();
    stubFetch();
    loaded.observeOutboundWrites();
    const frame = await inFrame(loaded, async () => {
      await fetch("https://api.test/x");
      await fetch(new URL("https://api.test/x"));
      await fetch(new Request("https://api.test/x"));
      await fetch("https://api.test/x", {});
      await fetch("https://api.test/x", undefined);
    });
    expect(frame.writeObserved).toBe(false);
  });

  it("reads the method of a Request, and lets init override it", async () => {
    const loaded = await load();
    stubFetch();
    loaded.observeOutboundWrites();
    const post = new Request("https://api.test/x", { method: "POST" });
    expect((await inFrame(loaded, () => fetch(post))).writeObserved).toBe(true);
    expect(
      (await inFrame(loaded, () => fetch(post, { method: "GET" })))
        .writeObserved,
    ).toBe(false);
    expect(
      (
        await inFrame(loaded, () =>
          fetch(new Request("https://api.test/x"), { method: "DELETE" }),
        )
      ).writeObserved,
    ).toBe(true);
  });

  it("counts a method it cannot read as a write, and still sends the request", async () => {
    const loaded = await load();
    const stub = stubFetch();
    loaded.observeOutboundWrites();
    const hostile = {
      get method(): string {
        throw new Error("unreadable");
      },
    };
    const notAString = { method: 7 };
    const frame = await inFrame(loaded, async () => {
      await fetch("https://api.test/x", hostile as RequestInit);
    });
    expect(frame.writeObserved).toBe(true);
    expect(stub).toHaveBeenCalledTimes(1);
    expect(
      (
        await inFrame(loaded, () =>
          fetch("https://api.test/x", notAString as unknown as RequestInit),
        )
      ).writeObserved,
    ).toBe(true);
  });

  it("counts the write before the request is sent", async () => {
    const loaded = await load();
    const frame = frameFor();
    let seenAtSend: boolean | undefined;
    globalThis.fetch = vi.fn(async () => {
      seenAtSend = frame.writeObserved;
      return new Response("ok");
    }) as unknown as typeof fetch;
    loaded.observeOutboundWrites();
    await inFrame(
      loaded,
      () => fetch("https://api.test/x", { method: "POST" }),
      frame,
    );
    expect(seenAtSend).toBe(true);
  });

  it("counts a write for the calls the sender runs inside", async () => {
    const loaded = await load();
    stubFetch();
    loaded.observeOutboundWrites();
    const parent = frameFor();
    const child = { ...frameFor(), parent };
    await inFrame(
      loaded,
      () => fetch("https://api.test/x", { method: "POST" }),
      child,
    );
    expect(parent.writeObserved).toBe(true);
    expect(parent.nestedWriteObserved).toBe(true);
  });

  it("does not count a request the sender exempted", async () => {
    const loaded = await load();
    stubFetch();
    loaded.observeOutboundWrites();
    const frame = await inFrame(loaded, () =>
      loaded.withoutWriteObservation(() =>
        fetch("https://api.test/x", { method: "POST" }),
      ),
    );
    expect(frame.writeObserved).toBe(false);
  });
});

describe("what the wrapper leaves alone", () => {
  it("passes every argument through and returns the original promise", async () => {
    const loaded = await load();
    const response = new Response("ok");
    const promise = Promise.resolve(response);
    const stub = vi.fn((..._args: unknown[]) => promise);
    globalThis.fetch = stub as unknown as typeof fetch;
    loaded.observeOutboundWrites();
    const input = new URL("https://api.test/x");
    const init = { method: "POST", body: "{}" };
    const extra = {};

    const returned = (fetch as (...a: unknown[]) => Promise<Response>)(
      input,
      init,
      extra,
    );

    expect(returned).toBe(promise);
    expect(stub.mock.calls[0]).toHaveLength(3);
    expect(stub.mock.calls[0]![0]).toBe(input);
    expect(stub.mock.calls[0]![1]).toBe(init);
    expect(stub.mock.calls[0]![2]).toBe(extra);
    expect(await returned).toBe(response);
  });

  it("rejects with the error the request rejected with", async () => {
    const loaded = await load();
    const failure = new TypeError("fetch failed");
    globalThis.fetch = vi.fn(async () => {
      throw failure;
    }) as unknown as typeof fetch;
    loaded.observeOutboundWrites();
    const frame = frameFor();
    let caught: unknown;
    await inFrame(
      loaded,
      async () => {
        try {
          await fetch("https://api.test/x", { method: "POST" });
        } catch (error) {
          caught = error;
        }
      },
      frame,
    );
    expect(caught).toBe(failure);
    expect(frame.writeObserved).toBe(true);
  });

  it("throws what the original throws synchronously", () => {
    return load().then((loaded) => {
      const failure = new Error("bad init");
      globalThis.fetch = vi.fn(() => {
        throw failure;
      }) as unknown as typeof fetch;
      loaded.observeOutboundWrites();
      expect(() => fetch("https://api.test/x")).toThrow(failure);
    });
  });

  it("calls the original with the receiver it was called with", async () => {
    const loaded = await load();
    let receiver: unknown = "unset";
    globalThis.fetch = vi.fn(function (this: unknown) {
      receiver = this;
      return Promise.resolve(new Response("ok"));
    }) as unknown as typeof fetch;
    loaded.observeOutboundWrites();
    await globalThis.fetch("https://api.test/x");
    expect(receiver).toBe(globalThis);
  });

  it("keeps the name and the own properties of the fetch it wraps", async () => {
    const loaded = await load();
    const preconnect = vi.fn();
    const original = Object.assign(
      async function fetch() {
        return new Response("ok");
      },
      { preconnect },
    );
    globalThis.fetch = original as unknown as typeof fetch;
    loaded.observeOutboundWrites();

    expect(globalThis.fetch).not.toBe(original);
    expect(globalThis.fetch.name).toBe("fetch");
    (globalThis.fetch as unknown as { preconnect(u: string): void }).preconnect(
      "https://api.test",
    );
    expect(preconnect).toHaveBeenCalledWith("https://api.test");
  });

  it("does nothing, and throws nothing, outside an action call", async () => {
    const loaded = await load();
    const stub = stubFetch();
    loaded.observeOutboundWrites();
    await expect(
      fetch("https://api.test/x", { method: "POST" }),
    ).resolves.toBeInstanceOf(Response);
    expect(stub).toHaveBeenCalledTimes(1);
  });
});

describe("installing", () => {
  it("wraps once however often it is asked", async () => {
    const loaded = await load();
    const stub = stubFetch();
    expect(loaded.observeOutboundWrites()).toBe("observing");
    const wrapper = globalThis.fetch;
    expect(wrapper).not.toBe(stub);
    for (let i = 0; i < 5; i += 1) {
      expect(loaded.observeOutboundWrites()).toBe("observing");
    }
    expect(globalThis.fetch).toBe(wrapper);
    await fetch("https://api.test/x");
    expect(stub).toHaveBeenCalledTimes(1);
  });

  it("wraps a fetch something replaced since, so a test double is seen too", async () => {
    const loaded = await load();
    stubFetch();
    loaded.observeOutboundWrites();
    const replacement = stubFetch();

    expect(loaded.observeOutboundWrites()).toBe("observing");
    const frame = await inFrame(loaded, () =>
      fetch("https://api.test/x", { method: "POST" }),
    );

    expect(replacement).toHaveBeenCalledTimes(1);
    expect(frame.writeObserved).toBe(true);
  });

  it("does not stack wrappers when another copy of the module wrapped it", async () => {
    const first = await load();
    const stub = stubFetch();
    first.observeOutboundWrites();
    const second = await load();
    second.observeOutboundWrites();
    const settled = globalThis.fetch;

    for (let i = 0; i < 3; i += 1) {
      first.observeOutboundWrites();
      second.observeOutboundWrites();
    }

    expect(globalThis.fetch).toBe(settled);
    await fetch("https://api.test/x");
    expect(stub).toHaveBeenCalledTimes(1);
  });

  it("leaves a browser's fetch alone", async () => {
    const loaded = await load();
    const stub = stubFetch();
    vi.stubGlobal("window", {});
    expect(loaded.observeOutboundWrites()).toBe("not-server");
    expect(globalThis.fetch).toBe(stub);
  });

  it("says, once, that writes go unseen when there is no fetch", async () => {
    const loaded = await load();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    Object.defineProperty(globalThis, "fetch", {
      value: undefined,
      writable: true,
      configurable: true,
    });

    expect(loaded.observeOutboundWrites()).toBe("fetch-missing");
    expect(loaded.observeOutboundWrites()).toBe("fetch-missing");

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("fetch is not available");
  });

  it("says, once, that writes go unseen when fetch cannot be replaced", async () => {
    const loaded = await load();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const frozen = vi.fn(async () => new Response("ok"));
    Object.defineProperty(globalThis, "fetch", {
      value: frozen,
      writable: false,
      configurable: true,
    });

    expect(loaded.observeOutboundWrites()).toBe("fetch-unwritable");
    expect(loaded.observeOutboundWrites()).toBe("fetch-unwritable");

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain(
      "fetch cannot be replaced",
    );
    expect(globalThis.fetch).toBe(frozen);
  });

  it("reports a setter that ignores the wrapper as unwritable", async () => {
    const loaded = await load();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const stub = vi.fn(async () => new Response("ok"));
    Object.defineProperty(globalThis, "fetch", {
      get: () => stub,
      set: () => undefined,
      configurable: true,
    });
    expect(loaded.observeOutboundWrites()).toBe("fetch-unwritable");
  });
});
