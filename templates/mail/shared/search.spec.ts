import { describe, expect, it } from "vitest";

import { emailMessageMatchesSearch } from "./search.js";
import type { EmailMessage } from "./types.js";

type SearchableEmail = Pick<
  EmailMessage,
  | "subject"
  | "snippet"
  | "body"
  | "from"
  | "to"
  | "cc"
  | "bcc"
  | "labelIds"
  | "isRead"
  | "isStarred"
  | "isArchived"
  | "isTrashed"
  | "isDraft"
  | "isSent"
  | "date"
  | "attachments"
>;

function email(overrides: Partial<SearchableEmail>): SearchableEmail {
  return {
    subject: "GitHub notification",
    snippet: "",
    body: "",
    from: { name: "GitHub", email: "notifications@github.com" },
    to: [],
    labelIds: ["important", "automated notifications"],
    isRead: false,
    isStarred: false,
    isArchived: false,
    isTrashed: false,
    isDraft: false,
    isSent: false,
    date: new Date().toISOString(),
    ...overrides,
  };
}

describe("emailMessageMatchesSearch — inbox tab query forms", () => {
  it('matches a quoted multi-word label ("label:\\"automated notifications\\"")', () => {
    expect(
      emailMessageMatchesSearch(email({}), 'label:"automated notifications"'),
    ).toBe(true);
  });

  it("matches Gmail's hyphenated label search form (label:automated-notifications)", () => {
    expect(
      emailMessageMatchesSearch(email({}), "label:automated-notifications"),
    ).toBe(true);
  });

  it("matches an OR of two label operators", () => {
    const msg = email({});
    expect(
      emailMessageMatchesSearch(msg, "label:pitch OR label:marketing"),
    ).toBe(false);
    expect(
      emailMessageMatchesSearch(msg, "label:pitch OR label:important"),
    ).toBe(true);
  });

  it("matches a from: operator", () => {
    expect(
      emailMessageMatchesSearch(email({}), "from:notifications@github.com"),
    ).toBe(true);
  });

  it("combines a negated operator with a positive label operator", () => {
    const fromGithub = email({});
    const fromSomeoneElse = email({
      from: { name: "Ada", email: "ada@example.com" },
    });
    const query =
      '-from:notifications@github.com label:"automated notifications"';

    // Negated from: excludes the GitHub sender even though the label matches.
    expect(emailMessageMatchesSearch(fromGithub, query)).toBe(false);
    // A different sender with the same label still matches.
    expect(emailMessageMatchesSearch(fromSomeoneElse, query)).toBe(true);
  });
});
