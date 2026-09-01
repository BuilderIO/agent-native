import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function emailsHandlerSource(): string {
  return readFileSync(new URL("./emails.ts", import.meta.url), "utf8");
}

describe("emails handler Gmail draft listing", () => {
  it("hydrates drafts and saved-filter inboxes while keeping other lists on metadata", () => {
    const source = emailsHandlerSource();

    expect(source).toContain("threadFormat:");
    expect(source).toContain('view === "drafts"');
    expect(source).toContain(
      '(needsSavedFilterParts && (settings?.savedFilters?.length ?? 0) > 0)',
    );
    expect(source).toContain('"full"');
    expect(source).toContain('"metadata"');
  });

  it("uses attachment account metadata when resolving Gmail-backed draft attachments", () => {
    const source = emailsHandlerSource();

    expect(source).toContain("requestAccountEmail ?? attachment.accountEmail");
  });
});

describe("emails handler Gmail label listing", () => {
  it("does not turn a full Gmail label read failure into local fallback data", () => {
    const source = emailsHandlerSource();

    expect(source).toContain("setResponseStatus(_event, 502)");
    expect(source).toContain("failedAccountReads > 0");
    expect(source).toContain("Unable to load Gmail labels. Please retry.");
  });

  it("filters local all-mail label reads and scopes Gmail label counts", () => {
    const source = emailsHandlerSource();

    expect(source).toContain(
      "if (label) emails = filterLabelMessages(emails, label);",
    );
    expect(source).toContain(
      "const accountTokens = await getAccountTokens(email, accountEmails);",
    );
    expect(source).toContain(
      "return recomputeUnreadCounts(\n    await readEmails(email),\n    await readLabels(email),\n  );",
    );
  });
});
