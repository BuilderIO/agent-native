import { readFileSync } from "node:fs";
import path from "node:path";

import { listFirstRunOnboardingExtensions } from "@agent-native/core/client/onboarding/first-run-registry";
import { describe, expect, it } from "vitest";

// Importing the module registers the extension, which is what the root layout
// does at boot.
import "./AnalyticsFirstRun";

const config = JSON.parse(
  readFileSync(path.join(process.cwd(), "agent-native.json"), "utf8"),
) as { onboarding?: { firstRun?: string } };

/**
 * Row 145: a first run must open the app's setup screen ("Start your first
 * analysis", sample datasets, a file, Skip) instead of dropping into the
 * dashboard with a checklist. The screen only ever renders when the app's own
 * first-run mode is on and the surface is handed to the provider: the mode was
 * "off", so the registered extension was never mounted.
 */
describe("first run onboarding", () => {
  it("runs the app's own first-run surface rather than switching it off", () => {
    expect(config.onboarding?.firstRun).toBe("app");
  });

  it("registers the setup screen as the first-run extension", () => {
    const extensions = listFirstRunOnboardingExtensions();
    expect(extensions.map((extension) => extension.id)).toContain(
      "analytics-first-run",
    );
    expect(extensions.every((extension) => extension.component)).toBe(true);
  });
});
