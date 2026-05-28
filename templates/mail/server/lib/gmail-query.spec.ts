import { describe, expect, it } from "vitest";
import {
  buildGmailEmailSearchQuery,
  filterInboxScopedThreadMessages,
  gmailLabelSearchClause,
} from "./gmail-query.js";
import type { EmailMessage } from "@shared/types.js";

describe("buildGmailEmailSearchQuery", () => {
  it("scopes inbox searches to inbox results", () => {
    expect(buildGmailEmailSearchQuery({ view: "inbox", q: "receipt" })).toBe(
      "in:inbox -in:sent receipt",
    );
  });

  it("keeps all-mail searches unscoped", () => {
    expect(buildGmailEmailSearchQuery({ view: "all", q: "receipt" })).toBe(
      "receipt",
    );
  });

  it("expands bare email-address searches across address fields", () => {
    expect(
      buildGmailEmailSearchQuery({
        view: "all",
        q: "ada@example.com",
      }),
    ).toBe(
      "{from:ada@example.com to:ada@example.com cc:ada@example.com bcc:ada@example.com deliveredto:ada@example.com ada@example.com}",
    );
  });

  it("keeps explicit Gmail address operators unchanged", () => {
    expect(
      buildGmailEmailSearchQuery({
        view: "all",
        q: "from:ada@example.com",
      }),
    ).toBe("from:ada@example.com");
  });

  it("keeps label and view clauses when expanding an email address search", () => {
    expect(
      buildGmailEmailSearchQuery({
        view: "inbox",
        label: "customer success",
        q: "ada@example.com",
      }),
    ).toBe(
      "in:inbox -in:sent label:customer-success {from:ada@example.com to:ada@example.com cc:ada@example.com bcc:ada@example.com deliveredto:ada@example.com ada@example.com}",
    );
  });

  it("scopes archive searches to archived mail", () => {
    expect(buildGmailEmailSearchQuery({ view: "archive", q: "receipt" })).toBe(
      "-in:inbox -in:sent -in:drafts -in:trash receipt",
    );
  });

  it("scopes user label tabs to inbox so archived filed mail stays hidden", () => {
    expect(
      buildGmailEmailSearchQuery({
        view: "inbox",
        label: "customer success",
        q: "renewal",
      }),
    ).toBe("in:inbox -in:sent label:customer-success renewal");
  });

  it("scopes unread user label tabs to unread inbox results", () => {
    expect(
      buildGmailEmailSearchQuery({
        view: "unread",
        label: "customer success",
        q: "renewal",
      }),
    ).toBe("is:unread in:inbox -in:sent label:customer-success renewal");
  });

  it("keeps all-mail label searches unscoped", () => {
    expect(
      buildGmailEmailSearchQuery({
        view: "all",
        label: "customer success",
        q: "renewal",
      }),
    ).toBe("label:customer-success renewal");
  });

  it("translates app category labels to Gmail search operators", () => {
    expect(
      buildGmailEmailSearchQuery({ view: "inbox", label: "updates" }),
    ).toBe("in:inbox -in:sent category:updates");
    expect(
      buildGmailEmailSearchQuery({ view: "inbox", label: "personal" }),
    ).toBe("in:inbox -in:sent category:primary");
  });

  it("keeps note-to-self scoped to inbox without dropping sent-to-self mail", () => {
    expect(
      buildGmailEmailSearchQuery({ view: "inbox", label: "note-to-self" }),
    ).toBe("in:inbox from:me");
  });
});

describe("gmailLabelSearchClause", () => {
  it("quotes Gmail labels that need quoting", () => {
    expect(gmailLabelSearchClause("Team/Foo Bar")).toBe('label:"Team/Foo-Bar"');
  });
});

function message(overrides: Partial<EmailMessage>): EmailMessage {
  return {
    id: "message",
    threadId: "thread",
    from: { name: "Sender", email: "sender@example.com" },
    to: [],
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

describe("filterInboxScopedThreadMessages", () => {
  it("keeps a sent latest message when the thread has an inbox message", () => {
    const received = message({
      id: "received-old",
      date: "2025-10-01T00:00:00.000Z",
      labelIds: ["inbox"],
    });
    const sentLatest = message({
      id: "sent-latest",
      date: "2026-05-21T00:00:00.000Z",
      isSent: true,
      labelIds: ["sent"],
    });

    expect(
      filterInboxScopedThreadMessages([received, sentLatest], "inbox").map(
        (m) => m.id,
      ),
    ).toEqual(["received-old", "sent-latest"]);
  });

  it("does not let sent-only threads into the inbox", () => {
    const sentOnly = message({
      id: "sent-only",
      isSent: true,
      labelIds: ["sent"],
    });

    expect(filterInboxScopedThreadMessages([sentOnly], "inbox")).toEqual([]);
  });

  it("excludes sent replies from custom label inbox previews", () => {
    const received = message({
      id: "received-old",
      date: "2025-10-01T00:00:00.000Z",
      labelIds: ["inbox", "customer success"],
    });
    const sentLatest = message({
      id: "sent-latest",
      date: "2026-05-21T00:00:00.000Z",
      isSent: true,
      labelIds: ["sent"],
    });

    expect(
      filterInboxScopedThreadMessages(
        [received, sentLatest],
        "inbox",
        "customer success",
      ).map((m) => m.id),
    ).toEqual(["received-old"]);
  });

  it("keeps the full thread preview for unread threads", () => {
    const unread = message({
      id: "unread-old",
      date: "2025-10-01T00:00:00.000Z",
      isRead: false,
      labelIds: ["inbox"],
    });
    const sentLatest = message({
      id: "sent-latest",
      date: "2026-05-21T00:00:00.000Z",
      isSent: true,
      labelIds: ["sent"],
    });

    expect(
      filterInboxScopedThreadMessages([unread, sentLatest], "unread").map(
        (m) => m.id,
      ),
    ).toEqual(["unread-old", "sent-latest"]);
  });
});
