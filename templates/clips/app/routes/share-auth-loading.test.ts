import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function readRoute(name: string): string {
  return readFileSync(resolve(process.cwd(), "app/routes", name), "utf8");
}

describe("authenticated recording route loading", () => {
  it("waits for the browser session before the direct player action", () => {
    const route = readRoute("r.$recordingId.tsx");
    expect(route).toContain("enabled: !!recordingId && !sessionLoading");
    expect(route).toContain("if (sessionLoading)");
    expect(route).toContain(
      "if (playerDataQ.isLoading || playerDataForbidden)",
    );
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
    expect(route).toContain("overflow-y-auto data-[state=inactive]:hidden");
    expect(route).toContain(
      "h-[var(--agent-native-viewport-height,100vh)] min-h-0",
    );
    expect(route).toContain("overflow-y-auto xl:flex-1 xl:overflow-y-hidden");
    expect(route).toContain("request-recording-access");
    expect(route).toContain("RequestAccessDialog");
    expect(route).toContain("requesterEmail");
    expect(route).toContain("submitGuestAccessRequest");
    expect(route).toContain("deniedData.accessRequestToken");
    expect(route).toContain("...(userEmail ? { viewerEmail: userEmail } : {})");
    expect(route).toContain("apiAccessDeniedStatus");
    expect(route).toContain("accessDeniedStatus");
    expect(route).toContain('const startAt = searchParams.get("at")');
    expect(route).toContain(
      "buildShareContinuationQuery(attribution, startAt)",
    );
    expect(route).toContain('IconLock className="h-5 w-5"');
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

  it("only renders a non-seekable transcript when the meeting payload shares it", () => {
    const route = readRoute("share.meeting.$meetingId.tsx");
    expect(route).toContain("{transcript && (");
    expect(route).toContain("<TranscriptBubbles");
    expect(route).not.toContain("recordingId=");
    expect(route).not.toContain("onSeek=");
    expect(route).toContain('t("shareMeeting.copyTranscript")');
  });

  it("keeps editor shares editable and shows their insights", () => {
    const route = readRoute("share.$shareId.tsx");
    expect(route).toContain('viewerRole === "editor"');
    expect(route).toContain("role={viewerRole ??");
    expect(route).toContain("<InsightsPanel");
    expect(route).toContain("{viewerCanEdit ? (");
  });

  it("gates fullscreen share interactions by the viewer permission", () => {
    const route = readRoute("share.$shareId.tsx");
    expect(route).toContain(
      "const viewerCanUseFullscreenInteractions = !session || viewerCanComment;",
    );
    expect(route).toContain(
      "recording.enableComments && viewerCanUseFullscreenInteractions",
    );
    expect(route).toContain(
      "recording.enableReactions && viewerCanUseFullscreenInteractions",
    );
    expect(route).toContain(
      'viewerCanUseFullscreenInteractions\n                  ? () => setPanel("comments")',
    );
  });

  it("does not expose the insights tab to viewers", () => {
    const shareRoute = readRoute("share.$shareId.tsx");
    const shareTrigger = shareRoute.indexOf(
      '<TabsTrigger value="insights" className="text-xs">',
    );
    const shareTriggerGuard = shareRoute.lastIndexOf(
      "{viewerCanEdit ? (",
      shareTrigger,
    );
    expect(shareTrigger).toBeGreaterThan(-1);
    expect(shareTriggerGuard).toBeGreaterThan(-1);

    const recordingRoute = readRoute("r.$recordingId.tsx");
    expect(recordingRoute).toContain(
      'canEdit ? trigger("insights", t("recordingPage.insights")) : null,',
    );
    expect(recordingRoute).not.toContain("InsightsUnavailableState");
  });

  it("gates private recipient sharing and places overflow after Share", () => {
    const recordingRoute = readRoute("r.$recordingId.tsx");
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
    expect(recordingRoute.match(/<ClipsShareTrigger/g)).toHaveLength(2);
    expect(shareRoute).toContain("<ClipsShareTrigger");
    expect(trigger).toContain('intent="primary"');
    expect(trigger).toContain('emphasis="solid"');

    const publicControlsStart = shareRoute.indexOf("<RecordingViewsBadge");
    expect(publicControlsStart).toBeGreaterThan(-1);
    const publicControls = shareRoute.slice(publicControlsStart);
    expect(publicControls.indexOf("<ClipsShareTrigger")).toBeLessThan(
      publicControls.indexOf("IconDotsVertical"),
    );
    expect(publicControls.indexOf("<ClipsShareTrigger")).toBeLessThan(
      publicControls.indexOf("<RecordingOptionsMenu"),
    );
    expect(shareRoute).toContain("IconDotsVertical");
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
});
