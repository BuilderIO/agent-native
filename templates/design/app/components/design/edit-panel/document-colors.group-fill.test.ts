import { buildCodeLayerProjection } from "@shared/code-layer";
import { expect, it } from "vitest";

import { rewriteSelectionFillStyles } from "./document-colors";

it("rewrites Group Fill text targets from the screen's projection", () => {
  const source = { kind: "design-file" as const, fileId: "screen-1" };
  const content = [
    "<html><body>",
    '<div data-agent-native-node-id="group" data-agent-native-group="true">',
    '<div data-agent-native-node-id="fill" style="width: 120px; height: 80px; background-color: #f97316"></div>',
    '<p data-agent-native-node-id="text" style="color: #f97316">Paint</p>',
    "</div>",
    "</body></html>",
  ].join("");
  const scope = {
    fileId: "screen-1",
    content,
    projection: buildCodeLayerProjection(content, { source }),
    source,
    sourceId: "group",
    selector: '[data-agent-native-node-id="group"]',
  };

  const result = rewriteSelectionFillStyles([scope], {
    backgroundColor: "rgba(249, 115, 22, 0.5)",
    backgroundImage: "none",
  });

  expect(result.status).toBe("applied");
  expect(result.updates[0]?.content).toContain("rgba(249, 115, 22, 0.5)");
  expect(result.updates[0]?.content).toContain("-webkit-text-fill-color");
});
