import { beforeEach, describe, expect, it, vi } from "vitest";

const { profiles, saveProfile } = vi.hoisted(() => {
  const profiles = new Map<string, string>();
  return {
    profiles,
    saveProfile: vi.fn(async (email: string, name: string) => {
      profiles.set(email, name);
      return { email, name, onboardingRole: null };
    }),
  };
});

vi.mock("../store.js", () => ({ updateUserProfile: saveProfile }));

const updateProfile = (await import("./update-user-profile.js")).default;

describe("profile display name capacity", () => {
  beforeEach(() => {
    profiles.clear();
    saveProfile.mockClear();
  });

  it.each([1, 120, 121, 256])(
    "saves an accepted %i-character name without truncation",
    async (length) => {
      const name = "A".repeat(length);
      const args = updateProfile.schema.parse({ name });
      const result = await updateProfile.run(args, {
        caller: "frontend",
        userEmail: "profile-owner@example.test",
      });
      expect(result.name).toBe(name);
      expect(profiles.get("profile-owner@example.test")).toBe(name);
      expect(saveProfile).toHaveBeenCalledExactlyOnceWith(
        "profile-owner@example.test",
        name,
      );
    },
  );

  it.each(["", "   ", "A".repeat(257)])(
    "rejects an empty or oversized name before writing",
    (name) => {
      expect(updateProfile.schema.safeParse({ name }).success).toBe(false);
      expect(saveProfile).not.toHaveBeenCalled();
      expect(profiles.size).toBe(0);
    },
  );
});
