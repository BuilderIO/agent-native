import { describe, it, expect, vi, beforeEach } from "vitest";

const sentryVitePluginMock = vi.hoisted(() =>
  vi.fn(() => [{ name: "sentry-vite-plugin-mock", enforce: "pre" }]),
);

vi.mock("@sentry/vite-plugin", () => ({
  sentryVitePlugin: sentryVitePluginMock,
}));

import {
  createSentrySourceMapUploadPlugin,
  isSentrySourceMapUploadEnabled,
  resolveSentryClientRelease,
  resolveSentrySourceMapUploadConfig,
} from "./sentry-source-maps.js";

describe("vite/sentry-source-maps", () => {
  beforeEach(() => {
    sentryVitePluginMock.mockClear();
  });

  describe("resolveSentryClientRelease", () => {
    it("uses the build id env vars, matching resolveAgentNativeBuildId", () => {
      expect(
        resolveSentryClientRelease({ AGENT_NATIVE_BUILD_ID: "abc123" }),
      ).toBe("agent-native-client@abc123");
    });

    it("falls back to development when no build id is set", () => {
      expect(resolveSentryClientRelease({})).toBe(
        "agent-native-client@development",
      );
    });
  });

  describe("resolveSentrySourceMapUploadConfig", () => {
    it("returns null when no auth token is set", () => {
      expect(
        resolveSentrySourceMapUploadConfig({
          SENTRY_ORG: "acme",
          SENTRY_PROJECT: "web",
        }),
      ).toBeNull();
    });

    it("returns null when a token is set but org/project are missing", () => {
      expect(
        resolveSentrySourceMapUploadConfig({ SENTRY_AUTH_TOKEN: "tok" }),
      ).toBeNull();
    });

    it("resolves a full config from SENTRY_ORG / SENTRY_PROJECT", () => {
      const config = resolveSentrySourceMapUploadConfig({
        SENTRY_AUTH_TOKEN: "tok",
        SENTRY_ORG: "acme",
        SENTRY_PROJECT: "web",
        AGENT_NATIVE_BUILD_ID: "deploy-42",
      });
      expect(config).toEqual({
        authToken: "tok",
        org: "acme",
        project: "web",
        url: undefined,
        release: "agent-native-client@deploy-42",
      });
    });

    it("falls back to SENTRY_ORG_SLUG and SENTRY_PROJECT_ID", () => {
      const config = resolveSentrySourceMapUploadConfig({
        SENTRY_AUTH_TOKEN: "tok",
        SENTRY_ORG_SLUG: "bridge-tm",
        SENTRY_PROJECT_ID: "4511270386466816",
      });
      expect(config?.org).toBe("bridge-tm");
      expect(config?.project).toBe("4511270386466816");
    });

    it("resolves a custom SENTRY_URL for self-hosted instances", () => {
      const config = resolveSentrySourceMapUploadConfig({
        SENTRY_AUTH_TOKEN: "tok",
        SENTRY_ORG: "acme",
        SENTRY_PROJECT: "web",
        SENTRY_URL: "https://sentry.internal.example.com",
      });
      expect(config?.url).toBe("https://sentry.internal.example.com");
    });
  });

  describe("isSentrySourceMapUploadEnabled", () => {
    it("mirrors resolveSentrySourceMapUploadConfig's null-ness", () => {
      expect(isSentrySourceMapUploadEnabled({})).toBe(false);
      expect(
        isSentrySourceMapUploadEnabled({
          SENTRY_AUTH_TOKEN: "tok",
          SENTRY_ORG: "acme",
          SENTRY_PROJECT: "web",
        }),
      ).toBe(true);
    });
  });

  describe("createSentrySourceMapUploadPlugin", () => {
    it("returns an empty array and never calls sentryVitePlugin when disabled", () => {
      const plugins = createSentrySourceMapUploadPlugin("dist/spa", {});
      expect(plugins).toEqual([]);
      expect(sentryVitePluginMock).not.toHaveBeenCalled();
    });

    it("calls sentryVitePlugin with the resolved config when enabled", () => {
      const plugins = createSentrySourceMapUploadPlugin("dist/spa", {
        SENTRY_AUTH_TOKEN: "tok",
        SENTRY_ORG: "acme",
        SENTRY_PROJECT: "web",
        AGENT_NATIVE_BUILD_ID: "deploy-42",
      });
      expect(plugins).toHaveLength(1);
      expect(sentryVitePluginMock).toHaveBeenCalledTimes(1);
      const callArgs = sentryVitePluginMock.mock.calls[0][0];
      expect(callArgs).toMatchObject({
        org: "acme",
        project: "web",
        authToken: "tok",
        telemetry: false,
        release: {
          name: "agent-native-client@deploy-42",
          inject: false,
        },
        sourcemaps: {
          filesToDeleteAfterUpload: ["dist/spa/**/*.map"],
        },
      });
      expect(callArgs.errorHandler).toBeInstanceOf(Function);
    });

    it("errorHandler swallows failures instead of throwing", () => {
      createSentrySourceMapUploadPlugin("dist/spa", {
        SENTRY_AUTH_TOKEN: "tok",
        SENTRY_ORG: "acme",
        SENTRY_PROJECT: "web",
      });
      const { errorHandler } = sentryVitePluginMock.mock.calls[0][0];
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(() => errorHandler(new Error("bad token"))).not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("bad token"),
      );
      warnSpy.mockRestore();
    });
  });
});
