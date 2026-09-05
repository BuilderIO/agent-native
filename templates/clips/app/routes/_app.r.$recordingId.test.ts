import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function readRoute(name: string): string {
  return readFileSync(resolve(process.cwd(), "app/routes", name), "utf8");
}

describe("direct recording route shell cue", () => {
  it("prefers public-share timestamps over legacy owner timestamps", () => {
    const route = readRoute("_app.r.$recordingId.tsx");

    expect(route).toContain('searchParams.get("at") ?? searchParams.get("t")');
  });

  it("clamps route playback state before exposing it", () => {
    const recordingRoute = readRoute("_app.r.$recordingId.tsx");
    const shareRoute = readRoute("share.$shareId.tsx");

    expect(recordingRoute).toContain(
      "const playbackMs = resolveStartMs(currentMs, recording?.durationMs)",
    );
    expect(recordingRoute).toContain("currentMs: Math.round(playbackMs)");
    expect(recordingRoute).toContain("currentMs={playbackMs}");
    expect(shareRoute).toContain(
      "const playbackMs = resolveStartMs(currentMs, recording?.durationMs)",
    );
    expect(shareRoute).toContain("currentMs={playbackMs}");
  });

  it("surfaces recording cleanup before advanced workflow submenus", () => {
    const route = readRoute("_app.r.$recordingId.tsx");
    const menuStart = route.indexOf('t("recordingPage.askAboutClip")');
    const menuEnd = route.indexOf(
      't("recordingPage.includeFullVideo")',
      menuStart,
    );
    const menu = route.slice(menuStart, menuEnd);

    expect(menuStart).toBeGreaterThan(-1);
    expect(menu).toContain('t("recordingPage.removeFillerWords")');
    expect(menu).toContain('t("recordingPage.removeSilences")');
    expect(menu).toContain("<DropdownMenuSub>");
    expect(menu).toContain('t("recordingPage.enhanceRecording")');
    expect(menu).toContain('t("recordingPage.createFromClip")');
    expect(menu).not.toContain('t("recordingPage.cleanUpRecording")');
  });

  it("keeps background AI work in one persistent Sonner lifecycle", () => {
    const route = readRoute("_app.r.$recordingId.tsx");

    expect(route).toContain("const aiRequestStatusQ = useQuery");
    expect(route).toContain('status === "queued" || status === "working"');
    expect(route).toContain("startAiRequestToast");
    expect(route).toContain("completeAiRequestToast");
    expect(route).toContain("failAiRequestToast");
    expect(route).toContain("duration: Number.POSITIVE_INFINITY");
    expect(route).toContain("transcriptPendingObservedRef.current = true");
    expect(route).toContain(
      "transcriptLifecycleRecordingIdRef.current !== recording.id",
    );
    expect(route).not.toContain("silenceRemovalStatus");
    expect(route).not.toContain(
      'toast.success(t("recordingPage.silenceQueued"))',
    );
    expect(route).not.toContain(
      'toast.success(t("recordingPage.fillerQueued"))',
    );
  });

  it("keeps Share primary and unifies mobile viewer panels", () => {
    const route = readRoute("_app.r.$recordingId.tsx");
    const toolbarStart = route.indexOf("const recordingActions = (");
    const toolbarEnd = route.indexOf("const ownerInitial", toolbarStart);
    const toolbar = route.slice(toolbarStart, toolbarEnd);

    expect(toolbarStart).toBeGreaterThan(-1);
    expect(toolbar).toContain("<IconEdit");
    expect(toolbar).toContain("<IconMoodSmile");
    expect(toolbar).toContain('t("recordingPage.react")');
    expect(toolbar).toContain("<PopoverContent");
    expect(toolbar).toContain("REACTION_EMOJIS.map");
    expect(toolbar).toContain("<RecordingOptionsMenu");
    expect(toolbar).toContain("canDownload={canDownloadRecording}");
    expect(toolbar).toContain("onDownload={() => void downloadRecording()}");
    expect(toolbar).not.toContain("<ClipsShareTrigger");
    expect(route).toContain("const renderShareControl = () => (");
    expect(route).toContain(
      '<ClipsShareTrigger label={t("recordingPage.share")} />',
    );
    expect(route).not.toContain('renderShareControl("');
    expect(toolbar).not.toContain("<ReactionsTray");
    expect(toolbar).not.toContain("<IconDownload");
    expect(toolbar).not.toContain("<IconMessageCircleBolt");
    expect(toolbar).not.toContain('aria-label={t("recordingPage.aiTools")}');
    expect(toolbar).not.toContain("<IconLink");
    expect(toolbar).not.toContain("copyShareLink");
    expect(toolbar).not.toContain("<ViewerButton");
    expect(route).toContain('className="flex shrink-0 items-center gap-2"');
    expect(toolbar).toContain('className="flex items-center gap-2"');
    const contentColumnStart = route.indexOf(
      'className="mx-auto flex min-h-0 w-full flex-1 flex-col gap-0 sm:gap-4 lg:max-w-[calc(177.778dvh-35.556rem)]"',
    );
    const contentColumn = route.slice(
      contentColumnStart,
      route.indexOf("{/* Side panel */}", contentColumnStart),
    );
    expect(contentColumnStart).toBeGreaterThan(-1);
    expect(contentColumn).toContain("<VideoPlayer");
    expect(route).toContain(
      "gap-0 sm:gap-4 sm:px-5 sm:pb-5 sm:pt-4 lg:min-h-0 lg:flex-1 lg:overflow-hidden",
    );
    expect(contentColumn).toContain("renderCommentsSection()");
    expect(toolbar).not.toContain("renderSidebarToggleButton()");
    expect(toolbar).not.toContain("renderPanelTabs()");
    expect(route).toContain("<ViewerTabsList");
    expect(route).toContain('<ViewerTabsTrigger value="comments">');
    expect(route).toContain('<ViewerTabsTrigger value="transcript">');
    expect(route).toContain('<ViewerTabsTrigger value="agent">');
    expect(route).toContain('<ViewerTabsTrigger value="settings">');
    expect(route).not.toContain("<ToggleGroup");
    expect(route).toContain('value={panel ?? "comments"}');
    expect(route).toContain('if (value === "comments")');
    expect(route).toContain("openCommentsPanel();");
    expect(route).not.toContain("IconLayoutSidebarRightCollapse");
    expect(route).not.toContain("IconLayoutSidebarRightExpand");
    expect(route).not.toContain("closeSidePanel");
    expect(route).not.toContain("lastToolbarPanelRef");
    expect(route).toContain(
      '!editing && !isCompactLayout && panel && panel !== "comments"',
    );
    const mobilePanelStart = route.indexOf('id="clip-activity-panel"');
    const mobilePanel = route.slice(
      mobilePanelStart,
      route.indexOf(") : (", mobilePanelStart),
    );
    expect(mobilePanelStart).toBeGreaterThan(-1);
    expect(mobilePanel).toContain("RecordingSidePanel");
    expect(mobilePanel).toContain('panel === "comments"');
    expect(mobilePanel).toContain("renderCommentsSection(true)");
    expect(mobilePanel).toContain("{renderPanelTabs()}");
    expect(mobilePanel.indexOf("{renderPanelTabs()}")).toBeLessThan(
      mobilePanel.indexOf('panel === "comments"'),
    );
    const sidePanelStart = route.indexOf("{/* Side panel */}");
    const sidePanel = route.slice(sidePanelStart, route.indexOf("</Tabs>"));
    expect(sidePanelStart).toBeGreaterThan(-1);
    expect(sidePanel).toContain("<RecordingSidePanel");
    expect(sidePanel).toContain(
      '"hidden lg:col-start-2 lg:row-start-1 lg:flex lg:w-[360px] xl:w-[420px]',
    );
    expect(sidePanel).toContain("{renderPanelTabs()}");
    expect(sidePanel).toContain("{renderSidePanel()}");
    expect(sidePanel).not.toContain("onClose");
    expect(sidePanel).not.toContain("closeLabel");
    expect(sidePanel.indexOf("{renderPanelTabs()}")).toBeLessThan(
      sidePanel.indexOf("{renderSidePanel()}"),
    );
    const sidePanelFrame = readFileSync(
      resolve(process.cwd(), "app/components/player/recording-side-panel.tsx"),
      "utf8",
    );
    expect(sidePanelFrame).toContain("data-recording-side-panel");
    expect(sidePanelFrame).toContain("border-y border-border bg-background");
    expect(sidePanelFrame).toContain("lg:bg-sidebar");
    expect(sidePanelFrame).toContain("lg:me-4");
    expect(sidePanelFrame).toContain("lg:rounded-xl");
    expect(sidePanelFrame).not.toContain("IconX");
    expect(route).toContain("alwaysShowControls");
    expect(route).toContain(
      "overflow-x-hidden bg-background lg:grid-cols-[minmax(0,1fr)_auto]",
    );

    const viewerControls = readFileSync(
      resolve(process.cwd(), "app/components/player/viewer-controls.tsx"),
      "utf8",
    );
    expect(viewerControls).toContain('variant="line"');
    expect(viewerControls).not.toContain("group-focus-visible:ring-2");
    expect(viewerControls).not.toContain("hover:bg-muted/50");
  });

  it("embeds Agent in the recording panel without mounting a second rail", () => {
    const route = readRoute("_app.r.$recordingId.tsx");
    const layout = readFileSync(
      resolve(process.cwd(), "app/components/library/library-layout.tsx"),
      "utf8",
    );

    expect(route).toContain('<ViewerTabsTrigger value="agent">');
    expect(route).toContain('value="agent"');
    expect(route).toContain("<AgentPanel");
    expect(route).toContain('scope={{ type: "recording", id: recording.id }}');
    expect(route).toContain("openAgentPanel");
    expect(route).not.toContain("openGlobalAgentPanel");
    expect(route).not.toContain("<LibraryLayout");
    expect(layout).toContain("<AgentSidebar");
    expect(layout).toContain(
      'className="agent-layout-main-surface flex min-h-0 min-w-0 flex-1 flex-col"',
    );
    expect(layout).toContain("showCollapseButton={isMobile}");
    expect(layout).toContain("<AgentToggleButton");
    expect(layout).toContain("showWhenOpen");
    expect(layout).toContain("<IconLayoutSidebarRight");
    expect(layout).toContain("<ClipsAgentToggleButton />");
    expect(layout).toContain("[&>.agent-sidebar-shell]:h-full");
    expect(layout).toContain("showAgentSidebar = true");
    expect(layout).toContain("{showAgentSidebar ? (");
    expect(route).toContain("<PageHeader>");
    expect(route).toContain("<BreadcrumbList");
    expect(route).toContain("<BreadcrumbLink asChild>");
    expect(route).toContain("<BreadcrumbPage");
    expect(route).toContain("<BreadcrumbSeparator");
    expect(route).toContain('to="/library"');
    expect(route).toContain("recordingFolder.spaceId");
    expect(route).toContain("{recordingActions}");
    expect(route).toContain("fallback={ownerInitial}");
    expect(route).toContain("{recording.description}");
    expect(route).toContain('t("shareDialog.more")');
  });

  it("keeps the processing state inside the signed-in workspace shell", () => {
    const route = readRoute("_app.r.$recordingId.tsx");

    expect(route).toContain("const processingView = (");
    expect(route).toContain("<PageHeader>");
    expect(route).toContain("{recordingBreadcrumb}");
    expect(route).toContain("renderShareControl()");
    expect(route).toContain("return processingView;");
    expect(route).toContain(
      'className="flex h-full min-h-0 w-full flex-col bg-background"',
    );
    expect(route).toContain("min-h-0 w-full max-w-6xl");
    expect(route).not.toContain("{session ?");
  });
});
