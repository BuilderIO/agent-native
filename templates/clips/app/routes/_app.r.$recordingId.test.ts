import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { shouldOfferTranscriptRegeneration } from "@/lib/background-ai-error";

function readRoute(name: string): string {
  return readFileSync(resolve(process.cwd(), "app/routes", name), "utf8");
}

describe("direct recording route shell cue", () => {
  it("localizes unreadable screenshot edit errors", () => {
    const route = readRoute("_app.r.$recordingId.tsx");

    expect(route).toContain('"CLIPS_SCREENSHOT_EDITS_UNREADABLE"');
    expect(route).toContain('t("screenshot.editsUnreadable")');
  });

  it("fences manual finalize retries to the loaded upload identity", () => {
    const route = readRoute("_app.r.$recordingId.tsx");

    expect(route).toContain(
      "uploadAttemptId: recording?.uploadAttemptId ?? null",
    );
    expect(route).toContain(
      "uploadGenerationId: recording?.uploadGenerationId ?? null",
    );
  });

  it("prefers public-share timestamps over legacy owner timestamps", () => {
    const route = readRoute("_app.r.$recordingId.tsx");

    expect(route).toContain('searchParams.get("at") ?? searchParams.get("t")');
    expect(route).toContain("requestedPlaybackRef.current");
    expect(route).toContain("playerRef.current?.seek(requestedStartMs)");
  });

  it("preserves only public playback state in the anonymous legacy redirect", () => {
    const route = readRoute("_app.r.$recordingId.tsx");

    expect(route).toContain("buildShareContinuationQuery");
    expect(route).toContain("legacyShareQuery");
    expect(route).toContain('searchParams.get("panel")');
  });

  it("opens Agent from legacy recording URLs and preserves collapsed state", () => {
    const route = readRoute("_app.r.$recordingId.tsx");

    expect(route).toContain("AGENT_SIDEBAR_QUERY_PARAM");
    expect(route).toContain("AGENT_SIDEBAR_QUERY_VALUE_OPEN");
    expect(route).toContain("nextParams.delete(AGENT_SIDEBAR_QUERY_PARAM)");
    expect(route).toContain('!nextParams.has("panel")');
    expect(route).toContain(
      "legacyAgentSidebar === AGENT_SIDEBAR_QUERY_VALUE_OPEN",
    );
    expect(route).toContain(
      'if (panelParam === "agent") {\n      setPanel("agent");\n      return;',
    );
    expect(route).not.toContain(
      'if (panelParam === "agent") {\n      setPanel("agent");\n      setSidePanelCollapsed(false);',
    );
    expect(route).toContain(
      "setPanel(next);\n      setSidePanelCollapsed(false);",
    );
  });

  it("routes the Agent shortcut to the recording composer after it mounts", () => {
    const route = readRoute("_app.r.$recordingId.tsx");
    const shortcutStart = route.indexOf(
      "const handleKeyDown = (event: KeyboardEvent)",
    );
    const shortcutEnd = route.indexOf(
      'document.addEventListener("keydown", handleKeyDown)',
      shortcutStart,
    );

    expect(route).toContain('event.key !== "i"');
    expect(route).toContain('".ProseMirror, textarea"');
    expect(route).toContain("window.setTimeout(() => focus(attempt + 1), 50)");
    expect(route).toContain("selectionHandoffRevisionRef.current += 1;");
    expect(route).toContain("setPendingSelectionText(selectionText || null);");
    expect(route).toContain(
      "if (selectionRevision !== selectionHandoffRevisionRef.current) return;",
    );
    expect(route).toMatch(
      /useEffect\(\s*\(\) => \(\) => \{\s*selectionHandoffRevisionRef\.current \+= 1;/,
    );
    expect(route).toContain('"pending-selection-context"');
    expect(route).toContain(
      ").then(dispatchSelectionAttached, dispatchSelectionAttached)",
    );
    expect(route.slice(shortcutStart, shortcutEnd)).not.toContain(
      "agent-panel:selection-attached",
    );
    expect(route).toContain('if (panel !== "agent") return;');
    expect(route).toContain("setPendingSelectionText(selectionText || null);");
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

  it("keeps background AI work in one finite terminal Sonner lifecycle", () => {
    const route = readRoute("_app.r.$recordingId.tsx");

    expect(route).toContain("const aiRequestStatusQ = useQuery");
    expect(route).toContain('status === "queued" || status === "working"');
    expect(route).toContain("startAiRequestToast");
    expect(route).toContain("completeAiRequestToast");
    expect(route).toContain("failAiRequestToast");
    expect(route).toContain(
      "activeAiRequestRef.current.requestedAt !== aiRequestStatus.requestedAt",
    );
    expect(route).toContain("requestedAt: result?.requestedAt ?? null");
    expect(route).toContain("useSonnerLifecycleToast");
    expect(route).not.toContain("duration: Number.POSITIVE_INFINITY");
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

  it("offers transcript regeneration when silence removal needs timestamps", () => {
    expect(
      shouldOfferTranscriptRegeneration(
        "remove-silences",
        "timestamped_transcript_required",
        "rec_1",
      ),
    ).toBe(true);
  });

  it("keeps protected recordings out of anonymous agent context links", () => {
    const route = readRoute("_app.r.$recordingId.tsx");

    expect(route).toContain("recording.hasPassword === true");
    expect(route).toContain("const shouldFallbackToShare =");
    expect(route).toContain("playerDataUnauthorized && !session");
  });

  it("opens ?panel=comments even while the recording is still loading", () => {
    const route = readRoute("_app.r.$recordingId.tsx");
    const effectStart = route.indexOf('if (panelParam === "comments") {');
    const effectEnd = route.indexOf("return;", effectStart);
    const effect = route.slice(effectStart, effectEnd);

    const normalizedEffect = effect.replace(/\s+/g, " ");
    expect(normalizedEffect).not.toContain(
      'setPanel(recording?.enableComments ? "comments" : "transcript")',
    );
    expect(normalizedEffect).toContain(
      'setPanel( recording && !recording.enableComments ? defaultPanel : "comments", )',
    );

    // `defaultPanel` is where the panel lands when the requested tab does not
    // apply. It is transcript for a video and comments for a screenshot,
    // which has no transcript tab at all — or settings when comments are off,
    // but only for someone who can see settings. Offering a viewer settings
    // made the guard bounce them between two tabs it rejects.
    const route2 = readRoute("_app.r.$recordingId.tsx").replace(/\s+/g, " ");
    expect(route2).toContain(
      'const defaultPanel: SidePanel = !isImage ? "transcript" : recording && !recording.enableComments && canEdit ? "settings" : "comments";',
    );
    expect(route2).not.toContain('!recording?.enableComments ? "settings"');
  });

  it("keeps the redesign comments preview fixture read-only", () => {
    const route = readRoute("_app.r.$recordingId.tsx");

    expect(route).toContain(
      "recordingId === VIEWER_REDESIGN_PREVIEW_ID\n      ? VIEWER_PREVIEW_COMMENTS",
    );
    expect(route).toContain(
      "role != null && recordingId !== VIEWER_REDESIGN_PREVIEW_ID",
    );
    expect(route).not.toContain("persistedPreviewReplies");
  });
});
