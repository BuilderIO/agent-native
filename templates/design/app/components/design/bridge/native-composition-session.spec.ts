// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runNativeCompositionSession } from "./native-composition-session";

let root: HTMLElement;
let fonts: PropertyDescriptor | undefined;
let animations: PropertyDescriptor | undefined;

beforeEach(() => {
  root = document.createElement("main");
  document.body.append(root);
  fonts = Object.getOwnPropertyDescriptor(document, "fonts");
  animations = Object.getOwnPropertyDescriptor(document, "getAnimations");
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready: Promise.resolve(), status: "loaded" },
  });
  Object.defineProperty(document, "getAnimations", {
    configurable: true,
    value: () => [],
  });
});

afterEach(() => {
  root.remove();
  if (fonts) Object.defineProperty(document, "fonts", fonts);
  else Reflect.deleteProperty(document, "fonts");
  if (animations) Object.defineProperty(document, "getAnimations", animations);
  else Reflect.deleteProperty(document, "getAnimations");
  vi.restoreAllMocks();
});

function options(runtimeOwnedNodes = new Set<Node>()) {
  return {
    document,
    authoredRoot: root,
    runtimeOwnedNodes,
    sourceContract: "declarative-only" as const,
    frameIndex: 12,
    fps: 24,
    startTimeSeconds: 1,
    timeoutMs: 200,
  };
}

describe("runNativeCompositionSession", () => {
  it("renders synchronized source time before restoring the native clock", async () => {
    const order: string[] = [];
    const value = await runNativeCompositionSession(options(), {
      suspend: () => {
        order.push("suspend");
        return "original-clock";
      },
      invalidateSources: () => order.push("invalidate"),
      render: async (time, signal) => {
        expect(signal.aborted).toBe(false);
        expect(time).toBe(1.5);
        order.push("render");
        return { rendered: 1 };
      },
      consume: async (rendered, frame) => {
        expect(frame.signal.aborted).toBe(false);
        expect(frame.timeSeconds).toBe(1.5);
        order.push("consume");
        return rendered;
      },
      restore: (snapshot) => {
        expect(snapshot).toBe("original-clock");
        order.push("restore");
      },
      hold: () => {
        throw new Error("A completed frame must restore playback.");
      },
    });
    expect(value).toMatchObject({ timeSeconds: 1.5, value: { rendered: 1 } });
    expect(order).toEqual(["suspend", "render", "consume", "restore"]);
  });

  it("invalidates only around an authored clock seek and its restoration", async () => {
    const moving = document.createElement("div");
    root.append(moving);
    let time = 25;
    let state: AnimationPlayState = "running";
    const animation = {
      effect: {
        target: moving,
        getComputedTiming: () => ({ endTime: 5000 }),
      },
      timeline: document.timeline,
      playbackRate: 1,
      get currentTime() {
        return time;
      },
      set currentTime(value: number | null) {
        time = value ?? 0;
      },
      get playState() {
        return state;
      },
      ready: Promise.resolve(),
      pause: () => {
        state = "paused";
      },
      play: () => {
        state = "running";
      },
      finish: () => {
        state = "finished";
      },
    };
    Object.defineProperty(document, "getAnimations", {
      configurable: true,
      value: () => [animation as unknown as Animation],
    });
    const order: string[] = [];
    await runNativeCompositionSession(options(), {
      suspend: () => "saved",
      invalidateSources: () => order.push("invalidate"),
      render: async () => {
        order.push("render");
        return 1;
      },
      consume: async (value) => {
        order.push("consume");
        return value;
      },
      restore: () => {
        order.push("restore");
      },
      hold: () => {
        throw new Error("A settled clock must restore");
      },
    });
    expect(order).toEqual([
      "invalidate",
      "render",
      "consume",
      "invalidate",
      "restore",
    ]);
    expect(time).toBe(25);
    expect(state).toBe("running");
  });

  it("rejects authored scripts while exempting only actual runtime-owned nodes", async () => {
    const script = document.createElement("script");
    script.type = "text/javascript";
    root.append(script);
    const restore = vi.fn();
    const render = vi.fn(async () => "rendered");
    const hooks = {
      suspend: () => 7,
      invalidateSources: vi.fn(),
      render,
      consume: async (rendered: string) => rendered,
      restore,
      hold: vi.fn(),
    };
    await expect(
      runNativeCompositionSession(options(), hooks),
    ).rejects.toMatchObject({
      code: "composition-scripted-source",
    });
    expect(render).not.toHaveBeenCalled();
    expect(restore).toHaveBeenCalledWith(7);
    const result = await runNativeCompositionSession(
      options(new Set<Node>([script])),
      hooks,
    );
    expect(result.value).toBe("rendered");
  });

  it("restores the native clock after a falsy render rejection", async () => {
    const restore = vi.fn();
    await expect(
      runNativeCompositionSession(options(), {
        suspend: () => "saved",
        invalidateSources: vi.fn(),
        render: async () => {
          throw 0;
        },
        consume: async (rendered: never) => rendered,
        restore,
        hold: vi.fn(),
      }),
    ).rejects.toBe(0);
    expect(restore).toHaveBeenCalledWith("saved");
  });

  it("surfaces a native clock restoration failure", async () => {
    const hold = vi.fn();
    await expect(
      runNativeCompositionSession(options(), {
        suspend: () => 1,
        invalidateSources: vi.fn(),
        render: async () => "ready",
        consume: async (rendered) => rendered,
        restore: () => {
          throw new Error("clock lost");
        },
        hold,
      }),
    ).rejects.toMatchObject({
      code: "composition-restore-failed",
      causes: [expect.any(Error)],
    });
    expect(hold).toHaveBeenCalledOnce();
  });

  it("keeps sought source time until an asynchronous consumer settles", async () => {
    let sourceTime = 137;
    let state: AnimationPlayState = "running";
    const animation = {
      effect: {
        target: root,
        getComputedTiming: () => ({ endTime: 4_000 }),
      },
      timeline: document.timeline,
      playbackRate: 1,
      get currentTime() {
        return sourceTime;
      },
      set currentTime(value: number | null) {
        sourceTime = value ?? 0;
      },
      get playState() {
        return state;
      },
      ready: Promise.resolve(),
      pause: () => {
        state = "paused";
      },
      play: () => {
        state = "running";
      },
      finish: () => {
        state = "finished";
      },
    } as unknown as Animation;
    Object.defineProperty(document, "getAnimations", {
      configurable: true,
      value: () => [animation],
    });
    let entered!: () => void;
    let release!: () => void;
    const consuming = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const restore = vi.fn();
    const pending = runNativeCompositionSession(options(), {
      suspend: () => "native-snapshot",
      invalidateSources: vi.fn(),
      render: async () => {
        expect(sourceTime).toBe(1_500);
        return "native-frame";
      },
      consume: async (rendered, frame) => {
        expect(rendered).toBe("native-frame");
        expect(frame.signal.aborted).toBe(false);
        expect(sourceTime).toBe(1_500);
        entered();
        await released;
        expect(sourceTime).toBe(1_500);
        return "consumed";
      },
      restore,
      hold: vi.fn(),
    });
    await consuming;
    expect(restore).not.toHaveBeenCalled();
    expect(sourceTime).toBe(1_500);
    release();
    await expect(pending).resolves.toMatchObject({ value: "consumed" });
    expect(sourceTime).toBe(137);
    expect(restore).toHaveBeenCalledWith("native-snapshot");
  });

  it("restores authored and native clocks after consumer failure or cancellation", async () => {
    const restore = vi.fn();
    await expect(
      runNativeCompositionSession(options(), {
        suspend: () => "before",
        invalidateSources: vi.fn(),
        render: async () => "rendered",
        consume: async () => {
          throw new Error("consumer failed");
        },
        restore,
        hold: vi.fn(),
      }),
    ).rejects.toThrow("consumer failed");
    expect(restore).toHaveBeenCalledWith("before");

    const controller = new AbortController();
    let entered!: () => void;
    let release!: () => void;
    const consuming = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = runNativeCompositionSession(
      { ...options(), signal: controller.signal },
      {
        suspend: () => "before-cancel",
        invalidateSources: vi.fn(),
        render: async () => "rendered",
        consume: async () => {
          entered();
          await released;
          return "late";
        },
        restore,
        hold: vi.fn(),
      },
    );
    await consuming;
    controller.abort();
    expect(restore).not.toHaveBeenCalledWith("before-cancel");
    release();
    await expect(pending).rejects.toMatchObject({
      code: "composition-aborted",
    });
    expect(restore).toHaveBeenCalledWith("before-cancel");
  });

  it("keeps thrown undefined values as explicit restoration causes", async () => {
    let captured: unknown;
    try {
      await runNativeCompositionSession(options(), {
        suspend: () => 1,
        invalidateSources: vi.fn(),
        render: async () => "rendered",
        consume: async () => {
          throw undefined;
        },
        restore: () => {
          throw new Error("restore failed");
        },
        hold: () => {
          throw undefined;
        },
      });
    } catch (error) {
      captured = error;
    }
    expect(captured).toMatchObject({ code: "composition-restore-failed" });
    expect((captured as { causes: unknown[] }).causes).toHaveLength(3);
    expect((captured as { causes: unknown[] }).causes[0]).toBeUndefined();
    expect((captured as { causes: unknown[] }).causes[2]).toBeUndefined();
  });
});
