import { expect, it } from "vitest";

import { flattenRows } from "./LayersPanel";

it("offers to expand a screen whose layers are not built yet", () => {
  const [row] = flattenRows(
    [{ id: "screen-1", name: "Screen 1", type: "file", childrenPending: true }],
    new Set(),
    false,
  );
  expect(row?.hasChildren).toBe(true);
});
