import { describe, expect, it } from "vitest";

import {
  humanizeToolLabelText,
  humanizeToolName,
  runningToolLabel,
} from "./tool-display.js";

describe("tool display labels", () => {
  it("humanizes dashed, underscored, and MCP tool names", () => {
    expect(humanizeToolName("generate-design")).toBe("generate design");
    expect(humanizeToolName("list_files")).toBe("list files");
    expect(humanizeToolName("mcp__codex_apps__figma___get_screenshot")).toBe(
      "get screenshot",
    );
  });

  it("uses user-facing labels for Design screen tools", () => {
    expect(humanizeToolName("delete-file")).toBe("remove screen");
    expect(humanizeToolName("get-design-snapshot")).toBe("get screen snapshot");
    expect(humanizeToolName("edit-design")).toBe("edit screen");
  });

  it("uses humanized names in running labels", () => {
    expect(runningToolLabel("generate-design")).toBe("Running generate design");
  });

  it("humanizes tool names inside activity labels without changing the verb", () => {
    expect(
      humanizeToolLabelText(
        "Preparing get-design-snapshot action",
        "get-design-snapshot",
      ),
    ).toBe("Preparing get screen snapshot action");
  });
});
