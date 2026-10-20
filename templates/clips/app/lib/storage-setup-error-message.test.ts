import { describe, expect, it } from "vitest";

import {
  storageAwareErrorMessage,
  storageSetupErrorMessage,
} from "./storage-setup-error-message";

describe("storageSetupErrorMessage", () => {
  it("uses the localized message for storage setup failures", () => {
    expect(
      storageSetupErrorMessage(
        { errorCode: "storage_setup_required" },
        "Localized storage prompt",
      ),
    ).toBe("Localized storage prompt");
  });

  it("leaves other errors to the existing error path", () => {
    expect(
      storageSetupErrorMessage({ errorCode: "database_error" }, "Localized"),
    ).toBeUndefined();
    expect(storageSetupErrorMessage(new Error("failed"), "Localized")).toBe(
      undefined,
    );
  });

  it("prefers the localized storage prompt for a failed background result", () => {
    expect(
      storageAwareErrorMessage(
        {
          status: "failed",
          error: "Storage setup required",
          errorCode: "storage_setup_required",
        },
        "Localized storage prompt",
        "Generic failure",
      ),
    ).toBe("Localized storage prompt");
  });

  it("uses a nonempty error message and falls back for empty messages", () => {
    expect(
      storageAwareErrorMessage(
        new Error("Provider unavailable"),
        "Storage",
        "Failed",
      ),
    ).toBe("Provider unavailable");
    expect(storageAwareErrorMessage(new Error(""), "Storage", "Failed")).toBe(
      "Failed",
    );
    expect(storageAwareErrorMessage({ error: "" }, "Storage", "Failed")).toBe(
      "Failed",
    );
  });
});
