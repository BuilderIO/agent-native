import { describe, expect, it } from "vitest";

import { mergeStableGoogleAuthStatus } from "./use-google-auth";

describe("mergeStableGoogleAuthStatus", () => {
  it("keeps the last known account photo through transient status misses", () => {
    const photoCache = new Map<string, string>();

    mergeStableGoogleAuthStatus(
      {
        connected: true,
        accounts: [{ email: "saee@example.com", photoUrl: "https://photo" }],
      },
      photoCache,
    );

    expect(
      mergeStableGoogleAuthStatus(
        {
          connected: true,
          accounts: [{ email: "saee@example.com" }],
        },
        photoCache,
      ).accounts,
    ).toEqual([{ email: "saee@example.com", photoUrl: "https://photo" }]);
  });

  it("forgets cached photos once the account is no longer connected", () => {
    const photoCache = new Map([["saee@example.com", "https://photo"]]);

    mergeStableGoogleAuthStatus(
      {
        connected: false,
        accounts: [],
      },
      photoCache,
    );

    expect(photoCache.size).toBe(0);
  });

  it("drops cached photos for accounts missing from the latest status", () => {
    const photoCache = new Map([
      ["saee@example.com", "https://saee-photo"],
      ["other@example.com", "https://other-photo"],
    ]);

    mergeStableGoogleAuthStatus(
      {
        connected: true,
        accounts: [{ email: "saee@example.com", photoUrl: "https://new" }],
      },
      photoCache,
    );

    expect([...photoCache.entries()]).toEqual([
      ["saee@example.com", "https://new"],
    ]);
  });
});
