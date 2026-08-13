import { describe, expect, it } from "vitest";

import { getOnboardingAppProfile } from "./app-profile.js";

const APP_IDS = [
  "analytics",
  "assets",
  "brain",
  "calendar",
  "chat",
  "clips",
  "content",
  "crm",
  "design",
  "dispatch",
  "factory",
  "forms",
  "macros",
  "mail",
  "plan",
  "slides",
  "tasks",
] as const;

describe("onboarding app profiles", () => {
  it.each(APP_IDS)("declares a usable profile for %s", (appId) => {
    const profile = getOnboardingAppProfile(appId);

    expect(profile.appId).toBe(appId);
    expect(profile.appName).toBeTruthy();
    expect(profile.capabilities.length).toBeGreaterThan(0);
    expect(profile.capabilities.every((capability) => capability.why)).toBe(
      true,
    );
    expect(
      profile.capabilities.some((capability) => capability.builderIncluded),
    ).toBe(true);
    expect(profile.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "file-storage",
          builderIncluded: true,
          suggested: true,
        }),
      ]),
    );
  });

  it("tailors Clips requirements without sharing mutable profile state", () => {
    const clips = getOnboardingAppProfile("clips");
    const ids = clips.capabilities.map((capability) => capability.id);

    expect(ids).toEqual([
      "llm",
      "file-storage",
      "video-storage",
      "transcription",
    ]);
    expect(clips.capabilities[2]?.keySummary).toContain("S3");
    expect(clips.capabilities[3]?.required).toBe(false);

    clips.capabilities[0]!.label = "Changed locally";
    expect(getOnboardingAppProfile("clips").capabilities[0]?.label).toBe(
      "AI model",
    );
  });

  it.each(["assets", "design", "slides"] as const)(
    "includes design system intelligence for %s",
    (appId) => {
      const capability = getOnboardingAppProfile(appId).capabilities.find(
        (item) => item.id === "design-system-intelligence",
      );

      expect(capability).toMatchObject({
        label: "Design system intelligence",
        required: false,
        builderIncluded: true,
      });
      expect(capability?.why).toContain("brand");
      expect(capability?.why).toContain("design-system");
    },
  );

  it("does not add design system intelligence to unrelated app profiles", () => {
    expect(
      getOnboardingAppProfile("analytics").capabilities.map(
        (capability) => capability.id,
      ),
    ).not.toContain("design-system-intelligence");
  });
});
