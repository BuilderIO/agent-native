import { describe, expect, it } from "vitest";
import {
  buildGmailEmailSearchQuery,
  gmailLabelSearchClause,
} from "./gmail-query.js";

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
