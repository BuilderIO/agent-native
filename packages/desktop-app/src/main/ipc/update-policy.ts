const DESKTOP_SSO_CANARY_VERSION = /-desktop-sso-canary\.\d+$/;

export type DesktopUpdateSupport =
  | { supported: true }
  | { supported: false; reason: string };

export function resolveDesktopUpdateSupport(
  isPackaged: boolean,
  version: string,
): DesktopUpdateSupport {
  if (!isPackaged) {
    return {
      supported: false,
      reason: "Auto-update is disabled in development",
    };
  }

  if (DESKTOP_SSO_CANARY_VERSION.test(version)) {
    return {
      supported: false,
      reason: "Auto-update is disabled for this Desktop SSO canary build",
    };
  }

  return { supported: true };
}
