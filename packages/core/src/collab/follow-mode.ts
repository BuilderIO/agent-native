/**
 * Follow-mode — let a user "follow" another participant so their viewport
 * tracks wherever that participant navigates.
 *
 * The followed participant publishes their viewport via setPresence().
 * useFollowUser watches their presence and calls a callback whenever it
 * changes so the consumer can scroll/zoom to match.
 *
 * Viewport publishing is opt-in via setPresence("viewport", { ... }).
 * This module handles the consumer (follower) side only.
 */

import { useEffect, useRef, useCallback, useState } from "react";

import type { OtherPresence } from "./presence.js";

export interface ViewportDescriptor {
  /** Active document / file ID being viewed. */
  fileId?: string;
  /** Scroll position. */
  scrollX?: number;
  scrollY?: number;
  /** Zoom level (1.0 = 100%). */
  zoom?: number;
  /** Normalized cursor last seen (0–1). */
  cursorX?: number;
  cursorY?: number;
}

export interface UseFollowUserOptions {
  /** Remote participants list from usePresence. */
  others: OtherPresence[];
  /**
   * The client ID to follow. Pass null / undefined to stop following.
   */
  followingId: number | null | undefined;
  /**
   * Key inside presence payload that carries viewport info.
   * Default: "viewport"
   */
  viewportKey?: string;
  /**
   * Called whenever the followed participant's viewport changes.
   * Consumers should scroll/zoom to the described viewport in here.
   */
  onViewport: (viewport: ViewportDescriptor) => void;
}

export interface UseFollowUserResult {
  /** The currently followed client ID, or null. */
  followingId: number | null;
  /** True when actively following someone. */
  isFollowing: boolean;
  /** Stop following the current target. */
  stopFollowing: () => void;
}

/**
 * Watch a specific participant's viewport presence and invoke onViewport
 * when it changes.
 */
export function useFollowUser({
  others,
  followingId,
  viewportKey = "viewport",
  onViewport,
}: UseFollowUserOptions): UseFollowUserResult {
  // Stable ref so the effect doesn't re-subscribe on every callback identity change.
  const onViewportRef = useRef(onViewport);
  onViewportRef.current = onViewport;

  const [activeId, setActiveId] = useState<number | null>(followingId ?? null);

  // Sync activeId when followingId prop changes.
  useEffect(() => {
    setActiveId(followingId ?? null);
  }, [followingId]);

  const stopFollowing = useCallback(() => {
    setActiveId(null);
  }, []);

  // Watch the target's viewport in the others array.
  const prevViewportRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeId == null) {
      prevViewportRef.current = null;
      return;
    }
    const target = others.find((o) => o.clientId === activeId);
    if (!target) return;

    const vp = target.presence[viewportKey] as ViewportDescriptor | undefined;
    if (!vp) return;

    const serialized = JSON.stringify(vp);
    if (serialized === prevViewportRef.current) return; // No change.
    prevViewportRef.current = serialized;
    onViewportRef.current(vp);
  }, [others, activeId, viewportKey]);

  return {
    followingId: activeId,
    isFollowing: activeId != null,
    stopFollowing,
  };
}
