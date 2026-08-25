import { ENVIRONMENT_BETA_HOSTS } from "@agent-native/core/shared";

export type DesktopEnvironmentLane = "production" | "beta";
export type DesktopEnvironmentLanePreference = "auto" | DesktopEnvironmentLane;

const BETA_LANE_EMAIL_DOMAIN = "@builder.io";

export function isBetaLaneEmail(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase().endsWith(BETA_LANE_EMAIL_DOMAIN) === true;
}

/**
 * Which hosted lane app webviews load.
 *
 * The hosted page runs the same @builder.io check itself and moves the tab
 * with `location.replace` after its session resolves, which costs a second
 * full document load. The shell already knows the verified email before it
 * navigates, so it picks the lane up front and that redirect never happens.
 */
export function resolveDesktopEnvironmentLane(input: {
  preference: DesktopEnvironmentLanePreference;
  email: string | null | undefined;
}): DesktopEnvironmentLane {
  if (input.preference === "production") return "production";
  // Eligibility gates the beta lane even for an explicit preference. A stored
  // "beta" outlives sign-out, and the Settings control is hidden for an
  // ineligible account — so honoring it would pin the next account on this
  // profile to beta with no way back.
  if (!isBetaLaneEmail(input.email)) return "production";
  return input.preference === "beta" || input.preference === "auto"
    ? "beta"
    : "production";
}

/**
 * Swap a first-party app URL onto the requested lane. The host map is the
 * authority, not the `beta.` prefix: apps without a beta site (tasks, videos)
 * must stay on production rather than resolve to a hostname nothing serves.
 */
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
