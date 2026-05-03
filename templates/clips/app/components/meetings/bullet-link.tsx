import { useMemo } from "react";
import { IconSearch } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  return (s.toLowerCase().match(/[a-z0-9']+/g) ?? []).filter(
    (t) => t.length > 2 && !STOPWORDS.has(t),
  );
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
  const matchIndex = useMemo(
    () => findBestSegmentMatch(bullet, segments),
    [bullet, segments],
  );
  const hasMatch = matchIndex >= 0;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="group flex items-start gap-1.5">
        <div className="flex-1 min-w-0">{children}</div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              disabled={!hasMatch}
              onClick={() => hasMatch && onJumpTo(matchIndex)}
              aria-label={
                hasMatch ? "Jump to transcript moment" : "No matching moment"
              }
              className={cn(
                "shrink-0 mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded transition-opacity",
                hasMatch
                  ? "opacity-0 group-hover:opacity-50 hover:!opacity-100 hover:bg-accent text-muted-foreground hover:text-foreground cursor-pointer"
                  : "opacity-0 group-hover:opacity-30 text-muted-foreground/50 cursor-default",
              )}
            >
              <IconSearch className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">
            {hasMatch ? "Jump to transcript" : "No matching moment found"}
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
