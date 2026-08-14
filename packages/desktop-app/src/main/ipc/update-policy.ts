const DESKTOP_SSO_CANARY_VERSION = /-desktop-sso-canary\.\d+$/;

export function isDesktopSsoCanaryVersion(version: string): boolean {
  return DESKTOP_SSO_CANARY_VERSION.test(version);
}

export function resolveDesktopUserDataDirectoryName(
  isPackaged: boolean,
  version: string,
): string | null {
  if (!isPackaged) return "Agent Native Dev";
  if (isDesktopSsoCanaryVersion(version)) return "Agent Native SSO Canary";
  return null;
}

export type DesktopUpdateSupport =
  | { supported: true }
  | { supported: false; reason: string };

export function resolveDesktopUpdateSupport(
  isPackaged: boolean,
  version: string,
  buildChannel = "release",
): DesktopUpdateSupport {
  if (!isPackaged || buildChannel !== "release") {
    return {
      supported: false,
      reason: "Auto-update is unavailable for local development builds",
    };
  }

  if (isDesktopSsoCanaryVersion(version)) {
    return {
      supported: false,
      reason: "Auto-update is disabled for this Desktop SSO canary build",
    };
  }

  return { supported: true };
}
