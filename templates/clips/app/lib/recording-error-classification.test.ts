import { describe, expect, it } from "vitest";

import { isPolicyPermissionError } from "./recording-error-classification";

describe("isPolicyPermissionError", () => {
  it("recognizes an explicit Permissions-Policy denial", () => {
    expect(
      isPolicyPermissionError(
        "This page is blocking camera access via Permissions-Policy.",
      ),
    ).toBe(true);
  });

  it("does not treat generic browser or macOS denials as policy failures", () => {
    expect(
      isPolicyPermissionError(
        "Camera access is blocked by the browser, macOS, or this app frame.",
      ),
    ).toBe(false);
  });
});
