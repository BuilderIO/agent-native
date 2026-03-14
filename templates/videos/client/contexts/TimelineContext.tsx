import { createContext, useContext, useEffect, useRef, useMemo, type ReactNode } from "react";
import { useTimelineState } from "@/state";
import type { AnimationTrack } from "@/types";
import { useComposition } from "./CompositionContext";

// ─── Persistence helpers ──────────────────────────────────────────────────────

const TRACKS_KEY = (id: string) => `videos-tracks:${id}`;
const VERSION_KEY = (id: string) => `videos-tracks-version:${id}`;

/**
 * Merge stored animatedProps onto the registry defaults.
 * - Registry props always win on metadata (codeSnippet, programmatic, unit, isCustom)
 * - User's from/to values are preserved for matching properties
 * - If user has NO stored data, use all registry defaults
 * - If user HAS stored data, only include registry props that exist in stored (respects deletions)
 * - New registry props are only added if stored data is empty (first load)
 * - Custom props the user added (not in registry) are kept at the end
 */
function mergeAnimatedProps(
  stored: AnimationTrack["animatedProps"],
  defaults: AnimationTrack["animatedProps"]
): AnimationTrack["animatedProps"] {
  const def = defaults ?? [];
  const sto = stored ?? [];

  // First load (no stored data) → use all registry defaults
  if (sto.length === 0) return def;

  // User has data → only merge props that exist in BOTH stored and defaults
  // This respects user deletions while keeping metadata in sync
  const merged = sto.map((storedProp) => {
    const defProp = def.find((d) => d.property === storedProp.property);
    if (defProp) {
      // Registry prop: keep user's from/to/keyframes/easing, but pull in registry metadata
      // If stored keyframes is empty/undefined, use registry keyframes (allows adding keyframes via code)
      const useRegistryKeyframes = (!storedProp.keyframes || storedProp.keyframes.length === 0) &&
                                    defProp.keyframes &&
                                    defProp.keyframes.length > 0;

      if (useRegistryKeyframes) {
        console.log(`[Videos] 🔄 Using registry keyframes for "${storedProp.property}" (${defProp.keyframes!.length} keyframes from code)`);
      }

      return {
        ...defProp,
        from: storedProp.from,
        to: storedProp.to,
        keyframes: useRegistryKeyframes ? defProp.keyframes : storedProp.keyframes,
        easing: storedProp.easing,
      };
    }
    // Custom prop (not in registry): keep as-is
    return storedProp;
  });

  // Add missing properties from registry that aren't in stored data
  // This ensures new required properties (like isClicking) get added to existing tracks
  const storedPropNames = new Set(sto.map(p => p.property));
  const missingProps = def.filter(p => !storedPropNames.has(p.property));
  
  if (missingProps.length > 0) {
    console.log(`[Videos] Added ${missingProps.length} missing properties:`, missingProps.map(p => p.property));
  }
  
  return [...merged, ...missingProps];
}

/**
 * Load saved tracks from localStorage, merged on top of the code-defined
 * defaults so that new/removed tracks always stay in sync with the registry.
 * animatedProps are merged deeply so new registry props and metadata always appear.
 *
 * VERSION CONTROL:
 * If registryVersion > storedVersion, localStorage is automatically cleared and
 * fresh registry defaults are returned. This prevents stale data issues.
 */
function loadTracks(
  compositionId: string,
  defaults: AnimationTrack[],
  registryVersion: number = 1,
  durationInFrames?: number
): AnimationTrack[] {
  try {
    // Check version first
    const storedVersionRaw = localStorage.getItem(VERSION_KEY(compositionId));
    const storedVersion = storedVersionRaw ? parseInt(storedVersionRaw, 10) : 0;

    // If registry is newer, clear ALL localStorage and use fresh defaults
    if (registryVersion > storedVersion) {
      console.log(
        `[Videos] 🔄 Registry version ${registryVersion} > localStorage version ${storedVersion}\n` +
        `Auto-clearing ALL stale data for "${compositionId}" (tracks, props, settings).`
      );
      // Clear everything to ensure complete sync
      localStorage.removeItem(TRACKS_KEY(compositionId));
      localStorage.removeItem(`videos-props:${compositionId}`);
      localStorage.removeItem(`videos-comp-settings:${compositionId}`);
      localStorage.setItem(VERSION_KEY(compositionId), String(registryVersion));
      return applyCameraTrackCorrection(defaults, durationInFrames);
    }

    const raw = localStorage.getItem(TRACKS_KEY(compositionId));
    if (!raw) {
      // First time loading - save version
      localStorage.setItem(VERSION_KEY(compositionId), String(registryVersion));
      return applyCameraTrackCorrection(defaults, durationInFrames);
    }
    const stored = JSON.parse(raw) as AnimationTrack[];

    // Deduplicate stored tracks by id (keep first occurrence)
    const seenIds = new Set<string>();
    const deduped = stored.filter(track => {
      if (seenIds.has(track.id)) return false;
      seenIds.add(track.id);
      return true;
    });

    // If we found duplicates, save the cleaned version back to localStorage
    if (deduped.length !== stored.length) {
      console.log(`[Videos] Cleaned ${stored.length - deduped.length} duplicate track(s) from localStorage`);
      localStorage.setItem(TRACKS_KEY(compositionId), JSON.stringify(deduped));
    }

    const merged = defaults.map((def) => {
      const sto = deduped.find((s) => s.id === def.id);
      if (!sto) return def;
      // Keep user's timing/easing/label edits, but deep-merge animatedProps
      return {
        ...sto,
        animatedProps: mergeAnimatedProps(sto.animatedProps, def.animatedProps),
      };
    });

    // Apply camera track correction here (before returning) to avoid triggering save
    return applyCameraTrackCorrection(merged, durationInFrames);
  } catch {
    return applyCameraTrackCorrection(defaults, durationInFrames);
  }
}

/**
 * Ensures camera track always spans the full composition duration.
 * Done during load to avoid triggering the save effect.
 */
function applyCameraTrackCorrection(
  tracks: AnimationTrack[],
  durationInFrames?: number
): AnimationTrack[] {
  if (!durationInFrames) return tracks;

  return tracks.map(track => {
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

function saveTracks(compositionId: string, tracks: AnimationTrack[], version: number = 1) {
  try {
    localStorage.setItem(TRACKS_KEY(compositionId), JSON.stringify(tracks));
    localStorage.setItem(VERSION_KEY(compositionId), String(version));
  } catch {}
}

// ─── Context type ─────────────────────────────────────────────────────────────

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

// ─── Provider ─────────────────────────────────────────────────────────────────

type TimelineProviderProps = {
  children: ReactNode;
};

export function TimelineProvider({ children }: TimelineProviderProps) {
  // Safety check for HMR issues - if context is missing, show helpful error
  let compositionContext;
  try {
    compositionContext = useComposition();
  } catch (error) {
    console.error('[Videos] ⚠️ HMR context error detected. Please refresh the page.');
    // Return minimal provider to prevent cascade errors
    return (
      <TimelineContext.Provider value={null}>
        {children}
      </TimelineContext.Provider>
    );
  }

  const { compositionId, effectiveComposition, selected, compSettings } = compositionContext;
  const timeline = useTimelineState([]);
  const prevFpsRef = useRef<Record<string, number>>({});

  // Get the default tracks and current fps from composition
  const defaultTracks = selected?.tracks ?? [];
  const registryVersion = selected?.version ?? 1;
  const durationInFrames = effectiveComposition?.durationInFrames ?? compSettings?.durationInFrames ?? 90;
  const fps = effectiveComposition?.fps ?? compSettings?.fps ?? 30;

  // When composition changes: load saved tracks (merged with code defaults)
  useEffect(() => {
    if (!compositionId) {
      timeline.setTracks([]);
      return;
    }
    const merged = loadTracks(compositionId, defaultTracks, registryVersion, durationInFrames);

    // 🔍 Validation: Warn if keyframes in registry are being ignored by localStorage
    const hasRegistryKeyframes = defaultTracks.some(t =>
      t.animatedProps?.some(p => p.keyframes && p.keyframes.length > 0)
    );
    const hasMergedKeyframes = merged.some(t =>
      t.animatedProps?.some(p => p.keyframes && p.keyframes.length > 0)
    );

    if (hasRegistryKeyframes && !hasMergedKeyframes) {
      console.warn(
        `[Videos] ⚠️ Registry has keyframes but they're not showing in the timeline!\n` +
        `Composition: ${compositionId}\n` +
        `Fix: Run in console: localStorage.removeItem('videos-tracks:${compositionId}'); location.reload();`
      );
    }

    timeline.setTracks(merged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compositionId]);

  // Save tracks to localStorage when changed (skip first load to avoid immediate save)
  const prevTracksRef = useRef<AnimationTrack[]>([]);
  const tracksInitialLoadRef = useRef(true);

  useEffect(() => {
    if (!compositionId) return;
    if (timeline.tracks === prevTracksRef.current) return;

    // Skip the very first load after composition changes
    if (tracksInitialLoadRef.current) {
      tracksInitialLoadRef.current = false;
      prevTracksRef.current = timeline.tracks;
      return;
    }

    // Save to localStorage (user made a change)
    console.log('[Videos] 💾 Saving tracks to localStorage (user edit)');
    saveTracks(compositionId, timeline.tracks, registryVersion);
    prevTracksRef.current = timeline.tracks;
  }, [compositionId, timeline.tracks, registryVersion]);

  // Reset initial load flag when composition changes
  useEffect(() => {
    tracksInitialLoadRef.current = true;
  }, [compositionId]);

  // Camera track duration is corrected inside loadTracks on initial load
  // But we still need to update it when user changes duration in settings
  const prevDurationRef = useRef(durationInFrames);

  useEffect(() => {
    if (!compositionId) return;

    // Only update if duration actually changed (user modified it)
    if (prevDurationRef.current !== durationInFrames && prevDurationRef.current !== undefined) {
      const cameraTrack = timeline.tracks.find(t => t.id === "camera");
      if (cameraTrack) {
        console.log('[Videos] 📹 User changed duration, updating camera track');
        timeline.updateTrack("camera", {
          startFrame: 0,
          endFrame: durationInFrames,
        });
      }
    }

    prevDurationRef.current = durationInFrames;
  }, [compositionId, durationInFrames, timeline]);

  // Sync changes from other tabs via storage event
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (!compositionId) return;

      const tracksKey = TRACKS_KEY(compositionId);

      if (e.key === tracksKey && e.newValue) {
        const newTracks = loadTracks(compositionId, defaultTracks, registryVersion);
        timeline.setTracks(newTracks);
        console.log('[Videos] Synced tracks from another tab');
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [compositionId, defaultTracks, registryVersion, timeline]);

  // Scale all track timings when FPS changes
  useEffect(() => {
    if (!compositionId) return;

    const previousFps = prevFpsRef.current[compositionId];

    // Only scale if FPS actually changed and we have a previous value
    if (previousFps && fps !== previousFps) {
      const fpsRatio = fps / previousFps;

      // Scale all tracks (including camera)
      const scaledTracks = timeline.tracks.map(track => {
        const scaledStart = Math.round(track.startFrame * fpsRatio);
        const scaledEnd = Math.round(track.endFrame * fpsRatio);

        // Scale keyframes if they exist
        const scaledProps = track.animatedProps?.map(prop => {
          if (!prop.keyframes || prop.keyframes.length === 0) return prop;

          const scaledKeyframes = prop.keyframes.map(kf => ({
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

    // Update previous FPS for next comparison
    prevFpsRef.current[compositionId] = fps;
  }, [compositionId, fps, timeline]);

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
    [timeline]
  );

  return (
    <TimelineContext.Provider value={value}>
      {children}
    </TimelineContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTimeline() {
  const context = useContext(TimelineContext);
  if (!context) {
    throw new Error("useTimeline must be used within TimelineProvider");
  }
  return context;
}
