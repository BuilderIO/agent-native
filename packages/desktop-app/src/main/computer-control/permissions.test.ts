import { describe, expect, it, vi } from "vitest";

import {
  getComputerPermissionStatus,
  requestAccessibilityPermission,
} from "./permissions";

describe("computer control permissions", () => {
  it("reads Screen Recording and Accessibility state from Electron", () => {
    const systemPreferences = {
      getMediaAccessStatus: vi.fn(() => "granted" as const),
      isTrustedAccessibilityClient: vi.fn(() => true),
    };

    expect(getComputerPermissionStatus(systemPreferences)).toEqual({
      screenRecording: "granted",
      accessibility: true,
    });
    expect(systemPreferences.getMediaAccessStatus).toHaveBeenCalledWith(
      "screen",
    );
    expect(systemPreferences.isTrustedAccessibilityClient).toHaveBeenCalledWith(
      false,
    );
  });

  it("only prompts for Accessibility when explicitly requested", () => {
    const systemPreferences = {
      getMediaAccessStatus: vi.fn(() => "not-determined" as const),
      isTrustedAccessibilityClient: vi.fn(() => false),
    };

    requestAccessibilityPermission(systemPreferences);
    expect(systemPreferences.isTrustedAccessibilityClient).toHaveBeenCalledWith(
      true,
    );
  });
});
