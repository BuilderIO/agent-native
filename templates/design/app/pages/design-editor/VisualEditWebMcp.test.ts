import { describe, expect, it } from "vitest";

import { createVisualEditWebMcpActions } from "./VisualEditWebMcp";

describe("get-visual-edit-prompt WebMCP action", () => {
  it("returns the editor's current prompt through a stable tool name", async () => {
    const result = {
      designId: "design_1",
      pendingEditCount: 2,
      status: "ready" as const,
      prompt: "Apply the two pending edits.",
    };
    const [action] = createVisualEditWebMcpActions({
      getPrompt: () => result,
    });

    expect(action.name).toBe("get-visual-edit-prompt");
    expect(action.run({}, {} as never)).toEqual(result);
  });
});
