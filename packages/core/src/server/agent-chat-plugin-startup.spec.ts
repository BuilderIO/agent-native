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

    expect(source).toContain(
      "if (!isProductionServerlessFunctionRuntime()) {\n        void ensureMcpInitialized().catch",
    );
    expect(source).toContain("waitUntilReady: ensureMcpInitialized,");
    expect(
      source.slice(
        source.indexOf("const invokeAgentChatHandler"),
        source.indexOf("const ownerContext = await resolveOwnerContext(event)"),
      ),
    ).toContain("await ensureMcpInitialized();");
  });

  it("keeps transient database failures structured on the stream route", () => {
    const source = readFileSync(
      new URL("./agent-chat-plugin.ts", import.meta.url),
      "utf8",
    );
    const streamRoute = source.slice(
      source.indexOf("if (streamingRuntime)"),
      source.indexOf("// ─── Durable background agent-chat run processor"),
    );

    expect(streamRoute).toMatch(
      /withTransientDatabaseFallback\(\s*AGENT_CHAT_STREAM_PATH/,
    );
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

  it("keeps webhook and event dispatch independent from the cron scheduler gate", () => {
    const source = readFileSync(
      new URL("./agent-chat-plugin.ts", import.meta.url),
      "utf8",
    );
    const triggerSetup = source.slice(
      source.indexOf("// ─── Trigger Dispatcher"),
      source.indexOf("})().catch((err)"),
    );

    expect(triggerSetup).not.toContain("disableRecurringJobsRuntime");
  });

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
    expect(sweepRoute).toContain("sweepUnclaimedBackgroundRuns");
    expect(sweepRoute).toContain("reapExpired: true");
    expect(sweepRoute).toContain("jobsSkippedReason");
    expect(sweepRoute.indexOf("reapAllStaleRuns()")).toBeLessThan(
      sweepRoute.indexOf("processRecurringJobs(schedulerDeps)"),
    );
    expect(sweepRoute).toContain("durable stale-run reap failed");
    expect(sweepRoute).toContain("staleRunsReaped");
    expect(sweepRoute).not.toContain(".catch(() => {})");
  });

  it("runs registered app handlers from the signed durable sweep and fails visibly", () => {
    const source = readFileSync(
      new URL("./agent-chat-plugin.ts", import.meta.url),
      "utf8",
    );
    const sweepRoute = source.slice(
      source.indexOf("          RECURRING_JOBS_SWEEP_PATH,\n"),
      source.indexOf("        if (disableRecurringJobsRuntime) {"),
    );

    expect(sweepRoute).toContain("runRecurringSweepHandlers");
    expect(sweepRoute).toContain("appSweepHandlers.failed.length > 0");
    expect(sweepRoute).toContain("setResponseStatus(event, 500)");
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
