// @vitest-environment happy-dom

import type { TweakDefinition } from "@shared/api";
import { describe, expect, it, vi } from "vitest";

import {
  createInteractTweakSetListener,
  resolveInteractTweakSet,
} from "./interact-tweak-set";

const SCREEN_HTML = `<!doctype html><html><body>
<div data-agent-native-node-id="explainer"><div data-agent-native-node-id="twist-dial"></div></div>
</body></html>`;

const TWEAKS: TweakDefinition[] = [
  {
    id: "twist",
    label: "Twist",
    type: "slider",
    min: 0,
    max: 2,
    step: 0.05,
    defaultValue: 1,
    cssVar: "--twist",
    scope: [{ screenId: "remix" }, { screenId: "explainer-2" }],
  },
  {
    id: "dial-only",
    label: "Dial",
    type: "slider",
    min: 0,
    max: 10,
    defaultValue: 5,
    cssVar: "--dial",
    scope: { nodeId: "twist-dial" },
  },
  {
    id: "elsewhere",
    label: "Elsewhere",
    type: "slider",
    min: 0,
    max: 1,
    defaultValue: 0,
    cssVar: "--elsewhere",
    scope: { screenId: "remix" },
  },
  {
    id: "mode",
    label: "Mode",
    type: "segment",
    options: [
      { label: "Calm", value: "calm" },
      { label: "Fast", value: "fast" },
    ],
    defaultValue: "calm",
  },
  {
    id: "grain",
    label: "Grain",
    type: "toggle",
    defaultValue: false,
  },
];

function resolve(data: unknown) {
  return resolveInteractTweakSet(data, TWEAKS, "explainer-2", SCREEN_HTML);
}

describe("resolveInteractTweakSet", () => {
  it("accepts a scoped tweak by id or cssVar and clamps it to min, max and step", () => {
    expect(resolve({ type: "tweak-set", id: "twist", value: 1.53 })).toEqual({
      tweakId: "twist",
      value: 1.55,
    });
    expect(
      resolve({ type: "tweak-set", cssVar: "--twist", value: "7deg" }),
    ).toEqual({ tweakId: "twist", value: 2 });
    expect(resolve({ type: "tweak-set", id: "twist", value: -3 })).toEqual({
      tweakId: "twist",
      value: 0,
    });
  });

  it("accepts a node-scoped tweak whose node is on this screen", () => {
    expect(resolve({ type: "tweak-set", id: "dial-only", value: 4 })).toEqual({
      tweakId: "dial-only",
      value: 4,
    });
    expect(
      resolveInteractTweakSet(
        { type: "tweak-set", id: "dial-only", value: 4 },
        TWEAKS,
        "explainer-2",
        "<html><body></body></html>",
      ),
    ).toBeNull();
  });

  it("rejects unknown and out-of-scope tweaks, bad values and other messages", () => {
    expect(resolve({ type: "tweak-set", id: "missing", value: 1 })).toBeNull();
    expect(
      resolve({ type: "tweak-set", cssVar: "--nope", value: 1 }),
    ).toBeNull();
    expect(
      resolve({ type: "tweak-set", id: "elsewhere", value: 1 }),
    ).toBeNull();
    expect(
      resolve({ type: "tweak-set", id: "twist", value: "wide" }),
    ).toBeNull();
    expect(
      resolve({ type: "tweak-set", id: "mode", value: "loud" }),
    ).toBeNull();
    expect(resolve({ type: "tweak-values", id: "twist", value: 1 })).toBeNull();
    expect(resolve(null)).toBeNull();
  });

  it("accepts option and toggle values the inspector could choose", () => {
    expect(resolve({ type: "tweak-set", id: "mode", value: "fast" })).toEqual({
      tweakId: "mode",
      value: "fast",
    });
    expect(resolve({ type: "tweak-set", id: "grain", value: "1" })).toEqual({
      tweakId: "grain",
      value: true,
    });
  });
});

function message(source: unknown, data: unknown): MessageEvent {
  return { source, data } as MessageEvent;
}

describe("createInteractTweakSetListener", () => {
  function setup() {
    const frameWindow = {} as Window;
    const onTweakSet = vi.fn();
    const listener = createInteractTweakSetListener({
      getFrameWindow: () => frameWindow,
      getTweaks: () => TWEAKS,
      screenId: "explainer-2",
      getScreenHtml: () => SCREEN_HTML,
      onTweakSet,
    });
    return { frameWindow, onTweakSet, listener };
  }

  it("writes a tweak-set from its own frame through the tweak setter", () => {
    const { frameWindow, onTweakSet, listener } = setup();
    listener(
      message(frameWindow, { type: "tweak-set", id: "twist", value: 1.53 }),
    );
    expect(onTweakSet).toHaveBeenCalledExactlyOnceWith("twist", 1.55);
  });

  it("ignores tweak-set messages from any other window", () => {
    const { onTweakSet, listener } = setup();
    listener(message({}, { type: "tweak-set", id: "twist", value: 1 }));
    listener(message(null, { type: "tweak-set", id: "twist", value: 1 }));
    expect(onTweakSet).not.toHaveBeenCalled();
  });
});
