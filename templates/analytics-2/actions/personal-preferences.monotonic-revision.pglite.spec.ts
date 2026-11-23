import { expect, it, vi } from "vitest";

import {
  readPersonalPreferences,
  savePersonalPreferences,
} from "./_personal-preferences";
const m = vi.hoisted(() => {
  process.env.DATABASE_URL = "pglite::memory:";
  return { email: "owner@example.test" as string | undefined };
});
vi.mock("@agent-native/core/server/request-context", async (original) => ({
  ...(await original<
    typeof import("@agent-native/core/server/request-context")
  >()),
  getRequestUserEmail: () => m.email,
}));
it("advances revisions under a fixed clock and refuses the earlier revision", async () => {
  m.email = "same-tick@example.test";
  const clock = vi.spyOn(Date, "now").mockReturnValue(1700000000000);
  try {
    const initial = await readPersonalPreferences();
    const first = await savePersonalPreferences({
      content: "First",
      expectedOwner: initial.owner,
      expectedRevision: initial.revision,
    });
    const second = await savePersonalPreferences({
      content: "Second",
      expectedOwner: first.owner,
      expectedRevision: first.revision,
    });
    expect(first.revision).not.toBeNull();
    expect(second.revision).not.toBeNull();
    expect(second.revision?.updatedAt).toBe(
      (first.revision?.updatedAt ?? 0) + 1,
    );
    await expect(
      savePersonalPreferences({
        content: "Stale",
        expectedOwner: first.owner,
        expectedRevision: first.revision,
      }),
    ).rejects.toThrow("Preferences changed");
    expect(await readPersonalPreferences()).toEqual(second);
    expect((await readPersonalPreferences()).content).toBe("Second");
  } finally {
    clock.mockRestore();
    m.email = "owner@example.test";
  }
});
