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

  it("waits for close-time persistence and deletes through the account-aware action", () => {
    const source = readFileSync(
      new URL("./AppLayout.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("const savePromise = compose.close(id)");
    expect(source).toContain("await savePromise");
    expect(source).toContain("applyDraftSaveResult(");
    expect(source).toContain("await compose.deleteSavedDraft(savedSnapshot)");
    expect(source).not.toContain("/api/emails/draft/${snapshot.savedDraftId}");
    expect(source).not.toContain("/api/emails/draft/${snap.savedDraftId}");
  });

  it("keeps recipient-only drafts in close and close-all recovery", () => {
    const source = readFileSync(
      new URL("./AppLayout.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("draft?.cc?.trim()");
    expect(source).toContain("draft?.bcc?.trim()");
    expect(source).toContain("d.cc?.trim()");
    expect(source).toContain("d.bcc?.trim()");
  });
});

describe("EmailThread inline draft close feedback", () => {
  it("waits for persistence and deletes the saved mailbox copy through the draft action", () => {
    const source = readFileSync(
      new URL("../email/EmailThread.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("const savePromise = compose.close(id)");
    expect(source).toContain("await savePromise");
    expect(source).toContain("compose.deleteSavedDraft(savedSnapshot)");
    expect(source).not.toContain("/api/emails/${snapshot.savedDraftId}");
  });
});
