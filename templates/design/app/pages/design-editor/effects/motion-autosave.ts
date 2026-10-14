import { useActionMutation } from "@agent-native/core/client/hooks";
import type { CodeLayerProjection } from "@shared/code-layer";
import type { MotionAnimationStyleDefinition } from "@shared/motion-animation-styles";
import type { MotionAudioClip } from "@shared/motion-code";
import {
  compileMotionCode,
  MOTION_SOURCE_WRITE_UNAVAILABLE,
} from "@shared/motion-code";
import { injectManagedMotionCss } from "@shared/motion-compiler";
import type { MotionEasingVariable } from "@shared/motion-easing";
import type { MotionNativeStyleInstance } from "@shared/motion-native-style";
import {
  injectMotionTextRuntime,
  removeMotionTextRuntime,
  type MotionTextDocument,
} from "@shared/motion-text-code";
import {
  sortMotionKeyframes,
  type MotionPlaybackMode,
} from "@shared/motion-timeline";
import type { QueryClient } from "@tanstack/react-query";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import type { MotionDockTrack } from "@/components/design/MotionDock";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import { MOTION_AUTOSAVE_DELAY_MS } from "@/pages/design-editor/editor-constants";
import { getFreshActiveFileContent } from "@/pages/design-editor/editor-state";
import {
  isLocalhostWriteConsentError,
  type LocalhostWriteConsentRequestOutcome,
} from "@/pages/design-editor/localhost-consent-request";
import {
  motionSourcePreviewProofForTargets,
  motionTimelineFingerprint,
} from "@/pages/design-editor/motion-state";
import type { DesignFile } from "@/pages/design-editor/types";

function motionAutosaveErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message
  ) {
    return error.message;
  }
  // i18n-ignore: fallback toast for motion autosave failure.
  return "Motion changes could not be saved.";
}

export interface MotionAutosaveArgs {
  activeCanvasSourceType: string;
  activeCodeLayerProjection: CodeLayerProjection;
  activeContent: string;
  activeFile: DesignFile;
  applyFileContentUpdate: (
    fileId: string,
    nextContent: string,
    options?: {
      refreshPreview?: boolean;
      skipPreview?: boolean;
      forcePreviewFullDocument?: boolean;
      persist?: boolean;
      recordHistory?: boolean;
      updatedAt?: string;
      clipboardMutation?: ClipboardContentMutationPublication;
    },
  ) => void;
  applyMotionEdit: ReturnType<
    typeof useActionMutation<undefined, undefined, "apply-motion-edit">
  >["mutate"];
  clearMotionAutosaveTimer: () => void;
  getScreenContent: (screenId: string) => string;
  id: string | undefined;
  lastLocalContentRef: RefObject<string | null>;
  lastScheduledMotionAutosaveFileVersionRef: RefObject<string | null>;
  lastScheduledMotionAutosaveRevisionRef: RefObject<number>;
  latestActiveContentRef: RefObject<string | null>;
  motionAutosaveFailedRevisionRef: RefObject<number | null>;
  motionAutosaveFlushRef: RefObject<(() => void) | null>;
  motionAutosavePending: ReturnType<
    typeof useActionMutation<undefined, undefined, "apply-motion-edit">
  >["isPending"];
  motionAutosaveRevision: number;
  motionAutosaveRevisionRef: RefObject<number>;
  motionAutosaveTimerRef: RefObject<number | null>;
  motionDefaultEase: string;
  motionDurationMs: number;
  motionPlaybackMode: MotionPlaybackMode;
  motionAnimationStyles: MotionAnimationStyleDefinition[];
  motionAudioClips: MotionAudioClip[];
  motionNativeStyles: MotionNativeStyleInstance[];
  motionEasingVariables: MotionEasingVariable[];
  motionProofTargetNodeIds: string[];
  motionTimelineId: string | null;
  motionTimelineFilePath: string | null;
  motionTracks: MotionDockTrack[];
  motionTextDocument: MotionTextDocument | null;
  motionTracksDirty: boolean;
  previousMotionFileIdRef: RefObject<string | null>;
  queryClient: QueryClient;
  requestLocalhostWrite: (opts: {
    connectionId: string;
    files: string[];
    onGranted: () => void;
    onCancel: () => void;
    onError: (error: unknown) => void;
  }) => LocalhostWriteConsentRequestOutcome;
  removeMotionTimeline: ReturnType<
    typeof useActionMutation<undefined, undefined, "remove-motion-timeline">
  >["mutate"];
  removeMotionTimelineMutation: ReturnType<
    typeof useActionMutation<undefined, undefined, "remove-motion-timeline">
  >;
  setMotionHydrationFingerprint: Dispatch<SetStateAction<string | null>>;
  setMotionTimelineId: Dispatch<SetStateAction<string | null>>;
  setMotionTracksDirty: Dispatch<SetStateAction<boolean>>;
  writeMotionAvailable: boolean;
  sourceWriteUnavailableMessage: string;
}

export function runMotionAutosave({
  activeCanvasSourceType,
  activeCodeLayerProjection,
  activeContent,
  activeFile,
  applyFileContentUpdate,
  applyMotionEdit,
  clearMotionAutosaveTimer,
  getScreenContent,
  id,
  lastLocalContentRef,
  lastScheduledMotionAutosaveFileVersionRef,
  lastScheduledMotionAutosaveRevisionRef,
  latestActiveContentRef,
  motionAutosaveFailedRevisionRef,
  motionAutosaveFlushRef,
  motionAutosavePending,
  motionAutosaveRevision,
  motionAutosaveRevisionRef,
  motionAutosaveTimerRef,
  motionDefaultEase,
  motionDurationMs,
  motionPlaybackMode,
  motionAnimationStyles,
  motionAudioClips,
  motionNativeStyles,
  motionEasingVariables,
  motionProofTargetNodeIds,
  motionTimelineId,
  motionTimelineFilePath,
  motionTracks,
  motionTextDocument,
  motionTracksDirty,
  previousMotionFileIdRef,
  queryClient,
  requestLocalhostWrite,
  removeMotionTimeline,
  removeMotionTimelineMutation,
  setMotionHydrationFingerprint,
  setMotionTimelineId,
  setMotionTracksDirty,
  writeMotionAvailable,
  sourceWriteUnavailableMessage,
}: MotionAutosaveArgs) {
  if (!writeMotionAvailable) {
    clearMotionAutosaveTimer();
    return;
  }
  if (!id || !activeFile?.id || !motionTracksDirty) return;
  if (motionAutosavePending) return;
  if (removeMotionTimelineMutation.isPending) return;
  if (motionAutosaveFailedRevisionRef.current === motionAutosaveRevision)
    return;
  const fileIdAtSchedule = activeFile.id;
  const fileRevisionAtSchedule = activeFile.updatedAt;
  const fileVersionAtSchedule = JSON.stringify([
    fileIdAtSchedule,
    fileRevisionAtSchedule ?? null,
  ]);
  const localConnectionId =
    activeCanvasSourceType === "localhost"
      ? activeCodeLayerProjection.source.connectionId?.trim()
      : undefined;
  const reportError = (error: unknown) => {
    const message = motionAutosaveErrorMessage(error);
    toast.error(
      message.startsWith(`${MOTION_SOURCE_WRITE_UNAVAILABLE}:`)
        ? sourceWriteUnavailableMessage
        : message,
    );
  };
  const handleMutationError = (
    error: unknown,
    options: {
      allowConsentRetry: boolean;
      files: string[];
      retry: () => void;
    },
  ) => {
    if (motionAutosaveRevisionRef.current === motionAutosaveRevision) {
      motionAutosaveFailedRevisionRef.current = motionAutosaveRevision;
      lastScheduledMotionAutosaveRevisionRef.current = 0;
    }
    if (
      !options.allowConsentRetry ||
      !localConnectionId ||
      !isLocalhostWriteConsentError(error) ||
      motionAutosaveRevisionRef.current !== motionAutosaveRevision ||
      previousMotionFileIdRef.current !== fileIdAtSchedule
    ) {
      reportError(error);
      return;
    }

    let retryStarted = false;
    const outcome = requestLocalhostWrite({
      connectionId: localConnectionId,
      files: options.files,
      onGranted: () => {
        if (
          retryStarted ||
          motionAutosaveRevisionRef.current !== motionAutosaveRevision ||
          previousMotionFileIdRef.current !== fileIdAtSchedule ||
          motionAutosaveFailedRevisionRef.current !== motionAutosaveRevision
        ) {
          return;
        }
        retryStarted = true;
        motionAutosaveFailedRevisionRef.current = null;
        options.retry();
      },
      onCancel: () => {},
      onError: reportError,
    });
    if (outcome === "opened" || outcome === "missing-connection") return;
    reportError(error);
  };
  if (
    lastScheduledMotionAutosaveRevisionRef.current === motionAutosaveRevision &&
    motionAutosaveTimerRef.current !== null &&
    lastScheduledMotionAutosaveFileVersionRef.current === fileVersionAtSchedule
  ) {
    return;
  }
  if (
    motionTracks.length === 0 &&
    !motionTextDocument &&
    motionAnimationStyles.length === 0 &&
    motionAudioClips.length === 0 &&
    motionNativeStyles.length === 0 &&
    motionEasingVariables.length === 0
  ) {
    if (!motionTimelineId) {
      setMotionTracksDirty(false);
      return;
    }
    const revisionAtSchedule = motionAutosaveRevision;
    const timelineIdAtSchedule = motionTimelineId;
    const removeArgs = {
      designId: id,
      timelineId: timelineIdAtSchedule,
      fileId: activeFile.id,
    };
    const removeWithConsentRetry = (allowConsentRetry: boolean) =>
      removeMotionTimeline(removeArgs, {
        onSuccess: () => {
          if (motionAutosaveFailedRevisionRef.current === revisionAtSchedule) {
            motionAutosaveFailedRevisionRef.current = null;
          }
          setMotionTimelineId((current) =>
            current === timelineIdAtSchedule ? null : current,
          );
          setMotionHydrationFingerprint(null);
          void queryClient.invalidateQueries({
            queryKey: ["action", "get-motion-timeline"],
          });
          if (motionAutosaveRevisionRef.current !== revisionAtSchedule) return;
          setMotionTracksDirty(false);
        },
        onError: (error: unknown) =>
          handleMutationError(error, {
            allowConsentRetry,
            files: motionTimelineFilePath ? [motionTimelineFilePath] : [],
            retry: () => removeWithConsentRetry(false),
          }),
      });
    removeWithConsentRetry(true);
    return;
  }

  const revisionAtSchedule = motionAutosaveRevision;
  lastScheduledMotionAutosaveRevisionRef.current = revisionAtSchedule;
  clearMotionAutosaveTimer();
  lastScheduledMotionAutosaveFileVersionRef.current = fileVersionAtSchedule;
  const fire = () => {
    if (motionAutosaveRevisionRef.current !== revisionAtSchedule) return;
    const tracksForSave = motionTracks
      .filter((track) => track.keyframes.length > 0)
      .map(({ label: _label, ...track }) => ({
        ...track,
        keyframes: sortMotionKeyframes(track.keyframes),
      }));
    if (
      tracksForSave.length === 0 &&
      !motionTextDocument &&
      motionAnimationStyles.length === 0 &&
      motionAudioClips.length === 0 &&
      motionNativeStyles.length === 0 &&
      motionEasingVariables.length === 0
    ) {
      return;
    }
    const isActiveFileNow =
      previousMotionFileIdRef.current === fileIdAtSchedule;
    const currentContent = isActiveFileNow
      ? getFreshActiveFileContent({
          activeContent,
          latestContent: latestActiveContentRef.current,
          lastLocalContent: lastLocalContentRef.current,
        })
      : getScreenContent(fileIdAtSchedule) || activeContent;
    const localMotionCss = compileMotionCode(
      {
        id: motionTimelineId ?? "",
        designId: id,
        sourceRef: fileIdAtSchedule,
        filePath: null,
        tracks: tracksForSave,
        animationStyles: motionAnimationStyles,
        nativeStyles: motionNativeStyles,
        durationMs: motionDurationMs,
        playbackMode: motionPlaybackMode,
        defaultEase: motionDefaultEase,
        compiledHash: null,
        createdAt: "",
        updatedAt: "",
      },
      {
        easingVariables: motionEasingVariables,
        audioClips: motionAudioClips,
      },
    ).css;
    const isLocalReactSource = activeCanvasSourceType === "localhost";
    const localSourceProof = isLocalReactSource
      ? motionSourcePreviewProofForTargets(activeCodeLayerProjection, [
          ...tracksForSave.map((track) => track.targetNodeId),
          ...(motionTextDocument?.animations.map(
            (animation) => animation.targetNodeId,
          ) ?? []),
          ...(motionAnimationStyles.length > 0 ? motionProofTargetNodeIds : []),
          ...motionNativeStyles.map((style) => style.targetNodeId),
        ])
      : null;
    const connectionId = activeCodeLayerProjection.source.connectionId?.trim();
    if (isLocalReactSource && (!localSourceProof || !connectionId)) {
      motionAutosaveFailedRevisionRef.current = revisionAtSchedule;
      lastScheduledMotionAutosaveRevisionRef.current = 0;
      toast.error(sourceWriteUnavailableMessage);
      return;
    }
    const localSource =
      isLocalReactSource && localSourceProof && connectionId
        ? {
            connectionId,
            modulePath: localSourceProof.modulePath,
            moduleVersionHash: localSourceProof.moduleVersionHash,
            renderedNodeIds: localSourceProof.renderedNodeIds,
          }
        : undefined;
    const applyArgs = {
      designId: id,
      fileId: fileIdAtSchedule,
      timelineId: motionTimelineId ?? undefined,
      sourceRef: fileIdAtSchedule,
      tracks: tracksForSave,
      animationStyles: motionAnimationStyles,
      nativeStyles: motionNativeStyles,
      audioClips: motionAudioClips,
      easingVariables: motionEasingVariables,
      textDocument: motionTextDocument,
      durationMs: motionDurationMs,
      playbackMode: motionPlaybackMode,
      defaultEase: motionDefaultEase,
      ...(localSource ? { localSource } : {}),
      ...(!localSource
        ? { currentContent, revision: fileRevisionAtSchedule }
        : {}),
      includeContent: false,
    };
    const applyWithConsentRetry = (allowConsentRetry: boolean) =>
      applyMotionEdit(applyArgs, {
        onSuccess: (result) => {
          if (motionAutosaveFailedRevisionRef.current === revisionAtSchedule) {
            motionAutosaveFailedRevisionRef.current = null;
          }
          const response = result as {
            fileId?: unknown;
            timelineId?: unknown;
            updatedAt?: unknown;
            compiledHash?: unknown;
            contentPatched?: unknown;
            filePath?: unknown;
          };
          const isStillActiveFile =
            previousMotionFileIdRef.current === fileIdAtSchedule;
          if (typeof response.timelineId === "string" && isStillActiveFile) {
            setMotionTimelineId(response.timelineId);
          }
          if (
            motionAutosaveRevisionRef.current === revisionAtSchedule &&
            isStillActiveFile
          ) {
            setMotionTracksDirty(false);
            const contentPatched = response.contentPatched !== false;
            const expectedHash =
              typeof response.compiledHash === "string"
                ? response.compiledHash
                : null;
            setMotionHydrationFingerprint(
              motionTimelineFingerprint(fileIdAtSchedule, {
                id:
                  typeof response.timelineId === "string"
                    ? response.timelineId
                    : (motionTimelineId ?? null),
                designId: id,
                sourceRef: fileIdAtSchedule,
                filePath:
                  typeof response.filePath === "string"
                    ? response.filePath
                    : null,
                tracks: tracksForSave,
                animationStyles: motionAnimationStyles,
                nativeStyles: motionNativeStyles,
                audioClips: motionAudioClips,
                easingVariables: motionEasingVariables,
                textDocument: motionTextDocument,
                durationMs: motionDurationMs,
                playbackMode: motionPlaybackMode,
                defaultEase: motionDefaultEase,
                compiledHash: expectedHash,
                cssHash: contentPatched ? expectedHash : null,
                source: "stored",
                createdAt: null,
                updatedAt:
                  typeof response.updatedAt === "string"
                    ? response.updatedAt
                    : null,
              }),
            );
            lastScheduledMotionAutosaveRevisionRef.current = 0;
          }
          if (
            typeof response.fileId === "string" &&
            response.fileId === fileIdAtSchedule &&
            response.contentPatched !== false
          ) {
            const freshContent = isStillActiveFile
              ? getFreshActiveFileContent({
                  activeContent: currentContent,
                  latestContent: latestActiveContentRef.current,
                  lastLocalContent: lastLocalContentRef.current,
                })
              : currentContent;
            const hasConcurrentEdits = freshContent !== currentContent;
            let patchedContent = injectManagedMotionCss(
              freshContent,
              localMotionCss,
            );
            patchedContent = motionTextDocument
              ? injectMotionTextRuntime(
                  patchedContent,
                  motionTextDocument,
                  motionPlaybackMode,
                )
              : removeMotionTextRuntime(patchedContent);
            applyFileContentUpdate(response.fileId, patchedContent, {
              refreshPreview: false,
              forcePreviewFullDocument: true,
              recordHistory: false,
              ...(hasConcurrentEdits
                ? {}
                : {
                    persist: false,
                    ...(typeof response.updatedAt === "string"
                      ? { updatedAt: response.updatedAt }
                      : {}),
                  }),
            });
          }
          void queryClient.invalidateQueries({
            queryKey: ["action", "get-motion-timeline"],
          });
        },
        onError: (error) =>
          handleMutationError(error, {
            allowConsentRetry,
            files: localSource ? [localSource.modulePath] : [],
            retry: () => applyWithConsentRetry(false),
          }),
      });
    applyWithConsentRetry(true);
  };
  motionAutosaveTimerRef.current = window.setTimeout(() => {
    motionAutosaveTimerRef.current = null;
    motionAutosaveFlushRef.current = null;
    fire();
  }, MOTION_AUTOSAVE_DELAY_MS);
  motionAutosaveFlushRef.current = () => {
    if (motionAutosaveTimerRef.current !== null) {
      window.clearTimeout(motionAutosaveTimerRef.current);
      motionAutosaveTimerRef.current = null;
    }
    motionAutosaveFlushRef.current = null;
    fire();
  };
}
