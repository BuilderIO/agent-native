/**
 * The release name here MUST match what `client/analytics.ts` sends as
 * `event.release` at runtime, or uploaded source maps never resolve against
 * captured events. Both derive it from the same `resolveAgentNativeBuildId()`
 * identifier so they can't drift apart independently.
 */
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
  const project = firstNonEmpty(
    env.SENTRY_PROJECT,
    env.SENTRY_CLIENT_PROJECT,
    env.SENTRY_PROJECT_ID,
  );
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

// Safe to always include in the plugins array regardless of `vite build` vs
// `vite dev` — `@sentry/vite-plugin`'s hooks only act during a real Rollup
// build. `outDir` only drives the post-upload `.map` cleanup glob; the
// upload itself reads Vite's build output directly.
export function createSentrySourceMapUploadPlugin(
  outDir: string,
  env: Record<string, string | undefined> = process.env,
): Plugin[] {
  const config = resolveSentrySourceMapUploadConfig(env);
  if (!config) return [];
  return sentryVitePlugin({
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
    sourcemaps: {
      filesToDeleteAfterUpload: [`${outDir}/**/*.map`],
    },
    // Every other Sentry integration in this framework fails open — a bad
    // token or org/project typo must never break a customer's production build.
    errorHandler: (error) => {
      console.warn(
        `[agent-native] Sentry source map upload failed (build continues): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    },
  }) as Plugin[];
}
