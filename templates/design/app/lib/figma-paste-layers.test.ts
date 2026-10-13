// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  figmaPasteLayerHtml,
  resolveFigmaPasteTargetScreenId,
  withHeadLinks,
} from "./figma-paste-layers";

describe("resolveFigmaPasteTargetScreenId", () => {
  const base = {
    viewMode: "overview" as const,
    activeFileId: "s1",
    boardFileId: "board",
    overviewSelectedScreenIds: [] as string[],
    hasLayerSelection: false,
  };

  it("targets the one selected screen", () => {
    expect(
      resolveFigmaPasteTargetScreenId({
        ...base,
        overviewSelectedScreenIds: ["s2"],
      }),
    ).toBe("s2");
  });

  it("targets the screen holding a selected layer", () => {
    expect(
      resolveFigmaPasteTargetScreenId({ ...base, hasLayerSelection: true }),
    ).toBe("s1");
  });

  it("has no target with nothing selected, several screens, or the board", () => {
    expect(resolveFigmaPasteTargetScreenId(base)).toBeNull();
    expect(
      resolveFigmaPasteTargetScreenId({
        ...base,
        overviewSelectedScreenIds: ["s1", "s2"],
      }),
    ).toBeNull();
    expect(
      resolveFigmaPasteTargetScreenId({
        ...base,
        activeFileId: "board",
        hasLayerSelection: true,
      }),
    ).toBeNull();
  });
});

describe("figmaPasteLayerHtml", () => {
  const content = `<!doctype html><html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist"></head><body><div data-agent-native-layer-name="Vector" style="position: relative; width: 10px; height: 10px"><svg data-agent-native-layer-name="Vector"></svg></div></body></html>`;

  it("pastes the node itself when the root only wraps it", () => {
    const layer = figmaPasteLayerHtml({ content, wrapsLooseNode: true });
    expect(layer?.html.startsWith("<svg")).toBe(true);
    expect(layer?.headLinks).toHaveLength(1);
  });

  it("pastes a copied frame as the frame", () => {
    const layer = figmaPasteLayerHtml({ content, wrapsLooseNode: false });
    expect(layer?.html.startsWith("<div")).toBe(true);
  });

  it("adds a font link to the target once", () => {
    const link = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist">`;
    const once = withHeadLinks("<html><head></head><body></body></html>", [
      link,
    ]);
    expect(withHeadLinks(once, [link])).toBe(once);
    expect(once.match(/family=Geist/g)).toHaveLength(1);
  });
});
