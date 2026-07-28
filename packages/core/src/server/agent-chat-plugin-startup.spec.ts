import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("agent chat startup", () => {
  it("does not block route readiness on the global stale-run repair", () => {
    const source = readFileSync(
      new URL("./agent-chat-plugin.ts", import.meta.url),
      "utf8",
    );
    const startup = source.slice(
      source.indexOf("const initPromise"),
      source.indexOf("const env = process.env.NODE_ENV"),
    );

    expect(startup).not.toContain("reapAllStaleRuns");
  });

  it("hydrates MCP connections after building the base action routes", () => {
    const source = readFileSync(
      new URL("./agent-chat-plugin.ts", import.meta.url),
      "utf8",
    );
    const mcpSetup = source.slice(
      source.indexOf("// Route readiness must not wait"),
      source.indexOf("// Resolve actions"),
    );

    expect(mcpSetup).toContain("new McpClientManager(null)");
    expect(mcpSetup).not.toContain("await mcpManager.start()");
    expect(
      source.indexOf("mcpInitializationPromise = initializeMcpManager()"),
    ).toBeGreaterThan(source.lastIndexOf("mcpManager.onChange"));
  });

  it("keeps trigger subscription registration behind route readiness", () => {
    const source = readFileSync(
      new URL("./agent-chat-plugin.ts", import.meta.url),
      "utf8",
    );
    const triggerSetup = source.slice(
      source.indexOf("// ─── Trigger Dispatcher"),
      source.indexOf("})().catch((err)"),
    );

    expect(triggerSetup).toContain("await initTriggerDispatcher");
    expect(triggerSetup).not.toContain("void (async () =>");
  });
});
