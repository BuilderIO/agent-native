// @vitest-environment happy-dom

// oracle-change(templates/design/app/components/design/design-canvas/interact-tweak-set.spec.ts): in-frame knobs no longer save, so the editor has no tweak-set listener left to test; this file proves the opposite.
// oracle-change(templates/design/app/components/design/FloatingTweaksPanel.test.tsx): the floating Tweaks panel is removed; the inspector's Tweaks section is the only tweaks surface.
// oracle-change(templates/design/app/components/design/floating-tweaks-layout.test.ts): its layout helper only placed the removed floating Tweaks panel.

import { resolveTweaksToCssVars } from "@shared/resolve-tweaks";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const keepalive = vi.hoisted(() => ({ calls: [] as unknown[] }));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  tryCallActionKeepalive: vi.fn((_name: string, params: unknown) => {
    keepalive.calls.push(params);
    return { accepted: true, completion: new Promise(() => {}) };
  }),
}));
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string) => key,
}));
vi.mock("@/lib/design-save-outbox", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/design-save-outbox")>()),
  journalDesignSaveOutboxEntry: vi.fn(async () => {}),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() },
}));

import {
  useTweaks,
  type UseTweaksResult,
} from "@/pages/design-editor/domains/use-tweaks";

import { DesignCanvas } from "./DesignCanvas";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const TWEAKS = [
  {
    id: "twist",
    label: "Twist",
    type: "slider" as const,
    cssVar: "--sail-twist",
    min: 0,
    max: 1,
    step: 0.05,
    defaultValue: 0.25,
  },
];
const DESIGN = {
  data: JSON.stringify({ tweaks: TWEAKS, tweakSelections: { twist: 0.25 } }),
};
// The Original, the Remix and two explainers, each with its own in-figure
// knob for the shared tweak.
const SCREENS = ["original", "remix", "explainer-1", "explainer-2"];
const SCREEN_HTML = `<!doctype html><html><head><style>:root{--sail-twist:0.25}</style></head>
<body><div id="panel"><input type="range" data-knob="--sail-twist"></div></body></html>`;

let root: Root;
let host: HTMLDivElement;

function mountBoard() {
  const applyTweaksAsync = vi.fn(() => new Promise(() => {}));
  const result = { current: undefined as unknown as UseTweaksResult };
  const args: Parameters<typeof useTweaks>[0] = {
    acknowledgeOutboxEntry: async () => {},
    applyTweaksAsync: applyTweaksAsync as never,
    canEditDesign: true,
    canEditDesignRef: { current: true },
    design: DESIGN,
    designSaveActorScope: "user-1",
    designSaveOperationSourceRef: { current: "tab-a" },
    id: "design-1",
    noteSaveLeftQueued: () => {},
    queryClient: { setQueryData: () => {} } as never,
    t: (key) => key,
    warnChangesWillRetry: () => {},
  };
  // Every screen gets the editor's resolved tweak values and nothing else,
  // as the board does.
  function Board() {
    result.current = useTweaks(args);
    return createElement(
      "div",
      null,
      SCREENS.map((screenId) =>
        createElement(DesignCanvas, {
          key: screenId,
          content: SCREEN_HTML,
          contentKey: `screen:${screenId}`,
          screenId,
          zoom: 100,
          deviceFrame: "none",
          interactMode: true,
          editMode: false,
          registerRuntimeBridge: false,
          onElementSelect: () => {},
          onElementHover: () => {},
          tweakValues: result.current.cssVarValues,
        }),
      ),
    );
  }
  act(() => root.render(createElement(Board)));
  const iframes = Array.from(
    host.querySelectorAll<HTMLIFrameElement>(
      "iframe[data-design-preview-iframe]",
    ),
  );
  expect(iframes).toHaveLength(SCREENS.length);
  const posts = iframes.map((iframe) => {
    const frameWindow = iframe.contentWindow;
    if (!frameWindow) throw new Error("no preview window");
    return { frameWindow, postMessage: vi.spyOn(frameWindow, "postMessage") };
  });
  return { result, applyTweaksAsync, posts };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  keepalive.calls = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Interact knobs on a multi-screen board", () => {
  it("never saves or changes the inspector when a frame's knob moves", async () => {
    const { result, applyTweaksAsync, posts } = mountBoard();
    const before = result.current.cssVarValues;

    // What an in-frame knob sent before knobs became local: the editor must
    // treat it as noise from every frame, with or without a capability.
    for (const { frameWindow } of posts) {
      for (const data of [
        { type: "tweak-set", id: "twist", value: 0.9 },
        { type: "tweak-set", cssVar: "--sail-twist", value: "0.9" },
      ]) {
        act(() => {
          window.dispatchEvent(
            new MessageEvent("message", { data, source: frameWindow }),
          );
        });
      }
    }
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });

    expect(result.current.tweakSelections).toEqual({ twist: 0.25 });
    expect(result.current.cssVarValues).toEqual(before);
    expect(result.current.pendingTweakChanges).toEqual([]);
    expect(applyTweaksAsync).not.toHaveBeenCalled();
    expect(keepalive.calls).toEqual([]);
    // The canvas may re-send values on render; it must never send others.
    for (const { postMessage } of posts) {
      const sent = postMessage.mock.calls
        .map(([message]) => message as { type?: string; values?: unknown })
        .filter((message) => message.type === "tweak-values")
        .map((message) => message.values);
      for (const values of sent) expect(values).toEqual(before);
    }
  });

  it("sends an inspector change to every screen, which resets its knob's starting value", () => {
    const { result, posts } = mountBoard();
    const expected = resolveTweaksToCssVars(TWEAKS, { twist: 0.6 });
    expect(expected["--sail-twist"]).toBeDefined();

    act(() => {
      expect(result.current.handleTweakChange("twist", 0.6)).toEqual({
        accepted: true,
      });
    });

    expect(result.current.cssVarValues).toEqual(expected);
    for (const { postMessage } of posts) {
      expect(postMessage).toHaveBeenCalledWith(
        { type: "tweak-values", values: expected },
        "*",
      );
    }
  });
});
