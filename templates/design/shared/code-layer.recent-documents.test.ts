import { afterEach, expect, it } from "vitest";

import {
  _recentProjectionDocumentCountForTests,
  buildCodeLayerProjection,
  clearCodeLayerProjectionCache,
} from "./code-layer";

afterEach(() => clearCodeLayerProjectionCache());

it("forgets a recent document once its projection is evicted", () => {
  const documents = Array.from(
    { length: 8 },
    (_, index) =>
      `<div data-agent-native-node-id="n${index}">${String(index).repeat(2_500_000)}</div>`,
  );
  documents.forEach((html, index) =>
    buildCodeLayerProjection(html, {
      source: { kind: "design-file", fileId: `file-${index}` },
    }),
  );

  expect(_recentProjectionDocumentCountForTests()).toBeLessThanOrEqual(5);
});
