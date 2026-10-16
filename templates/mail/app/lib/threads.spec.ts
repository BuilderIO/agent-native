import type { EmailMessage } from "@shared/types";
import { describe, expect, it } from "vitest";

import { matchesThreadAccount } from "./threads";

function message(accountEmail?: string): Pick<EmailMessage, "accountEmail"> {
  return { accountEmail };
}

describe("matchesThreadAccount", () => {
  it("matches an explicitly requested mailbox case-insensitively", () => {
    expect(
      matchesThreadAccount(message("Inbox@Example.com"), "inbox@example.com"),
    ).toBe(true);
  });

  it("does not use a cached message from a different or unknown mailbox", () => {
    expect(
      matchesThreadAccount(message("other@example.com"), "inbox@example.com"),
    ).toBe(false);
    expect(matchesThreadAccount(message(), "inbox@example.com")).toBe(false);
  });

  it("allows unscoped thread views", () => {
    expect(matchesThreadAccount(message("other@example.com"))).toBe(true);
  });
});
