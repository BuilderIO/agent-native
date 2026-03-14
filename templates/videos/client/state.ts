import { useState, useCallback } from "react";
import type { AnimationTrack } from "./types";

export type TimelineState = {
  tracks: AnimationTrack[];
  selectedTrackId: string | null;
  selectTrack: (id: string | null) => void;
  updateTrack: (id: string, patch: Partial<AnimationTrack>) => void;
  addTrack: (track: AnimationTrack) => void;
  deleteTrack: (id: string) => void;
  setTracks: (tracks: AnimationTrack[]) => void;
};

export function useTimelineState(initialTracks: AnimationTrack[] = []): TimelineState {
  const [tracks, setTracksInternal] = useState<AnimationTrack[]>(initialTracks);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);

  const selectTrack = useCallback((id: string | null) => {
    setSelectedTrackId(id);
  }, []);

  const updateTrack = useCallback((id: string, patch: Partial<AnimationTrack>) => {
    setTracksInternal((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...patch } : t))
    );
  }, []);

  const addTrack = useCallback((track: AnimationTrack) => {
    setTracksInternal((prev) => {
      // Cursor track should be inserted at the top (after camera if it exists)
      if (track.id === "cursor") {
        const cameraIndex = prev.findIndex(t => t.id === "camera");
        if (cameraIndex >= 0) {
          // Insert after camera
          return [
            ...prev.slice(0, cameraIndex + 1),
            track,
            ...prev.slice(cameraIndex + 1),
          ];
        } else {
          // Insert at the very top
          return [track, ...prev];
        }
      }
      // Other tracks append at the end
      return [...prev, track];
    });
  }, []);

  const deleteTrack = useCallback((id: string) => {
    setTracksInternal((prev) => prev.filter(t => t.id !== id));
    // Clear selection if the deleted track was selected
    setSelectedTrackId((prevId) => prevId === id ? null : prevId);
  }, []);

  // Resets tracks and clears selection — used when switching compositions
  const setTracks = useCallback((newTracks: AnimationTrack[]) => {
    setTracksInternal(newTracks);
    setSelectedTrackId(null);
  }, []);

  return {
    tracks,
    selectedTrackId,
    selectTrack,
    updateTrack,
    addTrack,
    deleteTrack,
    setTracks
  };
}
