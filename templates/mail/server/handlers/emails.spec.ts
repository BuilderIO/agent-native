import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function emailsHandlerSource(): string {
  return readFileSync(new URL("./emails.ts", import.meta.url), "utf8");
}

function handlerSection(source: string, handlerName: string): string {
  const start = source.indexOf(
    `export const ${handlerName} = defineEventHandler`,
  );
  if (start < 0) return "";
  const remainder = source.slice(start);
  const nextHandler = remainder.indexOf("\n// ───", 1);
  return nextHandler < 0 ? remainder : remainder.slice(0, nextHandler);
}

describe("emails handler Gmail draft listing", () => {
  it("hydrates drafts and attachment-filter inboxes while keeping other lists on metadata", () => {
    const source = emailsHandlerSource();

    expect(source).toContain("threadFormat:");
    expect(source).toContain('view === "drafts"');
    expect(source).toContain("const isPlainInboxRequest =");
    expect(source).toContain("const hasAttachmentSavedFilter =");
    expect(source).toContain(
      "searchQueryNeedsAttachmentMetadata(filter.query)",
    );
    expect(source).toContain('"full"');
    expect(source).toContain('"metadata"');
  });

  it("uses attachment account metadata when resolving Gmail-backed draft attachments", () => {
    const source = emailsHandlerSource();

    expect(source).toContain("requestAccountEmail ?? attachment.accountEmail");
  });
});

describe("emails handler saved-draft metadata", () => {
  it("returns the backend and resolved Gmail account for scoped deletion", () => {
    const source = emailsHandlerSource();

    expect(source).toContain('backend: "gmail" as const');
    expect(source).toContain("accountEmail: acct");
    expect(source).toContain('backend: "local" as const');
  });

  it("keeps an existing saved draft on its recorded backend", () => {
    const source = emailsHandlerSource();

    expect(source).toContain(
      "parseSavedDraftBackend(reqBody.savedDraftBackend)",
    );
    expect(source).toContain("resolveSavedDraftBackend(");
    expect(source).toContain("requestedBackend");
    expect(source).toContain("gmailConnected");
    expect(source).toContain('if (draftBackend === "gmail")');
  });

  it("verifies legacy saved-draft ownership instead of choosing from connection state", () => {
    const source = emailsHandlerSource();

    expect(source).toContain("resolveExistingSavedDraftOwnership({");
    expect(source).toContain("SavedDraftOwnershipError");
    expect(source).toContain("setResponseStatus(event, 409)");
    expect(source).toContain("encodeURIComponent(savedDraftId)");
  });

  it("does not mint a new local ID when an existing saved draft is missing", () => {
    const source = emailsHandlerSource();

    expect(source).toContain("if (savedDraftId && existingIdx < 0)");
    expect(source).toContain("setResponseStatus(event, 409);");
    expect(source).toContain(
      'return { error: "Saved local draft was not found" };',
    );
  });
});

describe("emails handler Gmail label listing", () => {
  it("does not turn a full Gmail label read failure into local fallback data", () => {
    const source = emailsHandlerSource();

    expect(source).toContain("setResponseStatus(_event, 502)");
    expect(source).toContain("let failedAccountReads = tokenErrors.length;");
    expect(source).toContain("Unable to load Gmail labels. Please retry.");
  });

  it("filters local all-mail label reads and scopes Gmail label counts", () => {
    const source = emailsHandlerSource();

    expect(source).toContain(
      "if (label) emails = filterLabelMessages(emails, label);",
    );
    expect(source).toContain("await getAccountTokens(email, accountEmails);");
    expect(source).toContain("errors: tokenErrors");
    expect(source).toContain(
      "return recomputeUnreadCounts(\n    await readEmails(email),\n    await readLabels(email),\n  );",
    );
  });
});

describe("emails handler force refresh", () => {
  it("fences list caches before and after resolving account tokens", () => {
    const section = handlerSection(emailsHandlerSource(), "listEmails");
    const tokenResolution = section.indexOf("await getAccountTokens(email);");
    const listInvalidations = [
      ...section.matchAll(/invalidateListCacheForOwner\(email\);/g),
    ].map((match) => match.index ?? -1);
    const historyInvalidation = section.indexOf(
      "invalidateHistoryCacheForAccount(account.email);",
    );

    expect(tokenResolution).toBeGreaterThanOrEqual(0);
    expect(listInvalidations).toHaveLength(2);
    expect(listInvalidations[0]).toBeLessThan(tokenResolution);
    expect(listInvalidations[1]).toBeGreaterThan(historyInvalidation);
  });
});

describe("emails handler connected-account mutation errors", () => {
  it("returns structured account-resolution and refresh failures before Gmail mutations", () => {
    const source = emailsHandlerSource();
    for (const handlerName of [
      "reportSpam",
      "blockSender",
      "muteThread",
      "calendarRsvp",
      "unsubscribeEmail",
    ]) {
      const section = handlerSection(source, handlerName);
      expect(section, handlerName).toContain("resolveGmailAccess(");
      expect(section, handlerName).toContain(
        "if (!gmailAccess.ok) return gmailAccess.response;",
      );
    }

    expect(source).toContain("setResponseStatus(event, 503);");
    expect(source).toContain("error: formatMailAccountErrors(accountErrors)");
    expect(source).toContain("accountErrors,");
  });
});

describe("emails handler triage account selection", () => {
  it("passes the requested account into every connected-mailbox triage path", () => {
    const source = emailsHandlerSource();

    for (const handlerName of ["reportSpam", "blockSender", "muteThread"]) {
      const section = handlerSection(source, handlerName);
      expect(section, handlerName).toContain("accountEmail?: string");
      expect(section, handlerName).toContain(
        "resolveGmailAccess(event, email, accountEmail)",
      );
    }
  });
});

describe("emails handler Gmail quota cooldown classification", () => {
  it("classifies typed Gmail cooldowns as 429 with Retry-After on thread and message fetches", () => {
    const source = emailsHandlerSource();

    expect(source).toContain("error instanceof GmailQuotaCooldownError");
    expect(source.split("gmailErrorStatus(").length - 1).toBeGreaterThanOrEqual(
      3,
    );
  });
});
