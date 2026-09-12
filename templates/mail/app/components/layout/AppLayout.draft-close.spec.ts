import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("AppLayout draft close feedback", () => {
  it("does not claim persistence before a draft save completes", () => {
    const source = readFileSync(
      new URL("./AppLayout.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('t("mail.toasts.draftClosed")');
    expect(source).toContain('t("mail.toasts.draftsClosed"');
    expect(source).not.toContain('toast("Draft saved."');
    expect(source).not.toContain("saved.`, {");
  });

  it("deletes saved drafts through the draft endpoint", () => {
    const source = readFileSync(
      new URL("./AppLayout.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("/api/emails/draft/${snapshot.savedDraftId}");
    expect(source).toContain("/api/emails/draft/${snap.savedDraftId}");
    expect(source).not.toContain("/api/emails/${snapshot.savedDraftId}");
    expect(source).not.toContain("/api/emails/${snap.savedDraftId}");
  });
});
