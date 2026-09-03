// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";

import {
  buildErrorReportTemplate,
  buildGitHubIssueUrl,
} from "./error-reporting.js";

describe("error reporting helpers", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("builds a feedback template with client debug context", () => {
    window.history.replaceState(null, "", "/plans/plan-1?token=secret");
    sessionStorage.setItem(
      "agent-chat-active-run",
      JSON.stringify({
        threadId: "thread-1",
        runId: "run-1",
        lastSeq: 2,
      }),
    );

    const body = buildErrorReportTemplate({
      appName: "Plan",
      title: "Plan did not load",
      details: "Action get-visual-plan failed",
      status: 500,
      extraDebug: [{ label: "Plan id", value: "plan-1" }],
    });

    expect(body).toContain("Describe what happened here:");
    expect(body).toContain("App: Plan");
    expect(body).toContain("Status: 500");
    expect(body).toContain("Screen: Plan did not load");
    expect(body).toContain("Error: Action get-visual-plan failed");
    expect(body).toContain(
      "Page: http://localhost:3000/plans/plan-1?token=%3Credacted%3E",
    );
    expect(body).toContain("Source: web");
    expect(body).toContain("Run: run-1");
    expect(body).toContain("Chat session: thread-1");
    expect(body).toContain("Plan id: plan-1");
  });

  it("prefills GitHub issues with the same report body", () => {
    window.history.replaceState(null, "", "/docs");

    const url = new URL(
      buildGitHubIssueUrl({
        appName: "Docs",
        title: "Something went wrong",
        details: "Unexpected render failure",
      }),
    );

    expect(url.origin + url.pathname).toBe(
      "https://github.com/BuilderIO/agent-native/issues/new",
    );
    expect(url.searchParams.get("title")).toBe("Docs: Something went wrong");
    expect(url.searchParams.get("body")).toContain("App: Docs");
    expect(url.searchParams.get("body")).toContain(
      "Error: Unexpected render failure",
    );
  });
});
