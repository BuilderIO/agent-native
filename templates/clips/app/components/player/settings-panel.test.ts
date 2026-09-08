import { describe, expect, it } from "vitest";

import { generateSecurePassword } from "./share-dialog";

describe("generateSecurePassword", () => {
  it("generates a strong URL-safe password without ambiguous characters", () => {
    const passwords = new Set(
      Array.from({ length: 20 }, () => generateSecurePassword()),
    );

    expect(passwords.size).toBe(20);
    for (const password of passwords) {
      expect(password).toHaveLength(20);
      expect(password).toMatch(
        /^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789._~-]+$/,
      );
    }
  });
});
