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

  it("keeps label tabs independent from inbox/archive views", () => {
    expect(
      buildGmailEmailSearchQuery({
        view: "inbox",
        label: "customer success",
        q: "renewal",
      }),
    ).toBe("renewal label:customer-success");
  });

  it("translates app category labels to Gmail search operators", () => {
    expect(
      buildGmailEmailSearchQuery({ view: "inbox", label: "updates" }),
    ).toBe("category:updates");
    expect(
      buildGmailEmailSearchQuery({ view: "inbox", label: "personal" }),
    ).toBe("category:primary");
  });
});

describe("gmailLabelSearchClause", () => {
  it("quotes Gmail labels that need quoting", () => {
    expect(gmailLabelSearchClause("Team/Foo Bar")).toBe('label:"Team/Foo-Bar"');
  });
});
