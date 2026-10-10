// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NativeEmbeddedAssetRegistryError } from "../../../../shared/native-embedded-assets";
import {
  NativeCompositionClockError,
  withNativeCompositionFrame,
} from "./native-composition-clock";

let root: HTMLElement;
let originalFonts: PropertyDescriptor | undefined;
let originalAnimations: PropertyDescriptor | undefined;

beforeEach(() => {
  root = document.createElement("main");
  document.body.append(root);
  originalFonts = Object.getOwnPropertyDescriptor(document, "fonts");
  originalAnimations = Object.getOwnPropertyDescriptor(
    document,
    "getAnimations",
  );
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
  if (originalFonts) Object.defineProperty(document, "fonts", originalFonts);
  else Reflect.deleteProperty(document, "fonts");
  if (originalAnimations)
    Object.defineProperty(document, "getAnimations", originalAnimations);
  else Reflect.deleteProperty(document, "getAnimations");
  vi.restoreAllMocks();
});

function frame(frameIndex: number, fps = 60, signal?: AbortSignal) {
  return {
    document,
    authoredRoot: root,
    sourceContract: "declarative-only" as const,
    frameIndex,
    fps,
    signal,
    timeoutMs: 200,
  };
}

function authoredAnimation(target: Element, rate = 2) {
  let time = 137;
  let state: AnimationPlayState = "running";
  const timing = { delay: -250, iterations: 3, direction: "alternate" };
  const animation = {
    effect: {
      target,
      getTiming: () => timing,
      getComputedTiming: () => ({ endTime: 4000 }),
      updateTiming: () => {
        throw new Error(
          "The authored delay and iterations must remain intact.",
        );
      },
    },
    timeline: document.timeline,
    playbackRate: rate,
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
    pause: vi.fn(() => {
      state = "paused";
    }),
    play: vi.fn(() => {
      state = "running";
    }),
    finish: vi.fn(() => {
      state = "finished";
    }),
  };
  Object.defineProperty(document, "getAnimations", {
    configurable: true,
    value: () => [animation as unknown as Animation],
  });
  return { animation, timing };
}

function authoredVideo() {
  const video = document.createElement("video");
  root.append(video);
  let time = 0.4;
  let paused = false;
  let seeking = false;
  let rate = 1.25;
  Object.defineProperties(video, {
    currentSrc: {
      configurable: true,
      value: `${document.location.origin}/owned-video.mp4`,
    },
    currentTime: {
      configurable: true,
      get: () => time,
      set: (value: number) => {
        time = value;
        seeking = true;
        queueMicrotask(() => {
          seeking = false;
          video.dispatchEvent(new Event("seeked"));
        });
      },
    },
    paused: { configurable: true, get: () => paused },
    seeking: { configurable: true, get: () => seeking },
    readyState: {
      configurable: true,
      get: () => 2,
    },
    seekable: {
      configurable: true,
      value: { length: 1, start: () => 0, end: () => 10 },
    },
    duration: { configurable: true, value: 10 },
    playbackRate: {
      configurable: true,
      get: () => rate,
      set: (value: number) => {
        rate = value;
      },
    },
    loop: { configurable: true, value: false },
    srcObject: { configurable: true, value: null },
    pause: {
      configurable: true,
      value: vi.fn(() => {
        paused = true;
      }),
    },
    play: {
      configurable: true,
      value: vi.fn(async () => {
        paused = false;
      }),
    },
  });
  return video;
}

describe("native composition clock", () => {
  it("seeks rational frame time through authored animation rate and video, then restores playback", async () => {
    const moving = document.createElement("div");
    root.append(moving);
    const { animation, timing } = authoredAnimation(moving);
    const video = authoredVideo();
    const onSourceClockChange = vi.fn();

    const result = await withNativeCompositionFrame(
      { ...frame(90), onSourceClockChange },
      ({ timeSeconds }) => {
        expect(timeSeconds).toBe(1.5);
        expect(animation.currentTime).toBe(3000);
        expect(animation.playState).toBe("paused");
        expect(animation.effect.getTiming()).toBe(timing);
        expect(video.currentTime).toBe(1.875);
        expect(video.paused).toBe(true);
        return "frame-ready";
      },
    );

    expect(result).toMatchObject({
      frameIndex: 90,
      fps: 60,
      timeSeconds: 1.5,
      value: "frame-ready",
    });
    expect(animation.currentTime).toBe(137);
    expect(animation.playState).toBe("running");
    expect(video.currentTime).toBe(0.4);
    expect(video.paused).toBe(false);
    expect(video.playbackRate).toBe(1.25);
    expect(onSourceClockChange).toHaveBeenCalledTimes(2);
  });

  it("uses frame index divided by fps without accumulating prior frame rounding", async () => {
    const observed: number[] = [];
    const onSourceClockChange = vi.fn();
    for (const index of [0, 1, 179]) {
      await withNativeCompositionFrame(
        { ...frame(index), onSourceClockChange },
        ({ timeSeconds }) => {
          observed.push(timeSeconds);
        },
      );
    }
    expect(observed).toEqual([0, 1 / 60, 179 / 60]);
    expect(onSourceClockChange).not.toHaveBeenCalled();
  });

  it("invalidates again after a rejected dynamic frame restores the authored clock", async () => {
    const moving = document.createElement("div");
    root.append(moving);
    const { animation } = authoredAnimation(moving);
    const onSourceClockChange = vi.fn();
    await expect(
      withNativeCompositionFrame({ ...frame(30), onSourceClockChange }, () => {
        throw new Error("render failed");
      }),
    ).rejects.toThrow("render failed");
    expect(onSourceClockChange).toHaveBeenCalledTimes(2);
    expect(animation.currentTime).toBe(137);
    expect(animation.playState).toBe("running");
  });

  it("adds a bounded segment start before rational frame time", async () => {
    const result = await withNativeCompositionFrame(
      { ...frame(30), startTimeSeconds: 12.25 },
      ({ timeSeconds }) => timeSeconds,
    );
    expect(result.timeSeconds).toBe(12.75);
    expect(result.startTimeSeconds).toBe(12.25);
  });

  it("rejects a root from another document and overlapping frame ownership", async () => {
    const foreign = document.implementation.createHTMLDocument("foreign");
    const foreignRoot = foreign.createElement("main");
    foreign.body.append(foreignRoot);
    await expect(
      withNativeCompositionFrame(
        { ...frame(0), authoredRoot: foreignRoot },
        () => "unreachable",
      ),
    ).rejects.toMatchObject({ code: "composition-source-contract" });

    let release!: (value: string) => void;
    const first = withNativeCompositionFrame(
      frame(0),
      () => new Promise<string>((resolve) => (release = resolve)),
    );
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await expect(
      withNativeCompositionFrame(frame(1), () => "unreachable"),
    ).rejects.toMatchObject({ code: "composition-busy" });
    release("first-complete");
    expect((await first).value).toBe("first-complete");
    expect(
      (await withNativeCompositionFrame(frame(1), () => "next-complete")).value,
    ).toBe("next-complete");
  });

  it("uses the finite effect end for reverse playback and holds an authored pause", async () => {
    const moving = document.createElement("div");
    root.append(moving);
    const { animation } = authoredAnimation(moving, -1);
    await withNativeCompositionFrame(frame(60), () => {
      expect(animation.currentTime).toBe(3000);
    });
    animation.pause();
    animation.currentTime = 620;
    await withNativeCompositionFrame(frame(120), () => {
      expect(animation.currentTime).toBe(620);
    });
    expect(animation.currentTime).toBe(620);
    expect(animation.playState).toBe("paused");
  });

  it("restores animation and media state after render rejection", async () => {
    const moving = document.createElement("div");
    root.append(moving);
    const { animation } = authoredAnimation(moving);
    const video = authoredVideo();
    await expect(
      withNativeCompositionFrame(frame(60), () => {
        throw new Error("native render rejected");
      }),
    ).rejects.toThrow("native render rejected");
    expect(animation.currentTime).toBe(137);
    expect(animation.playState).toBe("running");
    expect(video.currentTime).toBe(0.4);
    expect(video.paused).toBe(false);
  });

  it.each([undefined, null, false, 0])(
    "preserves falsy render rejection %s",
    async (rejection) => {
      const notCaught = Symbol("not caught");
      let caught: unknown = notCaught;
      try {
        await withNativeCompositionFrame(frame(0), () =>
          Promise.reject(rejection),
        );
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe(rejection);
    },
  );

  it("aborts a pending font wait and restores both playback states", async () => {
    const moving = document.createElement("div");
    root.append(moving);
    const { animation } = authoredAnimation(moving);
    const video = authoredVideo();
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { ready: new Promise<never>(() => {}), status: "loading" },
    });
    const controller = new AbortController();
    const pending = withNativeCompositionFrame(
      frame(30, 60, controller.signal),
      () => Promise.resolve("unreachable"),
    );
    queueMicrotask(() => controller.abort());
    await expect(pending).rejects.toMatchObject({
      code: "composition-aborted",
    });
    expect(animation.currentTime).toBe(137);
    expect(animation.playState).toBe("running");
    expect(video.currentTime).toBe(0.4);
    expect(video.paused).toBe(false);
  });

  it("waits for a cancelled render to quiesce before restoring authored motion", async () => {
    const moving = document.createElement("div");
    root.append(moving);
    const { animation } = authoredAnimation(moving);
    const controller = new AbortController();
    const pending = withNativeCompositionFrame(
      frame(30, 60, controller.signal),
      ({ signal }) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("stopped")), {
            once: true,
          });
        }),
    );
    await vi.waitFor(() => expect(animation.playState).toBe("paused"));
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      code: "composition-aborted",
    });
    expect(animation.currentTime).toBe(137);
    expect(animation.playState).toBe("running");
  });

  it("keeps document ownership locked until an uncooperative render settles", async () => {
    const moving = document.createElement("div");
    root.append(moving);
    const { animation } = authoredAnimation(moving);
    const controller = new AbortController();
    let release!: (value: string) => void;
    const pending = withNativeCompositionFrame(
      { ...frame(30, 60, controller.signal), quiesceTimeoutMs: 15 },
      () => new Promise<string>((resolve) => (release = resolve)),
    );
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    controller.abort();
    await expect(pending).rejects.toMatchObject({
      code: "composition-render-unsettled",
    });
    expect(animation.playState).toBe("paused");
    await expect(
      withNativeCompositionFrame(frame(31), () => "unreachable"),
    ).rejects.toMatchObject({ code: "composition-busy" });
    release("late");
    await vi.waitFor(() => expect(animation.playState).toBe("running"));
    expect(
      (await withNativeCompositionFrame(frame(31), () => "safe-next")).value,
    ).toBe("safe-next");
  });

  it("rejects undecoded media and restores playback", async () => {
    const video = authoredVideo();
    let reads = 0;
    Object.defineProperty(video, "readyState", {
      configurable: true,
      get: () => (++reads === 2 ? 1 : 2),
    });
    await expect(
      withNativeCompositionFrame(frame(60), () => "unreachable"),
    ).rejects.toMatchObject({ code: "composition-media-undecoded" });
    expect(video.currentTime).toBe(0.4);
    expect(video.paused).toBe(false);
  });

  it("times out a video whose requested seek never completes and restores playback", async () => {
    const video = authoredVideo();
    let time = 0.4;
    let writes = 0;
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      get: () => time,
      set: (value: number) => {
        time = value;
        writes += 1;
        if (writes === 2)
          queueMicrotask(() => video.dispatchEvent(new Event("seeked")));
      },
    });
    await expect(
      withNativeCompositionFrame(
        { ...frame(60), timeoutMs: 15 },
        () => "unreachable",
      ),
    ).rejects.toMatchObject({ code: "composition-timeout" });
    expect(video.currentTime).toBe(0.4);
    expect(video.paused).toBe(false);
  });

  it("rejects a transition with no deterministic frame zero before changing it", async () => {
    const moving = document.createElement("div");
    root.append(moving);
    const { animation } = authoredAnimation(moving);
    Object.assign(animation, { transitionProperty: "left" });
    await expect(
      withNativeCompositionFrame(frame(60), () => "unreachable"),
    ).rejects.toMatchObject({ code: "composition-animation-unseekable" });
    expect(animation.currentTime).toBe(137);
    expect(animation.playState).toBe("running");
  });

  it("rejects an animation with ambiguous source ownership", async () => {
    Object.defineProperty(document, "getAnimations", {
      configurable: true,
      value: () => [
        { effect: { getComputedTiming: () => ({ endTime: 1000 }) } },
      ],
    });
    await expect(
      withNativeCompositionFrame(frame(0), () => "unreachable"),
    ).rejects.toMatchObject({ code: "composition-animation-unseekable" });
  });

  it("rejects authored canvas, scripts, and remote media before reporting a frame", async () => {
    const canvas = document.createElement("canvas");
    root.append(canvas);
    await expect(
      withNativeCompositionFrame(frame(0), () => "unreachable"),
    ).rejects.toMatchObject({ code: "composition-canvas-source" });
    canvas.remove();

    const script = document.createElement("script");
    root.append(script);
    await expect(
      withNativeCompositionFrame(frame(0), () => "unreachable"),
    ).rejects.toMatchObject({ code: "composition-scripted-source" });
    script.remove();

    const video = authoredVideo();
    Object.defineProperty(video, "currentSrc", {
      configurable: true,
      value: "https://example.invalid/remote.mp4",
    });
    await expect(
      withNativeCompositionFrame(frame(0), () => "unreachable"),
    ).rejects.toMatchObject({ code: "composition-media-cross-origin" });
    expect(video.paused).toBe(false);
  });

  it("accepts only schema-valid inert export approvals without trusting executable scripts", async () => {
    const approvals = document.createElement("script");
    approvals.type = "application/x-agent-native-effect-approvals";
    approvals.textContent = JSON.stringify({
      schemaVersion: 1,
      hashes: ["a".repeat(64)],
    });
    root.append(approvals);
    expect(
      (await withNativeCompositionFrame(frame(0), () => "ready")).value,
    ).toBe("ready");

    approvals.textContent = '{"schemaVersion":1,"hashes":["bad"]}';
    await expect(
      withNativeCompositionFrame(frame(0), () => "unreachable"),
    ).rejects.toMatchObject({ code: "composition-source-contract" });

    approvals.textContent = JSON.stringify({
      schemaVersion: 1,
      hashes: ["a".repeat(64)],
      executable: true,
    });
    await expect(
      withNativeCompositionFrame(frame(0), () => "unreachable"),
    ).rejects.toMatchObject({ code: "composition-source-contract" });

    approvals.type = "text/javascript";
    await expect(
      withNativeCompositionFrame(frame(0), () => "unreachable"),
    ).rejects.toMatchObject({ code: "composition-scripted-source" });
  });

  it("accepts only bounded inert embedded raster metadata in a declarative frame", async () => {
    const assets = document.createElement("script");
    assets.type = "application/x-agent-native-effect-assets";
    assets.setAttribute("data-agent-native-export-assets", "");
    assets.textContent = JSON.stringify({
      schemaVersion: 1,
      assets: [
        {
          path: "/shaders/coverage.png",
          mimeType: "image/png",
          byteLength: 1,
          sha256: "0".repeat(64),
          base64: "AA==",
        },
      ],
    });
    root.append(assets);
    await expect(
      withNativeCompositionFrame(frame(0), () => "ready"),
    ).resolves.toMatchObject({ value: "ready" });
    assets.setAttribute("data-extra", "untrusted");
    await expect(
      withNativeCompositionFrame(frame(0), () => "never"),
    ).rejects.toMatchObject({ code: "composition-source-contract" });
    assets.removeAttribute("data-extra");
    assets.textContent =
      '{"schemaVersion":1,"assets":[{"path":"/bad","base64":"!"}]}';
    await expect(
      withNativeCompositionFrame(frame(0), () => "never"),
    ).rejects.toMatchObject({ code: "composition-source-contract" });
  });

  it("keeps a prepared raster registry intact through consecutive PNG and MP4 clock frames", async () => {
    const entry = {
      path: "/api/design-native-texture/00000000-0000-4000-8000-000000000000.png",
      mimeType: "image/png",
      byteLength: 137,
      sha256:
        "b5d466547546522cc582be9d6f3b5d76c28cfd8963f70551ca0a56dd91cec86d",
      base64:
        "iVBORw0KGgoAAAANSUhEUgAAAEAAAAAgCAYAAACinX6EAAAAUElEQVR42u3QQQ0AIAwAsclBBGKQggAk8pgTEEH2Ib3kDDRmcXv1U3kb+XQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/wNcLUK4D+nGW4EAAAAASUVORK5CYII=",
    };
    const assets = document.createElement("script");
    assets.type = "application/x-agent-native-effect-assets";
    assets.setAttribute("data-agent-native-export-assets", "");
    const text = JSON.stringify({ schemaVersion: 1, assets: [entry] });
    expect(text).toHaveLength(421);
    assets.textContent = text;
    root.append(assets);
    for (const frameIndex of [0, 1, 59]) {
      await expect(
        withNativeCompositionFrame(
          frame(frameIndex),
          ({ timeSeconds }) => timeSeconds,
        ),
      ).resolves.toMatchObject({ value: frameIndex / 60 });
      expect(assets.textContent).toBe(text);
      expect([...assets.attributes].map(({ name }) => name).sort()).toEqual([
        "data-agent-native-export-assets",
        "type",
      ]);
    }
  });

  it("reports the embedded attribute boundary without exposing attribute values", async () => {
    const assets = document.createElement("script");
    assets.type = "application/x-agent-native-effect-assets";
    assets.setAttribute("data-agent-native-export-assets", "");
    assets.setAttribute("data-extra", "private-attribute-value");
    assets.textContent = '{"schemaVersion":1,"assets":[]}';
    root.append(assets);
    const caught = await withNativeCompositionFrame(
      frame(0),
      () => "never",
    ).catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(NativeCompositionClockError);
    const error = caught as NativeCompositionClockError;
    expect(error.code).toBe("composition-source-contract");
    expect(error.message).toBe(
      "The inert embedded asset registry is unreadable. (embedded-attributes:type-error)",
    );
    expect(error.causes).toHaveLength(1);
    expect(error.causes[0]).toBeInstanceOf(TypeError);
    expect(String(error)).not.toContain("private-attribute-value");
  });

  it.each([
    ["registry-malformed", { schemaVersion: 2, assets: [] }],
    ["registry-limit", { schemaVersion: 1, assets: Array(17).fill({}) }],
    [
      "registry-path",
      {
        schemaVersion: 1,
        assets: [
          {
            path: "https://example.invalid/private.png",
            mimeType: "image/png",
            byteLength: 1,
            sha256: "0".repeat(64),
            base64: "AA==",
          },
        ],
      },
    ],
    [
      "registry-mime",
      {
        schemaVersion: 1,
        assets: [
          {
            path: "/private.png",
            mimeType: "text/html",
            byteLength: 1,
            sha256: "0".repeat(64),
            base64: "AA==",
          },
        ],
      },
    ],
    [
      "registry-duplicate",
      {
        schemaVersion: 1,
        assets: Array(2).fill({
          path: "/private.png",
          mimeType: "image/png",
          byteLength: 1,
          sha256: "0".repeat(64),
          base64: "AA==",
        }),
      },
    ],
  ] as const)(
    "preserves the typed %s parser refusal in an observable bounded clock diagnostic",
    async (code, value) => {
      const assets = document.createElement("script");
      assets.type = "application/x-agent-native-effect-assets";
      assets.setAttribute("data-agent-native-export-assets", "");
      assets.textContent = JSON.stringify(value);
      root.append(assets);
      const caught = await withNativeCompositionFrame(
        frame(0),
        () => "never",
      ).catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(NativeCompositionClockError);
      const error = caught as NativeCompositionClockError;
      expect(error.code).toBe("composition-source-contract");
      expect(error.message).toBe(
        `The inert embedded asset registry is unreadable. (embedded-registry:${code})`,
      );
      expect(error.causes).toHaveLength(1);
      expect(error.causes[0]).toBeInstanceOf(NativeEmbeddedAssetRegistryError);
      expect(error.causes[0]).toMatchObject({ code });
      expect(String(error)).not.toContain("private.png");
      expect(String(error)).not.toContain("AA==");
    },
  );

  it.each([
    [new ReferenceError("private-registry-body"), "reference-error"],
    [new RangeError("private-registry-body"), "range-error"],
    [new TypeError("private-registry-body"), "type-error"],
    [new Error("private-registry-body"), "unexpected-error"],
    [
      { code: "private-registry-body", message: "secret".repeat(1000) },
      "unknown-error",
    ],
  ] as const)(
    "retains an unexpected inert read cause without leaking its payload",
    async (cause, category) => {
      const assets = document.createElement("script");
      assets.type = "application/x-agent-native-effect-assets";
      assets.setAttribute("data-agent-native-export-assets", "");
      Object.defineProperty(assets, "textContent", {
        get: () => {
          throw cause;
        },
      });
      root.append(assets);
      const caught = await withNativeCompositionFrame(
        frame(0),
        () => "never",
      ).catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(NativeCompositionClockError);
      const error = caught as NativeCompositionClockError;
      expect(error.code).toBe("composition-source-contract");
      expect(error.message).toBe(
        `The inert embedded asset registry is unreadable. (embedded-registry:${category})`,
      );
      expect(error.causes).toEqual([cause]);
      expect(String(error)).not.toContain("private-registry-body");
      expect(String(error)).not.toContain("secret");
      expect(String(error).length).toBeLessThan(160);
    },
  );

  it.each([
    [
      "application/x-agent-native-effect-approvals",
      undefined,
      "approval-record",
      "The inert native effect approval record is unreadable.",
    ],
    [
      "text/plain",
      "data-agent-native-export-font-licenses",
      "font-license-record",
      "The inert export font-license record is unreadable.",
    ],
  ] as const)(
    "reports an inert sibling JSON refusal without serializing malformed input",
    async (type, marker, boundary, prefix) => {
      const script = document.createElement("script");
      script.type = type;
      if (marker) script.setAttribute(marker, "");
      script.textContent = "private-malformed-json-input";
      root.append(script);
      const caught = await withNativeCompositionFrame(
        frame(0),
        () => "never",
      ).catch((error: unknown) => error);
      expect(caught).toBeInstanceOf(NativeCompositionClockError);
      const error = caught as NativeCompositionClockError;
      expect(error.code).toBe("composition-source-contract");
      expect(error.message).toBe(`${prefix} (${boundary}:invalid-json)`);
      expect(error.causes).toHaveLength(1);
      expect(error.causes[0]).toBeInstanceOf(SyntaxError);
      expect(String(error)).not.toContain("private-malformed-json-input");
    },
  );

  it("rejects event handlers even on otherwise inert native records", async () => {
    const approvals = document.createElement("script");
    approvals.type = "application/x-agent-native-effect-approvals";
    approvals.textContent = JSON.stringify({ schemaVersion: 1, hashes: [] });
    approvals.setAttribute("onclick", "window.untrusted = true");
    root.append(approvals);
    await expect(
      withNativeCompositionFrame(frame(0), () => "unreachable"),
    ).rejects.toMatchObject({ code: "composition-scripted-source" });

    approvals.remove();
    const manifest = document.createElement("script");
    manifest.type = "application/x-agent-native-effects";
    manifest.textContent = "{}";
    manifest.setAttribute("onload", "window.untrusted = true");
    root.append(manifest);
    await expect(
      withNativeCompositionFrame(frame(0), () => "unreachable"),
    ).rejects.toMatchObject({ code: "composition-scripted-source" });
  });

  it("accepts only bounded inert export font-license metadata", async () => {
    const licenses = document.createElement("script");
    licenses.type = "text/plain";
    licenses.setAttribute("data-agent-native-export-font-licenses", "");
    licenses.textContent = JSON.stringify([
      { path: "/fonts/display.woff2", text: "Example font copyright" },
    ]);
    root.append(licenses);
    expect(
      (await withNativeCompositionFrame(frame(0), () => "ready")).value,
    ).toBe("ready");

    licenses.setAttribute("onload", "window.untrusted = true");
    await expect(
      withNativeCompositionFrame(frame(0), () => "unreachable"),
    ).rejects.toMatchObject({ code: "composition-scripted-source" });
    licenses.removeAttribute("onload");

    licenses.textContent = JSON.stringify([
      { path: "/font", text: "ok", js: true },
    ]);
    await expect(
      withNativeCompositionFrame(frame(0), () => "unreachable"),
    ).rejects.toMatchObject({ code: "composition-source-contract" });

    licenses.textContent = "not JSON";
    await expect(
      withNativeCompositionFrame(frame(0), () => "unreachable"),
    ).rejects.toMatchObject({ code: "composition-source-contract" });

    licenses.textContent = "[]";
    licenses.setAttribute("src", "/untrusted.js");
    await expect(
      withNativeCompositionFrame(frame(0), () => "unreachable"),
    ).rejects.toMatchObject({ code: "composition-source-contract" });
  });

  it("does not seek or reject native presentation canvases", async () => {
    const presentation = document.createElement("canvas");
    presentation.setAttribute("data-an-native-presentation", "");
    root.append(presentation);
    expect(
      await withNativeCompositionFrame(
        { ...frame(0), runtimeOwnedNodes: new Set([presentation]) },
        () => "ready",
      ),
    ).toMatchObject({
      value: "ready",
    });
  });

  it("rejects invalid frame bounds and missing source contract", async () => {
    await expect(
      withNativeCompositionFrame(frame(-1), () => "unreachable"),
    ).rejects.toBeInstanceOf(NativeCompositionClockError);
    await expect(
      withNativeCompositionFrame(
        { ...frame(1), startTimeSeconds: 3_600 },
        () => "unreachable",
      ),
    ).rejects.toMatchObject({ code: "composition-invalid-frame" });
    await expect(
      withNativeCompositionFrame(
        { ...frame(1), sourceContract: "unknown" as "declarative-only" },
        () => "unreachable",
      ),
    ).rejects.toMatchObject({ code: "composition-source-contract" });
  });

  it("reports both render failure and failed video restoration", async () => {
    const video = authoredVideo();
    let time = 0.4;
    let writes = 0;
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      get: () => time,
      set: (value: number) => {
        time = value;
        writes += 1;
        if (writes === 1)
          queueMicrotask(() => video.dispatchEvent(new Event("seeked")));
      },
    });
    let error: unknown;
    try {
      await withNativeCompositionFrame(frame(60), () => Promise.reject(false));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(NativeCompositionClockError);
    expect(error).toMatchObject({ code: "composition-restore-failed" });
    const causes = (error as NativeCompositionClockError).causes;
    expect(causes[0]).toBe(false);
    expect(
      causes.some(
        (cause) =>
          cause instanceof NativeCompositionClockError &&
          cause.code === "composition-timeout",
      ),
    ).toBe(true);
    await expect(
      withNativeCompositionFrame(frame(61), () => "unreachable"),
    ).rejects.toMatchObject({ code: "composition-restore-failed" });
  });
});
