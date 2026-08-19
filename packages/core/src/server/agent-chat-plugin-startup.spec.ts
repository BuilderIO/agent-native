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
      source.indexOf("if (!isProductionServerlessFunctionRuntime()) {"),
    ).toBeGreaterThan(source.lastIndexOf("mcpManager.onChange"));
  });

  it("does not eagerly hydrate MCP on a serverless cold start", () => {
    const source = readFileSync(
      new URL("./agent-chat-plugin.ts", import.meta.url),
      "utf8",
    );

    // Nothing awaits the eager hydration, so on a runtime that freezes after
    // responding its settings scan and MCP handshakes escape past the response.
    expect(source).toContain(
      "if (!isProductionServerlessFunctionRuntime()) {\n        void ensureMcpInitialized().catch",
    );
    // The lazy path must actually run: never initializing would be worse than
    // the cold-start cost it removes.
    expect(source).toContain("waitUntilReady: ensureMcpInitialized,");
    expect(
      source.slice(
        source.indexOf("const invokeAgentChatHandler"),
        source.indexOf("const ownerContext = await resolveOwnerContext(event)"),
      ),
    ).toContain("await ensureMcpInitialized();");
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

  /**
   * The in-process fast sweep is gated on `shouldDisableInProcessSweeps()`,
   * which is ON for every production serverless function — so for 21 days
   * production had NO periodic stale reaper at all (1,216 stranded runs, 12% of
   * all runs, up to 59 minutes each). The durable, signed, platform-scheduled
   * recurring-job sweep is the only per-site tick that exists; stale reaping
   * rides it rather than getting a second scheduled function or a second
   * kill-switch exemption.
   */
  it("drives stale reaping from the durable scheduled sweep", () => {
    const source = readFileSync(
      new URL("./agent-chat-plugin.ts", import.meta.url),
      "utf8",
    );
    const sweepRoute = source.slice(
      source.indexOf("          RECURRING_JOBS_SWEEP_PATH,\n"),
      source.indexOf("        if (disableRecurringJobsRuntime) {"),
    );

    expect(sweepRoute).toContain("reapAllStaleRuns()");
    // Ahead of the open-ended job sweep, which can spend the platform wall.
    expect(sweepRoute.indexOf("reapAllStaleRuns()")).toBeLessThan(
      sweepRoute.indexOf("processRecurringJobs(schedulerDeps)"),
    );
    // A reap failure is reported and stays distinguishable from "reaped
    // nothing", but must never take recurring jobs down with it.
    expect(sweepRoute).toContain("durable stale-run reap failed");
    expect(sweepRoute).toContain("staleRunsReaped");
    expect(sweepRoute).not.toContain(".catch(() => {})");
  });

  it("does not swallow the in-process stale reap either", () => {
    const source = readFileSync(
      new URL("./agent-chat-plugin.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("await reapAllStaleRuns().catch(() => {});");
    expect(source).toContain("in-process stale-run reap failed");
  });
});
