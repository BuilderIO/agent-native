import { describe, it, expect } from "vitest";

import { runWithRequestContext } from "../server/request-context.js";
import { createInitMemo } from "./init-memo.js";

describe("createInitMemo", () => {
  it("runs the init once and reuses the settled result", async () => {
    let runs = 0;
    const memo = createInitMemo(async () => {
      runs++;
    });

    await memo();
    await memo();
    await memo();

    expect(runs).toBe(1);
  });

  it("shares one in-flight init between callers in the same request", async () => {
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const memo = createInitMemo(async () => {
      runs++;
      await gate;
    });

    await runWithRequestContext({ userEmail: "a@example.test" }, async () => {
      const first = memo();
      const second = memo();
      release();
      await Promise.all([first, second]);
    });

    expect(runs).toBe(1);
  });

  it("does not make a second request await an init the first one abandoned", async () => {
    // The whole point: on Workers the abandoned promise never settles, so a
    // memo that shares it across requests hangs the second caller forever.
    let runs = 0;
    const memo = createInitMemo(async () => {
      runs++;
      if (runs === 1) await new Promise<void>(() => {});
    });

    await runWithRequestContext({ userEmail: "a@example.test" }, () => {
      void memo();
      return Promise.resolve();
    });

    await runWithRequestContext({ userEmail: "b@example.test" }, () => memo());

    expect(runs).toBe(2);
  });

  it("does not share a pending init started outside any request", async () => {
    let runs = 0;
    const memo = createInitMemo(async () => {
      runs++;
      if (runs === 1) await new Promise<void>(() => {});
    });

    void memo();
    await memo();

    expect(runs).toBe(2);
  });

  it("re-runs after a failure instead of caching the rejection", async () => {
    let runs = 0;
    const memo = createInitMemo(async () => {
      runs++;
      if (runs === 1) throw new Error("table create failed");
    });

    await expect(memo()).rejects.toThrow("table create failed");
    await expect(memo()).resolves.toBeUndefined();
    expect(runs).toBe(2);
  });

  it("re-runs after reset", async () => {
    let runs = 0;
    const memo = createInitMemo(async () => {
      runs++;
    });

    await memo();
    memo.reset();
    await memo();

    expect(runs).toBe(2);
  });
});
