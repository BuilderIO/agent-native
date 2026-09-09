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
    expect(shareDialogSource).toContain("z-[260] w-[360px]");
    expect(shareDialogSource).toContain("flex h-10 items-center");
    expect(shareDialogSource).toContain(
      'view !== "main" || reserveCloseButton',
    );
    expect(shareDialogSource).toContain("h-8 w-full justify-start");
    expect(shareDialogSource).toContain("<ViewerSwitch");
    expect(shareUiSource).toContain("flex h-8 min-w-0 flex-1");
    expect(shareUiSource).toContain('className="size-8 shrink-0"');
  });

  it("keeps human and agent actions in separate tab panels", () => {
    const shareDialogSource = readSource("./share-dialog.tsx");

    expect(shareDialogSource).toContain('<TabsContent value="people"');
    expect(shareDialogSource).toContain('<TabsContent value="agents"');
    expect(shareDialogSource).toContain("<PeopleTab");
    expect(shareDialogSource).toContain("<AgentTab");
    expect(shareDialogSource).toContain("<CopyButton");
    expect(shareDialogSource).toContain("value={shareUrl}");
    expect(shareDialogSource).toContain("writeClipboardText(agentCopyValue)");
    // Share URLs are never rendered into an input.
    expect(shareDialogSource).not.toContain(
      "value={shareUrl}\n          readOnly",
    );
  });

  it("restores the split Share and Copy link toolbar action", () => {
    const shareDialogSource = readSource("./share-dialog.tsx");
    const shareTriggerSource = readSource("./clips-share-trigger.tsx");
    const recordingRouteSource = readSource(
      "../../routes/_app.r.$recordingId.tsx",
    );

    expect(shareDialogSource).toContain("<PageHeaderActionGroup>");
    expect(shareDialogSource).toContain("<PopoverAnchor");
    expect(shareDialogSource).toContain("<IconLink");
    expect(shareDialogSource).toContain("<IconCheck");
    expect(shareDialogSource).toContain("copyShareLink");
    expect(shareDialogSource).toContain('link_type: "share"');
    expect(shareDialogSource).toContain("<TooltipContent");
    expect(shareDialogSource).not.toContain("PageHeaderSecondaryAction");
    expect(recordingRouteSource).not.toContain("<RecordingAgentHandoffPopover");
    expect(recordingRouteSource).toContain("<ShareRecordingPopover");
    expect(shareTriggerSource).toContain("<IconUserPlus");
    expect(shareDialogSource).toContain("<PeopleAccessSection");
    expect(shareDialogSource).toContain("<GeneralAccessSelect");
    expect(shareDialogSource).toContain('variant="line"');
    expect(shareDialogSource).toContain('t("shareDialog.people")');
    expect(shareDialogSource).toContain('t("shareDialog.agents")');
    expect(shareDialogSource).toContain('view === "main"');
    expect(shareDialogSource).toContain("showHeaderCopy");
    expect(shareDialogSource).not.toContain("showCopyLink");
    expect(shareDialogSource).toContain("value={shareUrl}");
    expect(shareDialogSource).not.toContain('defaultValue="link"');
    expect(shareTriggerSource).toContain("<PageHeaderPrimaryAction asChild>");
    expect(shareTriggerSource).not.toContain("h-8");
    expect(shareTriggerSource).not.toContain("text-xs");
  });

  it("keeps recording access controls in Share instead of viewer settings", () => {
    const shareDialogSource = readSource("./share-dialog.tsx");
    const settingsPanelSource = readSource("./settings-panel.tsx");

    expect(shareDialogSource).toContain("<GeneralAccessSelect");
    expect(shareDialogSource).toContain("<RecordingAccessControls");
    expect(shareDialogSource).toContain('id="share-password-required"');
    expect(shareDialogSource).toContain('type="datetime-local"');
    expect(shareDialogSource).not.toContain(
      't("playerSettings.generatePassword")',
    );
    expect(shareDialogSource).toMatch(
      /<Label[\s\S]*htmlFor="share-password-required"[\s\S]*<ViewerSwitch[\s\S]*id="share-password-required"/,
    );
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

  it("keeps agent destinations in the Agents tab", () => {
    const shareDialogSource = readSource("./share-dialog.tsx");
    const logoSource = readSource("../agent-destination-logos.tsx");

    expect(shareDialogSource).toContain('setView("social")');
    expect(shareDialogSource).toContain('setView("embed")');
    expect(shareDialogSource).toContain("<ShareOptionRow");
    expect(shareDialogSource).toContain("<SocialTab");
    expect(shareDialogSource).toContain("customizeOpen");
    expect(shareDialogSource).toContain('openAgentDestination("claude")');
    expect(shareDialogSource).toContain('openAgentDestination("claude-code")');
    expect(shareDialogSource).toContain('openAgentDestination("codex")');
    expect(shareDialogSource).toContain("function AgentTab");
    expect(shareDialogSource).not.toContain("<DropdownMenu");
    expect(shareDialogSource).not.toContain(
      "export function RecordingAgentHandoffPopover",
    );
    expect(shareDialogSource).toContain("<ClaudeLogo");
    expect(shareDialogSource).toContain("<ClaudeCodeLogo");
    expect(shareDialogSource).toContain("<CodexLogo");
    expect(logoSource).toContain('viewBox="0 0 100 100"');
    expect(logoSource).toContain("<IconBrandOpenai");
    expect(shareDialogSource).not.toContain("<textarea");
  });

  it("keeps agent handoff out of the People tab", () => {
    const shareDialogSource = readSource("./share-dialog.tsx");
    const peopleTabStart = shareDialogSource.indexOf("function PeopleTab");
    const agentTabStart = shareDialogSource.indexOf("function AgentTab");
    const accessControlsStart = shareDialogSource.indexOf(
      "function RecordingAccessControls",
    );
    const peopleTabSource = shareDialogSource.slice(
      peopleTabStart,
      agentTabStart,
    );
    const agentTabSource = shareDialogSource.slice(
      agentTabStart,
      accessControlsStart,
    );

    expect(agentTabSource).toContain('openAgentDestination("claude")');
    expect(agentTabSource).toContain("writeClipboardText(agentCopyValue)");
    expect(peopleTabSource).not.toContain("openAgentDestination");
    expect(peopleTabSource).not.toContain("agentCopyValue");
    expect(peopleTabSource).toContain("<InvitePeopleField");
    expect(peopleTabSource).toContain("<PeopleAccessSection");
    expect(peopleTabSource).toContain(
      'className="-mx-3 border-t border-border px-1.5 pt-1.5"',
    );
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

  it("identifies a lone owner instead of showing a generic access status", () => {
    const shareUiSource = readSource("../sharing/share-ui.tsx");

    expect(shareUiSource).toMatch(
      /meta=\{\s*first && \(open \|\| rest\.length === 0\)[\s\S]*\? firstRole[\s\S]*: t\("shareUi\.canAccess"\)/,
    );
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

  it("loads a scoped agent link only when the Agents tab is active", () => {
    const shareDialogSource = readSource("./share-dialog.tsx");

    expect(shareDialogSource).toContain("needsScopedAgentContext");
    expect(shareDialogSource).toContain("if (!active)");
    expect(shareDialogSource).toContain(
      "visibility !== null && needsScopedAgentContext",
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
    expect(shareDialogSource).toMatch(
      /description: t\(\s*"shareUi\.recordingCommenter\.description",?\s*\)/,
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
