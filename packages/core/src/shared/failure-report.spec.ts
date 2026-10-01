import { describe, expect, it } from "vitest";

import {
  chatThreadUrl,
  compactFailureContext,
  formatFailureReport,
} from "./failure-report.js";

describe("failure report", () => {
  it("builds the canonical thread deep link and encodes the id", () => {
    expect(chatThreadUrl("https://mail.agent-native.com/", "thr_1")).toBe(
      "https://mail.agent-native.com/?thread=thr_1",
    );
    expect(chatThreadUrl("https://agent-native.com/mail", "a b&c")).toBe(
      "https://agent-native.com/mail/?thread=a%20b%26c",
    );
  });

  it("drops blank and non-string fields", () => {
    expect(
      compactFailureContext({
        appId: " mail ",
        runId: "  ",
        threadId: undefined,
      }),
    ).toEqual({ appId: "mail" });
  });

  it("formats one line per field, with the inspection action last", () => {
    const text = formatFailureReport(
      {
        appId: "mail",
        threadId: "thr_1",
        threadUrl: "https://mail.agent-native.com/?thread=thr_1",
        runId: "run_1",
        errorCode: "credential_rejected",
        occurredAt: "2026-10-01T12:00:00.000Z",
        release: "agent-native-client@abc",
      },
      { message: "The provider rejected the credential" },
    );

    expect(text.split("\n")).toEqual([
      "Agent-Native failure report",
      "error: The provider rejected the credential",
      "app: mail",
      "thread: https://mail.agent-native.com/?thread=thr_1",
      "run: run_1",
      "code: credential_rejected",
      "time: 2026-10-01T12:00:00.000Z",
      "build: agent-native-client@abc",
      'inspect: get-agent-thread-debug {"runId":"run_1"}',
    ]);
  });

  it("flattens a value that carried newlines so a report cannot gain lines", () => {
    const text = formatFailureReport(
      { appId: "mail" },
      { message: "first\nsecond: injected\n\n  third" },
    );
    expect(text.split("\n")).toHaveLength(3);
    expect(text).toContain("error: first second: injected third");
  });

  it("points at the thread when there is no run, and says nothing when there is neither", () => {
    expect(formatFailureReport({ threadId: "thr_1" })).toContain(
      'inspect: get-agent-thread-debug {"threadId":"thr_1"}',
    );
    expect(formatFailureReport({ appId: "mail" })).not.toContain("inspect:");
  });
});
