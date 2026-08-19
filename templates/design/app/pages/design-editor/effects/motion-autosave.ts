import { useActionMutation } from "@agent-native/core/client/hooks";
import {
  compile as compileMotionTimeline,
  injectManagedMotionCss,
} from "@shared/motion-compiler";
import { sortMotionKeyframes } from "@shared/motion-timeline";
import type { QueryClient } from "@tanstack/react-query";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import type { MotionDockTrack } from "@/components/design/MotionDock";
import type { ClipboardContentMutationPublication } from "@/lib/clipboard-content-lineage";
import { MOTION_AUTOSAVE_DELAY_MS } from "@/pages/design-editor/editor-constants";
import { getFreshActiveFileContent } from "@/pages/design-editor/editor-state";
import { motionTimelineFingerprint } from "@/pages/design-editor/motion-state";
import type { DesignFile } from "@/pages/design-editor/types";

export interface MotionAutosaveArgs {
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
  motionTimelineId: string | null;
  motionTracks: MotionDockTrack[];
  motionTracksDirty: boolean;
  previousMotionFileIdRef: RefObject<string | null>;
  queryClient: QueryClient;
  removeMotionTimeline: ReturnType<
    typeof useActionMutation<undefined, undefined, "remove-motion-timeline">
  >["mutate"];
  removeMotionTimelineMutation: ReturnType<
    typeof useActionMutation<undefined, undefined, "remove-motion-timeline">
  >;
  setMotionHydrationFingerprint: Dispatch<SetStateAction<string | null>>;
  setMotionTimelineId: Dispatch<SetStateAction<string | null>>;
  setMotionTracksDirty: Dispatch<SetStateAction<boolean>>;
}

export function runMotionAutosave({
  activeContent,
  activeFile,
  applyFileContentUpdate,
  applyMotionEdit,
  clearMotionAutosaveTimer,
  getScreenContent,
  id,
  lastLocalContentRef,
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
  motionTimelineId,
  motionTracks,
  motionTracksDirty,
  previousMotionFileIdRef,
  queryClient,
  removeMotionTimeline,
  removeMotionTimelineMutation,
  setMotionHydrationFingerprint,
  setMotionTimelineId,
  setMotionTracksDirty,
}: MotionAutosaveArgs) {
  if (!id || !activeFile?.id || !motionTracksDirty) return;
  if (motionAutosavePending) return;
  if (motionAutosaveFailedRevisionRef.current === motionAutosaveRevision)
    return;
  if (
    lastScheduledMotionAutosaveRevisionRef.current === motionAutosaveRevision &&
    motionAutosaveTimerRef.current !== null
  ) {
    return;
  }
  // U-motion-empty: the user deleted every track (or the last keyframe of
  // the last track, which MotionDock collapses into removing the track).
  // apply-motion-edit's schema rejects an empty tracks array, so this can't
  // go through the normal autosave — it must go through remove-motion-timeline
  // instead, which deletes the motion_timeline row AND strips the managed
  // <style data-agent-native-motion> block so a reload doesn't restore the
  // old animation. Nothing to remove if there was never a persisted
  // timeline for this file (motionTimelineId is null) — just clear dirty.
  if (motionTracks.length === 0) {
    if (!motionTimelineId) {
      setMotionTracksDirty(false);
      return;
    }
    if (removeMotionTimelineMutation.isPending) return;
    const revisionAtSchedule = motionAutosaveRevision;
    const timelineIdAtSchedule = motionTimelineId;
    removeMotionTimeline(
      { designId: id, timelineId: timelineIdAtSchedule },
      {
        onSuccess: () => {
          if (motionAutosaveRevisionRef.current !== revisionAtSchedule) return;
          setMotionTracksDirty(false);
          setMotionTimelineId(null);
          setMotionHydrationFingerprint(null);
          void queryClient.invalidateQueries({
            queryKey: ["action", "get-motion-timeline"],
          });
        },
        onError: (error: unknown) => {
          if (motionAutosaveRevisionRef.current === revisionAtSchedule) {
            motionAutosaveFailedRevisionRef.current = revisionAtSchedule;
          }
          toast.error(
            error instanceof Error
              ? error.message
              : // i18n-ignore: fallback toast for motion timeline removal failure.
                "Motion changes could not be saved.",
          );
        },
      },
    );
    return;
  }

  const revisionAtSchedule = motionAutosaveRevision;
  lastScheduledMotionAutosaveRevisionRef.current = revisionAtSchedule;
  clearMotionAutosaveTimer();
  const fileIdAtSchedule = activeFile.id;
  const fileRevisionAtSchedule = activeFile.updatedAt;
  const fire = () => {
    if (motionAutosaveRevisionRef.current !== revisionAtSchedule) return;
    // Drop empty tracks defensively (a 0-keyframe track fails the action
    // schema and would brick every subsequent autosave) and canonicalise
    // keyframe order so the persisted JSON is always time-sorted. Full
    // emptiness (0 tracks) is handled above via remove-motion-timeline
    // before this closure is ever scheduled; this guards the case where
    // every remaining track individually has 0 keyframes (shouldn't
    // normally happen — MotionDock removes a track once its keyframes hit
    // 0 — but stays a defensive no-op rather than sending an invalid
    // payload that would brick the next autosave).
    const tracksForSave = motionTracks
      .filter((track) => track.keyframes.length > 0)
      .map(({ label: _label, ...track }) => ({
        ...track,
        keyframes: sortMotionKeyframes(track.keyframes),
      }));
    if (tracksForSave.length === 0) return;
    // When flushed after a file switch, the schedule-time file is no longer
    // active; resolve its content from the per-screen cache instead of the
    // active-file refs (which may already point at the NEW file).
    const isActiveFileNow =
      previousMotionFileIdRef.current === fileIdAtSchedule;
    const currentContent = isActiveFileNow
      ? getFreshActiveFileContent({
          activeContent,
          latestContent: latestActiveContentRef.current,
          lastLocalContent: lastLocalContentRef.current,
        })
      : getScreenContent(fileIdAtSchedule) || activeContent;
    const localMotionCss = compileMotionTimeline({
      id: motionTimelineId ?? "",
      designId: id,
      sourceRef: fileIdAtSchedule,
      filePath: null,
      tracks: tracksForSave,
      durationMs: motionDurationMs,
      defaultEase: motionDefaultEase,
      compiledHash: null,
      createdAt: "",
      updatedAt: "",
    }).css;
    applyMotionEdit(
      {
        designId: id,
        fileId: fileIdAtSchedule,
        timelineId: motionTimelineId ?? undefined,
        sourceRef: fileIdAtSchedule,
        tracks: tracksForSave,
        durationMs: motionDurationMs,
        defaultEase: motionDefaultEase,
        currentContent,
        revision: fileRevisionAtSchedule,
        includeContent: false,
      },
      {
        onSuccess: (result) => {
          const response = result as {
            fileId?: unknown;
            timelineId?: unknown;
            updatedAt?: unknown;
            compiledHash?: unknown;
            contentPatched?: unknown;
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
            // Seed the hydration fingerprint with the EXPECTED post-save
            // identity instead of null: a null fingerprint lets the
            // still-stale get-motion-timeline cache re-hydrate the
            // pre-save tracks (UI reverts, then jumps back on refetch,
            // and edits made in that window lock in the reverted state).
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
                filePath: null,
                tracks: tracksForSave,
                durationMs: motionDurationMs,
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
            // Re-inject the managed CSS into the FRESHEST content at
            // success time — replaying the pre-flight snapshot would
            // clobber document edits made while the save was in flight.
            const freshContent = isStillActiveFile
              ? getFreshActiveFileContent({
                  activeContent: currentContent,
                  latestContent: latestActiveContentRef.current,
                  lastLocalContent: lastLocalContentRef.current,
                })
              : currentContent;
            const hasConcurrentEdits = freshContent !== currentContent;
            const patchedContent = injectManagedMotionCss(
              freshContent,
              localMotionCss,
            );
            applyFileContentUpdate(response.fileId, patchedContent, {
              refreshPreview: false,
              forcePreviewFullDocument: true,
              recordHistory: false,
              // Without concurrent edits, adopt the server's write as-is
              // (no re-save). With concurrent edits the merged content must
              // flow through the normal save path and stay marked pending.
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
        onError: (error) => {
          if (motionAutosaveRevisionRef.current === revisionAtSchedule) {
            motionAutosaveFailedRevisionRef.current = revisionAtSchedule;
            lastScheduledMotionAutosaveRevisionRef.current = 0;
          }
          toast.error(
            error instanceof Error
              ? error.message
              : // i18n-ignore: fallback toast for motion autosave failure.
                "Motion changes could not be saved.",
          );
        },
      },
    );
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
