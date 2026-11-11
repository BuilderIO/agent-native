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
  builderRefusedAskAdmin: "Builder.io refused; ask an admin (translated).",
  storageRefusedAskAdmin: "The bucket refused; ask an admin (translated).",
  storageNotConfiguredAskAdmin: "No storage; ask an admin (translated).",
  connectBuilder: "Connect Builder.io",
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
      true,
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
        true,
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
      true,
    );

    expect(mocks.error).toHaveBeenCalledWith("File too large (max 10 MB)");
  });

  it("uses the fallback when the failure has no message", () => {
    toastUploadFailure("nope", "Failed to attach file", labels, true);

    expect(mocks.error).toHaveBeenCalledWith("Failed to attach file");
  });
});

describe("toastUploadFailure for someone who can't change workspace storage", () => {
  afterEach(() => {
    mocks.error.mockReset();
    vi.restoreAllMocks();
  });

  it("offers only reconnecting Builder.io when Builder refused", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    toastUploadFailure(
      new UploadError("Server text in English.", "builder-refused"),
      "Failed to attach file",
      labels,
      false,
    );

    const [message, options] = mocks.error.mock.lastCall ?? [];
    expect(message).toBe("Builder.io refused; ask an admin (translated).");
    expect(options.action.label).toBe("Reconnect Builder.io");
    expect(options.cancel).toBeUndefined();
    options.action.onClick();
    expect(open).toHaveBeenCalledWith(
      expect.stringMatching(/\/settings\/model$/),
      "_blank",
      "noopener",
    );
  });

  it("asks for an owner or admin, with no button, when the bucket refused", () => {
    toastUploadFailure(
      new UploadError("Server text in English.", "storage-refused"),
      "Failed to attach file",
      labels,
      false,
    );

    expect(mocks.error).toHaveBeenCalledWith(
      "The bucket refused; ask an admin (translated).",
    );
  });

  it("offers connecting their own Builder.io when nothing is set up", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    toastUploadFailure(
      new UploadError("Server text in English.", "not-configured"),
      "Failed to attach file",
      labels,
      false,
    );

    const [message, options] = mocks.error.mock.lastCall ?? [];
    expect(message).toBe("No storage; ask an admin (translated).");
    expect(options.action.label).toBe("Connect Builder.io");
    options.action.onClick();
    expect(open).toHaveBeenCalledWith(
      expect.stringMatching(/\/settings\/model$/),
      "_blank",
      "noopener",
    );
  });

  it("never links to File uploads and storage", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    for (const reason of [
      "builder-refused",
      "storage-refused",
      "not-configured",
    ] as const) {
      toastUploadFailure(
        new UploadError("Server text in English.", reason),
        "Failed to attach file",
        labels,
        false,
      );
      const options = mocks.error.mock.lastCall?.[1];
      options?.action?.onClick();
      options?.cancel?.onClick();
    }

    for (const [href] of open.mock.calls) {
      expect(String(href)).not.toMatch(/\/settings\/infra/);
    }
  });
});

describe("toastStorageSetupFailure", () => {
  afterEach(() => {
    mocks.error.mockReset();
  });

  it("leaves any other failure to the caller", () => {
    expect(
      toastStorageSetupFailure(new TypeError("Failed to fetch"), labels, true),
    ).toBe(false);
    expect(
      toastStorageSetupFailure(
        new UploadError("Upload failed", null),
        labels,
        true,
      ),
    ).toBe(false);
    expect(mocks.error).not.toHaveBeenCalled();
  });
});
