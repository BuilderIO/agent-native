import type { ActionCaller } from "@agent-native/core/action";
import { describe, expect, it } from "vitest";

import { personStartedContext, recordingMadeBy } from "./recording-made-by.js";

describe("recordingMadeBy", () => {
  it.each<ActionCaller>(["tool", "mcp", "webmcp", "a2a"])(
    "reads a %s call as an agent's",
    (caller) => {
      expect(recordingMadeBy({ caller })).toEqual({
        madeBy: "agent",
        madeByAgent: null,
      });
    },
  );

  it.each<ActionCaller>(["frontend", "http", "mcp-widget", "mcp-widget-write"])(
    "reads a %s call as a person's",
    (caller) => {
      expect(recordingMadeBy({ caller })).toEqual({
        madeBy: "person",
        madeByAgent: null,
      });
    },
  );

  it("leaves a call that doesn't say who made it unrecorded", () => {
    const unrecorded = { madeBy: null, madeByAgent: null };
    expect(recordingMadeBy(undefined)).toEqual(unrecorded);
    expect(recordingMadeBy({ caller: "cli" })).toEqual(unrecorded);
    expect(recordingMadeBy({ caller: "automation" })).toEqual(unrecorded);
  });

  it("names an MCP agent by its client: a known product's label, else its own name", () => {
    expect(
      recordingMadeBy({ caller: "mcp", mcpClient: { name: "claude-code" } }),
    ).toEqual({ madeBy: "agent", madeByAgent: "Claude" });
    expect(
      recordingMadeBy({ caller: "mcp", mcpClient: { name: " my-agent " } }),
    ).toEqual({ madeBy: "agent", madeByAgent: "my-agent" });
    expect(
      recordingMadeBy({ caller: "mcp", mcpClient: { name: "x".repeat(200) } })
        .madeByAgent,
    ).toHaveLength(80);
  });

  it("names an agent from its User-Agent only when that names a known product", () => {
    expect(
      recordingMadeBy({
        caller: "mcp",
        mcpClient: { userAgent: "Cursor/1.4 (darwin)" },
      }).madeByAgent,
    ).toBe("Cursor");
    expect(
      recordingMadeBy({
        caller: "mcp",
        mcpClient: { userAgent: "python-requests/2.32" },
      }).madeByAgent,
    ).toBeNull();
  });

  it("reads a call a person started as theirs though it arrives over A2A", () => {
    const relayed = { caller: "a2a" as const, userEmail: "ana@example.com" };
    const started = personStartedContext(relayed);

    expect(recordingMadeBy(started)).toEqual({
      madeBy: "person",
      madeByAgent: null,
    });
    expect(recordingMadeBy({ ...started })).toEqual({
      madeBy: "person",
      madeByAgent: null,
    });
    expect(recordingMadeBy(relayed).madeBy).toBe("agent");
    expect(started.userEmail).toBe("ana@example.com");
  });
});
