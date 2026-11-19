/// <reference types="vite/client" />

import type { DesktopOnboardingHost } from "./components/OnboardingHostSlot.js";

function isOnboardingHost(value: unknown): value is DesktopOnboardingHost {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof Reflect.get(value, "appId") === "string" &&
    typeof Reflect.get(value, "render") === "function"
  );
}

/**
 * Reads the `onboardingHosts` export of each module a build drops into
 * `src/renderer/host-extensions/`. The directory is empty upstream; a module
 * with a malformed export throws instead of being skipped.
 */
export function collectDesktopOnboardingHosts(
  modules: Record<string, unknown>,
): DesktopOnboardingHost[] {
  return Object.entries(modules)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([file, mod]) => {
      const hosts =
        mod !== null && typeof mod === "object"
          ? Reflect.get(mod, "onboardingHosts")
          : undefined;
      if (!Array.isArray(hosts) || !hosts.every(isOnboardingHost))
        throw new Error(
          `${file} must export \`onboardingHosts\`: an array of { appId, render }`,
        );
      return hosts;
    });
}

export const desktopOnboardingHosts: readonly DesktopOnboardingHost[] =
  collectDesktopOnboardingHosts(
    import.meta.glob("./host-extensions/*.tsx", { eager: true }),
  );
