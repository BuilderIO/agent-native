import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function readRoute(name: string): string {
  return readFileSync(resolve(process.cwd(), "app/routes", name), "utf8");
}

describe("authenticated recording route loading", () => {
  it("waits for the browser session before the direct player action", () => {
    const route = readRoute("_app.r.$recordingId.tsx");
    expect(route).toContain("enabled: !!recordingId && !sessionLoading");
    expect(route).toContain(
      "if (playerDataQ.isLoading || playerDataForbidden)",
    );
    expect(route).toContain("<RecordingWorkspaceSkeleton />");
    expect(route).not.toContain("buildSignInReturnHref");
  });

  it("lets public shares proceed when session status is unavailable", () => {
    const route = readRoute("share.$shareId.tsx");
    expect(route).toContain("status: sessionStatus,");
    expect(route).toContain("enabled: !!shareId");
    expect(route).toContain('sessionStatus === "loading"');
    expect(route).toContain('sessionStatus === "signing-out"');
    expect(route).toContain('sessionStatus === "unavailable"');
    expect(route).toContain("retry: retrySession");
    expect(route).toContain("retrySession();");
    expect(route).toContain("retriedUnavailableSessionRef");
    expect(route).toContain('t("sharePage.checkAgain")');
    expect(route).toContain("void dataQ.refetch();");
    expect(route).toContain("dataQ.data.status === 401");
    expect(route).toContain("dataQ.data.status === 404");
    expect(route).toContain("!needsPassword &&");
    expect(route).toContain(
      'type SharePanel = "comments" | "transcript" | "agent"',
    );
    expect(route).toContain(
      "h-[var(--agent-native-viewport-height,100vh)] min-h-0",
    );
    expect(route).toMatch(/className="[^"]*min-h-0 flex-1 overflow-y-auto/);
    expect(route).toContain("request-recording-access");
    expect(route).toContain("RequestAccessDialog");
    expect(route).toContain("requesterEmail");
    expect(route).toContain("submitGuestAccessRequest");
    expect(route).toContain("deniedData.accessRequestToken");
    expect(route).toContain("...(userEmail ? { viewerEmail: userEmail } : {})");
    expect(route).toContain("apiAccessDeniedStatus");
    expect(route).toContain("accessDeniedStatus");
    expect(route).toContain('const startAt = searchParams.get("at")');
    expect(route).toContain("readShareAttribution(search)");
    expect(route).not.toContain(
      'typeof window === "undefined" ? "" : window.location.search',
    );
    expect(route).not.toContain(
      'if (typeof window === "undefined") return path;',
    );
    expect(route).toContain(
      "buildShareContinuationQuery(attribution, startAt, panelParam)",
    );
    expect(route).toContain('IconLock className="h-5 w-5"');
  });

  it("renders signed-in share viewers in the app shell with breadcrumbs", () => {
    const route = readRoute("share.$shareId.tsx");
    const root = readFileSync(resolve(process.cwd(), "app/root.tsx"), "utf8");

    expect(root).toContain("isRecordingSharePath(location.pathname)");
    expect(root).toContain('typeof window !== "undefined"');
    expect(root).toContain('sessionStatus === "authenticated"');
    expect(root).toContain(
      "isStandalonePublicPath(location.pathname) && !authenticatedShare",
    );
    expect(root).toContain("<LibraryLayout>");
    expect(route).toContain("<PageBreadcrumb items={shareBreadcrumbItems} />");
    expect(route).not.toContain(
      'aria-label={t("recordingPage.backToLibrary")}',
    );
  });

  it("keeps sharing unavailable while a recording upload is processing", () => {
    const route = readRoute("_app.r.$recordingId.tsx");
    const viewStart = route.indexOf("const processingView = (");
    const viewEnd = route.indexOf("return processingView;", viewStart);
    const processingView = route.slice(viewStart, viewEnd);

    expect(viewStart).toBeGreaterThanOrEqual(0);
    expect(viewEnd).toBeGreaterThan(viewStart);
    expect(processingView).not.toContain("renderShareControl()");
    expect(processingView).not.toContain("ShareCopyRow");
  });

  it("keeps transient missing share records loading while retrying locally", () => {
    const route = readRoute("share.$shareId.tsx");
    expect(route).toContain("const MISSING_SHARE_RETRY_LIMIT = 8;");
    expect(route).toContain("status === 404 &&");
    expect(route).toContain("updateCount < MISSING_SHARE_RETRY_LIMIT");
    expect(route).toContain("retryingMissingShare ||");
    expect(route).toContain("getQueryState(shareQueryKey)?.dataUpdateCount");
  });

  it("keeps expired share loader data impersonal for CDN caching", () => {
    const route = readRoute("share.$shareId.tsx");

    expect(route).toContain("isRecordingExpired(rec.expiresAt)");
    expect(route).not.toContain("isRecordingExpiredForViewer");
    expect(route).not.toContain("sameOwnerEmail");
  });

  it("waits for the browser session before the meeting share payload request", () => {
    const route = readRoute("share.meeting.$meetingId.tsx");
    expect(route).toContain('fetchPublicMeeting(meetingId ?? "", {');
    expect(route).toContain("enabled: !!meetingId && !sessionLoading");
    expect(route).toContain("initialData: initialMeetingResult");
    expect(route).toContain("privateShareLoaderData");
    expect(route).toContain(
      "export function headers({ loaderHeaders }: HeadersArgs)",
    );
    expect(route).toContain(
      "!meeting && (sessionLoading || meetingQuery.isLoading)",
    );
    expect(route).toContain('eq(schema.meetings.visibility, "public")');
    expect(route).not.toContain('fetch("/api/public-meeting');
  });

  it("keeps the meeting timestamp stable through hydration", () => {
    const route = readRoute("share.meeting.$meetingId.tsx");
    expect(route).toContain("useState(false);");
    expect(route).toContain('stable ? "en-US" : []');
    expect(route).toContain('...(stable ? { timeZone: "UTC" } : {})');
    expect(route).toContain(
      "formatDateTime(meeting.scheduledStart, !hasHydrated)",
    );
  });

  it("only renders a non-seekable transcript when the meeting payload shares it", () => {
    const route = readRoute("share.meeting.$meetingId.tsx");
    expect(route).toContain("{transcript && (");
    expect(route).toContain("<TranscriptBubbles");
    expect(route).not.toContain("recordingId=");
    expect(route).not.toContain("onSeek=");
    expect(route).toContain('t("shareMeeting.copyTranscript")');
  });

  it("keeps editor shares editable and exposes attached viewer insights", () => {
    const route = readRoute("share.$shareId.tsx");
    expect(route).toContain('viewerRole === "editor"');
    expect(route).toContain("role={viewerRole ??");
    expect(route).toContain("<RecordingViewsBadge");
    expect(route).toContain("canViewDetails={viewerCanEdit}");
    expect(route).not.toContain("<InsightsPanel");
  });

  it("keeps public viewer identity, engagement, and side panels aligned", () => {
    const route = readRoute("share.$shareId.tsx");

    expect(route).toContain("const ownerInitial =");
    expect(route).toContain("ownerInitial: rec.ownerEmail");
    expect(route).not.toContain("ownerEmail: rec.ownerEmail");
    expect(route).toContain("<ClipsAvatar");
    expect(route).toContain("const recordedOn = formatRecordedOn");
    expect(route).toContain('stable ? "en-US" : undefined');
    expect(route).toContain(
      "formatRecordedOn(recording?.createdAt, !hasHydrated)",
    );
    expect(route).toContain("<RecordingViewsBadge");
    expect(route).toContain("<ShareReactionPicker");
    expect(route).toContain('t("recordingPage.react")');
    expect(route).toContain("<ViewerTabsList");
    expect(route).toContain('<ViewerTabsTrigger value="transcript">');
    expect(route).toContain('<ViewerTabsTrigger value="agent">');
    expect(route).toContain("<RecordingSidePanel");
    expect(route).toContain('className="contents"');
    expect(route).toContain(
      'className="col-span-full row-start-1 flex min-h-14 min-w-0 shrink-0 flex-wrap items-center gap-3 bg-background px-5 py-3 lg:flex-nowrap"',
    );
    expect(route).not.toContain(
      "row-start-1 flex min-w-0 shrink-0 flex-wrap items-center gap-3 border-b border-border",
    );
    expect(route).not.toContain("closeLabel");
    expect(route).not.toContain("onClose={() => setPanel(null)}");
    expect(route).toContain("PublicAgentEmptyState");
    expect(route).toContain("AccountGateDialog");
    expect(route).toContain('onSignup={() => openCreateAccount("agent")}');
    expect(route).toContain('onSignIn={() => fireShareCtaClick("signin")}');
    expect(route).not.toContain("SignInPromptDialog");
    expect(route).toContain('t("sharePage.agentEmptyTitle")');
    expect(route).toContain('t("sharePage.agentEmptyDescription")');
    expect(route).toContain('t("sharePage.agentEmptySignInPrompt")');
    expect(route).toContain('t("signInPrompt.createAccount")');
    expect(route).toContain('t("signInPrompt.signIn")');
    expect(route).toContain("CaptureInstallButton");
    expect(route).toContain('t("sharePage.downloadDesktopApp")');
    expect(route).not.toContain("agentNativeClips");
    expect(route).toContain('useState<SharePanel>("comments")');
    expect(route).toContain("lg:grid-cols-[minmax(0,1fr)_360px]");
    expect(route).toContain("col-span-full row-start-1");
    expect(route).toContain("lg:col-start-2");
    expect(route).toContain(
      "w-full flex-col gap-5 pb-10 sm:px-4 lg:h-full lg:min-h-0 lg:max-w-[min(100%,1600px,calc(177.778dvh-35.556rem))] lg:pt-4",
    );
    expect(route).toContain("lg:min-h-0 lg:flex-1 lg:overflow-hidden");
    expect(route).not.toContain("max-w-[1200px]");
    expect(route).not.toContain(
      'variant={panel === "transcript" ? "secondary" : "ghost"}',
    );
    expect(route).not.toContain(
      'variant={panel === "agent" ? "secondary" : "ghost"}',
    );
  });

  it("gates fullscreen share interactions by the viewer permission", () => {
    const route = readRoute("share.$shareId.tsx");
    expect(route).toContain(
      "const viewerCanUseFullscreenInteractions = !session || viewerCanComment;",
    );
    expect(route).toContain(
      "recording.enableComments &&\n                    viewerCanUseFullscreenInteractions",
    );
    expect(route).toContain("recording.enableReactions &&");
    expect(route).toContain("viewerCanUseFullscreenInteractions");
    expect(route).toContain("onCommentClick={");
    expect(route).toContain('setPanel("comments")');
  });

  it("sends anonymous participation into the shared account dialog", () => {
    const route = readRoute("share.$shareId.tsx");

    expect(route).toContain("const [accountGateIntent");
    expect(route).toContain("setAccountGateIntent(intent);");
    expect(route).toContain("share_account_gate_shown");
    expect(route).toContain("share_account_action_completed");
    expect(route).toContain("retrySession();");
    expect(route).toContain("pendingAccountActionRef");
    expect(route).toContain("disabled={Boolean(session) && !viewerCanComment}");
    expect(route).toContain("onReact={reactToRecording}");
  });

  it("keeps public comments in flow and consolidates recording insights", () => {
    const shareRoute = readRoute("share.$shareId.tsx");
    expect(shareRoute).toContain('value="comments"');
    expect(shareRoute).toContain('useState<SharePanel>("comments")');
    expect(shareRoute).toContain('presentation="inline"');
    expect(shareRoute).toContain(
      'className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-3 pt-2"',
    );
    expect(shareRoute.match(/t\("sharePage\.comments"\)/g)).toHaveLength(1);
    expect(shareRoute).toContain("const [descriptionExpanded");
    expect(shareRoute).toContain('!descriptionExpanded && "line-clamp-2"');
    expect(shareRoute).not.toContain('panel === "insights"');

    const recordingRoute = readRoute("_app.r.$recordingId.tsx");
    expect(recordingRoute).not.toContain(
      'trigger("insights", t("recordingPage.insights"))',
    );
    expect(recordingRoute).toContain(
      'defaultOpen={canEdit && panelParam === "insights"}',
    );
    expect(recordingRoute).not.toContain("InsightsUnavailableState");
  });

  it("gates private recipient sharing and places overflow after Share", () => {
    const recordingRoute = readRoute("_app.r.$recordingId.tsx");
    const shareRoute = readRoute("share.$shareId.tsx");
    const trigger = readFileSync(
      resolve(process.cwd(), "app/components/player/clips-share-trigger.tsx"),
      "utf8",
    );

    expect(recordingRoute).toContain("const isPrivateRecipient =");
    expect(recordingRoute).toContain(
      '(role === "viewer" || role === "commenter") &&',
    );
    expect(recordingRoute).toContain('recording?.visibility === "private";');
    expect(recordingRoute.match(/isPrivateRecipient \? \(/g)).toHaveLength(2);
    expect(
      recordingRoute.match(/t\("recordingPage\.sharedWithYou"\)/g),
    ).toHaveLength(2);
    expect(recordingRoute).toContain("const renderShareControl =");
    expect(recordingRoute.match(/renderShareControl\(/g)).toHaveLength(1);
    expect(shareRoute).toContain("<ClipsShareTrigger");
    expect(trigger).toContain('intent="primary"');
    expect(trigger).toContain('emphasis="solid"');

    const publicControlsStart = shareRoute.indexOf("<header");
    expect(publicControlsStart).toBeGreaterThan(-1);
    const publicControls = shareRoute.slice(publicControlsStart);
    expect(shareRoute.indexOf("const shareControl")).toBeLessThan(
      publicControlsStart,
    );
    expect(publicControls.indexOf("{shareControl}")).toBeGreaterThan(-1);
    expect(publicControls.indexOf("{shareControl}")).toBeLessThan(
      publicControls.indexOf("<RecordingOptionsMenu"),
    );
    expect(shareRoute).not.toContain("IconDotsVertical");
    expect(shareRoute).not.toContain("IconDots className");
  });

  it("keeps meeting agent links scoped through both page and context loading", () => {
    const meetingRoute = readRoute("share.meeting.$meetingId.tsx");
    expect(meetingRoute).toContain("verifyScopedAgentAccessToken");
    expect(meetingRoute).toContain("CLIPS_MEETING_AGENT_RESOURCE_KIND");
    expect(meetingRoute).toContain("agentAccessToken");
    expect(meetingRoute).toContain('fetchPublicMeeting(meetingId ?? "", {');
    expect(meetingRoute).toContain("recordingId: schema.meetings.recordingId");
    expect(meetingRoute).toContain("recordingTranscripts");
    expect(meetingRoute).toContain("transcript: transcript");
  });

  it("keeps the shared clip agent scoped to the clip being viewed", () => {
    const shareRoute = readRoute("share.$shareId.tsx");
    const agentPanel = shareRoute.slice(shareRoute.lastIndexOf("<AgentPanel"));

    expect(agentPanel).toContain("scope={");
    expect(agentPanel).toContain('type: "recording"');
    expect(agentPanel).toContain("id: recording.id");
  });

  it("opens the comments panel on the public share page for ?panel=comments links", () => {
    const shareRoute = readRoute("share.$shareId.tsx");

    expect(shareRoute).toContain(
      'const panelParam = searchParams.get("panel")',
    );
    const effectStart = shareRoute.indexOf(
      "if (recording && !recording.enableComments) {",
    );
    expect(effectStart).toBeGreaterThan(-1);
    const effect = shareRoute.slice(effectStart, effectStart + 700);
    expect(effect).toContain('if (panelParam === "comments") {');
    expect(effect).toContain("selectCommentsPanel();");

    expect(effect).toContain(
      'setPanel((current) => (current === "comments" ? "transcript" : current));',
    );
  });

  it("does not re-select comments every time the viewer changes tabs", () => {
    const shareRoute = readRoute("share.$shareId.tsx");

    const effectStart = shareRoute.indexOf(
      "if (recording && !recording.enableComments) {",
    );
    expect(effectStart).toBeGreaterThan(-1);
    const depsStart = shareRoute.indexOf("}, [", effectStart);
    const depsEnd = shareRoute.indexOf("]);", depsStart);
    const deps = shareRoute.slice(depsStart, depsEnd);

    expect(deps).not.toMatch(/(^|[^.\w])panel(?![.\w?])/);
  });

  it("re-runs the comments deep link when navigating between shares", () => {
    const shareRoute = readRoute("share.$shareId.tsx");

    const effectStart = shareRoute.indexOf(
      "if (recording && !recording.enableComments) {",
    );
    expect(effectStart).toBeGreaterThan(-1);
    const depsStart = shareRoute.indexOf("}, [", effectStart);
    const depsEnd = shareRoute.indexOf("]);", depsStart);
    const deps = shareRoute.slice(depsStart, depsEnd);

    expect(deps).toContain("panelParam");
    expect(deps).toContain("recording?.enableComments");
    expect(deps).toContain("shareId");
  });

  it("preserves ?panel in the sign-in continuation URL for public shares", () => {
    const shareRoute = readRoute("share.$shareId.tsx");

    expect(shareRoute).toContain(
      "buildShareContinuationQuery(attribution, startAt, panelParam)",
    );

    const attributionSrc = readFileSync(
      resolve(process.cwd(), "shared/share-attribution.ts"),
      "utf8",
    );
    expect(attributionSrc).toContain('if (panel) params.set("panel", panel);');
  });

  it("sends signed-in viewers to the app shell instead of the marketing page", () => {
    const shareRoute = readRoute("share.$shareId.tsx");

    expect(shareRoute).toContain(
      'const homeHref = session ? appPath("/home") : appPath("/");',
    );

    expect(shareRoute).toContain("homeHref: string;");
    expect(shareRoute).toContain(
      '<a href={homeHref}>{t("clipsFinalRaw.goHome")}</a>',
    );
    expect(shareRoute).not.toContain('<a href={appPath("/")}>');

    expect(shareRoute.match(/homeHref=\{homeHref\}/g)).toHaveLength(6);

    expect(shareRoute).toContain(
      'to={appPath("/")}\n              aria-label={t("navigation.brand")}',
    );
  });
});
