import { describe, expect, it } from "vitest";

import { resolveClipboardLayerSourceHtml } from "./clipboard-layer-source";

describe("resolveClipboardLayerSourceHtml", () => {
  it("uses the hydrated runtime DOM for eligible localhost screens", () => {
    expect(
      resolveClipboardLayerSourceHtml({
        runtimeProjectionEligible: true,
        runtimeSnapshot: {
          html: '<div data-agent-native-node-id="runtime-card">Card</div>',
          nodeCount: 1,
        },
        liveSnapshotHtml: '<div id="root"></div>',
        storedContent: "http://localhost:4173/dashboard",
      }),
    ).toContain("runtime-card");
  });

  it("keeps inline screens on their authored document", () => {
    const authored =
      '<template x-for="item in items"><article x-text="item"></article></template>';
    expect(
      resolveClipboardLayerSourceHtml({
        runtimeProjectionEligible: false,
        runtimeSnapshot: {
          html: "<article>Rendered item</article>",
          nodeCount: 1,
        },
        storedContent: authored,
      }),
    ).toBe(authored);
  });

  it("falls back to the source snapshot until a runtime tree exists", () => {
    expect(
      resolveClipboardLayerSourceHtml({
        runtimeProjectionEligible: true,
        runtimeSnapshot: { html: "", nodeCount: 0 },
        liveSnapshotHtml: '<main data-agent-native-node-id="ssr">SSR</main>',
        storedContent: "http://localhost:4173",
      }),
    ).toContain('data-agent-native-node-id="ssr"');
  });
});
