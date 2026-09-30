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

  it("keeps MCP managers out of startup and static action registries", () => {
    const source = readFileSync(
      new URL("./agent-chat-plugin.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toContain("new McpClientManager(");
    expect(source).not.toContain("ensureMcpInitialized");
    expect(source).toContain(
      "resolveAdditionalActions: ({ ownerEmail, orgId })",
    );
  });

  it("resolves MCP only from authenticated chat or a due job that requests tools", () => {
    const source = readFileSync(
      new URL("./agent-chat-plugin.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("resolveBackgroundMcpToolSelection(");
    const jobResolver = source.slice(
      source.indexOf("const getJobMcpActionEntries"),
      source.indexOf("// Mount status + management routes"),
    );
    expect(jobResolver).toContain("principalFromRequestContext()");
    expect(jobResolver).toContain("principal.userEmail");
    expect(jobResolver).toContain("principal.orgId");
    expect(
      source.slice(
        source.indexOf("const invokeAgentChatHandler"),
        source.indexOf("const ownerContext = await resolveOwnerContext(event)"),
      ),
    ).not.toContain("getMcpManager");
  });

  it("routes anonymous chat through the read-only handler without MCP actions", () => {
    const source = readFileSync(
      new URL("./agent-chat-plugin.ts", import.meta.url),
      "utf8",
    );
    const anonymousHandler = source.slice(
      source.indexOf("const anonymousHandler ="),
      source.indexOf("// Build the dev handler"),
    );
    const invocation = source.slice(
      source.indexOf("const invokeAgentChatHandler ="),
      source.indexOf("// A Function URL is a separate origin"),
    );

    expect(invocation).toContain("ownerContext.anonymous && anonymousHandler");
    expect(invocation).not.toContain("getMcpManager");
    expect(anonymousHandler).toContain("actions: anonymousReadOnlyActions");
    expect(anonymousHandler).not.toContain("resolveAdditionalActions");
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
    expect(sweepRoute).toContain("RECURRING_SWEEP_BUDGET_MS");
    expect(sweepRoute).toContain("runRecurringSweepHandlers(sweepContext)");
    expect(sweepRoute).toContain("appSweepHandlers.failed.length > 0");
    expect(sweepRoute).toContain("setResponseStatus(event, 500)");
    expect(sweepRoute.indexOf("const staleRunsReaped")).toBeLessThan(
      sweepRoute.indexOf("const sweepContext"),
    );
    expect(sweepRoute.indexOf("const sweepContext")).toBeLessThan(
      sweepRoute.indexOf("runRecurringSweepHandlers(sweepContext)"),
    );
    expect(
      sweepRoute.indexOf("runRecurringSweepHandlers(sweepContext)"),
    ).toBeLessThan(sweepRoute.indexOf("processFailureAlertRetries()"));
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
