import { describe, expect, it } from "vitest";

import {
  suggestionAuthorClient,
  suggestionAuthorSource,
} from "./actor-kind.js";
import type { SuggestionAuthorSource } from "./types.js";

describe("suggestion authors", () => {
  it.each<[string | undefined, SuggestionAuthorSource | null]>([
    ["mcp", "mcp"],
    ["webmcp", "mcp"],
    ["a2a", "a2a"],
    ["agent", "agent"],
    ["tool", "agent"],
    ["frontend", null],
    [undefined, null],
  ])("files a %s call under %s", (caller, source) => {
    expect(suggestionAuthorSource({ caller })).toBe(source);
  });

  it("files a call with no context under no source", () => {
    expect(suggestionAuthorSource(undefined)).toBeNull();
    expect(suggestionAuthorClient(undefined)).toBeNull();
  });

  it("names the MCP host from the client's handshake name or User-Agent", () => {
    expect(
      suggestionAuthorClient({
        caller: "mcp",
        mcpClient: { name: "claude-code", version: "2.1.308" },
      }),
    ).toBe("claude-code");
    expect(
      suggestionAuthorClient({
        caller: "mcp",
        mcpClient: { userAgent: "codex-mcp-client/0.167.0" },
      }),
    ).toBe("codex");
    expect(
      suggestionAuthorClient({
        caller: "mcp",
        mcpClient: { name: "mcp-remote" },
      }),
    ).toBeNull();
  });

  it("names no MCP host for a call that did not come over MCP", () => {
    expect(
      suggestionAuthorClient({
        caller: "agent",
        mcpClient: { name: "claude-code" },
      }),
    ).toBeNull();
  });
});
