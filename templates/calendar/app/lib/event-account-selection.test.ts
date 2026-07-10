import { describe, expect, it } from "vitest";

import {
  reconcileEventAccountEmail,
  resolveEventAccountEmail,
  shouldShowEventAccountSelector,
} from "./event-account-selection";
import { buildEventFormInitializationKey } from "./event-form-initialization";

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

  it("updates only the account when connected accounts resolve after form initialization", () => {
    const initialization = {
      draftTimezone: "America/Indiana/Indianapolis",
      date: "2026-07-10",
      startTime: "09:00",
      endTime: "09:30",
      defaultTimezone: "America/Indiana/Indianapolis",
    };
    const initializationKey = buildEventFormInitializationKey(initialization);

    expect(reconcileEventAccountEmail([], undefined)).toBeUndefined();
    expect(reconcileEventAccountEmail(accounts, undefined)).toBe(
      "primary@example.com",
    );
    expect(buildEventFormInitializationKey(initialization)).toBe(
      initializationKey,
    );
  });

  it("keeps a valid user selection as accounts refetch", () => {
    expect(
      reconcileEventAccountEmail(
        accounts,
        "primary@example.com",
        "secondary@example.com",
      ),
    ).toBe("primary@example.com");
    expect(reconcileEventAccountEmail(accounts, "secondary@example.com")).toBe(
      "secondary@example.com",
    );
  });

  it("falls back to a valid draft account when the current selection disconnects", () => {
    expect(
      reconcileEventAccountEmail(
        accounts,
        "missing@example.com",
        "secondary@example.com",
      ),
    ).toBe("secondary@example.com");
    expect(
      reconcileEventAccountEmail(
        accounts,
        "missing@example.com",
        "also-missing@example.com",
      ),
    ).toBe("primary@example.com");
  });

  it("only adds selector chrome for multiple connected accounts", () => {
    expect(shouldShowEventAccountSelector(accounts)).toBe(true);
    expect(shouldShowEventAccountSelector(accounts.slice(0, 1))).toBe(false);
  });
});
