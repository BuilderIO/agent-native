import { describe, expect, it } from "vitest";

import { storageSetupErrorMessage } from "./storage-setup-error-message";

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
});
