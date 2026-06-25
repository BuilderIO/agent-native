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

  it("uses the live workspace mount when a configured base belongs to another app", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv("VITE_APP_BASE_PATH", "/dispatch");
    vi.stubGlobal("window", { location: { pathname: "/diagrams" } });

    expect(appBasePath()).toBe("/diagrams");
    expect(agentNativePath("/_agent-native/poll")).toBe(
      "/diagrams/_agent-native/poll",
    );
  });

  it("uses the live workspace route segment for app API paths under nested routes", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv("VITE_APP_BASE_PATH", "/dispatch");
    vi.stubGlobal("window", { location: { pathname: "/diagrams/editor" } });

    expect(appBasePath()).toBe("/diagrams");
    expect(appApiPath("local-migration")).toBe("/diagrams/api/local-migration");
  });

  it("uses the external embed target when a transplanted app runs from srcdoc", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv("VITE_APP_BASE_PATH", "/dispatch");
    vi.stubGlobal("window", {
      location: { pathname: "srcdoc" },
      __AGENT_NATIVE_EXTERNAL_EMBED: {
        target: "/assets/library?mediaType=image",
      },
    });

    expect(appBasePath()).toBe("/assets");
    expect(agentNativePath("/_agent-native/agent-engine/status")).toBe(
      "/assets/_agent-native/agent-engine/status",
    );
  });

  it("keeps a configured workspace base when the current path matches it", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv("VITE_APP_BASE_PATH", "/dispatch");
    vi.stubGlobal("window", { location: { pathname: "/dispatch/overview" } });

    expect(appBasePath()).toBe("/dispatch");
    expect(agentNativePath("/_agent-native/notifications/count")).toBe(
      "/dispatch/_agent-native/notifications/count",
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

  it("uses the configured workspace OAuth origin in workspace mode", () => {
    vi.stubEnv("VITE_AGENT_NATIVE_WORKSPACE", "1");
    vi.stubEnv(
      "VITE_WORKSPACE_OAUTH_ORIGIN",
      "https://workspace.example/dispatch",
    );
    vi.stubEnv("VITE_WORKSPACE_GATEWAY_URL", "http://127.0.0.1:8080");
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

  it("falls back to a public workspace gateway origin in workspace mode", () => {
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
    vi.unstubAllEnvs();
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
    vi.unstubAllEnvs();
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
