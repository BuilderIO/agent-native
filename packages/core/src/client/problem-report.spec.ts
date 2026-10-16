import { beforeEach, describe, expect, it, vi } from "vitest";

import { uploadProblemReport } from "./problem-report.js";
import type { RecorderReport } from "./recorder.js";

const callActionMock = vi.hoisted(() => vi.fn());
vi.mock("./use-action.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./use-action.js")>()),
  callAction: callActionMock,
}));

const REPORT: RecorderReport = {
  app: "mail",
  build: "abc123",
  url: "/inbox",
  at: "2026-10-14T16:20:05.120Z",
  reason: "user",
  windowSeconds: 120,
  events: [{ t: -1, at: 1, type: "action", name: "list-labels", ok: true }],
  watched: {},
  pending: [],
  dropped: 0,
};

beforeEach(() => {
  callActionMock.mockReset();
});

describe("uploadProblemReport", () => {
  it("stores the full report through save-problem-report and returns its ref", async () => {
    callActionMock.mockResolvedValue({ ref: "attachment:v1:abc" });

    await expect(uploadProblemReport(REPORT)).resolves.toEqual({
      status: "ok",
      ref: "attachment:v1:abc",
    });
    expect(callActionMock).toHaveBeenCalledWith("save-problem-report", {
      report: REPORT,
    });
  });

  it("returns a typed failure with the action's code and message when storage refuses", async () => {
    callActionMock.mockRejectedValue(
      Object.assign(new Error("Action save-problem-report failed: ..."), {
        status: 503,
        errorCode: "attachment_storage_unavailable",
        actionMessage: "No object storage is connected.",
      }),
    );

    await expect(uploadProblemReport(REPORT)).resolves.toEqual({
      status: "failed",
      errorCode: "attachment_storage_unavailable",
      message: "No object storage is connected.",
    });
  });

  it("still reports a failure when the network drops before any action message", async () => {
    callActionMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(uploadProblemReport(REPORT)).resolves.toEqual({
      status: "failed",
    });
  });
});
