import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useMemo,
  type ReactNode,
} from "react";
import { useTimelineState } from "@/state";
import type { AnimationTrack } from "@/types";
import { useComposition } from "./CompositionContext";
import type { CompositionCollabData } from "@/hooks/use-composition-collab";
import { debug } from "@/utils/debug";

const TRACKS_KEY = (id: string) => `videos-tracks:${id}`;
const VERSION_KEY = (id: string) => `videos-tracks-version:${id}`;

function mergeAnimatedProps(
  stored: AnimationTrack["animatedProps"],
  defaults: AnimationTrack["animatedProps"],
): AnimationTrack["animatedProps"] {
  const def = defaults ?? [];
  const sto = stored ?? [];

  // First load (no stored data) → use all registry defaults
  if (sto.length === 0) return def;

  const merged = sto.map((storedProp) => {
    const defProp = def.find((d) => d.property === storedProp.property);
    if (defProp) {
      const useRegistryKeyframes =
        (!storedProp.keyframes || storedProp.keyframes.length === 0) &&
        defProp.keyframes &&
        defProp.keyframes.length > 0;

      if (useRegistryKeyframes) {
        debug.verbose("Using registry keyframes", {
          property: storedProp.property,
          keyframes: defProp.keyframes!.length,
        });
      }

      return {
        ...defProp,
        from: storedProp.from,
        to: storedProp.to,
        keyframes: useRegistryKeyframes
          ? defProp.keyframes
          : storedProp.keyframes,
        easing: storedProp.easing,
      };
    }
    return storedProp;
  });

  const storedPropNames = new Set(sto.map((p) => p.property));
  const missingProps = def.filter((p) => !storedPropNames.has(p.property));

  if (missingProps.length > 0) {
    debug.verbose("Added missing animated props", {
      count: missingProps.length,
      properties: missingProps.map((p) => p.property),
    });
  }

  return [...merged, ...missingProps];
}

function loadTracks(
  compositionId: string,
  defaults: AnimationTrack[],
  registryVersion: number = 1,
  durationInFrames?: number,
): AnimationTrack[] {
  try {
    const storedVersionRaw = localStorage.getItem(VERSION_KEY(compositionId));
    const storedVersion = storedVersionRaw ? parseInt(storedVersionRaw, 10) : 0;

    if (registryVersion > storedVersion) {
      debug.verbose("Clearing stale composition data", {
        compositionId,
        registryVersion,
        storedVersion,
      });
      localStorage.removeItem(TRACKS_KEY(compositionId));
      localStorage.removeItem(`videos-props:${compositionId}`);
      localStorage.removeItem(`videos-comp-settings:${compositionId}`);
      localStorage.setItem(VERSION_KEY(compositionId), String(registryVersion));
      return applyCameraTrackCorrection(defaults, durationInFrames);
    }

    const raw = localStorage.getItem(TRACKS_KEY(compositionId));
    if (!raw) {
      localStorage.setItem(VERSION_KEY(compositionId), String(registryVersion));
      return applyCameraTrackCorrection(defaults, durationInFrames);
    }
    const stored = JSON.parse(raw) as AnimationTrack[];

    const seenIds = new Set<string>();
    const deduped = stored.filter((track) => {
      if (seenIds.has(track.id)) return false;
      seenIds.add(track.id);
      return true;
    });

    if (deduped.length !== stored.length) {
      debug.verbose("Cleaned duplicate tracks from localStorage", {
        removed: stored.length - deduped.length,
      });
      localStorage.setItem(TRACKS_KEY(compositionId), JSON.stringify(deduped));
    }

    const merged = defaults.map((def) => {
      const sto = deduped.find((s) => s.id === def.id);
      if (!sto) return def;
      return {
        ...sto,
        animatedProps: mergeAnimatedProps(sto.animatedProps, def.animatedProps),
      };
    });

    return applyCameraTrackCorrection(merged, durationInFrames);
  } catch {
    return applyCameraTrackCorrection(defaults, durationInFrames);
  }
}

function applyCameraTrackCorrection(
  tracks: AnimationTrack[],
  durationInFrames?: number,
): AnimationTrack[] {
  if (!durationInFrames) return tracks;

  return tracks.map((track) => {
    if (track.id === "camera") {
      return {
        ...track,
        startFrame: 0,
        endFrame: durationInFrames,
      };
    }
    return track;
  });
}

function saveTracks(
  compositionId: string,
  tracks: AnimationTrack[],
  version: number = 1,
) {
  try {
    localStorage.setItem(TRACKS_KEY(compositionId), JSON.stringify(tracks));
    localStorage.setItem(VERSION_KEY(compositionId), String(version));
  } catch {}
}

type TimelineContextType = {
  tracks: AnimationTrack[];
  selectedTrackId: string | null;
  selectTrack: (id: string | null) => void;
  updateTrack: (id: string, patch: Partial<AnimationTrack>) => void;
  addTrack: (track: AnimationTrack) => void;
  deleteTrack: (id: string) => void;
  setTracks: (tracks: AnimationTrack[]) => void;
};

const TimelineContext = createContext<TimelineContextType | null>(null);

type TimelineProviderProps = {
  children: ReactNode;
  /** Optional: push state to collab layer on changes. */
  onCollabPush?: (data: CompositionCollabData) => void;
  /** Optional: remote collab data to apply when it arrives. */
  collabData?: CompositionCollabData | null;
  /** Whether collab is synced (prevents overwriting remote data on first load). */
  collabSynced?: boolean;
};

export function TimelineProvider({
  children,
  onCollabPush,
  collabData,
  collabSynced,
}: TimelineProviderProps) {
  let compositionContext;
  try {
    compositionContext = useComposition();
  } catch (error) {
    debug.error("HMR context error detected. Please refresh the page.", error);
    return (
      <TimelineContext.Provider value={null}>
        {children}
      </TimelineContext.Provider>
    );
  }

  const { compositionId, effectiveComposition, selected, compSettings } =
    compositionContext;
  const timeline = useTimelineState([]);
  const prevFpsRef = useRef<Record<string, number>>({});

  const defaultTracks = selected?.tracks ?? [];
  const registryVersion = selected?.version ?? 1;
  const durationInFrames =
    effectiveComposition?.durationInFrames ??
    compSettings?.durationInFrames ??
    90;
  const fps = effectiveComposition?.fps ?? compSettings?.fps ?? 30;

  useEffect(() => {
    if (!compositionId) {
      timeline.setTracks([]);
      return;
    }
    const merged = loadTracks(
      compositionId,
      defaultTracks,
      registryVersion,
      durationInFrames,
    );

    const hasRegistryKeyframes = defaultTracks.some((t) =>
      t.animatedProps?.some((p) => p.keyframes && p.keyframes.length > 0),
    );
    const hasMergedKeyframes = merged.some((t) =>
      t.animatedProps?.some((p) => p.keyframes && p.keyframes.length > 0),
    );

    if (hasRegistryKeyframes && !hasMergedKeyframes) {
      debug.warn("Registry keyframes are missing from merged tracks", {
        compositionId,
      });
    }

    timeline.setTracks(merged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compositionId]);

  const prevTracksRef = useRef<AnimationTrack[]>([]);
  const tracksInitialLoadRef = useRef(true);

  useEffect(() => {
    if (!compositionId) return;
    if (timeline.tracks === prevTracksRef.current) return;

    if (tracksInitialLoadRef.current) {
      tracksInitialLoadRef.current = false;
      prevTracksRef.current = timeline.tracks;
      return;
    }

    debug.verbose("Saving tracks to localStorage", { compositionId });
    saveTracks(compositionId, timeline.tracks, registryVersion);
    prevTracksRef.current = timeline.tracks;
  }, [compositionId, timeline.tracks, registryVersion]);

  useEffect(() => {
    tracksInitialLoadRef.current = true;
  }, [compositionId]);

  const prevDurationRef = useRef(durationInFrames);

  useEffect(() => {
    if (!compositionId) return;

    if (
      prevDurationRef.current !== durationInFrames &&
      prevDurationRef.current !== undefined
    ) {
      const cameraTrack = timeline.tracks.find((t) => t.id === "camera");
      if (cameraTrack) {
        debug.verbose("Updating camera track duration", {
          compositionId,
          durationInFrames,
        });
        timeline.updateTrack("camera", {
          startFrame: 0,
          endFrame: durationInFrames,
        });
      }
    }

    prevDurationRef.current = durationInFrames;
  }, [compositionId, durationInFrames, timeline]);

  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (!compositionId) return;

      const tracksKey = TRACKS_KEY(compositionId);

      if (e.key === tracksKey && e.newValue) {
        const newTracks = loadTracks(
          compositionId,
          defaultTracks,
          registryVersion,
        );
        timeline.setTracks(newTracks);
        debug.verbose("Synced tracks from another tab", { compositionId });
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [compositionId, defaultTracks, registryVersion, timeline]);

  useEffect(() => {
    if (!compositionId) return;

    const previousFps = prevFpsRef.current[compositionId];

    if (previousFps && fps !== previousFps) {
      const fpsRatio = fps / previousFps;

      const scaledTracks = timeline.tracks.map((track) => {
        const scaledStart = Math.round(track.startFrame * fpsRatio);
        const scaledEnd = Math.round(track.endFrame * fpsRatio);

        const scaledProps = track.animatedProps?.map((prop) => {
          if (!prop.keyframes || prop.keyframes.length === 0) return prop;

          const scaledKeyframes = prop.keyframes.map((kf) => ({
            ...kf,
            frame: Math.round(kf.frame * fpsRatio),
          }));

          return { ...prop, keyframes: scaledKeyframes };
        });

        return {
          ...track,
          startFrame: scaledStart,
          endFrame: scaledEnd,
          animatedProps: scaledProps,
        };
      });

      timeline.setTracks(scaledTracks);
    }

    prevFpsRef.current[compositionId] = fps;
  }, [compositionId, fps, timeline]);

  const collabPushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!compositionId || !onCollabPush) return;
    if (timeline.tracks === prevTracksRef.current) return;

    if (tracksInitialLoadRef.current) return;

    if (collabPushTimerRef.current) clearTimeout(collabPushTimerRef.current);
    collabPushTimerRef.current = setTimeout(() => {
      debug.verbose("Pushing tracks to collab layer", { compositionId });
      onCollabPush({ tracks: timeline.tracks });
    }, 500);

    return () => {
      if (collabPushTimerRef.current) clearTimeout(collabPushTimerRef.current);
    };
  }, [compositionId, timeline.tracks, onCollabPush]);

  const prevCollabDataRef = useRef<CompositionCollabData | null>(null);

  useEffect(() => {
    if (!compositionId || !collabSynced || !collabData) return;
    if (collabData === prevCollabDataRef.current) return;
    prevCollabDataRef.current = collabData;

    if (collabData.tracks && Array.isArray(collabData.tracks)) {
      const remoteJson = JSON.stringify(collabData.tracks);
      const localJson = JSON.stringify(timeline.tracks);
      if (remoteJson !== localJson) {
        debug.verbose("Applying remote tracks from collab layer", {
          compositionId,
        });
        const merged = loadTracks(
          compositionId,
          collabData.tracks as AnimationTrack[],
          registryVersion,
          durationInFrames,
        );
        timeline.setTracks(merged);
        saveTracks(compositionId, merged, registryVersion);
      }
    }
  }, [
    compositionId,
    collabData,
    collabSynced,
    durationInFrames,
    registryVersion,
    timeline,
  ]);

  const value = useMemo(
    () => ({
      tracks: timeline.tracks,
      selectedTrackId: timeline.selectedTrackId,
      selectTrack: timeline.selectTrack,
      updateTrack: timeline.updateTrack,
      addTrack: timeline.addTrack,
      deleteTrack: timeline.deleteTrack,
      setTracks: timeline.setTracks,
    }),
    [timeline],
  );

  return (
    <TimelineContext.Provider value={value}>
      {children}
    </TimelineContext.Provider>
  );
}

export function useTimeline() {
  const context = useContext(TimelineContext);
  if (!context) {
    throw new Error("useTimeline must be used within TimelineProvider");
  }
  return context;
}
