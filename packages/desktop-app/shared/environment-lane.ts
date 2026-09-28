import { ENVIRONMENT_BETA_HOSTS } from "@agent-native/core/shared";

export type DesktopEnvironmentLane = "production" | "beta";
export type DesktopEnvironmentLanePreference = "auto" | DesktopEnvironmentLane;

const BETA_LANE_EMAIL_DOMAIN = "@builder.io";

export function isBetaLaneEmail(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase().endsWith(BETA_LANE_EMAIL_DOMAIN) === true;
}

export function resolveDesktopEnvironmentLane(input: {
  preference: DesktopEnvironmentLanePreference;
  email: string | null | undefined;
}): DesktopEnvironmentLane {
  if (input.preference === "production") return "production";
  if (!isBetaLaneEmail(input.email)) return "production";
  return input.preference === "beta" || input.preference === "auto"
    ? "beta"
    : "production";
}

export function withDesktopEnvironmentLane(
  rawUrl: string,
  lane: DesktopEnvironmentLane,
): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  if (parsed.protocol !== "https:") return rawUrl;

  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  const productionHost = host.replace(/^beta\./, "");
  const betaHost =
    ENVIRONMENT_BETA_HOSTS[
      productionHost as keyof typeof ENVIRONMENT_BETA_HOSTS
    ];
  if (!betaHost) return rawUrl;

  const target = lane === "beta" ? betaHost : productionHost;
  if (host === target) return rawUrl;
  parsed.hostname = target;
  return parsed.toString();
}
