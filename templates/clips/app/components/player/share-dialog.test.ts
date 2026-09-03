import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildSocialShareUrl } from "../../lib/social-share";

function readSource(name: string): string {
  return readFileSync(new URL(name, import.meta.url), "utf8");
}

describe("recording share popover", () => {
  it("renders above the player at the compact toolbar density", () => {
    const shareDialogSource = readSource("./share-dialog.tsx");
    const shareUiSource = readSource("../sharing/share-ui.tsx");
    const videoPlayerSource = readSource("./video-player.tsx");

    expect(videoPlayerSource).toContain("absolute inset-0 z-10");
    expect(videoPlayerSource).toContain(
      "absolute inset-x-0 bottom-0 opacity-100 transition-opacity duration-200",
    );
    expect(shareDialogSource).toContain("z-[260] w-[400px]");
    expect(shareDialogSource).toContain("flex h-10 items-center");
    expect(shareDialogSource).toContain("h-8 w-full justify-start");
    expect(shareDialogSource).toContain("<ViewerSwitch");
    expect(shareUiSource).toContain("flex h-8 min-w-0 flex-1");
    expect(shareUiSource).toContain('className="size-8 shrink-0"');
  });

  it("does not show the same public URL twice", () => {
    const shareDialogSource = readSource("./share-dialog.tsx");

    expect(shareDialogSource).toContain('t("shareDialog.shareWithAgents")');
    // Both links are copy actions, so neither URL is rendered as text.
    expect(shareDialogSource).toContain("<CopyButton");
    expect(shareDialogSource).toContain("value={shareUrl}");
    expect(shareDialogSource).toContain("value={agentCopyValue}");
    // Share URLs are never rendered into an input.
    expect(shareDialogSource).not.toContain(
      "value={shareUrl}\n          readOnly",
    );
  });

  it("makes sharing and copy link first-class split actions", () => {
    const shareDialogSource = readSource("./share-dialog.tsx");
    const shareTriggerSource = readSource("./clips-share-trigger.tsx");

    expect(shareDialogSource).toContain("<ButtonGroup");
    expect(shareDialogSource).toContain("<PopoverAnchor");
    expect(shareDialogSource).toContain("<IconLink");
    expect(shareDialogSource).toContain("<IconCheck");
    expect(shareDialogSource).toContain("copyShareLink");
    expect(shareDialogSource).toContain('link_type: "share"');
    expect(shareTriggerSource).toContain("<IconUserPlus");
    expect(shareDialogSource).toContain("<PeopleAccessSection");
    expect(shareDialogSource).toContain("<GeneralAccessSelect");
    expect(shareDialogSource).toContain('view === "main"');
    expect(shareDialogSource).toContain("showHeaderCopy");
    expect(shareDialogSource).toContain("value={shareUrl}");
    expect(shareDialogSource).not.toContain('defaultValue="link"');
  });

  it("keeps recording access controls in Share instead of viewer settings", () => {
    const shareDialogSource = readSource("./share-dialog.tsx");
    const settingsPanelSource = readSource("./settings-panel.tsx");

    expect(shareDialogSource).toContain("<GeneralAccessSelect");
    expect(shareDialogSource).toContain("<RecordingAccessControls");
    expect(shareDialogSource).toContain('id="share-password-required"');
    expect(shareDialogSource).toContain('type="datetime-local"');
    expect(settingsPanelSource).not.toContain('t("playerSettings.privacy")');
    expect(settingsPanelSource).not.toContain(
      'useActionMutation("set-resource-visibility"',
    );
    expect(settingsPanelSource).not.toContain(
      'id="recording-password-required"',
    );
  });

  it("keeps social destinations as distinct share jobs", () => {
    const clipUrl = "https://clips.example/share/abc?via=owner";
    const title = "Quarterly demo & notes";

    expect(buildSocialShareUrl("linkedin", clipUrl, title)).toBe(
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(clipUrl)}`,
    );
    expect(buildSocialShareUrl("x", clipUrl, title)).toBe(
      `https://twitter.com/intent/tweet?url=${encodeURIComponent(clipUrl)}&text=${encodeURIComponent(title)}`,
    );
    expect(buildSocialShareUrl("facebook", clipUrl, title)).toBe(
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(clipUrl)}`,
    );
    expect(buildSocialShareUrl("email", clipUrl, title)).toContain(
      `subject=${encodeURIComponent(title)}`,
    );
  });

  it("progressively discloses embed settings and agent sharing", () => {
    const shareDialogSource = readSource("./share-dialog.tsx");

    expect(shareDialogSource).toContain('setView("social")');
    expect(shareDialogSource).toContain('setView("embed")');
    expect(shareDialogSource).toContain("<ShareOptionRow");
    expect(shareDialogSource).toContain("<SocialTab");
    expect(shareDialogSource).toContain("customizeOpen");
    expect(shareDialogSource).toContain("agentShareOpen");
    expect(shareDialogSource).not.toContain("<textarea");
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

    expect(shareDialogSource).toContain("needsScopedAgentContext");
    expect(shareDialogSource).toContain(
      't("shareDialog.agentTokenDescription")',
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

  it("lets managers change an existing share role", () => {
    const shareUiSource = readSource("../sharing/share-ui.tsx");

    expect(shareUiSource).toContain(
      "const handleChangeRole = (s: Share, nextRole: Role)",
    );
    expect(shareUiSource).toContain("principalType: s.principalType");
    expect(shareUiSource).toContain("principalId: s.principalId");
    expect(shareUiSource).toContain("role: nextRole");
    expect(shareUiSource).toContain('onError?.(err, "permission")');
    expect(shareUiSource).toContain("value={s.role}");
    expect(shareUiSource).toContain(
      "onValueChange={(value) => handleChangeRole(s, value as Role)}",
    );
    expect(shareUiSource).toContain("disabled={share.isPending}");
  });
});
