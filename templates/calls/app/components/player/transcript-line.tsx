import { forwardRef, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  IconScissors,
  IconShare,
  IconCopy,
  IconMessage,
} from "@tabler/icons-react";
import { formatMs } from "@/lib/timestamp-format";
import type { TranscriptSegment, TrackerHit } from "@/../shared/api";
import type { SpeakerParticipant } from "./speaker-avatars";

export interface TranscriptLineProps {
  segment: TranscriptSegment;
  segmentIndex: number;
  participant?: SpeakerParticipant;
  isActive: boolean;
  isSelectedByUser?: boolean;
  highlightTerm?: string;
  activeMatchStart?: number | null;
  trackerHits?: TrackerHit[];
  onSeek: (ms: number) => void;
  onCreateSnippet?: () => void;
  onShareMoment?: () => void;
  onComment?: () => void;
  onCopyQuote?: () => void;
}

export const TranscriptLine = forwardRef<HTMLDivElement, TranscriptLineProps>(
  function TranscriptLine(props, ref) {
    const {
      segment,
      participant,
      isActive,
      isSelectedByUser,
      highlightTerm,
      activeMatchStart,
      trackerHits,
      onSeek,
      onCreateSnippet,
      onShareMoment,
      onComment,
      onCopyQuote,
    } = props;

    const textParts = useMemo(
      () =>
        renderWithHighlights(segment.text, highlightTerm, activeMatchStart),
      [segment.text, highlightTerm, activeMatchStart],
    );

    const displayName =
      participant?.displayName || segment.speakerLabel || "Unknown";
    const avatarColor = participant?.color;

    return (
      <div
        ref={ref}
        data-segment-start={segment.startMs}
        data-active={isActive || undefined}
        className={cn(
          "group relative flex gap-3 px-4 py-3 border-l-2 border-transparent",
          isActive && "bg-accent/60 border-foreground",
          isSelectedByUser && "bg-accent",
        )}
      >
        <Avatar className="h-8 w-8 shrink-0 mt-0.5">
          {participant?.avatarUrl ? (
            <AvatarImage src={participant.avatarUrl} />
          ) : null}
          <AvatarFallback
            className="text-[10px] font-semibold"
            style={
              avatarColor
                ? { backgroundColor: avatarColor, color: "#fff" }
                : undefined
            }
          >
            {initials(displayName)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-semibold text-foreground truncate">
              {displayName}
            </span>
            <button
              onClick={() => onSeek(segment.startMs)}
              className="text-[11px] font-mono text-muted-foreground hover:text-foreground"
            >
              {formatMs(segment.startMs)}
            </button>
            {participant?.isInternal === false ? (
              <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground border border-border rounded px-1 py-[1px]">
                Guest
              </span>
            ) : null}
          </div>
          <button
            onClick={() => onSeek(segment.startMs)}
            className="text-left text-sm leading-relaxed text-foreground/90 mt-0.5 block"
          >
            {textParts.map((p, i) =>
              p.type === "mark" ? (
                <mark
                  key={i}
                  className={cn(
                    "rounded px-0.5 bg-foreground/15 text-foreground",
                    p.active && "bg-foreground text-background",
                  )}
                >
                  {p.text}
                </mark>
              ) : (
                <span key={i}>{p.text}</span>
              ),
            )}
          </button>
          {trackerHits && trackerHits.length ? (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {trackerHits.map((h) => (
                <span
                  key={h.id}
                  className="text-[10px] rounded-full px-1.5 py-0.5 border border-border flex items-center gap-1"
                  title={h.quote}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: h.trackerColor || "#888" }}
                  />
                  <span className="font-medium">{h.trackerName}</span>
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <TooltipProvider delayDuration={300}>
          <div
            className="absolute top-2 right-3 flex items-center gap-0.5 opacity-0 group-hover:opacity-100"
            data-line-actions
          >
            {onCreateSnippet ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={onCreateSnippet}
                  >
                    <IconScissors className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Create snippet</TooltipContent>
              </Tooltip>
            ) : null}
            {onShareMoment ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={onShareMoment}
                  >
                    <IconShare className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Share moment</TooltipContent>
              </Tooltip>
            ) : null}
            {onComment ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={onComment}
                  >
                    <IconMessage className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Comment</TooltipContent>
              </Tooltip>
            ) : null}
            {onCopyQuote ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={onCopyQuote}
                  >
                    <IconCopy className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Copy quote</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        </TooltipProvider>
      </div>
    );
  },
);

interface TextPart {
  type: "text" | "mark";
  text: string;
  active?: boolean;
}

function renderWithHighlights(
  text: string,
  term: string | undefined,
  activeMatchStart: number | null | undefined,
): TextPart[] {
  const q = term?.trim().toLowerCase();
  if (!q) return [{ type: "text", text }];
  const lower = text.toLowerCase();
  const parts: TextPart[] = [];
  let idx = 0;
  while (idx < text.length) {
    const found = lower.indexOf(q, idx);
    if (found === -1) {
      parts.push({ type: "text", text: text.slice(idx) });
      break;
    }
    if (found > idx) parts.push({ type: "text", text: text.slice(idx, found) });
    parts.push({
      type: "mark",
      text: text.slice(found, found + q.length),
      active: activeMatchStart === found,
    });
    idx = found + q.length;
  }
  return parts;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}
