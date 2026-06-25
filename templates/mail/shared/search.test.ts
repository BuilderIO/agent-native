import { describe, expect, it } from "vitest";

import { emailMessageMatchesSearch } from "./search";
import type { EmailMessage } from "./types";

function message(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    id: "message",
    threadId: "thread",
    from: { name: "Sender", email: "sender@example.com" },
    to: [{ name: "Ada", email: "ada@example.com" }],
    subject: "Subject",
    snippet: "",
    body: "",
    date: "2026-05-20T00:00:00.000Z",
    isRead: true,
    isStarred: false,
    isArchived: false,
    isTrashed: false,
    labelIds: [],
    ...overrides,
  };
}

describe("emailMessageMatchesSearch", () => {
  it("matches recipient addresses", () => {
    expect(emailMessageMatchesSearch(message(), "ada@example.com")).toBe(true);
  });

  it("matches cc and bcc addresses", () => {
    expect(
      emailMessageMatchesSearch(
        message({
          to: [],
          cc: [{ name: "Grace", email: "grace@example.com" }],
        }),
        "grace@example.com",
      ),
    ).toBe(true);

    expect(
      emailMessageMatchesSearch(
        message({
          to: [],
          bcc: [{ name: "Katherine", email: "katherine@example.com" }],
        }),
        "katherine@example.com",
      ),
    ).toBe(true);
  });
});
