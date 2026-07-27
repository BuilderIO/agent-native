import { describe, expect, it } from "vitest";

import {
  applyDesignClipboardManagedStyles,
  extractDesignClipboardManagedStyles,
  isValidDesignClipboardManagedStyleSnapshot,
} from "./design-clipboard-managed-styles";

const SOURCE = `<!doctype html><html><head>
<style data-agent-native-breakpoints>
@media (max-width: 1279px) {
  [data-agent-native-node-id="card"][data-agent-native-node-id="card"] { color: red; padding: 24px; }
  [data-agent-native-node-id="unrelated"][data-agent-native-node-id="unrelated"] { opacity: 0.2; }
}
@media (max-width: 809px) {
  [data-agent-native-node-id="title"][data-agent-native-node-id="title"] { font-size: 22px; }
}
</style>
<style data-agent-native-states>
[data-agent-native-node-id="card"]:hover { background-color: black !important; }
[data-agent-native-node-id="unrelated"]:focus { outline-color: red !important; }
</style>
<style data-agent-native-state-breakpoints>
@media (max-width: 809px) {
  [data-agent-native-node-id="title"][data-agent-native-node-id="title"]:focus-visible { color: yellow !important; }
}
</style>
</head><body>
<article data-agent-native-node-id="card" class="max-[1279px]:p-6">
  <h2 data-agent-native-node-id="title">Title</h2>
</article>
<aside data-agent-native-node-id="unrelated">Unrelated</aside>
</body></html>`;

const LAYER = `<article data-agent-native-node-id="card" class="max-[1279px]:p-6">
  <h2 data-agent-native-node-id="title">Title</h2>
</article>`;

describe("managed styles in the Design clipboard", () => {
  it("extracts only responsive and interaction rules owned by the selected subtree", () => {
    const snapshot = extractDesignClipboardManagedStyles(SOURCE, LAYER);
    expect(snapshot).toEqual({
      version: 1,
      breakpoints: expect.arrayContaining([
        {
          maxWidthPx: 1279,
          nodeId: "card",
          property: "color",
          value: "red",
        },
        {
          maxWidthPx: 1279,
          nodeId: "card",
          property: "padding",
          value: "24px",
        },
        {
          maxWidthPx: 809,
          nodeId: "title",
          property: "font-size",
          value: "22px",
        },
      ]),
      interactionStates: expect.arrayContaining([
        {
          nodeId: "card",
          state: "hover",
          property: "background-color",
          value: "black",
        },
        {
          maxWidthPx: 809,
          nodeId: "title",
          state: "focus-visible",
          property: "color",
          value: "yellow",
        },
      ]),
    });
    expect(snapshot?.interactionStates).toHaveLength(2);
    expect(JSON.stringify(snapshot)).not.toContain("unrelated");
    expect(JSON.stringify(snapshot)).not.toContain("data-an-state-preview");
  });

  it("remaps rules, preserves target rules and cascade, generates preview twins, and is idempotent", () => {
    const snapshot = extractDesignClipboardManagedStyles(SOURCE, LAYER)!;
    const target = `<!doctype html><html><head>
<style data-agent-native-breakpoints>@media (max-width: 999px) { [data-agent-native-node-id="existing"] { width: 10px; } }</style>
</head><body><div data-agent-native-node-id="existing"></div><article data-agent-native-node-id="copy-card"><h2 data-agent-native-node-id="copy-title">Title</h2></article></body></html>`;
    const idMap = new Map([
      ["card", "copy-card"],
      ["title", "copy-title"],
    ]);
    const first = applyDesignClipboardManagedStyles(target, [snapshot], idMap);
    const second = applyDesignClipboardManagedStyles(first, [snapshot], idMap);

    expect(second).toBe(first);
    expect(first).toContain("copy-card");
    expect(first).toContain("copy-title");
    expect(first).toContain("existing");
    expect(first).not.toContain("unrelated");
    expect(first.indexOf("max-width: 1279px")).toBeLessThan(
      first.indexOf("max-width: 999px"),
    );
    expect(first.indexOf("max-width: 999px")).toBeLessThan(
      first.indexOf("max-width: 809px"),
    );
    expect(first).toContain(
      '[data-agent-native-node-id="copy-card"][data-an-state-preview="hover"]',
    );
    expect(first.match(/data-agent-native-state-breakpoints/g)).toHaveLength(1);
    expect(first.match(/font-size: 22px/g)).toHaveLength(1);
  });

  it("rejects hostile or unbounded clipboard declarations", () => {
    expect(
      isValidDesignClipboardManagedStyleSnapshot({
        version: 1,
        breakpoints: [
          {
            maxWidthPx: 809,
            nodeId: "card",
            property: "background",
            value: "red;}</style><script>alert(1)</script>",
          },
        ],
        interactionStates: [],
      }),
    ).toBe(false);
  });
});
