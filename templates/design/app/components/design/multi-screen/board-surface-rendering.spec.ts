import { describe, expect, it } from "vitest";

import { getBoardSurfaceContentBounds } from "./board-surface-html";
import { getBoardSurfaceRenderGeometry } from "./overview-layout";

describe("board surface rendering", () => {
  it("uses the viewport for a normal-flow app stored as the only board file", () => {
    const appDocument = `<!doctype html><html><body data-agent-native-node-id="body">
      <div data-agent-native-node-id="app" class="app">
        <header data-agent-native-node-id="header"><h1 data-agent-native-node-id="title">Badge Studio</h1></header>
        <main data-agent-native-node-id="main"><section data-agent-native-node-id="preview">Preview</section></main>
      </div>
    </body></html>`;
    const viewport = { x: -640, y: -360, width: 1280, height: 720 };

    const contentBounds = getBoardSurfaceContentBounds(appDocument);
    const renderGeometry = getBoardSurfaceRenderGeometry({
      logicalGeometry: { x: -65536, y: -65536, width: 131072, height: 131072 },
      contentBounds,
      screenGeometries: [viewport],
      focus: { x: 0, y: 0 },
    });

    expect(contentBounds).toBeNull();
    expect(renderGeometry).toEqual(viewport);
  });
});
