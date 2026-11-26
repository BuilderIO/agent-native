import { describe, expect, it } from "vitest";

import * as mcp from "./index.js";

describe("mcp entry point", () => {
  it("exposes the per-turn grant and chat-turn extension points", () => {
    expect(typeof mcp.registerMcpChatTurnApps).toBe("function");
    expect(typeof mcp.mintMcpChatTurn).toBe("function");
    expect(typeof mcp.mcpChatTurnOwner).toBe("function");
    expect(typeof mcp.isMcpTurnGrantAction).toBe("function");
    expect(mcp.MCP_CHAT_TURN_FIELD).toBe("__agentNativeMcpChatTurn");
    expect(typeof mcp.MCP_TURN_GRANT_HEADER).toBe("string");
    expect(typeof mcp.MCP_USER_TURN_META_KEY).toBe("string");
    expect(mcp.MCP_SKILLS_EXTENSION_ID).toBe("io.modelcontextprotocol/skills");
    expect(typeof mcp.buildSkill).toBe("function");
    expect(typeof mcp.getBuiltinMcpSkill).toBe("function");
  });
});
