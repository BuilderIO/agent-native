/**
 * ═══════════════════════════════════════════════════════════════════════════
 * COMPOSITION REGISTRY
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This file is the single source of truth for all composition defaults.
 *
 * ⚠️ KEYFRAME SYNC PATTERN:
 *
 * When adding keyframes to a composition track in this registry:
 *
 * 1. If the composition was already loaded in localStorage BEFORE you added
 *    keyframes, users won't see them automatically (localStorage wins).
 *
 * 2. Fix: Users should run this in browser console:
 *    ```
 *    resetTracks('composition-id');  // Then refresh page
 *    ```
 *
 * 3. The merge logic now preserves registry keyframes when localStorage has
 *    empty arrays, so this should auto-fix on next reload.
 *
 * 4. Validation warnings will appear in console if keyframes are missing.
 *
 * 📝 BEST PRACTICE:
 *
 * - Always define keyframes in the registry from the start
 * - If adding keyframes later, announce to users they may need to reset
 * - Use resetCurrent() in console for quick testing during development
 *
 * ═══════════════════════════════════════════════════════════════════════════
 */

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
  /**
   * Version number for this composition's data structure.
   * Increment this when you make changes to tracks/props that should
   * invalidate localStorage cache (e.g., adding keyframes, changing structure).
   * If localStorage version < registry version, localStorage will be auto-reset.
   * Defaults to 1 if not specified.
   */
  version?: number;
};

export const compositions: CompositionEntry[] = [
  {
    id: "test-qa",
    title: "QA Test Composition",
    description: "Temporary composition for QA testing",
    component: BlankComposition,
    durationInFrames: 240,
    fps: 30,
    width: 1920,
    height: 1080,
    defaultProps: {} satisfies BlankCompositionProps,
    tracks: createStandardTracks(240),
  },
];

// Re-export track helpers
export { createCameraTrack, createCursorTrack, createStandardTracks };

/**
 * Convert a title to a URL-friendly slug
 */
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
