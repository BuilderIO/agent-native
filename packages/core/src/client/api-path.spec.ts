import { afterEach, describe, expect, it, vi } from "vitest";
import {
  agentNativePath,
  appApiPath,
  appBasePath,
  appPath,
} from "./api-path.js";
import { oauthRedirectUri } from "./frame.js";

describe("agentNativePath", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
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

describe("oauthRedirectUri", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("uses the mounted callback path outside workspace mode", () => {
    vi.stubGlobal("window", {
      location: {
        origin: "https://workspace.example",
        pathname: "/calendar/_agent-native/google/auth-url",
      },
    });

    expect(oauthRedirectUri("/_agent-native/google/callback")).toBe(
      "https://workspace.example/calendar/_agent-native/google/callback",
    );
  });

  it("uses the root callback relay in workspace mode", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubGlobal("window", {
      location: {
        origin: "https://workspace.example",
        pathname: "/calendar/_agent-native/google/auth-url",
      },
    });

    expect(oauthRedirectUri("/_agent-native/google/callback")).toBe(
      "https://workspace.example/_agent-native/google/callback",
    );
  });

  it("uses the configured workspace gateway origin in workspace mode", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv(
      "VITE_WORKSPACE_GATEWAY_URL",
      "https://workspace.example/dispatch",
    );
    vi.stubGlobal("window", {
      location: {
        origin:
          "https://940ebc5a83164aa6a37dde445e494f3a-thunder-handle-xmq6tgfy.builderio.xyz",
        pathname: "/dispatch/_agent-native/google/auth-url",
      },
    });

    expect(oauthRedirectUri("/_agent-native/google/callback")).toBe(
      "https://workspace.example/_agent-native/google/callback",
    );
  });
});

describe("appPath", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prefixes app-local root paths from the current mounted pathname", () => {
    vi.stubGlobal("window", {
      location: { pathname: "/docs/_agent-native/auth/reset" },
    });

    expect(appPath("/api/local-migration")).toBe("/docs/api/local-migration");
    expect(appPath("/settings")).toBe("/docs/settings");
  });

  it("does not double-prefix already mounted paths", () => {
    vi.stubGlobal("window", {
      location: { pathname: "/docs/_agent-native/auth/reset" },
    });

    expect(appPath("/docs/api/local-migration")).toBe(
      "/docs/api/local-migration",
    );
  });

  it("leaves relative paths alone", () => {
    vi.stubGlobal("window", {
      location: { pathname: "/docs/_agent-native/auth/reset" },
    });

    expect(appPath("api/local-migration")).toBe("api/local-migration");
  });
});

describe("appApiPath", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes app-local API paths and applies the app base path", () => {
    vi.stubGlobal("window", {
      location: { pathname: "/docs/_agent-native/auth/reset" },
    });

    expect(appApiPath("local-migration")).toBe("/docs/api/local-migration");
    expect(appApiPath("/api/local-migration")).toBe(
      "/docs/api/local-migration",
    );
  });
});
