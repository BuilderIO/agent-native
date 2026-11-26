import { describe, expect, it } from "vitest";

import getFileStorage from "./get-file-storage.js";

describe("file upload actions over MCP", () => {
  it.each([["get-file-storage", getFileStorage]] as const)(
    "keeps %s in the app, off MCP",
    (_name, action) => {
      expect(action.mcpTool).toBe(false);
    },
  );
});
