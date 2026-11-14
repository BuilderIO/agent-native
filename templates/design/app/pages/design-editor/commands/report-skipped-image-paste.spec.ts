import { beforeEach, describe, expect, it, vi } from "vitest";

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) },
}));

import {
  MAX_IMAGE_PASTE_FILE_MB,
  MAX_IMAGE_PASTE_FILES,
} from "@/components/design/design-canvas/image-paste-files";

import { runReportSkippedImagePaste } from "./report-skipped-image-paste";

const t = (key: string, options?: Record<string, unknown>) =>
  `${key} ${JSON.stringify(options ?? {})}`;

describe("runReportSkippedImagePaste", () => {
  beforeEach(() => {
    toastError.mockClear();
  });

  it("stays silent when nothing was skipped", () => {
    runReportSkippedImagePaste({ t }, { tooMany: 0, tooLarge: 0, invalid: 0 });
    expect(toastError).not.toHaveBeenCalled();
  });

  it("says how many files were over the count cap and what the cap is", () => {
    runReportSkippedImagePaste({ t }, { tooMany: 5, tooLarge: 0, invalid: 0 });
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith(
      t("designEditor.toasts.pasteMediaTooMany", {
        count: 5,
        limit: MAX_IMAGE_PASTE_FILES,
      }),
    );
  });

  it("says how many files were too large and the size limit in MB", () => {
    runReportSkippedImagePaste({ t }, { tooMany: 0, tooLarge: 2, invalid: 0 });
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith(
      t("designEditor.toasts.pasteMediaTooLarge", {
        count: 2,
        limitMb: MAX_IMAGE_PASTE_FILE_MB,
      }),
    );
  });

  it("reports each reason in its own toast when both happened", () => {
    runReportSkippedImagePaste({ t }, { tooMany: 1, tooLarge: 3, invalid: 0 });
    expect(toastError.mock.calls.map(([message]) => message)).toEqual([
      t("designEditor.toasts.pasteMediaTooMany", {
        count: 1,
        limit: MAX_IMAGE_PASTE_FILES,
      }),
      t("designEditor.toasts.pasteMediaTooLarge", {
        count: 3,
        limitMb: MAX_IMAGE_PASTE_FILE_MB,
      }),
    ]);
  });

  it("reports unreadable entries with the generic error", () => {
    runReportSkippedImagePaste({ t }, { tooMany: 0, tooLarge: 0, invalid: 1 });
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith(t("common.genericError"));
  });
});
