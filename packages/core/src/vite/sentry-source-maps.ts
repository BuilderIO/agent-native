import { rm } from "node:fs/promises";
import path from "node:path";

import { sentryVitePlugin } from "@sentry/vite-plugin";
import type { Plugin, ResolvedConfig } from "vite";

import { resolveAgentNativeBuildId } from "../shared/build-id.js";

function firstNonEmpty(
  ...values: Array<string | undefined>
): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

export function resolveSentryClientRelease(
  env: Record<string, string | undefined>,
): string | null {
  const buildId = resolveAgentNativeBuildId(env, "");
  return buildId ? `agent-native-client@${buildId}` : null;
}

interface SentrySourceMapUploadCredentials {
  authToken: string;
  org: string;
  project: string;
  url?: string;
}

export interface SentrySourceMapUploadConfig extends SentrySourceMapUploadCredentials {
  release: string;
}

// A token alone can't safely guess org/project, and a half-configured plugin
// would fail every build rather than cleanly no-op.
function resolveSentrySourceMapUploadCredentials(
  env: Record<string, string | undefined>,
): SentrySourceMapUploadCredentials | null {
  const authToken = firstNonEmpty(env.SENTRY_AUTH_TOKEN);
  if (!authToken) return null;
  const org = firstNonEmpty(env.SENTRY_ORG, env.SENTRY_ORG_SLUG);
  const project = firstNonEmpty(env.SENTRY_PROJECT, env.SENTRY_CLIENT_PROJECT);
  if (!org || !project) return null;
  return {
    authToken,
    org,
    project,
    url: firstNonEmpty(env.SENTRY_URL),
  };
}

export function resolveSentrySourceMapUploadConfig(
  env: Record<string, string | undefined> = process.env,
): SentrySourceMapUploadConfig | null {
  const credentials = resolveSentrySourceMapUploadCredentials(env);
  const release = resolveSentryClientRelease(env);
  return credentials && release ? { ...credentials, release } : null;
}

export function isSentrySourceMapUploadEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return resolveSentrySourceMapUploadCredentials(env) !== null;
}

function createUploadedSourceMapCleanupPlugin(): Plugin {
  return {
    name: "agent-native:delete-uploaded-sentry-source-maps",
    enforce: "post",
    writeBundle: {
      order: "post",
      sequential: true,
      async handler(outputOptions, bundle) {
        const outputDirectory = outputOptions.dir
          ? outputOptions.dir
          : path.dirname(outputOptions.file!);
        const sourceMapFileNames = Object.values(bundle).flatMap((output) => {
          if (output.type === "asset") {
            return output.fileName.endsWith(".map") ? [output.fileName] : [];
          }
          return output.map ? [`${output.fileName}.map`] : [];
        });
        await Promise.all(
          sourceMapFileNames.map((fileName) =>
            rm(path.join(outputDirectory, fileName), { force: true }),
          ),
        );
      },
    },
  };
}

function resolvedClientBuildId(config: ResolvedConfig): string | null {
  const definedBuildId = config.define?.__AGENT_NATIVE_BUILD_ID__;
  if (typeof definedBuildId !== "string") return null;
  const buildId: unknown = JSON.parse(definedBuildId);
  return typeof buildId === "string" && buildId.trim() ? buildId.trim() : null;
}

export function createSentrySourceMapUploadPlugin(
  env: Record<string, string | undefined> = process.env,
): Plugin[] {
  const credentials = resolveSentrySourceMapUploadCredentials(env);
  if (!credentials) return [];

  let uploadPlugin: Plugin | undefined;
  const proxyPlugin: Plugin = {
    name: "sentry-vite-plugin",
    enforce: "pre",
    configResolved(config) {
      if (config.command !== "build") return;
      const buildId = resolvedClientBuildId(config);
      if (!buildId) {
        console.warn(
          "Sentry source map upload skipped because the client build ID is missing; generated source maps will still be removed.",
        );
        return;
      }
      const uploadConfig: SentrySourceMapUploadConfig = {
        ...credentials,
        release: `agent-native-client@${buildId}`,
      };
      const sentryPlugin = sentryVitePlugin({
        org: uploadConfig.org,
        project: uploadConfig.project,
        authToken: uploadConfig.authToken,
        url: uploadConfig.url,
        telemetry: false,
        release: {
          name: uploadConfig.release,
          inject: false,
        },
        // A source-map upload is optional observability work. The cleanup plugin
        // still removes maps when this handler returns, so a bad token cannot
        // block the deploy or publish source contents.
        errorHandler: (error) => {
          const message = (
            error instanceof Error ? error.message : String(error)
          ).replaceAll(uploadConfig.authToken, "[redacted]");
          console.warn(
            `Sentry source map upload failed; continuing without publishing source maps: ${message}`,
          );
        },
      }) as Plugin | Plugin[];
      uploadPlugin = Array.isArray(sentryPlugin)
        ? sentryPlugin[0]
        : sentryPlugin;
    },
    buildStart(options) {
      const hook = uploadPlugin?.buildStart;
      if (typeof hook === "function") return hook.call(this, options);
    },
    renderChunk(code, chunk, outputOptions, meta) {
      const hook = uploadPlugin?.renderChunk;
      if (typeof hook === "function") {
        return hook.call(this, code, chunk, outputOptions, meta);
      }
    },
    writeBundle(outputOptions, bundle) {
      const hook = uploadPlugin?.writeBundle;
      if (typeof hook === "function") {
        return hook.call(this, outputOptions, bundle);
      }
    },
  };

  return [proxyPlugin, createUploadedSourceMapCleanupPlugin()];
}
