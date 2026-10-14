import type { MotionNativeStyleInstance } from "@shared/motion-native-style";
import type { MotionTextDocument } from "@shared/motion-text-code";
import { createMotionTrack } from "@shared/motion-timeline";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { toast } from "sonner";

import type { MotionAutosaveArgs } from "./motion-autosave";
import { runMotionAutosave } from "./motion-autosave";

function createArgs(
  updatedAt: string,
  refs: Pick<
    MotionAutosaveArgs,
    | "lastScheduledMotionAutosaveFileVersionRef"
    | "lastScheduledMotionAutosaveRevisionRef"
    | "motionAutosaveRevisionRef"
    | "motionAutosaveTimerRef"
    | "motionAutosaveFlushRef"
    | "previousMotionFileIdRef"
    | "lastLocalContentRef"
    | "latestActiveContentRef"
    | "motionAutosaveFailedRevisionRef"
  >,
): MotionAutosaveArgs {
  const clearMotionAutosaveTimer = () => {
    const timer = refs.motionAutosaveTimerRef.current;
    if (timer !== null) window.clearTimeout(timer);
    refs.motionAutosaveTimerRef.current = null;
  };

  return {
    activeCanvasSourceType: "inline",
    activeCodeLayerProjection: {
      source: {},
      nodes: [],
    } as unknown as MotionAutosaveArgs["activeCodeLayerProjection"],
    activeContent: "<html></html>",
    activeFile: {
      id: "file-1",
      filename: "index.html",
      fileType: "html",
      content: "<html></html>",
      createdAt: "2026-10-11T00:00:00.000Z",
      updatedAt,
    },
    applyFileContentUpdate: vi.fn(),
    applyMotionEdit:
      vi.fn() as unknown as MotionAutosaveArgs["applyMotionEdit"],
    clearMotionAutosaveTimer,
    getScreenContent: () => "<html></html>",
    id: "design-1",
    ...refs,
    motionAutosavePending: false,
    motionAutosaveRevision: 7,
    motionDefaultEase: "ease",
    motionDurationMs: 1000,
    motionPlaybackMode: "once",
    motionAnimationStyles: [],
    motionAudioClips: [],
    motionEasingVariables: [],
    motionNativeStyles: [],
    motionProofTargetNodeIds: [],
    motionTimelineId: "timeline-1",
    motionTimelineFilePath: null,
    motionTracks: [
      { ...createMotionTrack("node-1", "opacity"), label: "Layer" },
    ],
    motionTextDocument: null,
    motionTracksDirty: true,
    queryClient: {
      invalidateQueries: vi.fn(),
    } as unknown as MotionAutosaveArgs["queryClient"],
    requestLocalhostWrite: vi.fn(
      () => "opened" as const,
    ) as unknown as MotionAutosaveArgs["requestLocalhostWrite"],
    removeMotionTimeline:
      vi.fn() as unknown as MotionAutosaveArgs["removeMotionTimeline"],
    removeMotionTimelineMutation: {
      isPending: false,
    } as MotionAutosaveArgs["removeMotionTimelineMutation"],
    setMotionHydrationFingerprint: vi.fn(),
    setMotionTimelineId: vi.fn(),
    setMotionTracksDirty: vi.fn(),
    writeMotionAvailable: true,
    sourceWriteUnavailableMessage: "Motion edits are unavailable.",
  };
}

describe("runMotionAutosave", () => {
  afterEach(() => {
    vi.mocked(toast.error).mockClear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reschedules a pending save when the source revision advances", () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    const refs = {
      lastScheduledMotionAutosaveFileVersionRef: { current: null },
      lastScheduledMotionAutosaveRevisionRef: { current: 0 },
      motionAutosaveRevisionRef: { current: 7 },
      motionAutosaveTimerRef: { current: null },
      motionAutosaveFlushRef: { current: null },
      previousMotionFileIdRef: { current: "file-1" },
      lastLocalContentRef: { current: null },
      latestActiveContentRef: { current: null },
      motionAutosaveFailedRevisionRef: { current: null },
    } as unknown as Pick<
      MotionAutosaveArgs,
      | "lastScheduledMotionAutosaveFileVersionRef"
      | "lastScheduledMotionAutosaveRevisionRef"
      | "motionAutosaveRevisionRef"
      | "motionAutosaveTimerRef"
      | "motionAutosaveFlushRef"
      | "previousMotionFileIdRef"
      | "lastLocalContentRef"
      | "latestActiveContentRef"
      | "motionAutosaveFailedRevisionRef"
    >;
    const first = createArgs("revision-1", refs);
    const second = createArgs("revision-2", refs);
    const applyMotionEdit = vi.fn();
    first.applyMotionEdit = applyMotionEdit;
    second.applyMotionEdit = applyMotionEdit;

    runMotionAutosave(first);
    vi.advanceTimersByTime(400);
    runMotionAutosave(second);

    vi.advanceTimersByTime(499);
    expect(applyMotionEdit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(applyMotionEdit).toHaveBeenCalledTimes(1);
    expect(applyMotionEdit.mock.calls[0]?.[0]).toMatchObject({
      fileId: "file-1",
      revision: "revision-2",
    });
  });

  it("saves audio-only edits instead of removing an empty timeline", () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    const refs = {
      lastScheduledMotionAutosaveFileVersionRef: { current: null },
      lastScheduledMotionAutosaveRevisionRef: { current: 0 },
      motionAutosaveRevisionRef: { current: 7 },
      motionAutosaveTimerRef: { current: null },
      motionAutosaveFlushRef: { current: null },
      previousMotionFileIdRef: { current: "file-1" },
      lastLocalContentRef: { current: null },
      latestActiveContentRef: { current: null },
      motionAutosaveFailedRevisionRef: { current: null },
    } as unknown as Pick<
      MotionAutosaveArgs,
      | "lastScheduledMotionAutosaveFileVersionRef"
      | "lastScheduledMotionAutosaveRevisionRef"
      | "motionAutosaveRevisionRef"
      | "motionAutosaveTimerRef"
      | "motionAutosaveFlushRef"
      | "previousMotionFileIdRef"
      | "lastLocalContentRef"
      | "latestActiveContentRef"
      | "motionAutosaveFailedRevisionRef"
    >;
    const args = createArgs("revision-1", refs);
    const applyMotionEdit = vi.fn();
    const audioClips = [
      {
        id: "clip-1",
        sourceUrl: "https://example.com/audio.mp3",
        timelineStartMs: 0,
        sourceTrimStartMs: 0,
        durationMs: 500,
        volume: 1,
        muted: false,
      },
    ];
    args.motionTracks = [];
    args.motionAudioClips = audioClips;
    args.applyMotionEdit = applyMotionEdit;

    runMotionAutosave(args);
    vi.advanceTimersByTime(500);

    expect(applyMotionEdit).toHaveBeenCalledTimes(1);
    expect(applyMotionEdit.mock.calls[0]?.[0]).toMatchObject({
      tracks: [],
      audioClips,
    });
  });

  it("saves React Text animation through the localhost source proof", () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    const refs = {
      lastScheduledMotionAutosaveFileVersionRef: { current: null },
      lastScheduledMotionAutosaveRevisionRef: { current: 0 },
      motionAutosaveRevisionRef: { current: 7 },
      motionAutosaveTimerRef: { current: null },
      motionAutosaveFlushRef: { current: null },
      previousMotionFileIdRef: { current: "file-1" },
      lastLocalContentRef: { current: null },
      latestActiveContentRef: { current: null },
      motionAutosaveFailedRevisionRef: { current: null },
    } as unknown as Pick<
      MotionAutosaveArgs,
      | "lastScheduledMotionAutosaveFileVersionRef"
      | "lastScheduledMotionAutosaveRevisionRef"
      | "motionAutosaveRevisionRef"
      | "motionAutosaveTimerRef"
      | "motionAutosaveFlushRef"
      | "previousMotionFileIdRef"
      | "lastLocalContentRef"
      | "latestActiveContentRef"
      | "motionAutosaveFailedRevisionRef"
    >;
    const args = createArgs("revision-1", refs);
    const applyMotionEdit = vi.fn();
    const targetNodeId = "hero-title";
    const textDocument: MotionTextDocument = {
      version: 1,
      animations: [
        {
          targetNodeId,
          unit: "word",
          direction: "forward",
          staggerMs: 40,
          property: "opacity",
          durationMs: 320,
          keyframes: [
            { t: 0, value: "0", ease: "ease-out" },
            { t: 1, value: "1" },
          ],
        },
      ],
    };
    args.activeCanvasSourceType = "localhost";
    args.activeCodeLayerProjection = {
      source: { connectionId: "connection-1" },
      nodes: [
        {
          dataAttributes: {
            "data-agent-native-node-id": targetNodeId,
            "data-agent-native-motion-source-file": "src/Card.tsx",
            "data-agent-native-motion-source-hash": "a".repeat(64),
          },
        },
      ],
    } as unknown as MotionAutosaveArgs["activeCodeLayerProjection"];
    args.motionTracks = [];
    args.motionTextDocument = textDocument;
    args.applyMotionEdit = applyMotionEdit;

    runMotionAutosave(args);
    vi.advanceTimersByTime(500);

    expect(applyMotionEdit).toHaveBeenCalledTimes(1);
    expect(applyMotionEdit.mock.calls[0]?.[0]).toMatchObject({
      localSource: {
        connectionId: "connection-1",
        modulePath: "src/Card.tsx",
        moduleVersionHash: "a".repeat(64),
        renderedNodeIds: [targetNodeId],
      },
      tracks: [],
      textDocument,
    });
  });

  it("persists native styles and compiles their CSS instead of deleting an empty-track timeline", () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    const refs = {
      lastScheduledMotionAutosaveFileVersionRef: { current: null },
      lastScheduledMotionAutosaveRevisionRef: { current: 0 },
      motionAutosaveRevisionRef: { current: 7 },
      motionAutosaveTimerRef: { current: null },
      motionAutosaveFlushRef: { current: null },
      previousMotionFileIdRef: { current: "file-1" },
      lastLocalContentRef: { current: null },
      latestActiveContentRef: { current: null },
      motionAutosaveFailedRevisionRef: { current: null },
    } as unknown as Pick<
      MotionAutosaveArgs,
      | "lastScheduledMotionAutosaveFileVersionRef"
      | "lastScheduledMotionAutosaveRevisionRef"
      | "motionAutosaveRevisionRef"
      | "motionAutosaveTimerRef"
      | "motionAutosaveFlushRef"
      | "previousMotionFileIdRef"
      | "lastLocalContentRef"
      | "latestActiveContentRef"
      | "motionAutosaveFailedRevisionRef"
    >;
    const args = createArgs("revision-1", refs);
    const nativeStyle: MotionNativeStyleInstance = {
      type: "FIGMA",
      styleKey: "Opacity",
      sourceStyleId: "source-style-1",
      sourceInstanceId: "source-instance-1",
      nameKey: "motion.preset_name.opacity",
      duration: 0.45,
      timelineOffset: 0.2,
      targetNodeId: "node-1",
      props: {
        type: "fadeIn",
        amount: 0,
        startFrame: 0,
        endFrame: 100,
        delay: 0,
        easing: { type: "EASE_OUT" },
      },
    };
    args.motionTracks = [];
    args.motionNativeStyles = [nativeStyle];
    const applyMotionEdit = vi.fn();
    const applyFileContentUpdate = vi.fn();
    args.applyMotionEdit =
      applyMotionEdit as unknown as MotionAutosaveArgs["applyMotionEdit"];
    args.applyFileContentUpdate = applyFileContentUpdate;

    runMotionAutosave(args);
    vi.advanceTimersByTime(500);

    expect(args.removeMotionTimeline).not.toHaveBeenCalled();
    expect(applyMotionEdit).toHaveBeenCalledOnce();
    expect(applyMotionEdit.mock.calls[0]?.[0]).toMatchObject({
      tracks: [],
      nativeStyles: [nativeStyle],
    });

    const onSuccess = (
      applyMotionEdit.mock.calls[0]?.[1] as unknown as {
        onSuccess: (result: unknown) => void;
      }
    ).onSuccess;
    onSuccess({
      fileId: "file-1",
      timelineId: "timeline-1",
      updatedAt: "2026-10-11T00:00:01.000Z",
      compiledHash: "compiled-native-style",
      contentPatched: true,
    });

    expect(applyFileContentUpdate).toHaveBeenCalledOnce();
    expect(applyFileContentUpdate.mock.calls[0]?.[1]).toContain(
      "@keyframes an-motion-",
    );
    expect(applyFileContentUpdate.mock.calls[0]?.[1]).toContain(
      "agent-native-motion-source",
    );
  });

  it("requests consent and retries the same still-pending source revision once", () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    const refs = {
      lastScheduledMotionAutosaveFileVersionRef: { current: null },
      lastScheduledMotionAutosaveRevisionRef: { current: 0 },
      motionAutosaveRevisionRef: { current: 7 },
      motionAutosaveTimerRef: { current: null },
      motionAutosaveFlushRef: { current: null },
      previousMotionFileIdRef: { current: "file-1" },
      lastLocalContentRef: { current: null },
      latestActiveContentRef: { current: null },
      motionAutosaveFailedRevisionRef: { current: null },
    } as unknown as Pick<
      MotionAutosaveArgs,
      | "lastScheduledMotionAutosaveFileVersionRef"
      | "lastScheduledMotionAutosaveRevisionRef"
      | "motionAutosaveRevisionRef"
      | "motionAutosaveTimerRef"
      | "motionAutosaveFlushRef"
      | "previousMotionFileIdRef"
      | "lastLocalContentRef"
      | "latestActiveContentRef"
      | "motionAutosaveFailedRevisionRef"
    >;
    const args = createArgs("revision-1", refs);
    args.activeCanvasSourceType = "localhost";
    args.activeCodeLayerProjection = {
      source: { connectionId: "connection-1" },
      nodes: [
        {
          dataAttributes: {
            "data-agent-native-node-id": "node-1",
            "data-agent-native-motion-source-file": "src/Card.tsx",
            "data-agent-native-motion-source-hash": "a".repeat(64),
          },
        },
      ],
    } as unknown as MotionAutosaveArgs["activeCodeLayerProjection"];
    const applyMotionEdit = vi.fn();
    args.applyMotionEdit =
      applyMotionEdit as unknown as MotionAutosaveArgs["applyMotionEdit"];
    const requestLocalhostWrite = vi.fn(
      (_opts: Parameters<MotionAutosaveArgs["requestLocalhostWrite"]>[0]) =>
        "opened" as const,
    );
    args.requestLocalhostWrite = requestLocalhostWrite;

    runMotionAutosave(args);
    vi.advanceTimersByTime(500);

    const firstCall = applyMotionEdit.mock.calls[0] as unknown as [
      unknown,
      { onError: (error: unknown) => void },
    ];
    firstCall[1].onError(
      new Error("A localhost write-consent grant is required."),
    );

    expect(requestLocalhostWrite).toHaveBeenCalledOnce();
    expect(requestLocalhostWrite.mock.calls[0]?.[0]).toMatchObject({
      connectionId: "connection-1",
      files: ["src/Card.tsx"],
    });
    expect(toast.error).not.toHaveBeenCalled();

    const consent = requestLocalhostWrite.mock.calls[0]?.[0];
    const originalInput = firstCall[0];
    consent?.onGranted();
    consent?.onGranted();

    expect(applyMotionEdit).toHaveBeenCalledTimes(2);
    expect(applyMotionEdit.mock.calls[1]?.[0]).toBe(originalInput);
    expect(
      (applyMotionEdit.mock.calls[1]?.[0] as { localSource?: unknown })
        .localSource,
    ).toMatchObject({ moduleVersionHash: "a".repeat(64) });

    const retryCall = applyMotionEdit.mock.calls[1] as unknown as [
      unknown,
      { onError: (error: unknown) => void },
    ];
    retryCall[1].onError(new Error("Editor access was revoked during retry."));
    expect(requestLocalhostWrite).toHaveBeenCalledOnce();
    expect(toast.error).toHaveBeenCalledWith(
      "Editor access was revoked during retry.",
    );
  });

  it("does not retry a motion revision that changed while consent was pending", () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    const refs = {
      lastScheduledMotionAutosaveFileVersionRef: { current: null },
      lastScheduledMotionAutosaveRevisionRef: { current: 0 },
      motionAutosaveRevisionRef: { current: 7 },
      motionAutosaveTimerRef: { current: null },
      motionAutosaveFlushRef: { current: null },
      previousMotionFileIdRef: { current: "file-1" },
      lastLocalContentRef: { current: null },
      latestActiveContentRef: { current: null },
      motionAutosaveFailedRevisionRef: { current: null },
    } as unknown as Pick<
      MotionAutosaveArgs,
      | "lastScheduledMotionAutosaveFileVersionRef"
      | "lastScheduledMotionAutosaveRevisionRef"
      | "motionAutosaveRevisionRef"
      | "motionAutosaveTimerRef"
      | "motionAutosaveFlushRef"
      | "previousMotionFileIdRef"
      | "lastLocalContentRef"
      | "latestActiveContentRef"
      | "motionAutosaveFailedRevisionRef"
    >;
    const args = createArgs("revision-1", refs);
    args.activeCanvasSourceType = "localhost";
    args.activeCodeLayerProjection = {
      source: { connectionId: "connection-1" },
      nodes: [
        {
          dataAttributes: {
            "data-agent-native-node-id": "node-1",
            "data-agent-native-motion-source-file": "src/Card.tsx",
            "data-agent-native-motion-source-hash": "a".repeat(64),
          },
        },
      ],
    } as unknown as MotionAutosaveArgs["activeCodeLayerProjection"];
    const applyMotionEdit = vi.fn();
    args.applyMotionEdit =
      applyMotionEdit as unknown as MotionAutosaveArgs["applyMotionEdit"];
    const requestLocalhostWrite = vi.fn(
      (_opts: Parameters<MotionAutosaveArgs["requestLocalhostWrite"]>[0]) =>
        "opened" as const,
    );
    args.requestLocalhostWrite = requestLocalhostWrite;

    runMotionAutosave(args);
    vi.advanceTimersByTime(500);
    const firstCall = applyMotionEdit.mock.calls[0] as unknown as [
      unknown,
      { onError: (error: unknown) => void },
    ];
    firstCall[1].onError(
      new Error("A localhost write-consent grant is required."),
    );

    refs.motionAutosaveRevisionRef.current = 8;
    requestLocalhostWrite.mock.calls[0]?.[0].onGranted();

    expect(applyMotionEdit).toHaveBeenCalledOnce();
  });

  it("surfaces authorization failures and does not request consent for them", () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    const refs = {
      lastScheduledMotionAutosaveFileVersionRef: { current: null },
      lastScheduledMotionAutosaveRevisionRef: { current: 0 },
      motionAutosaveRevisionRef: { current: 7 },
      motionAutosaveTimerRef: { current: null },
      motionAutosaveFlushRef: { current: null },
      previousMotionFileIdRef: { current: "file-1" },
      lastLocalContentRef: { current: null },
      latestActiveContentRef: { current: null },
      motionAutosaveFailedRevisionRef: { current: null },
    } as unknown as Pick<
      MotionAutosaveArgs,
      | "lastScheduledMotionAutosaveFileVersionRef"
      | "lastScheduledMotionAutosaveRevisionRef"
      | "motionAutosaveRevisionRef"
      | "motionAutosaveTimerRef"
      | "motionAutosaveFlushRef"
      | "previousMotionFileIdRef"
      | "lastLocalContentRef"
      | "latestActiveContentRef"
      | "motionAutosaveFailedRevisionRef"
    >;
    const args = createArgs("revision-1", refs);
    args.activeCanvasSourceType = "localhost";
    args.activeCodeLayerProjection = {
      source: { connectionId: "connection-1" },
      nodes: [
        {
          dataAttributes: {
            "data-agent-native-node-id": "node-1",
            "data-agent-native-motion-source-file": "src/Card.tsx",
            "data-agent-native-motion-source-hash": "a".repeat(64),
          },
        },
      ],
    } as unknown as MotionAutosaveArgs["activeCodeLayerProjection"];
    const applyMotionEdit = vi.fn();
    args.applyMotionEdit =
      applyMotionEdit as unknown as MotionAutosaveArgs["applyMotionEdit"];
    const requestLocalhostWrite = vi.fn(
      (_opts: Parameters<MotionAutosaveArgs["requestLocalhostWrite"]>[0]) =>
        "opened" as const,
    );
    args.requestLocalhostWrite = requestLocalhostWrite;

    runMotionAutosave(args);
    vi.advanceTimersByTime(500);
    const firstCall = applyMotionEdit.mock.calls[0] as unknown as [
      unknown,
      { onError: (error: unknown) => void },
    ];
    firstCall[1].onError(new Error("Design editor access was revoked."));

    expect(requestLocalhostWrite).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Design editor access was revoked.",
    );
  });

  it("requests consent before deleting a localhost timeline and retries that deletion once", () => {
    const refs = {
      lastScheduledMotionAutosaveFileVersionRef: { current: null },
      lastScheduledMotionAutosaveRevisionRef: { current: 0 },
      motionAutosaveRevisionRef: { current: 7 },
      motionAutosaveTimerRef: { current: null },
      motionAutosaveFlushRef: { current: null },
      previousMotionFileIdRef: { current: "file-1" },
      lastLocalContentRef: { current: null },
      latestActiveContentRef: { current: null },
      motionAutosaveFailedRevisionRef: { current: null },
    } as unknown as Pick<
      MotionAutosaveArgs,
      | "lastScheduledMotionAutosaveFileVersionRef"
      | "lastScheduledMotionAutosaveRevisionRef"
      | "motionAutosaveRevisionRef"
      | "motionAutosaveTimerRef"
      | "motionAutosaveFlushRef"
      | "previousMotionFileIdRef"
      | "lastLocalContentRef"
      | "latestActiveContentRef"
      | "motionAutosaveFailedRevisionRef"
    >;
    const args = createArgs("revision-1", refs);
    args.activeCanvasSourceType = "localhost";
    args.activeCodeLayerProjection = {
      source: { connectionId: "connection-1" },
      nodes: [],
    } as unknown as MotionAutosaveArgs["activeCodeLayerProjection"];
    args.motionTracks = [];
    args.motionTimelineId = "timeline-1";
    args.motionTimelineFilePath = "src/Card.tsx";
    const removeMotionTimeline = vi.fn();
    args.removeMotionTimeline =
      removeMotionTimeline as unknown as MotionAutosaveArgs["removeMotionTimeline"];
    const requestLocalhostWrite = vi.fn(
      (_opts: Parameters<MotionAutosaveArgs["requestLocalhostWrite"]>[0]) =>
        "opened" as const,
    );
    args.requestLocalhostWrite = requestLocalhostWrite;

    runMotionAutosave(args);

    const firstCall = removeMotionTimeline.mock.calls[0] as unknown as [
      unknown,
      { onError: (error: unknown) => void },
    ];
    firstCall[1].onError(
      new Error("A localhost write-consent grant is required."),
    );
    const consent = requestLocalhostWrite.mock.calls[0]?.[0];
    expect(consent).toMatchObject({ files: ["src/Card.tsx"] });
    const originalInput = firstCall[0];
    consent?.onGranted();
    consent?.onGranted();

    expect(removeMotionTimeline).toHaveBeenCalledTimes(2);
    expect(removeMotionTimeline.mock.calls[1]?.[0]).toBe(originalInput);
  });

  it("waits for timeline removal before saving newer motion against a fresh timeline", () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    const refs = {
      lastScheduledMotionAutosaveFileVersionRef: { current: null },
      lastScheduledMotionAutosaveRevisionRef: { current: 0 },
      motionAutosaveRevisionRef: { current: 7 },
      motionAutosaveTimerRef: { current: null },
      motionAutosaveFlushRef: { current: null },
      previousMotionFileIdRef: { current: "file-1" },
      lastLocalContentRef: { current: null },
      latestActiveContentRef: { current: null },
      motionAutosaveFailedRevisionRef: { current: null },
    } as unknown as Pick<
      MotionAutosaveArgs,
      | "lastScheduledMotionAutosaveFileVersionRef"
      | "lastScheduledMotionAutosaveRevisionRef"
      | "motionAutosaveRevisionRef"
      | "motionAutosaveTimerRef"
      | "motionAutosaveFlushRef"
      | "previousMotionFileIdRef"
      | "lastLocalContentRef"
      | "latestActiveContentRef"
      | "motionAutosaveFailedRevisionRef"
    >;
    const args = createArgs("revision-1", refs);
    args.motionTracks = [];
    args.motionTimelineId = "timeline-1";
    const removeMotionTimeline = vi.fn();
    const applyMotionEdit = vi.fn();
    args.removeMotionTimeline =
      removeMotionTimeline as unknown as MotionAutosaveArgs["removeMotionTimeline"];
    args.applyMotionEdit =
      applyMotionEdit as unknown as MotionAutosaveArgs["applyMotionEdit"];

    runMotionAutosave(args);
    expect(removeMotionTimeline).toHaveBeenCalledOnce();

    refs.motionAutosaveRevisionRef.current = 8;
    args.motionAutosaveRevision = 8;
    args.motionTracks = [
      { ...createMotionTrack("node-1", "opacity"), label: "Layer" },
    ];
    args.removeMotionTimelineMutation = {
      isPending: true,
    } as MotionAutosaveArgs["removeMotionTimelineMutation"];
    runMotionAutosave(args);
    expect(applyMotionEdit).not.toHaveBeenCalled();

    const removeCall = removeMotionTimeline.mock.calls[0] as unknown as [
      unknown,
      { onSuccess: () => void },
    ];
    removeCall[1].onSuccess();
    const setTimelineId = args.setMotionTimelineId as ReturnType<typeof vi.fn>;
    const clearRemovedTimeline = setTimelineId.mock.calls[0]?.[0] as (
      current: string | null,
    ) => string | null;
    expect(clearRemovedTimeline("timeline-1")).toBeNull();
    expect(clearRemovedTimeline("newer-timeline")).toBe("newer-timeline");
    expect(args.setMotionTracksDirty).not.toHaveBeenCalledWith(false);

    args.motionTimelineId = null;
    args.removeMotionTimelineMutation = {
      isPending: false,
    } as MotionAutosaveArgs["removeMotionTimelineMutation"];
    runMotionAutosave(args);
    vi.advanceTimersByTime(500);

    expect(applyMotionEdit).toHaveBeenCalledOnce();
    expect(applyMotionEdit.mock.calls[0]?.[0]).toMatchObject({
      fileId: "file-1",
      tracks: [expect.objectContaining({ targetNodeId: "node-1" })],
    });
    expect(applyMotionEdit.mock.calls[0]?.[0]).toMatchObject({
      timelineId: undefined,
    });
  });
});
