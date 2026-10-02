import * as codeLayer from "@shared/code-layer";
import { expect, it, vi } from "vitest";

import { selectionColorValues } from "./document-colors";

vi.mock("@shared/code-layer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@shared/code-layer")>();
  return {
    ...actual,
    resolveCodeLayerTarget: vi.fn(actual.resolveCodeLayerTarget),
  };
});

it("resolves a scope through the editor's projection without a re-parse", () => {
  const source = { kind: "design-file" as const, fileId: "screen-1" };
  const content =
    '<main><section data-agent-native-node-id="card" style="color: #ff0000; background-color: #00ff00">Hi</section><p style="color: #0000ff">Other</p></main>';
  const projection = codeLayer.buildCodeLayerProjection(content, { source });
  const scope = { fileId: "screen-1", content, source, sourceId: "card" };
  const resolve = vi.mocked(codeLayer.resolveCodeLayerTarget);

  resolve.mockClear();
  const viaProjection = selectionColorValues([], [{ ...scope, projection }]);
  expect(resolve).not.toHaveBeenCalled();

  expect(viaProjection).toEqual(selectionColorValues([], [scope]));
  expect(resolve).toHaveBeenCalled();
  expect(viaProjection.length).toBeGreaterThan(0);
  expect(viaProjection.map((color) => color.value)).not.toContain("#0000ff");
});
