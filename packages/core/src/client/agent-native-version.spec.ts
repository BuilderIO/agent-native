// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  formatAgentNativeDiagnostics,
  getAgentNativeDiagnostics,
  getAgentNativePackageVersions,
} from "./agent-native-version.js";

describe("Agent-Native build metadata", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads and sorts the package versions embedded in the client build", () => {
    vi.stubGlobal("__AGENT_NATIVE_PACKAGE_VERSIONS__", {
      "@agent-native/toolkit": "0.16.8",
      "@agent-native/core": "0.165.4",
      unrelated: "ignored",
    });

    expect(getAgentNativePackageVersions()).toEqual([
      { name: "@agent-native/core", version: "0.165.4" },
      { name: "@agent-native/toolkit", version: "0.16.8" },
    ]);
  });

  it("formats safe support diagnostics without including unrelated globals", () => {
    vi.stubGlobal("__AGENT_NATIVE_PACKAGE_VERSIONS__", {
      "@agent-native/core": "0.165.4",
    });

    expect(getAgentNativeDiagnostics()).toEqual({
      buildId: "development",
      environment: "unknown",
      packages: { "@agent-native/core": "0.165.4" },
    });
    expect(JSON.parse(formatAgentNativeDiagnostics())).toEqual(
      getAgentNativeDiagnostics(),
    );
  });
});
