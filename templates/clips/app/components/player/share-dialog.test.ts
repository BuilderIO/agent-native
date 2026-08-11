import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function readSource(name: string): string {
  return readFileSync(new URL(name, import.meta.url), "utf8");
}

describe("recording share popover", () => {
  it("renders above the video player controls", () => {
    const shareDialogSource = readSource("./share-dialog.tsx");
    const videoPlayerSource = readSource("./video-player.tsx");

    expect(videoPlayerSource).toContain("absolute inset-0 z-10");
    expect(videoPlayerSource).toContain("absolute inset-x-0 bottom-0 z-20");
    expect(shareDialogSource).toContain("z-[260] w-[440px]");
  });

  it("does not show the same public URL twice", () => {
    const shareDialogSource = readSource("./share-dialog.tsx");

    expect(shareDialogSource).toContain(
      'isPublic\n            ? t("shareDialog.shareLink")',
    );
    expect(shareDialogSource).toContain(
      'label={t("shareDialog.shareWithAgents")}',
    );
    expect(shareDialogSource).toContain("{!isPublic ? (");
    expect(shareDialogSource).toContain("if (!isPublic)");
    expect(shareDialogSource).not.toContain("Collapsible");
  });

  it("uses known recording access while share details load", () => {
    const shareDialogSource = readSource("./share-dialog.tsx");

    expect(shareDialogSource).toContain("data?.role ?? initialRole");
    expect(shareDialogSource).toContain("initialVisibility ??");
    expect(shareDialogSource).not.toContain('?? "private"');
  });

  it("keeps private and org human links copyable after access loads", () => {
    const shareDialogSource = readSource("./share-dialog.tsx");

    expect(shareDialogSource).toContain(
      "disabled={visibilityPending || !sharesLoaded}",
    );
    expect(shareDialogSource).not.toContain("(!isPublic && canManage)");
  });

  it("offers a rich email preview only for public, unprotected clips", () => {
    const shareDialogSource = readSource("./share-dialog.tsx");

    expect(shareDialogSource).toContain("hasPassword !== false");
    expect(shareDialogSource).toContain("buildEmailPreviewMarkup");
    expect(shareDialogSource).toContain("html: markup.html");
    expect(shareDialogSource).toContain('t("shareDialog.copyEmailPreview")');
  });

  it("labels recording viewers as commenters without changing the stored role", () => {
    const shareDialogSource = readSource("./share-dialog.tsx");
    const shareUiSource = readSource("../sharing/share-ui.tsx");
    const meetingDialogSource = readSource(
      "../meetings/share-meeting-dialog.tsx",
    );

    expect(shareDialogSource).toContain("roleCopy={{");
    expect(shareDialogSource).toContain(
      'label: t("shareUi.recordingViewer.label")',
    );
    expect(shareDialogSource).toContain(
      'description: t("shareUi.recordingViewer.description")',
    );
    expect(shareUiSource).toContain(
      "roleCopy?: Partial<Record<Role, RoleCopy>>",
    );
    expect(shareUiSource).toContain("getRoleLabel(s.role)");
    expect(shareUiSource).toContain('useState<Role>("viewer")');
    expect(meetingDialogSource).not.toContain("roleCopy");
  });
});
