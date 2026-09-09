/**
 * Browser Sentry source-map upload for the Vite client build.
 *
 * `client/analytics.ts` has captured browser exceptions in every template
 * since it was introduced, but nothing in the build pipeline ever uploaded a
 * source map or created a Sentry release, so every captured stack trace
 * pointed at minified production code. This closes that gap the same way
 * every other Sentry integration in this framework is wired: read config
 * from env, no-op silently when it's absent, never fail the build over an
 * observability hiccup.
 *
 * The release name here MUST match what `client/analytics.ts` sends as
 * `event.release` at runtime, or uploaded source maps never resolve against
 * captured events. Both sides derive it from the same
 * `resolveAgentNativeBuildId()` env-driven identifier — this module computes
 * it at build time, `clientBuildId()` reads it back at runtime via the
 * `__AGENT_NATIVE_BUILD_ID__` define both paths already share.
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

/** Shared with `client/analytics.ts`'s runtime `event.release`. */
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

/**
 * Resolves upload config from env, or `null` when disabled.
 *
 * Requires all of an auth token, org, and project — a token alone isn't
 * enough to safely guess org/project, and a half-configured plugin would
 * fail every build rather than cleanly no-op.
 */
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

/** `true` when `resolveSentrySourceMapUploadConfig` finds a usable config. */
export function isSentrySourceMapUploadEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return resolveSentrySourceMapUploadConfig(env) !== null;
}

/**
 * Creates the source-map upload plugin for the client build, or `[]` when
 * disabled. Safe to always include in the plugins array regardless of
 * `vite build` vs `vite dev` — `@sentry/vite-plugin`'s own hooks only act
 * during a real Rollup build, so it's inert during dev serving.
 *
 * `outDir` only drives the post-upload cleanup glob (removing `.map` files
 * from the shipped `dist/` so production doesn't serve real source maps
 * publicly); the upload itself reads Vite's build output directly and
 * doesn't need to know the output directory.
 */
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
      // Explicit name so the upload matches `client/analytics.ts`'s runtime
      // `event.release` exactly. `inject: false` because that file already
      // sets `release` itself — letting the plugin also inject its own
      // auto-detected (git-SHA-based) release would create a second,
      // divergent source of truth for the same field.
      name: config.release,
      inject: false,
    },
    sourcemaps: {
      filesToDeleteAfterUpload: [`${outDir}/**/*.map`],
    },
    // Every other Sentry integration in this framework fails open
    // (initServerSentry, ensureSentry) — a bad token, network blip, or
    // org/project typo must never break a customer's production build.
    errorHandler: (error) => {
      console.warn(
        `[agent-native] Sentry source map upload failed (build continues): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    },
  }) as Plugin[];
}
