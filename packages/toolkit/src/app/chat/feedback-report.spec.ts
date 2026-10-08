// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";

import { formatFeedbackReport } from "./feedback-report.js";

describe("formatFeedbackReport", () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("names the run, thread link, message and note so a pasted report opens the exact run", () => {
    const lines = formatFeedbackReport({
      threadId: "thr_1",
      runId: "run_1",
      messageId: "msg_1",
      note: "Said done,\nbut wasn't.  Wrong numbers",
    }).split("\n");

    expect(lines).toEqual(
      expect.arrayContaining([
        "Agent-Native failure report",
        `thread: ${window.location.origin}/?thread=thr_1`,
        "run: run_1",
        'inspect: get-agent-thread-debug {"runId":"run_1"}',
        "message: msg_1",
        "note: Said done, but wasn't. Wrong numbers",
      ]),
    );
    expect(lines.some((line) => line.startsWith("build: "))).toBe(true);
  });

  it("omits the note line and the run when there are none", () => {
    const text = formatFeedbackReport({
      threadId: "thr_2",
      messageId: "msg_2",
      note: "  ",
    });

    expect(text).not.toContain("note:");
    expect(text).not.toContain("run:");
    expect(text).toContain("message: msg_2");
  });
});
