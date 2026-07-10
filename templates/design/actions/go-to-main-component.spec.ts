import { describe, expect, it } from "vitest";

import action from "./go-to-main-component.js";

describe("go-to-main-component schema", () => {
  it("accepts the minimal designId + nodeId payload", () => {
    expect(
      action.schema.safeParse({ designId: "design_1", nodeId: "node_1" })
        .success,
    ).toBe(true);
  });

  it("accepts an optional fileId", () => {
    const parsed = action.schema.safeParse({
      designId: "design_1",
      nodeId: "node_1",
      fileId: "file_about",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.fileId).toBe("file_about");
  });

  it("rejects a payload missing nodeId", () => {
    expect(action.schema.safeParse({ designId: "design_1" }).success).toBe(
      false,
    );
  });

  it("uses the default mutation transport because it writes navigation state", () => {
    expect(action.readOnly).not.toBe(true);
    expect(action.http).toBeUndefined();
  });
});
