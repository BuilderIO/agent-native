import { describe, expect, it } from "vitest";

import { mcpClientConnectionsSchema } from "./mcp-client-connections.js";

describe("MCP connection response", () => {
  it("accepts recorded or unknown activity and rejects invalid status or timestamps", () => {
    const connection = {
      client: "cursor",
      status: "connected",
      lastUsedAt: 42,
    };
    expect(
      mcpClientConnectionsSchema.safeParse({
        connections: [
          connection,
          { ...connection, status: "unknown", lastUsedAt: null },
        ],
      }).success,
    ).toBe(true);
    for (const invalid of [
      { status: "online" },
      { lastUsedAt: -1 },
      { lastUsedAt: 1.5 },
      { client: "unrecognized" },
    ]) {
      expect(
        mcpClientConnectionsSchema.safeParse({
          connections: [{ ...connection, ...invalid }],
        }).success,
      ).toBe(false);
    }
  });
});
