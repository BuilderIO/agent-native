import { describe, expect, it } from "vitest";

import {
  resolveEventAccountEmail,
  shouldShowEventAccountSelector,
} from "./event-account-selection";

const accounts = [
  { email: "primary@example.com" },
  { email: "secondary@example.com" },
];

describe("event account selection", () => {
  it("defaults new events to the first connected account", () => {
    expect(resolveEventAccountEmail(accounts)).toBe("primary@example.com");
  });

  it("preserves a connected account from a persisted or agent draft", () => {
    expect(resolveEventAccountEmail(accounts, "secondary@example.com")).toBe(
      "secondary@example.com",
    );
  });

  it("falls back when a draft account has since disconnected", () => {
    expect(resolveEventAccountEmail(accounts, "missing@example.com")).toBe(
      "primary@example.com",
    );
  });

  it("only adds selector chrome for multiple connected accounts", () => {
    expect(shouldShowEventAccountSelector(accounts)).toBe(true);
    expect(shouldShowEventAccountSelector(accounts.slice(0, 1))).toBe(false);
  });
});
