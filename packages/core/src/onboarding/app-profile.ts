import { getAppConfig } from "../app-config/index.js";
import {
  getOnboardingAppProfileForId,
  normalizeOnboardingAppId,
} from "./app-profile-data.js";
import type { OnboardingAppProfile } from "./types.js";

export { getOnboardingAppProfileForId } from "./app-profile-data.js";

export function resolveOnboardingAppId(explicit?: string): string {
  const config = getAppConfig();
  return normalizeOnboardingAppId(
    explicit ?? config.app.id ?? config.app.packageName,
  );
}

export function getOnboardingAppProfile(appId?: string): OnboardingAppProfile {
  return getOnboardingAppProfileForId(resolveOnboardingAppId(appId));
}
