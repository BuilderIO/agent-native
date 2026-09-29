import { describe, expect, it } from "vitest";

import { getOnboardingAppProfile } from "./app-profile.js";
import { WORKSPACE_SERVICES } from "./workspace-services.js";

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
    const storage = profile.capabilities.find(
      (capability) =>
        capability.id === "file-storage" || capability.id === "video-storage",
    );
    expect(storage).toMatchObject({
      builderIncluded: true,
      suggested: appId !== "clips",
    });
    expect(storage?.required).toBe(appId === "clips");
    expect(profile.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "llm",
          required: true,
        }),
        expect.objectContaining({
          id: "voice-input",
          required: false,
          suggested: true,
        }),
        expect.objectContaining({
          id: "embeddings",
          required: false,
          suggested: true,
        }),
        expect.objectContaining({
          id: "system-one",
          label: "Decision model (Jev)",
          required: false,
          suggested: true,
          builderIncluded: true,
          keySummary: "Jev decision model key",
        }),
      ]),
    );
  });

  it("tailors Clips requirements without sharing mutable profile state", () => {
    const clips = getOnboardingAppProfile("clips");
    const ids = clips.capabilities.map((capability) => capability.id);

    expect(ids).toEqual([
      "llm",
      "system-one",
      "video-storage",
      "voice-input",
      "image-generation",
      "embeddings",
      "background-agents",
      "browser-automation",
      "transcription",
    ]);
    expect(clips.capabilities[2]?.required).toBe(true);
    expect(clips.capabilities[2]?.keySummary).toBe("Object storage");
    expect(clips.capabilities[2]?.label).toBe("Object storage");
    expect(clips.capabilities[2]?.service).toBe("storage");
    expect(clips.capabilities[5]).toMatchObject({
      id: "embeddings",
      required: false,
      suggested: true,
    });

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

  it("separates Assets image and video requirements", () => {
    const assets = getOnboardingAppProfile("assets").capabilities;

    expect(assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "media-generation",
          required: true,
        }),
        // Builder.io powers video generation too (Assets' video provider).
        expect.objectContaining({
          id: "video-generation",
          required: false,
          suggested: true,
          builderIncluded: true,
        }),
        expect.objectContaining({
          id: "file-storage",
          required: false,
          suggested: true,
        }),
      ]),
    );
  });

  it.each(["design", "slides"] as const)(
    "marks image generation as recommended for %s",
    (appId) => {
      expect(getOnboardingAppProfile(appId).capabilities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "image-generation",
            required: false,
            suggested: true,
          }),
        ]),
      );
    },
  );

  it.each(APP_IDS)(
    "lists every shared service Infrastructure shows for %s",
    (appId) => {
      const capabilities = getOnboardingAppProfile(appId).capabilities;
      const tagged = capabilities
        .map((capability) => capability.service)
        .filter(Boolean);

      // In Infrastructure's order, once each, and only where declared for
      // services not every app lists.
      expect(tagged).toEqual(
        WORKSPACE_SERVICES.filter(
          (service) =>
            service.everyApp ||
            capabilities.some(
              (capability) => capability.service === service.id,
            ),
        ).map((service) => service.id),
      );
      for (const capability of capabilities) {
        if (!capability.service) continue;
        expect(capability.builderIncluded).toBe(true);
        expect(capability.builderOnly === true).toBe(
          WORKSPACE_SERVICES.find(
            (service) => service.id === capability.service,
          )?.kind === "builder-only",
        );
      }
    },
  );

  it("marks the Builder.io-only services and keeps them optional", () => {
    const capabilities = getOnboardingAppProfile("design").capabilities;
    const builderOnly = capabilities.filter(
      (capability) => capability.builderOnly,
    );

    expect(builderOnly.map((capability) => capability.service)).toEqual([
      "design-system-intelligence",
      "background-agents",
      "browser-automation",
    ]);
    expect(
      builderOnly.every(
        (capability) => !capability.required && !capability.suggested,
      ),
    ).toBe(true);
  });

  it("uses an app's declared capability for a service without lowering its tag", () => {
    const assets = getOnboardingAppProfile("assets").capabilities;
    const images = assets.filter(
      (capability) => capability.service === "images",
    );

    expect(images).toEqual([
      expect.objectContaining({ id: "media-generation", required: true }),
    ]);
    expect(assets.map((capability) => capability.id)).not.toContain(
      "image-generation",
    );
    const forms = getOnboardingAppProfile("forms").capabilities.find(
      (capability) => capability.service === "storage",
    );
    expect(forms).toMatchObject({
      label: "File storage",
      required: false,
      suggested: true,
    });
  });

  it("leaves image generation untagged where no app declares it", () => {
    expect(
      getOnboardingAppProfile("mail").capabilities.find(
        (capability) => capability.service === "images",
      ),
    ).toMatchObject({ required: false, suggested: false });
  });
});
