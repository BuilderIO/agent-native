import type React from "react";
import {
  BlankComposition,
  type BlankCompositionProps,
} from "./compositions/BlankComposition";
import {
  createCameraTrack,
  createCursorTrack,
  createStandardTracks,
} from "./trackHelpers";
import type { AnimationTrack } from "@/types";

export type CompositionEntry = {
  id: string;
  title: string;
  description: string;
  component: React.FC<any>;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
  defaultProps: Record<string, any>;
  tracks: AnimationTrack[];
  storage?: "registry" | "database";
  /** Increment when registry defaults should replace stale local overrides. */
  version?: number;
};

export const compositions: CompositionEntry[] = [];

export { createCameraTrack, createCursorTrack, createStandardTracks };

function titleToSlug(title: string): string {
  if (!title || !title.trim()) return "temp";

  return (
    title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-") // Replace non-alphanumeric with hyphens
      .replace(/^-+|-+$/g, "") // Remove leading/trailing hyphens
      .replace(/-+/g, "-") || // Replace multiple hyphens with single
    "temp"
  ); // Fallback if result is empty
}

/**
 * Find the next available slug by appending -2, -3, etc.
 */
function getAvailableSlug(baseSlug: string): string {
  let slug = baseSlug;
  let counter = 2;

  while (compositions.some((c) => c.id === slug)) {
    slug = `${baseSlug}-${counter}`;
    counter++;
  }

  return slug;
}

/**
 * Create a new blank composition with camera and cursor tracks
 */
export function createBlankComposition(title: string): CompositionEntry {
  const baseSlug = titleToSlug(title);
  const id = getAvailableSlug(baseSlug);
  const durationInFrames = 240;

  return {
    id,
    title: title.trim() || "Untitled Composition",
    description: "Blank composition",
    component: BlankComposition,
    durationInFrames,
    fps: 30,
    width: 1920,
    height: 1080,
    defaultProps: {} satisfies BlankCompositionProps,
    tracks: createStandardTracks(durationInFrames),
  };
}

/**
 * Add a new composition to the registry
 */
export function addComposition(composition: CompositionEntry) {
  compositions.push(composition);
}
