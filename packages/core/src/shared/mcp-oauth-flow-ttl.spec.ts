import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  MCP_OAUTH_FLOW_TTL_MS,
  MCP_OAUTH_FLOW_TTL_SECONDS,
} from "./mcp-oauth-flow-ttl.js";

function source(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf8",
  );
}

describe("MCP OAuth flow TTL", () => {
  it("keeps the millisecond form in step with the second form", () => {
    expect(MCP_OAUTH_FLOW_TTL_MS).toBe(MCP_OAUTH_FLOW_TTL_SECONDS * 1_000);
  });

  it("is the only definition the server flow cookie uses", () => {
    const routes = source("../mcp-client/oauth-routes.ts");
    expect(routes).toContain("MCP_OAUTH_FLOW_TTL_SECONDS");
    expect(routes).not.toMatch(/FLOW_TTL_SECONDS\s*=\s*\d/);
  });

  it("is the only definition the client pending window uses", () => {
    const refresh = source("../client/resources/mcp-connection-refresh.ts");
    expect(refresh).toContain("MCP_OAUTH_FLOW_TTL_MS");
    expect(refresh).not.toMatch(/PENDING_TTL_MS\s*=\s*\d/);
  });
});
