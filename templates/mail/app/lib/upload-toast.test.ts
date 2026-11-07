// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { UploadError } from "./upload";
import { toastImageUploadFailure, toastUploadFailure } from "./upload-toast";

const mocks = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock("sonner", () => ({ toast: { error: mocks.error } }));

describe("toastUploadFailure", () => {
  afterEach(() => {
    mocks.error.mockReset();
    vi.restoreAllMocks();
  });

  it("offers Settings in a new tab when storage needs reconnecting", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    toastUploadFailure(
      new UploadError("Builder.io rejected the connection.", true),
      "Failed to attach file",
      "Open settings",
    );

    const [message, options] = mocks.error.mock.lastCall ?? [];
    expect(message).toBe("Builder.io rejected the connection.");
    expect(options.action.label).toBe("Open settings");
    options.action.onClick();
    expect(open).toHaveBeenCalledWith(
      expect.stringMatching(/\/settings\/model$/),
      "_blank",
      "noopener",
    );
  });

  it("shows the server's reason with no action otherwise", () => {
    toastUploadFailure(
      new UploadError("File too large (max 10 MB)", false),
      "Failed to attach file",
      "Open settings",
    );

    expect(mocks.error).toHaveBeenCalledWith("File too large (max 10 MB)");
  });

  it("uses the fallback when the failure has no message", () => {
    toastUploadFailure("nope", "Failed to attach file", "Open settings");

    expect(mocks.error).toHaveBeenCalledWith("Failed to attach file");
  });

  it("keeps an image failure's translated message", () => {
    toastImageUploadFailure(
      new TypeError("Failed to fetch"),
      "Failed to upload image",
      "Open settings",
    );

    expect(mocks.error).toHaveBeenCalledWith("Failed to upload image");
  });

  it("still offers Settings when an image needs storage reconnected", () => {
    toastImageUploadFailure(
      new UploadError("Builder.io rejected the connection.", true),
      "Failed to upload image",
      "Open settings",
    );

    const [message, options] = mocks.error.mock.lastCall ?? [];
    expect(message).toBe("Builder.io rejected the connection.");
    expect(options.action.label).toBe("Open settings");
  });
});
