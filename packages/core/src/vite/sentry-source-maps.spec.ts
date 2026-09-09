import { describe, it, expect, vi, beforeEach } from "vitest";

const sentryVitePluginMock = vi.hoisted(() =>
  vi.fn(() => [{ name: "sentry-vite-plugin-mock", enforce: "pre" }]),
);

vi.mock("@sentry/vite-plugin", () => ({
  sentryVitePlugin: sentryVitePluginMock,
}));

import {
  createSentrySourceMapUploadPlugin,
  resolveSentrySourceMapUploadConfig,
} from "./sentry-source-maps.js";

describe("vite/sentry-source-maps", () => {
  beforeEach(() => {
    sentryVitePluginMock.mockClear();
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

    it("does not accept the numeric SENTRY_PROJECT_ID as a project slug", () => {
      expect(
        resolveSentrySourceMapUploadConfig({
          SENTRY_AUTH_TOKEN: "tok",
          SENTRY_ORG: "acme",
          SENTRY_PROJECT_ID: "4511270423822336",
        }),
      ).toBeNull();
    });

    it("resolves a full config, falling back to SENTRY_ORG_SLUG", () => {
      const config = resolveSentrySourceMapUploadConfig({
        SENTRY_AUTH_TOKEN: "tok",
        SENTRY_ORG_SLUG: "acme",
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
  });

  describe("createSentrySourceMapUploadPlugin", () => {
    it("returns an empty array and never calls sentryVitePlugin when disabled", () => {
      expect(createSentrySourceMapUploadPlugin({})).toEqual([]);
      expect(sentryVitePluginMock).not.toHaveBeenCalled();
    });

    it("calls sentryVitePlugin with the resolved config when enabled", () => {
      const plugins = createSentrySourceMapUploadPlugin({
        SENTRY_AUTH_TOKEN: "tok",
        SENTRY_ORG: "acme",
        SENTRY_PROJECT: "web",
        AGENT_NATIVE_BUILD_ID: "deploy-42",
      });
      expect(plugins).toHaveLength(1);
      const callArgs = sentryVitePluginMock.mock.calls[0][0];
      expect(callArgs).toMatchObject({
        org: "acme",
        project: "web",
        authToken: "tok",
        release: { name: "agent-native-client@deploy-42", inject: false },
      });
      expect(callArgs.sourcemaps).toBeUndefined();
    });

    it("errorHandler swallows failures instead of throwing", () => {
      createSentrySourceMapUploadPlugin({
        SENTRY_AUTH_TOKEN: "tok",
        SENTRY_ORG: "acme",
        SENTRY_PROJECT: "web",
      });
      const { errorHandler } = sentryVitePluginMock.mock.calls[0][0];
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(() => errorHandler(new Error("bad token"))).not.toThrow();
      warnSpy.mockRestore();
    });
  });
});
