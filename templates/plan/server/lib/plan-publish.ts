import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface PlanPublishAuth {
  url: string;
  token: string;
}

const CONFIG_PATH_ENV = "PLAN_PUBLISH_CONFIG_PATH";

export const DEFAULT_PLAN_HOSTED_URL = "https://plan.agent-native.com";

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

export function planConnectCommand(hostedUrl: string): string {
  return `npx @agent-native/core@latest connect ${hostedUrl}`;
}
