import { describe, expect, it } from "vitest";

import getLabs from "./get-labs.js";

describe("labs actions over MCP", () => {
  it.each([["get-labs", getLabs]] as const)(
    "keeps %s in the app, off MCP",
    (_name, action) => {
      expect(action.mcpTool).toBe(false);
    },
  );
});
