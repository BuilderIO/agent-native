import { describe, expect, it } from "vitest";

import { isWorkspaceUiLeaf } from "./workspace-ui-leaves.js";
describe("presentation chunk eligibility runtime", () => {
  it.each([
    "/repo/packages/toolkit/src/ui/card.tsx",
    "C:\\repo\\packages\\toolkit\\dist\\ui\\card.js",
    "/repo/packages/toolkit/dist/ui/dialog.mjs",
  ])("accepts an isolated presentation module %s", (id) =>
    expect(isWorkspaceUiLeaf(id)).toBe(true),
  );
  it.each([
    "/repo/packages/toolkit/src/app/card.tsx",
    "/repo/packages/toolkit/src/ui/sidebar.tsx",
    "/repo/packages/toolkit/src/ui/button.tsx",
    "/repo/packages/toolkit/src/ui/index.ts",
    "/repo/packages/toolkit/src/ui/card.tsx?virtual",
    "/repo/packages/another/src/ui/card.tsx",
    "/repo/packages/toolkit/src/ui/card.css",
  ])("rejects a coupled or virtual module %s", (id) =>
    expect(isWorkspaceUiLeaf(id)).toBe(false),
  );
});
