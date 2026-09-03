import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Re-import fresh per test so the module-level version cache does not leak
// between cases (the SHA suffix is computed at call time, but the npm version
// is cached on first read).
async function freshModule() {
  vi.resetModules();
  return import("./builder-gateway-headers.js");
}

describe("builder gateway headers", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the package version with no SHA when no deploy SHA env is set", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    vi.stubEnv("AGENT_NATIVE_BUILD_SHA", "");
    const { getBuilderGatewayClientVersion, getAgentNativeCorePackageVersion } =
      await freshModule();

    const version = getBuilderGatewayClientVersion();
    expect(version).toBe(getAgentNativeCorePackageVersion());
    // No "+sha" suffix when there is no SHA.
    expect(version).not.toContain("+");
  });

  it("appends a 7-char SHA suffix from VERCEL_GIT_COMMIT_SHA", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abcdef1234567890");
    vi.stubEnv("AGENT_NATIVE_BUILD_SHA", "");
    const { getBuilderGatewayClientVersion, getAgentNativeCorePackageVersion } =
      await freshModule();

    const base = getAgentNativeCorePackageVersion();
    expect(getBuilderGatewayClientVersion()).toBe(`${base}+abcdef1`);
  });

  it("prefers VERCEL_GIT_COMMIT_SHA over AGENT_NATIVE_BUILD_SHA", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "1111111aaaa");
    vi.stubEnv("AGENT_NATIVE_BUILD_SHA", "2222222bbbb");
    const { getBuilderGatewayClientVersion, getAgentNativeCorePackageVersion } =
      await freshModule();

    const base = getAgentNativeCorePackageVersion();
    expect(getBuilderGatewayClientVersion()).toBe(`${base}+1111111`);
  });

  it("falls back to AGENT_NATIVE_BUILD_SHA when Vercel SHA is absent", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    vi.stubEnv("AGENT_NATIVE_BUILD_SHA", "deadbeefcafe");
    const { getBuilderGatewayClientVersion, getAgentNativeCorePackageVersion } =
      await freshModule();

    const base = getAgentNativeCorePackageVersion();
    expect(getBuilderGatewayClientVersion()).toBe(`${base}+deadbee`);
  });

  it("ignores a too-short SHA (< 7 chars) and emits only the version", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abc123");
    vi.stubEnv("AGENT_NATIVE_BUILD_SHA", "");
    const { getBuilderGatewayClientVersion, getAgentNativeCorePackageVersion } =
      await freshModule();

    expect(getBuilderGatewayClientVersion()).toBe(
      getAgentNativeCorePackageVersion(),
    );
  });

  it("trims whitespace around the SHA before measuring length", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "   fedcba9   ");
    vi.stubEnv("AGENT_NATIVE_BUILD_SHA", "");
    const { getBuilderGatewayClientVersion, getAgentNativeCorePackageVersion } =
      await freshModule();

    const base = getAgentNativeCorePackageVersion();
    expect(getBuilderGatewayClientVersion()).toBe(`${base}+fedcba9`);
  });

  it("builds stable attribution headers carrying the client version", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    vi.stubEnv("AGENT_NATIVE_BUILD_SHA", "");
    const { getBuilderGatewayRequestHeaders, getBuilderGatewayClientVersion } =
      await freshModule();

    const headers = getBuilderGatewayRequestHeaders();
    expect(headers["x-client-name"]).toBe("@agent-native/core");
    expect(headers["x-client-version"]).toBe(getBuilderGatewayClientVersion());
  });

  it("caches the resolved package version across calls", async () => {
    const { getAgentNativeCorePackageVersion } = await freshModule();
    const first = getAgentNativeCorePackageVersion();
    expect(getAgentNativeCorePackageVersion()).toBe(first);
    expect(typeof first).toBe("string");
    expect(first.length).toBeGreaterThan(0);
  });
});
