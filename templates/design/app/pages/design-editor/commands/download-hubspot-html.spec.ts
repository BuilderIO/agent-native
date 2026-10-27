import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  commitAfterPaint,
  flushCommitsAfterPaint,
} from "../commit-after-paint";
import { runDownloadHubspotHtml } from "./download-hubspot-html";

const { callAction, toast } = vi.hoisted(() => ({
  callAction: vi.fn(),
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    loading: vi.fn().mockReturnValue("pending-export"),
    dismiss: vi.fn(),
  },
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  callAction,
  actionErrorCode: (error: { errorCode?: string } | undefined) =>
    error?.errorCode,
  actionErrorMessage: (error: unknown) =>
    typeof error === "object" && error !== null && "actionMessage" in error
      ? error.actionMessage
      : undefined,
}));
vi.mock("sonner", () => ({ toast }));

beforeEach(() => {
  vi.clearAllMocks();
  flushCommitsAfterPaint();
});

function args() {
  return {
    designId: "email-design",
    fileId: "email-frame",
    exportingRef: { current: false },
    setExporting: vi.fn(),
    getScreenContent: () => "draft",
    flushPendingFileContentSaves: vi.fn().mockResolvedValue(undefined),
    triggerBlobDownload: vi.fn(),
    onInvalidEmail: vi.fn(),
    t: (key: string) => key,
  };
}

describe("HubSpot HTML download", () => {
  it("flushes the latest edit, waits for its save, and pins the exact source before downloading", async () => {
    let content = "old";
    commitAfterPaint(() => {
      content = "new";
    });
    let finishSave!: () => void;
    const save = new Promise<void>((resolve) => {
      finishSave = resolve;
    });
    const options = {
      ...args(),
      getScreenContent: () => content,
      flushPendingFileContentSaves: vi.fn(() => save),
    };
    callAction.mockResolvedValue({
      html: "<html>email</html>",
      filename: "email.html",
    });
    const pending = runDownloadHubspotHtml(options);
    expect(content).toBe("new");
    expect(options.setExporting).toHaveBeenCalledWith(true);
    expect(callAction).not.toHaveBeenCalled();
    expect(toast.loading).toHaveBeenCalledWith(
      "designEditor.toasts.hubspotHtmlExporting",
    );
    finishSave();
    await pending;
    expect(callAction).toHaveBeenCalledWith("export-hubspot-html", {
      id: "email-design",
      fileId: "email-frame",
      expectedVersionHash: "3:b9jhu9",
    });
    const [blob, filename] = options.triggerBlobDownload.mock.calls[0]!;
    expect(filename).toBe("email.html");
    expect(blob.type).toBe("text/html;charset=utf-8");
    expect(await blob.text()).toBe("<html>email</html>");
    expect(options.exportingRef.current).toBe(false);
    expect(toast.dismiss).toHaveBeenCalledWith("pending-export");
  });

  it("shows an actionable export failure without downloading stale HTML", async () => {
    const options = args();
    callAction.mockRejectedValue({
      actionMessage: "Save your changes before exporting.",
    });
    await runDownloadHubspotHtml(options);
    expect(toast.error).toHaveBeenCalledWith(
      "Save your changes before exporting.",
    );
    expect(options.triggerBlobDownload).not.toHaveBeenCalled();
    expect(options.setExporting).toHaveBeenLastCalledWith(false);
    expect(options.onInvalidEmail).not.toHaveBeenCalled();
  });

  it("offers conversion only for email validation failures from the export action", async () => {
    const options = args();
    callAction.mockRejectedValue({
      errorCode: "invalid_hubspot_email",
      actionMessage: "CSS grid is not supported in email.",
    });
    await runDownloadHubspotHtml(options);
    expect(options.onInvalidEmail).toHaveBeenCalledWith({
      reason: "CSS grid is not supported in email.",
      expectedVersionHash: "5:1eckznw",
    });
    expect(toast.error).not.toHaveBeenCalled();
    expect(options.triggerBlobDownload).not.toHaveBeenCalled();
  });

  it.each(["hubspot_email_source_changed", "forbidden", undefined])(
    "keeps %s failures as errors without an agent offer",
    async (errorCode) => {
      const options = args();
      callAction.mockRejectedValue({
        errorCode,
        actionMessage: "Export failed",
      });
      await runDownloadHubspotHtml(options);
      expect(options.onInvalidEmail).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith("Export failed");
    },
  );

  it("does not offer conversion when saving fails", async () => {
    const options = args();
    options.flushPendingFileContentSaves.mockRejectedValue({
      errorCode: "invalid_hubspot_email",
      actionMessage: "Save failed",
    });
    await runDownloadHubspotHtml(options);
    expect(callAction).not.toHaveBeenCalled();
    expect(options.onInvalidEmail).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("Save failed");
  });
});
