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

    expect(shareDialogSource).toContain('t("shareDialog.shareWithAgents")');
    // Both links are copy actions, so neither URL is rendered as text.
    expect(shareDialogSource).toContain("<CopyButton");
    expect(shareDialogSource).toContain("value={shareUrl}");
    expect(shareDialogSource).toContain("value={agentCopyValue}");
    // The embed textarea is the only readOnly field; share URLs are never
    // rendered into an input.
    expect(shareDialogSource).not.toContain(
      "value={shareUrl}\n          readOnly",
    );
  });

  it("keeps individual access in the primary share surface", () => {
    const shareDialogSource = readSource("./share-dialog.tsx");

    expect(shareDialogSource).toContain("<PeopleAccessSection");
    expect(shareDialogSource).toContain("<GeneralAccessSelect");
    expect(shareDialogSource).toContain(
      "const tabCount = 1 + (canEmbed ? 1 : 0);",
    );
    expect(shareDialogSource).not.toContain('value="invite"');
  });

  it("offers inviting only to managers", () => {
    const shareDialogSource = readSource("./share-dialog.tsx");

    expect(shareDialogSource).toMatch(/canManage \? \(\s*<InvitePeopleField/);
  });

  it("uses the public JSON context URL for public agent sharing", () => {
    const shareDialogSource = readSource("./share-dialog.tsx");

    expect(shareDialogSource).toContain(
      'import { buildAgentApiUrls } from "../../../shared/agent-context";',
    );
    expect(shareDialogSource).toContain(
      "function absolutePublicAgentContextUrl(recordingId: string)",
    );
    expect(shareDialogSource).toContain("hasPassword === false");
    expect(shareDialogSource).toContain(
      "const agentLink = isPublic\n    ? publicAgentContextUrl || agentContextUrl",
    );
    expect(shareDialogSource).toContain("})) as { contextUrl?: string };");
    expect(shareDialogSource).toContain(
      "setAgentContextUrl(result.contextUrl)",
    );
    expect(shareDialogSource).not.toContain(
      "const agentLink = isPublic ? shareUrl : agentContextUrl;",
    );
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

  it("keeps copy fields compact and hides the raw URL", () => {
    const shareUiSource = readSource("../sharing/share-ui.tsx");

    expect(shareUiSource).toContain("export function CopyButton");
    // The URL is only ever passed to the clipboard, never rendered.
    expect(shareUiSource).not.toContain("readOnly");
    expect(shareUiSource).toContain('t("shareUi.copied")');
    expect(shareUiSource).toContain("text-success");
  });

  it("offers a rich email preview only for public, unprotected clips", () => {
    const shareDialogSource = readSource("./share-dialog.tsx");

    expect(shareDialogSource).toContain("hasPassword !== false");
    expect(shareDialogSource).toContain("buildEmailPreviewMarkup");
    expect(shareDialogSource).toContain("html: markup.html");
    expect(shareDialogSource).toContain('t("shareDialog.copyEmailPreview")');
  });

  it("keeps the share link free of playback-position clutter", () => {
    const shareDialogSource = readSource("./share-dialog.tsx");

    expect(shareDialogSource).not.toContain('url.searchParams.set("at",');
    expect(shareDialogSource).not.toContain("currentMs");
    expect(shareDialogSource).toContain("value={shareUrl}");
  });

  it("only promises agent-link expiry when the link is scoped", () => {
    const shareDialogSource = readSource("./share-dialog.tsx");

    expect(shareDialogSource).toContain(
      'needsScopedAgentContext\n              ? t("shareDialog.agentTokenDescription")',
    );
    expect(shareDialogSource).toContain(
      't("shareDialog.agentPublicDescription")',
    );
  });

  it("offers commenter as a distinct recording role", () => {
    const shareDialogSource = readSource("./share-dialog.tsx");
    const shareUiSource = readSource("../sharing/share-ui.tsx");
    const meetingDialogSource = readSource(
      "../meetings/share-meeting-dialog.tsx",
    );

    expect(shareDialogSource).toContain("roleCopy={{");
    expect(shareDialogSource).toContain(
      'label: t("shareUi.recordingCommenter.label")',
    );
    expect(shareDialogSource).toContain(
      'description: t("shareUi.recordingCommenter.description")',
    );
    expect(shareUiSource).toContain(
      "roleCopy?: Partial<Record<Role, RoleCopy>>",
    );
    expect(shareUiSource).toContain("getRoleLabel(s.role)");
    expect(shareUiSource).toContain('useState<Role>("viewer")');
    expect(meetingDialogSource).not.toContain("roleCopy");
  });
});
