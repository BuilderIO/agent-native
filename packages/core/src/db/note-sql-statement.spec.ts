import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActionExecutionFrame } from "../action-frame.js";

// Each test loads its own copy of the modules, so the frame storage the hook
// writes to is the one the test reads.
async function load() {
  vi.resetModules();
  const [frames, hook] = await Promise.all([
    import("../action-frame.js"),
    import("./note-sql-statement.js"),
  ]);
  return { ...frames, ...hook };
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("noteSqlStatement", () => {
  it("counts a statement that writes as a database write of the running call", async () => {
    const loaded = await load();
    const frame = await inFrame(loaded, () =>
      loaded.noteSqlStatement("INSERT INTO t (id) VALUES ('a')"),
    );
    expect(frame.writeObserved).toBe(true);
    expect(frame.writeObservedChannel).toBe("db");
  });

  it("does not count a read", async () => {
    const loaded = await load();
    const frame = await inFrame(loaded, () =>
      loaded.noteSqlStatement("SELECT id FROM t"),
    );
    expect(frame.writeObserved).toBe(false);
    expect(frame.writeObservedChannel).toBeUndefined();
  });

  it("counts a statement with no SQL text as a write", async () => {
    const loaded = await load();
    const frame = await inFrame(loaded, () =>
      loaded.noteSqlStatement(undefined),
    );
    expect(frame.writeObserved).toBe(true);
    expect(frame.writeObservedChannel).toBe("db");
  });

  it("leaves a call that already wrote with its first channel", async () => {
    const loaded = await load();
    const frame = frameFor();
    frame.writeObserved = true;
    frame.writeObservedChannel = "http";
    await inFrame(
      loaded,
      () => loaded.noteSqlStatement("DELETE FROM t WHERE id = 'a'"),
      frame,
    );
    expect(frame.writeObservedChannel).toBe("http");
  });

  it("does not count a write the call is exempted from observing", async () => {
    const loaded = await load();
    const frame = await inFrame(loaded, () =>
      loaded.withoutWriteObservation(() =>
        loaded.noteSqlStatement("UPDATE t SET v = 1"),
      ),
    );
    expect(frame.writeObserved).toBe(false);
  });

  it("does nothing outside an action call", async () => {
    const loaded = await load();
    expect(() =>
      loaded.noteSqlStatement("INSERT INTO t (id) VALUES ('a')"),
    ).not.toThrow();
  });
});
