import { useEffect, useRef, useCallback, useState } from "react";

import type { OtherPresence } from "./presence.js";

export interface ViewportDescriptor {
  fileId?: string;
  scrollX?: number;
  scrollY?: number;
  zoom?: number;
  cursorX?: number;
  cursorY?: number;
}

export interface UseFollowUserOptions {
  others: OtherPresence[];
  followingId: number | null | undefined;
  viewportKey?: string;
  onViewport: (viewport: ViewportDescriptor) => void;
}

export interface UseFollowUserResult {
  followingId: number | null;
  isFollowing: boolean;
  stopFollowing: () => void;
}

export function useFollowUser({
  others,
  followingId,
  viewportKey = "viewport",
  onViewport,
}: UseFollowUserOptions): UseFollowUserResult {
  const onViewportRef = useRef(onViewport);
  onViewportRef.current = onViewport;

  const [activeId, setActiveId] = useState<number | null>(followingId ?? null);

  useEffect(() => {
    setActiveId(followingId ?? null);
  }, [followingId]);

  const stopFollowing = useCallback(() => {
    setActiveId(null);
  }, []);

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
    if (serialized === prevViewportRef.current) return;
    prevViewportRef.current = serialized;
    onViewportRef.current(vp);
  }, [others, activeId, viewportKey]);

  return {
    followingId: activeId,
    isFollowing: activeId != null,
    stopFollowing,
  };
}
