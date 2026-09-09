import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { build, type Plugin } from "vite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sentryUpload = vi.hoisted(() => vi.fn<() => Promise<void>>());
const sentryVitePluginMock = vi.hoisted(() =>
  vi.fn((options: { errorHandler: (error: Error) => void }) => [
    {
      name: "sentry-vite-plugin-mock",
      enforce: "pre",
      async writeBundle() {
        try {
          await sentryUpload();
        } catch (error) {
          options.errorHandler(error as Error);
        }
      },
    },
  ]),
);

const temporaryDirectories: string[] = [];

function temporaryBuild(): {
  entryPath: string;
  mapPath: string;
  publishDirectory: string;
} {
  const directory = mkdtempSync(
    path.join(tmpdir(), "agent-native-sourcemaps-"),
  );
  const entryPath = path.join(directory, "entry.js");
  const publishDirectory = path.join(directory, "publish");
  temporaryDirectories.push(directory);
  mkdirSync(publishDirectory);
  writeFileSync(entryPath, "console.log('built');");
  return {
    entryPath,
    mapPath: path.join(publishDirectory, "client.js.map"),
    publishDirectory,
  };
}

async function runViteBuild(
  entryPath: string,
  publishDirectory: string,
  plugins: Plugin[],
): Promise<void> {
  await build({
    configFile: false,
    logLevel: "silent",
    plugins,
    build: {
      emptyOutDir: true,
      lib: {
        entry: entryPath,
        fileName: () => "client.js",
        formats: ["es"],
      },
      outDir: publishDirectory,
      sourcemap: true,
    },
  });
}

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
    sentryUpload.mockReset();
    sentryUpload.mockResolvedValue();
  });

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { force: true, recursive: true });
    }
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
      expect(plugins).toHaveLength(2);
      const callArgs = sentryVitePluginMock.mock.calls[0][0];
      expect(callArgs).toMatchObject({
        org: "acme",
        project: "web",
        authToken: "tok",
        release: { name: "agent-native-client@deploy-42", inject: false },
      });
      expect(callArgs.sourcemaps).toBeUndefined();
      expect(plugins.at(-1)?.name).toBe(
        "agent-native:delete-uploaded-sentry-source-maps",
      );
    });

    it("removes source maps from the publish artifact after upload succeeds", async () => {
      const { entryPath, mapPath, publishDirectory } = temporaryBuild();
      sentryUpload.mockImplementation(async () => {
        expect(existsSync(mapPath)).toBe(true);
      });
      const plugins = createSentrySourceMapUploadPlugin({
        SENTRY_AUTH_TOKEN: "tok",
        SENTRY_ORG: "acme",
        SENTRY_PROJECT: "web",
      });

      await runViteBuild(entryPath, publishDirectory, plugins);

      expect(sentryUpload).toHaveBeenCalledOnce();
      expect(existsSync(mapPath)).toBe(false);
      expect(existsSync(path.join(publishDirectory, "client.js"))).toBe(true);
    });

    it("removes source maps and completes when upload fails", async () => {
      const { entryPath, mapPath, publishDirectory } = temporaryBuild();
      sentryUpload.mockImplementation(async () => {
        expect(existsSync(mapPath)).toBe(true);
        throw new Error("upload rejected");
      });
      const plugins = createSentrySourceMapUploadPlugin({
        SENTRY_AUTH_TOKEN: "tok",
        SENTRY_ORG: "acme",
        SENTRY_PROJECT: "web",
      });

      await runViteBuild(entryPath, publishDirectory, plugins);

      expect(sentryUpload).toHaveBeenCalledOnce();
      expect(existsSync(mapPath)).toBe(false);
      expect(existsSync(path.join(publishDirectory, "client.js"))).toBe(true);
    });
  });
});
