import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetAppConfigForTests } from "../app-config/index.js";
import { runWithRequestContext } from "../server/request-context.js";
import { buildFailureContext, withFailureContext } from "./failure-context.js";

const ENV_KEYS = [
  "APP_URL",
  "APP_BASE_PATH",
  "VITE_APP_BASE_PATH",
  "AGENT_NATIVE_APP",
  "AGENT_NATIVE_RELEASE",
  "AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT",
] as const;

describe("failure context packet", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    process.env.AGENT_NATIVE_APP = "calendar";
    process.env.AGENT_NATIVE_RELEASE = "agent-native-server@abc123";
    process.env.AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT = "production";
    process.env.APP_URL = "https://calendar.agent-native.com";
    resetAppConfigForTests();
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    resetAppConfigForTests();
  });

  it("links the thread in the canonical ?thread= form and names app, build and environment", () => {
    const packet = buildFailureContext({ threadId: "thr_1", runId: "run_1" });

    expect(packet).toMatchObject({
      appId: "calendar",
      release: "agent-native-server@abc123",
      environment: "production",
      threadId: "thr_1",
      runId: "run_1",
      threadUrl: "https://calendar.agent-native.com/?thread=thr_1",
    });
    expect(Date.parse(packet.occurredAt ?? "")).not.toBeNaN();
  });

  it("takes the thread and run from the ambient chat run when the caller names none", () => {
    const packet = runWithRequestContext(
      {
        userEmail: "someone@example.com",
        orgId: "org_1",
        run: { threadId: "thr_ambient", runId: "run_ambient" },
      },
      () => buildFailureContext(),
    );

    expect(packet.threadId).toBe("thr_ambient");
    expect(packet.runId).toBe("run_ambient");
    expect(packet.threadUrl).toBe(
      "https://calendar.agent-native.com/?thread=thr_ambient",
    );
  });

  it("never invents a thread link when no thread is known or no host is configured", () => {
    expect(buildFailureContext().threadUrl).toBeUndefined();

    delete process.env.APP_URL;
    resetAppConfigForTests();
    const packet = buildFailureContext({ threadId: "thr_1" });
    expect(packet.threadId).toBe("thr_1");
    expect(packet.threadUrl).toBeUndefined();
  });

  it("prefers the host the request arrived on and keeps the app base path", () => {
    process.env.APP_BASE_PATH = "/mail";
    const packet = runWithRequestContext(
      { requestOrigin: "https://beta.agent-native.com" },
      () => buildFailureContext({ threadId: "thr_1" }),
    );

    expect(packet.threadUrl).toBe(
      "https://beta.agent-native.com/mail/?thread=thr_1",
    );
  });

  it("records org or personal scope and never an email address", () => {
    const org = runWithRequestContext(
      { userEmail: "someone@example.com", orgId: "org_1" },
      () => buildFailureContext(),
    );
    const personal = runWithRequestContext(
      {
        userEmail: "someone@example.com",
        orgId: "org_1",
        orgScope: "personal",
      },
      () => buildFailureContext(),
    );

    expect(org.userScope).toBe("org");
    expect(personal.userScope).toBe("personal");
    expect(buildFailureContext().userScope).toBeUndefined();
    expect(JSON.stringify([org, personal])).not.toContain("someone@example");
  });

  it("lets explicit fields win over ambient ones", () => {
    const packet = runWithRequestContext(
      { run: { threadId: "thr_ambient", runId: "run_ambient" } },
      () => buildFailureContext({ threadId: "thr_explicit" }),
    );

    expect(packet.threadId).toBe("thr_explicit");
    expect(packet.runId).toBe("run_ambient");
  });

  describe("withFailureContext", () => {
    it("derives the packet from what the call site already reports", () => {
      const context = withFailureContext(
        {
          route: "/_agent-native/actions/list-events",
          tags: { action: "list-events", errorCode: "gmail_quota_cooldown" },
          extra: { request_id: "req_1", runId: "run_1", threadId: "thr_1" },
        },
        {},
      );

      expect(context.aiTraceId).toBe("run_1");
      expect(context.extra?.request_id).toBe("req_1");
      expect(context.extra?.failureContext).toMatchObject({
        route: "/_agent-native/actions/list-events",
        actionName: "list-events",
        errorCode: "gmail_quota_cooldown",
        requestId: "req_1",
        runId: "run_1",
        threadUrl: "https://calendar.agent-native.com/?thread=thr_1",
      });
    });

    it("reads the action name from the tag or from extra", () => {
      expect(
        withFailureContext({ tags: { action: "save-deck" } }).extra
          ?.failureContext,
      ).toMatchObject({ actionName: "save-deck" });
      expect(
        withFailureContext({ extra: { actionName: "edit-design" } }).extra
          ?.failureContext,
      ).toMatchObject({ actionName: "edit-design" });
    });

    it("joins an exception to its run through aiTraceId and keeps a caller's own value", () => {
      const fromTrace = withFailureContext({ aiTraceId: "run_9" });
      expect(fromTrace.extra?.failureContext).toMatchObject({ runId: "run_9" });

      const own = withFailureContext({
        aiTraceId: "run_own",
        extra: { runId: "run_other" },
      });
      expect(own.aiTraceId).toBe("run_own");
    });

    it("carries explicit identifiers for work the boundary cannot see", () => {
      const context = withFailureContext({
        extra: { automationName: "daily-digest", appId: "keeps-existing" },
        failure: { threadId: "thr_job", runId: "job-1" },
      });

      expect(context.failure).toBeUndefined();
      expect(context.extra).toMatchObject({ appId: "keeps-existing" });
      expect(context.extra?.failureContext).toMatchObject({
        automationName: "daily-digest",
        threadId: "thr_job",
        runId: "job-1",
        threadUrl: "https://calendar.agent-native.com/?thread=thr_job",
      });
    });

    it("keeps a failureContext the caller already built", () => {
      const context = withFailureContext({
        extra: { failureContext: { appId: "custom" } },
      });
      expect(context.extra?.failureContext).toMatchObject({ appId: "custom" });
    });
  });
});
