// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { UploadError } from "./upload";
import { toastStorageSetupFailure, toastUploadFailure } from "./upload-toast";

const mocks = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock("sonner", () => ({ toast: { error: mocks.error } }));

const labels = {
  builderRefused: "Builder.io refused the connection (translated).",
  storageRefused: "The bucket refused the upload (translated).",
  storageNotConfigured: "Storage isn't set up (translated).",
  openStorageSettings: "Open storage settings",
  reconnectBuilder: "Reconnect Builder.io",
  useOwnStorage: "Use your own storage",
};

describe("toastUploadFailure", () => {
  afterEach(() => {
    mocks.error.mockReset();
    vi.restoreAllMocks();
  });

  it("offers reconnecting Builder.io or the workspace's own storage when Builder refused", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    toastUploadFailure(
      new UploadError("Server text in English.", "builder-refused"),
      "Failed to attach file",
      labels,
    );

    const [message, options] = mocks.error.mock.lastCall ?? [];
    expect(message).toBe("Builder.io refused the connection (translated).");
    expect(options.action.label).toBe("Reconnect Builder.io");
    options.action.onClick();
    expect(open).toHaveBeenLastCalledWith(
      expect.stringMatching(/\/settings\/model$/),
      "_blank",
      "noopener",
    );
    expect(options.cancel.label).toBe("Use your own storage");
    options.cancel.onClick();
    expect(open).toHaveBeenLastCalledWith(
      expect.stringMatching(/\/settings\/infra#uploads$/),
      "_blank",
      "noopener",
    );
  });

  it.each([
    ["storage-refused", "The bucket refused the upload (translated)."],
    ["not-configured", "Storage isn't set up (translated)."],
  ] as const)(
    "opens File uploads and storage when the reason is %s",
    (reason, translated) => {
      const open = vi.spyOn(window, "open").mockImplementation(() => null);

      toastUploadFailure(
        new UploadError("Server text in English.", reason),
        "Failed to attach file",
        labels,
      );

      const [message, options] = mocks.error.mock.lastCall ?? [];
      expect(message).toBe(translated);
      expect(options.action.label).toBe("Open storage settings");
      expect(options.cancel).toBeUndefined();
      options.action.onClick();
      expect(open).toHaveBeenCalledWith(
        expect.stringMatching(/\/settings\/infra#uploads$/),
        "_blank",
        "noopener",
      );
    },
  );

  it("shows the server's reason with no action otherwise", () => {
    toastUploadFailure(
      new UploadError("File too large (max 10 MB)", null),
      "Failed to attach file",
      labels,
    );

    expect(mocks.error).toHaveBeenCalledWith("File too large (max 10 MB)");
  });

  it("uses the fallback when the failure has no message", () => {
    toastUploadFailure("nope", "Failed to attach file", labels);

    expect(mocks.error).toHaveBeenCalledWith("Failed to attach file");
  });
});

describe("toastStorageSetupFailure", () => {
  afterEach(() => {
    mocks.error.mockReset();
  });

  it("leaves any other failure to the caller", () => {
    expect(
      toastStorageSetupFailure(new TypeError("Failed to fetch"), labels),
    ).toBe(false);
    expect(
      toastStorageSetupFailure(new UploadError("Upload failed", null), labels),
    ).toBe(false);
    expect(mocks.error).not.toHaveBeenCalled();
  });
});
