// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";

import {
  clientFailureContext,
  formatClientFailureReport,
} from "./failure-report.js";

function setLocation(path: string): void {
  window.history.replaceState(null, "", path);
}

function setActiveRun(threadId: string, runId: string): void {
  sessionStorage.setItem(
    "agent-chat-active-run",
    JSON.stringify({ threadId, runId, lastSeq: 1 }),
  );
}

describe("client failure report", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    setLocation("/");
  });

  it("links the thread named by the caller in the canonical ?thread= form", () => {
    const context = clientFailureContext({ threadId: "thr_1", runId: "run_1" });

    expect(context).toMatchObject({
      appId: window.location.host,
      threadId: "thr_1",
      runId: "run_1",
      threadUrl: `${window.location.origin}/?thread=thr_1`,
    });
    expect(context.release).toMatch(/^agent-native-client@/);
    expect(Date.parse(context.occurredAt ?? "")).not.toBeNaN();
  });

  it("falls back to the thread open in the URL, then to the active run", () => {
    setActiveRun("thr_active", "run_active");
    setLocation("/inbox?thread=thr_url&token=secret");
    expect(clientFailureContext().threadId).toBe("thr_url");

    setLocation("/inbox");
    const fromRun = clientFailureContext();
    expect(fromRun).toMatchObject({
      threadId: "thr_active",
      runId: "run_active",
    });
  });

  it("does not pair the active run with a different thread", () => {
    setActiveRun("thr_active", "run_active");
    const context = clientFailureContext({ threadId: "thr_other" });
    expect(context.threadId).toBe("thr_other");
    expect(context.runId).toBeUndefined();
  });

  it("never copies the page query string into the report", () => {
    setLocation("/inbox?token=secret&thread=thr_1");
    const text = formatClientFailureReport({ message: "boom" });
    expect(text).not.toContain("secret");
    expect(text).toContain(`${window.location.origin}/?thread=thr_1`);
  });

  it("formats the copy-able packet with the error, code and the inspection action", () => {
    const text = formatClientFailureReport({
      message: "The provider rejected the credential",
      errorCode: "credential_rejected",
      runId: "run_9",
      threadId: "thr_9",
    });

    expect(text.split("\n")).toEqual(
      expect.arrayContaining([
        "Agent-Native failure report",
        "error: The provider rejected the credential",
        `app: ${window.location.host}`,
        `thread: ${window.location.origin}/?thread=thr_9`,
        "run: run_9",
        "code: credential_rejected",
        'inspect: get-agent-thread-debug {"runId":"run_9"}',
      ]),
    );
  });

  it("says nothing about a thread when none is open", () => {
    const text = formatClientFailureReport({ message: "boom" });
    expect(text).not.toContain("thread:");
    expect(text).not.toContain("inspect:");
  });
});
