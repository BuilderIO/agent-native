// @vitest-environment happy-dom
import { expect, it } from "vitest";

import { setAbsolutePositioningForNodeInHtml } from "@/pages/design-editor/html-layer-positioning";

it("pins a flow layer's measured sub-pixel size on whole pixels when it leaves auto layout", () => {
  const html = `<!DOCTYPE html><html><body><div style="display:flex"><div data-agent-native-node-id="cell" style="flex:1 1 0%;border-width:0.5px">Cell</div></div></body></html>`;

  const next = setAbsolutePositioningForNodeInHtml(
    html,
    "cell",
    { x: 40.6, y: 12.2 },
    undefined,
    { width: 333.33, height: 40.5 },
  );

  const cell = new DOMParser()
    .parseFromString(next, "text/html")
    .querySelector<HTMLElement>('[data-agent-native-node-id="cell"]')!;
  expect([
    cell.style.left,
    cell.style.top,
    cell.style.width,
    cell.style.height,
    cell.style.borderWidth,
  ]).toEqual(["41px", "12px", "334px", "41px", "0.5px"]);
});
