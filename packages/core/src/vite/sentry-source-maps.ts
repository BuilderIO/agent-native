/**
 * The release name here MUST match what `client/analytics.ts` sends as
 * `event.release` at runtime, or uploaded source maps never resolve against
 * captured events. Both derive it from the same `resolveAgentNativeBuildId()`
 * identifier so they can't drift apart independently.
 */
import { readdir, rm } from "node:fs/promises";
import path from "node:path";

import { sentryVitePlugin } from "@sentry/vite-plugin";
import type { Plugin } from "vite";

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
): string {
  return `agent-native-client@${resolveAgentNativeBuildId(env, "development")}`;
}

export interface SentrySourceMapUploadConfig {
  authToken: string;
  org: string;
  project: string;
  url?: string;
  release: string;
}

// A token alone can't safely guess org/project, and a half-configured plugin
// would fail every build rather than cleanly no-op.
export function resolveSentrySourceMapUploadConfig(
  env: Record<string, string | undefined> = process.env,
): SentrySourceMapUploadConfig | null {
  const authToken = firstNonEmpty(env.SENTRY_AUTH_TOKEN);
  if (!authToken) return null;
  const org = firstNonEmpty(env.SENTRY_ORG, env.SENTRY_ORG_SLUG);
  // SENTRY_PROJECT_ID is the numeric DSN project id used elsewhere in this
  // repo (sentry-config.ts) — not a valid value for the plugin's `project`
  // option, which wants the project slug. Passing the numeric id would
  // silently target the wrong project instead of cleanly no-oping.
  const project = firstNonEmpty(env.SENTRY_PROJECT, env.SENTRY_CLIENT_PROJECT);
  if (!org || !project) return null;
  return {
    authToken,
    org,
    project,
    url: firstNonEmpty(env.SENTRY_URL),
    release: resolveSentryClientRelease(env),
  };
}

export function isSentrySourceMapUploadEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return resolveSentrySourceMapUploadConfig(env) !== null;
}

async function removeSourceMaps(directory: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await removeSourceMaps(filePath);
      } else if (entry.name.endsWith(".map")) {
        await rm(filePath, { force: true });
      }
    }),
  );
}

function createUploadedSourceMapCleanupPlugin(): Plugin {
  return {
    name: "agent-native:delete-uploaded-sentry-source-maps",
    enforce: "post",
    writeBundle: {
      order: "post",
      sequential: true,
      async handler(outputOptions) {
        if (outputOptions.dir) {
          await removeSourceMaps(outputOptions.dir);
        } else if (outputOptions.file) {
          await rm(`${outputOptions.file}.map`, { force: true });
        }
      },
    },
  };
}

// Safe to always include in the plugins array regardless of `vite build` vs
// `vite dev` — `@sentry/vite-plugin`'s hooks only act during a real Rollup
// build.
export function createSentrySourceMapUploadPlugin(
  env: Record<string, string | undefined> = process.env,
): Plugin[] {
  const config = resolveSentrySourceMapUploadConfig(env);
  if (!config) return [];
  const uploadPlugins = sentryVitePlugin({
    org: config.org,
    project: config.project,
    authToken: config.authToken,
    url: config.url,
    telemetry: false,
    release: {
      // inject: false — client/analytics.ts already sets `release` itself;
      // letting the plugin also inject its own git-SHA-based release would
      // create a second, divergent source of truth for the same field.
      name: config.release,
      inject: false,
    },
    // A source-map upload is optional observability work. The cleanup plugin
    // still removes maps when this handler returns, so a bad token cannot
    // block the deploy or publish source contents.
    errorHandler: () => {
      console.warn(
        "Sentry source map upload failed; continuing without publishing source maps.",
      );
    },
  }) as Plugin[];

  return [...uploadPlugins, createUploadedSourceMapCleanupPlugin()];
}
