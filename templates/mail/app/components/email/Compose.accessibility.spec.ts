import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const composeModalSource = readFileSync(
  "app/components/email/ComposeModal.tsx",
  "utf8",
);
const inlineReplySource = readFileSync(
  "app/components/email/InlineReplyComposer.tsx",
  "utf8",
);
const bubbleToolbarSource = readFileSync(
  "app/components/email/ComposeBubbleToolbar.tsx",
  "utf8",
);

describe("compose control accessibility", () => {
  it("keeps icon-only compose actions keyboard discoverable", () => {
    for (const label of [
      'aria-label={t("mail.compose.newDraft")}',
      'aria-label={t("mail.compose.closeAllDrafts")}',
      'aria-label={t("mail.compose.bold")}',
      'aria-label={t("mail.compose.italic")}',
      'aria-label={t("mail.compose.insertLink")}',
      'aria-label={t("mail.compose.attachFile")}',
      'aria-label={t("mail.compose.deleteDraft")}',
    ]) {
      expect(composeModalSource).toContain(label);
    }

    for (const label of [
      'aria-label={t("mail.compose.popOut")}',
      'aria-label={t("mail.compose.bold")}',
      'aria-label={t("mail.compose.italic")}',
      'aria-label={t("mail.compose.insertLink")}',
      'aria-label={t("mail.compose.attachFile")}',
      'aria-label={t("mail.compose.discardDraft")}',
    ]) {
      expect(inlineReplySource).toContain(label);
    }

    expect(inlineReplySource).toContain(
      'showCcBcc ? "mail.compose.hideCcBcc" : "mail.compose.showCcBcc"',
    );
    expect(bubbleToolbarSource).toContain(
      'aria-label={t("mail.compose.enterLinkUrl")}',
    );
    expect(bubbleToolbarSource).toContain(
      'aria-label={t("mail.compose.aiAssist")}',
    );
    expect(bubbleToolbarSource).toContain("aria-label={title}");
  });
});
