import { getRequestContext } from "@agent-native/core/server";
import { resolveEnvironmentTargets } from "@agent-native/core/shared";

export type EnvironmentLane = "production" | "beta";

function normalizeHostname(hostname: string | undefined): string | null {
  const normalized = hostname?.trim().toLowerCase().replace(/\.$/, "");
  return normalized || null;
}

export function requestEnvironmentLane(): EnvironmentLane {
  const requestOrigin = getRequestContext()?.requestOrigin;
  if (!requestOrigin) return "production";

  try {
    const hostname = normalizeHostname(new URL(requestOrigin).hostname);
    const targets = resolveEnvironmentTargets(hostname ?? undefined);
    return targets?.betaHost === hostname ? "beta" : "production";
  } catch {
    // coercion-ok: an invalid request origin cannot select a beta lane.
    return "production";
  }
}

export function projectEnvironmentUrl(
  rawUrl: string,
  lane: EnvironmentLane = requestEnvironmentLane(),
): string {
  if (lane !== "beta") return rawUrl;

  try {
    const url = new URL(rawUrl);
    const targets = resolveEnvironmentTargets(url.hostname);
    if (!targets || url.hostname === targets.betaHost) return rawUrl;
    url.protocol = "https:";
    url.hostname = targets.betaHost;
    url.port = "";
    return url.toString();
  } catch {
    // coercion-ok: unknown or malformed optional app URLs stay unchanged and
    // are validated at the boundary where they are used.
    return rawUrl;
  }
}
