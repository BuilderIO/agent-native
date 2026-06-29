import { describe, expect, it } from "vitest";

import action from "./apply-visual-edit.js";

const styleIntent = {
  kind: "style" as const,
  target: {},
  property: "color",
  value: "red",
};

describe("apply-visual-edit schema", () => {
  it("requires a design or file id for persisted design-file edits", () => {
    expect(
      action.schema.safeParse({
        source: { kind: "design-file" },
        intent: styleIntent,
      }).success,
    ).toBe(false);

    expect(
      action.schema.safeParse({
        source: { kind: "design-file", designId: "design_123" },
        intent: styleIntent,
      }).success,
    ).toBe(true);

    expect(
      action.schema.safeParse({
        source: { kind: "design-file", fileId: "file_123" },
        intent: styleIntent,
      }).success,
    ).toBe(true);
  });
});
