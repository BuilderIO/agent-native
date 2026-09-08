import { describe, expect, it } from "vitest";

import {
  DESKTOP_REMOTE_MCP_UNAVAILABLE_REASON,
  desktopRemoteMcpUnavailable,
} from "./chat-first-mcp.js";

describe("desktop remote MCP capability state", () => {
  it("uses an explicit unavailable state until the secure broker exists", () => {
    expect(desktopRemoteMcpUnavailable()).toEqual({
      state: "unavailable",
      error: DESKTOP_REMOTE_MCP_UNAVAILABLE_REASON,
    });
  });
});
