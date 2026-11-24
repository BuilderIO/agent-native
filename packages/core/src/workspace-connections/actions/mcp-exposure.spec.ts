import { describe, expect, it } from "vitest";

import listWorkspaceUserGroups from "./list-workspace-user-groups.js";

describe("workspace connections actions over MCP", () => {
  it.each([["list-workspace-user-groups", listWorkspaceUserGroups]] as const)(
    "serves %s to outside agents unlisted, through tool search",
    (_name, action) => {
      expect(action.mcpTool).toBe("search");
    },
  );
});
