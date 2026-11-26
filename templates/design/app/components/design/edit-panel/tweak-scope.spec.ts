// @vitest-environment happy-dom

import type { TweakDefinition } from "@shared/api";
import { describe, expect, it } from "vitest";

import {
  tweakTargetsForSelection,
  tweaksForSelection,
  type TweakSelectionTarget,
} from "./tweak-scope";

const SCREEN_HTML = `<!doctype html><html><body>
  <section data-agent-native-node-id="hero">
    <canvas data-agent-native-node-id="wave" class="wave"></canvas>
    <h1 data-agent-native-node-id="title">Title</h1>
  </section>
  <footer data-agent-native-node-id="footer"></footer>
</body></html>`;

function tweak(id: string, scope?: TweakDefinition["scope"]): TweakDefinition {
  return {
    id,
    label: id,
    type: "slider",
    defaultValue: 1,
    cssVar: `--${id}`,
    ...(scope ? { scope } : {}),
  };
}

const TWEAKS = [
  tweak("global"),
  tweak("wave-speed", { screenId: "home", nodeId: "wave" }),
  tweak("other-screen", { screenId: "pricing" }),
];

function shown(targets: TweakSelectionTarget[]): string[] {
  return tweaksForSelection(TWEAKS, targets, (screenId) =>
    screenId === "home" ? SCREEN_HTML : undefined,
  ).map((t) => t.id);
}

describe("tweaksForSelection", () => {
  it("shows the scoped knob for the element, its ancestors, and the screen", () => {
    expect(
      shown([{ screenId: "home", element: { sourceId: "wave" } }]),
    ).toEqual(["global", "wave-speed"]);
    expect(
      shown([{ screenId: "home", element: { sourceId: "hero" } }]),
    ).toEqual(["global", "wave-speed"]);
    expect(shown([{ screenId: "home" }])).toEqual(["global", "wave-speed"]);
  });

  it("hides the scoped knob for siblings and unrelated elements", () => {
    expect(
      shown([{ screenId: "home", element: { sourceId: "title" } }]),
    ).toEqual(["global"]);
    expect(
      shown([{ screenId: "home", element: { sourceId: "footer" } }]),
    ).toEqual(["global"]);
  });

  it("keeps screen-scoped knobs on their screen", () => {
    expect(shown([{ screenId: "pricing" }])).toEqual([
      "global",
      "other-screen",
    ]);
  });

  it("matches by selector and one hop when the screen has no document", () => {
    const urlTweaks = [tweak("glow", { selector: ".hero-canvas" })];
    const pick = (target: TweakSelectionTarget) =>
      tweaksForSelection(urlTweaks, [target], () => undefined).length;
    expect(
      pick({ screenId: "url", element: { selector: ".hero-canvas" } }),
    ).toBe(1);
    expect(
      pick({
        screenId: "url",
        element: {
          selector: ".hero-canvas > span",
          parentAutoLayout: {
            selector: ".hero-canvas",
            boundingRect: { x: 0, y: 0, width: 1, height: 1 },
          },
        },
      }),
    ).toBe(1);
    expect(pick({ screenId: "url", element: { selector: ".nav" } })).toBe(0);
  });

  it("shows nothing with no selection", () => {
    expect(shown([])).toEqual([]);
  });

  it("keeps a node-scoped knob without a screen id to the screens that have the node", () => {
    const unscopedToScreen = [tweak("hero-glow", { nodeId: "wave" })];
    const shownOn = (screenId: string) =>
      tweaksForSelection(unscopedToScreen, [{ screenId }], (id) =>
        id === "home" ? SCREEN_HTML : "<html><body></body></html>",
      ).map((t) => t.id);

    expect(shownOn("home")).toEqual(["hero-glow"]);
    expect(shownOn("pricing")).toEqual([]);
  });

  it("does not show a node-scoped knob without a screen id on a screen it cannot check", () => {
    expect(
      tweaksForSelection(
        [tweak("hero-glow", { nodeId: "wave" })],
        [{ screenId: "url-screen" }],
        () => undefined,
      ),
    ).toEqual([]);
  });

  it("shows a shared knob on every screen in its scope list and hides it for siblings", () => {
    const shared = [
      tweak("sail-speed", [
        { screenId: "home", nodeId: "wave" },
        { screenId: "explainer-1" },
        { screenId: "url", selector: ".hero-canvas" },
      ]),
    ];
    const shownOn = (target: TweakSelectionTarget) =>
      tweaksForSelection(shared, [target], (id) =>
        id === "home" ? SCREEN_HTML : undefined,
      ).length;

    expect(shownOn({ screenId: "home", element: { sourceId: "wave" } })).toBe(
      1,
    );
    expect(shownOn({ screenId: "explainer-1" })).toBe(1);
    expect(
      shownOn({ screenId: "url", element: { selector: ".hero-canvas" } }),
    ).toBe(1);
    expect(shownOn({ screenId: "home", element: { sourceId: "title" } })).toBe(
      0,
    );
    expect(shownOn({ screenId: "original" })).toBe(0);
  });
});

describe("tweakTargetsForSelection", () => {
  it("uses the active screen only when the screen itself is selected", () => {
    expect(
      tweakTargetsForSelection({ elements: [], screenId: "screen-a" }),
    ).toEqual([{ screenId: "screen-a" }]);
    expect(
      tweakTargetsForSelection({ elements: [{}], screenId: "screen-a" }),
    ).toEqual([]);
  });

  it("keeps each selected element's owning screen with the inspector fallback", () => {
    expect(
      tweakTargetsForSelection({
        elements: [
          { sourceId: "selected" },
          {
            sourceId: "remote",
            sourceLayerIdentity: { screenId: "screen-b", nodeId: "remote" },
          },
        ],
        fallbackScreenId: "screen-a",
        screenId: "screen-a",
      }),
    ).toEqual([
      { screenId: "screen-a", element: { sourceId: "selected" } },
      {
        screenId: "screen-b",
        element: {
          sourceId: "remote",
          sourceLayerIdentity: { screenId: "screen-b", nodeId: "remote" },
        },
      },
    ]);
  });
});
