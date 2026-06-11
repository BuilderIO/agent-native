/**
 * Publish bridge: read the hosted base URL + auth token used by
 * `publish-visual-plan` to push a local plan to a hosted Agent-Native instance.
 *
 * CONTRACT (consumed by `publish-visual-plan`, written by `agent-native connect`
 * — owned by the CLI/auth agent):
 *
 * The hosted base URL and a bearer token are resolved in priority order:
 *   1. Env vars — `PLAN_PUBLISH_URL` (or `PLAN_HOSTED_URL`) and
 *      `PLAN_PUBLISH_TOKEN` (or `AGENT_NATIVE_TOKEN`).
 *   2. A JSON config file at `PLAN_PUBLISH_CONFIG_PATH`, defaulting to
 *      `~/.agent-native/plan-publish.json`, shaped like:
 *        { "url": "https://plan.agent-native.com", "token": "<bearer>" }
 *      (also accepts `baseUrl`/`hostedUrl` and `accessToken`/`bearerToken`).
 *
 * This mirrors the existing device-token config precedent in
 * `packages/core/src/cli/code-agent-connector.ts`
 * (`~/.agent-native/remote-device.json`). `agent-native connect <hosted-url>`
 * already mints a token via the device-code flow; that flow should additionally
 * persist `{ url, token }` to this file (or the env vars) so the server can
 * publish on the user's behalf. Until then, the action returns a structured
 * `needsAuth` result instead of throwing, so the client can trigger lazy
 * account creation.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface PlanPublishAuth {
  url: string;
  token: string;
}

const CONFIG_PATH_ENV = "PLAN_PUBLISH_CONFIG_PATH";

/** Default hosted base URL surfaced to the user when no token is configured. */
export const DEFAULT_PLAN_HOSTED_URL = "https://plan.agent-native.com";

/** Absolute path to the publish config file for this process. */
export function planPublishConfigPath(): string {
  return path.resolve(
    process.env[CONFIG_PATH_ENV] ??
      path.join(os.homedir(), ".agent-native", "plan-publish.json"),
  );
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Resolve the hosted base URL the user would connect to, even when no token is
 * configured (used to surface the connect command / auth URL on `needsAuth`).
 */
export function resolvePlanHostedUrl(): string {
  const fromEnv = firstString(
    process.env.PLAN_PUBLISH_URL,
    process.env.PLAN_HOSTED_URL,
  );
  if (fromEnv) return stripTrailingSlash(fromEnv);

  try {
    const raw = JSON.parse(
      fs.readFileSync(planPublishConfigPath(), "utf-8"),
    ) as unknown;
    if (raw && typeof raw === "object") {
      const url = firstString(
        (raw as Record<string, unknown>).url,
        (raw as Record<string, unknown>).baseUrl,
        (raw as Record<string, unknown>).hostedUrl,
      );
      if (url) return stripTrailingSlash(url);
    }
  } catch {
    // No config file — fall through to the default.
  }
  return DEFAULT_PLAN_HOSTED_URL;
}

/**
 * Resolve `{ url, token }` for publishing, or `null` when no token is available
 * (i.e. the device has not connected an account yet).
 */
export function resolvePlanPublishAuth(): PlanPublishAuth | null {
  const envToken = firstString(
    process.env.PLAN_PUBLISH_TOKEN,
    process.env.AGENT_NATIVE_TOKEN,
  );
  const envUrl = firstString(
    process.env.PLAN_PUBLISH_URL,
    process.env.PLAN_HOSTED_URL,
  );
  if (envToken && envUrl) {
    return { url: stripTrailingSlash(envUrl), token: envToken };
  }

  try {
    const raw = JSON.parse(
      fs.readFileSync(planPublishConfigPath(), "utf-8"),
    ) as unknown;
    if (!raw || typeof raw !== "object") return null;
    const rec = raw as Record<string, unknown>;
    const token = firstString(
      rec.token,
      rec.accessToken,
      rec.bearerToken,
      // Env token can still pair with a file URL.
      envToken,
    );
    const url = firstString(rec.url, rec.baseUrl, rec.hostedUrl, envUrl);
    if (!token || !url) return null;
    return { url: stripTrailingSlash(url), token };
  } catch {
    // Env token without an env URL, or no config file — cannot publish.
    return null;
  }
}

/** The command a user runs to connect an account for publishing. */
export function planConnectCommand(hostedUrl: string): string {
  return `npx @agent-native/core@latest connect ${hostedUrl}`;
}
