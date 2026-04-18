import { useCallback, useEffect, useMemo, useState } from "react";
import type { TranscriptSegment } from "@/../shared/api";

export interface TranscriptHit {
  segmentIndex: number;
  matchRanges: Array<[number, number]>;
}

export interface UseTranscriptSearchResult {
  hits: TranscriptHit[];
  activeHitIndex: number;
  next: () => void;
  prev: () => void;
  focusHit: (hitIndex: number) => void;
  query: string;
}

export function useTranscriptSearch(
  segments: TranscriptSegment[],
  query: string,
): UseTranscriptSearchResult {
  const hits = useMemo<TranscriptHit[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: TranscriptHit[] = [];
    for (let i = 0; i < segments.length; i++) {
      const text = segments[i].text.toLowerCase();
      const ranges: Array<[number, number]> = [];
      let idx = 0;
      while (idx < text.length) {
        const found = text.indexOf(q, idx);
        if (found === -1) break;
        ranges.push([found, found + q.length]);
        idx = found + q.length;
      }
      if (ranges.length) out.push({ segmentIndex: i, matchRanges: ranges });
    }
    return out;
  }, [segments, query]);

  const [activeHitIndex, setActiveHitIndex] = useState(0);

  useEffect(() => {
    setActiveHitIndex(0);
  }, [query]);

  useEffect(() => {
    if (activeHitIndex >= hits.length) {
      setActiveHitIndex(hits.length === 0 ? 0 : hits.length - 1);
    }
  }, [hits.length, activeHitIndex]);

  const next = useCallback(() => {
    setActiveHitIndex((i) => (hits.length === 0 ? 0 : (i + 1) % hits.length));
  }, [hits.length]);

  const prev = useCallback(() => {
    setActiveHitIndex((i) =>
      hits.length === 0 ? 0 : (i - 1 + hits.length) % hits.length,
    );
  }, [hits.length]);

  const focusHit = useCallback(
    (hitIndex: number) => {
      if (hitIndex < 0 || hitIndex >= hits.length) return;
      setActiveHitIndex(hitIndex);
    },
    [hits.length],
  );

  return { hits, activeHitIndex, next, prev, focusHit, query };
}
