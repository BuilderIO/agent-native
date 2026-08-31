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

  it("matches Gmail from operators in the local mailbox fallback", () => {
    expect(
      emailMessageMatchesSearch(
        message({
          from: { name: "GitHub", email: "notifications@github.com" },
        }),
        "from:notifications@github.com",
      ),
    ).toBe(true);
    expect(
      emailMessageMatchesSearch(
        message({ from: { name: "Other", email: "other@example.com" } }),
        "from:notifications@github.com",
      ),
    ).toBe(false);
  });

  it("matches either side of a Gmail OR query", () => {
    expect(
      emailMessageMatchesSearch(
        message({
          from: { name: "GitHub", email: "notifications@github.com" },
        }),
        "from:notifications@github.com OR from:alerts@example.com",
      ),
    ).toBe(true);
    expect(
      emailMessageMatchesSearch(
        message({ from: { name: "Alerts", email: "alerts@example.com" } }),
        "from:notifications@github.com OR from:alerts@example.com",
      ),
    ).toBe(true);
    expect(
      emailMessageMatchesSearch(
        message({ from: { name: "Other", email: "other@example.com" } }),
        "from:notifications@github.com OR from:alerts@example.com",
      ),
    ).toBe(false);
  });

  it("matches Gmail brace groups as OR queries", () => {
    expect(
      emailMessageMatchesSearch(
        message({
          from: { name: "GitHub", email: "notifications@github.com" },
        }),
        "{from:notifications@github.com from:alerts@example.com}",
      ),
    ).toBe(true);
  });

  it("keeps quoted operator values together in brace groups", () => {
    expect(
      emailMessageMatchesSearch(
        message({ from: { name: "Jane Doe", email: "jane@example.com" } }),
        '{from:"Jane Doe" from:alerts@example.com}',
      ),
    ).toBe(true);
  });

  it("keeps negated Gmail brace groups excluded as a whole", () => {
    const query = "-{from:alerts@example.com from:news@example.com}";
    expect(
      emailMessageMatchesSearch(
        message({ from: { name: "Alerts", email: "alerts@example.com" } }),
        query,
      ),
    ).toBe(false);
    expect(
      emailMessageMatchesSearch(
        message({ from: { name: "News", email: "news@example.com" } }),
        query,
      ),
    ).toBe(false);
    expect(
      emailMessageMatchesSearch(
        message({ from: { name: "Other", email: "other@example.com" } }),
        query,
      ),
    ).toBe(true);
  });

  it("applies common negative and state Gmail operators", () => {
    expect(
      emailMessageMatchesSearch(
        message({
          from: { name: "GitHub", email: "notifications@github.com" },
          isRead: false,
          labelIds: ["inbox"],
        }),
        "from:notifications@github.com is:unread in:inbox",
      ),
    ).toBe(true);
    expect(
      emailMessageMatchesSearch(
        message({
          from: { name: "GitHub", email: "notifications@github.com" },
          isRead: true,
          labelIds: ["inbox"],
        }),
        "from:notifications@github.com -is:unread",
      ),
    ).toBe(true);
  });

  it("matches common saved-filter category, attachment, filename, and date operators", () => {
    const githubAttachment = {
      id: "attachment",
      filename: "report.pdf",
      mimeType: "application/pdf",
      size: 12,
    };
    const email = message({
      date: "2026-05-20T00:00:00.000Z",
      labelIds: ["promotions"],
      attachments: [githubAttachment],
    });

    expect(emailMessageMatchesSearch(email, "category:promotions")).toBe(true);
    expect(emailMessageMatchesSearch(email, "has:attachment")).toBe(true);
    expect(emailMessageMatchesSearch(email, "filename:pdf")).toBe(true);
    expect(
      emailMessageMatchesSearch(email, "after:2026/05/19 before:2026/05/21"),
    ).toBe(true);
  });
});
