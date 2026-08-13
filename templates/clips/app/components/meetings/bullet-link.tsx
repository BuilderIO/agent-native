import { useT } from "@agent-native/core/client/i18n";
import { useMemo } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { formatTranscriptTimestamp } from "../transcript/transcript-segment-row";
import type { TranscriptSegment } from "./transcript-bubbles";

const STOPWORDS = new Set<string>([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "to",
  "of",
  "in",
  "on",
  "at",
  "for",
  "with",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "as",
  "by",
  "from",
  "we",
  "i",
  "you",
  "they",
  "he",
  "she",
  "our",
  "their",
  "his",
  "her",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "should",
  "could",
  "can",
  "may",
  "might",
  "so",
  "if",
  "then",
  "than",
  "about",
  "into",
  "out",
  "up",
  "down",
  "just",
  "also",
  "very",
  "much",
  "more",
  "most",
  "some",
  "any",
  "all",
  "no",
  "not",
]);

function tokenize(s: string): string[] {
  const matches: string[] = s.toLowerCase().match(/[a-z0-9']+/g) ?? [];
  return matches.filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/**
 * Find the segment whose token-overlap with the bullet is highest.
 * Returns -1 if no segment shares enough content (threshold ≥2 shared tokens).
 */
function findBestSegmentMatch(
  bullet: string,
  segments: TranscriptSegment[],
): number {
  const bulletTokens = new Set(tokenize(bullet));
  if (bulletTokens.size === 0) return -1;

  let bestIndex = -1;
  let bestScore = 0;
  segments.forEach((seg, i) => {
    const segTokens = tokenize(seg.text);
    let score = 0;
    for (const t of segTokens) if (bulletTokens.has(t)) score++;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  });
  return bestScore >= 2 ? bestIndex : -1;
}

interface BulletLinkProps {
  bullet: string;
  segments: TranscriptSegment[];
  onJumpTo: (segmentIndex: number) => void;
  children: React.ReactNode;
}

export function BulletLink({
  bullet,
  segments,
  onJumpTo,
  children,
}: BulletLinkProps) {
  const t = useT();
  const matchIndex = useMemo(
    () => findBestSegmentMatch(bullet, segments),
    [bullet, segments],
  );
  const hasMatch = matchIndex >= 0;
  const timestamp = hasMatch
    ? formatTranscriptTimestamp(segments[matchIndex]!.startMs)
    : null;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="group flex items-start gap-1.5">
        <div className="flex min-w-0 flex-1">{children}</div>
        {timestamp ? (
          <button
            type="button"
            onClick={() => onJumpTo(matchIndex)}
            aria-label={t("bulletLink.jumpToTranscript", { time: timestamp })}
            className={cn(
              "mt-0.5 inline-flex h-5 shrink-0 items-center rounded px-1 font-mono text-[10px] tabular-nums text-muted-foreground/80 opacity-0 transition-opacity",
              "group-hover:opacity-100 [@media(hover:none)]:opacity-100",
              "cursor-pointer hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            )}
          >
            {timestamp}
          </button>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                disabled
                aria-label={t("bulletLink.noMatchingMoment")}
                className="mt-0.5 inline-flex h-5 shrink-0 cursor-default items-center rounded px-1 font-mono text-[10px] tabular-nums text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100 [@media(hover:none)]:opacity-100"
              >
                --:--
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">
              {t("bulletLink.noMatchingMoment")}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
}
