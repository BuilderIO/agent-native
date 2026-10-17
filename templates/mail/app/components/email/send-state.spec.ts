import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function sourceFor(fileName: string): string {
  return readFileSync(new URL(`./${fileName}`, import.meta.url), "utf8");
}

describe("send feedback contract", () => {
  it("keeps the popout undo window authoritative until provider dispatch", () => {
    const source = sourceFor("ComposeModal.tsx");

    expect(source).toContain("const SEND_UNDO_WINDOW_MS = 10_000;");
    expect(source).toContain("if (cancelled || dispatchStarted) return;");
    expect(source).toContain("dispatchStarted = true;");
    expect(source).toContain("onStageForSend(activeId);");
    expect(source).toContain("onRestoreAfterSend(sendingId);");
    expect(source).toContain("onDiscard(sendingId);");
    expect(source).toContain('action: { label: t("mail.actions.undo")');
    expect(source).toMatch(
      /toast\(t\("mail\.toasts\.messageSent"\), \{\s+id: sendingToastId,/,
    );
    expect(source).toContain("shouldMarkReplyDoneAfterSend(");
    expect(source).toContain("archiveEmail.mutate({");
    expect(source).toContain("markDoneAfterSend && draftSnapshot.replyToId");
    expect(source).not.toContain('toast("Message sent."');
    expect(source.indexOf("onDiscard(sendingId);")).toBeGreaterThan(
      source.indexOf(".then((result) => {"),
    );
  });

  it("applies the same provider-confirmed state to inline replies", () => {
    const source = sourceFor("InlineReplyComposer.tsx");

    expect(source).toContain("const SEND_UNDO_WINDOW_MS = 10_000;");
    expect(source).toContain("if (cancelled || dispatchStarted) return;");
    expect(source).toContain("dispatchStarted = true;");
    expect(source).toContain('toast(t("mail.toasts.messageSent"), {');
    expect(source).toContain("shouldMarkReplyDoneAfterSend(");
    expect(source).toContain("archiveEmail.mutate({");
    expect(source).toContain("markDoneAfterSend && draftSnapshot.replyToId");
    expect(source).not.toContain('toast("Message sent."');
  });
});
