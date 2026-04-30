import { afterEach, describe, expect, it, vi } from "vitest";
import { agentNativePath, appBasePath } from "./api-path.js";

describe("agentNativePath", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("leaves non-framework paths alone", () => {
    vi.stubGlobal("window", { location: { pathname: "/docs/dashboard" } });

    expect(agentNativePath("/api/local-migration")).toBe(
      "/api/local-migration",
    );
  });

  it("prefixes framework paths from the current mounted pathname", () => {
    vi.stubGlobal("window", {
      location: { pathname: "/docs/_agent-native/auth/reset" },
    });

    expect(appBasePath()).toBe("/docs");
    expect(agentNativePath("/_agent-native/auth/session")).toBe(
      "/docs/_agent-native/auth/session",
    );
  });

  it("does not add a prefix when no mounted framework marker is present", () => {
    vi.stubGlobal("window", { location: { pathname: "/settings" } });

    expect(appBasePath()).toBe("");
    expect(agentNativePath("/_agent-native/org/members")).toBe(
      "/_agent-native/org/members",
    );
  });
});
