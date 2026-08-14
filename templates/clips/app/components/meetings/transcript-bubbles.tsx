import { useT } from "@agent-native/core/client/i18n";
import {
  IconChevronDown,
  IconChevronUp,
  IconNotes,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import type { KeyboardEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { TranscriptSegmentRow } from "../transcript/transcript-segment-row";
import {
  attendeeInitials,
  type AttendeeStackParticipant,
} from "./attendee-stack";

export interface TranscriptSegment {
  startMs: number;
  endMs?: number;
  text: string;
  speaker?: string | null;
  source?: "mic" | "system" | null;
}

interface TranscriptBubblesProps {
  segments: TranscriptSegment[];
  isLive: boolean;
  participants?: AttendeeStackParticipant[];
  ownerEmail?: string | null;
  /**
   * Imperative ref hook: parent can scroll a particular segment into view.
   * Receives a function (segmentIndex) => void.
   */
  registerScrollTo?: (fn: (segmentIndex: number) => void) => void;
  /** Rendered at the left of the header row. Omit for no title (the header
   * then shows only the search trigger, e.g. the compact share-page use). */
  title?: ReactNode;
  /** Rendered in the header, before the search trigger (e.g. a copy button). */
  headerActions?: ReactNode;
}

interface BubbleGroup {
  speaker: SpeakerIdentity;
  segments: { seg: TranscriptSegment; index: number }[];
}

interface SpeakerIdentity {
  key: string;
  label: string | null;
  initialsSource: AttendeeStackParticipant | string;
  isOwner: boolean;
  accentClass: string;
}

const SPEAKER_ACCENTS = [
  "bg-accent text-accent-foreground",
  "bg-secondary text-secondary-foreground",
  "bg-muted text-foreground",
] as const;

const OWNER_ACCENT = "bg-highlight/10 text-primary";

function normalizeSpeaker(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function findParticipant(
  speaker: string | null | undefined,
  participants: AttendeeStackParticipant[],
): AttendeeStackParticipant | undefined {
  const normalizedSpeaker = speaker ? normalizeSpeaker(speaker) : "";
  if (!normalizedSpeaker) return undefined;
  return participants.find((participant) => {
    const name = participant.name ? normalizeSpeaker(participant.name) : "";
    const email = normalizeSpeaker(participant.email);
    return normalizedSpeaker === name || normalizedSpeaker === email;
  });
}

function resolveParticipantForSpeaker(
  source: "mic" | "system",
  participants: AttendeeStackParticipant[],
  ownerEmail?: string | null,
): AttendeeStackParticipant | undefined {
  const ownerParticipant =
    (ownerEmail && findParticipant(ownerEmail, participants)) ||
    participants.find((participant) => participant.isOrganizer);

  if (source === "mic") return ownerParticipant;
  if (!ownerParticipant) return undefined;

  // Generic Them/System segments can only be resolved from meeting metadata
  // when there is exactly one possible remote participant. Do not guess in a
  // group meeting until transcript ingestion stores a stable speaker id.
  const otherParticipants = participants.filter(
    (participant) =>
      normalizeSpeaker(participant.email) !==
      normalizeSpeaker(ownerParticipant.email),
  );
  return otherParticipants.length === 1 ? otherParticipants[0] : undefined;
}

function accentForSpeaker(key: string, isOwner: boolean): string {
  if (isOwner) return OWNER_ACCENT;

  let hash = 0;
  for (const character of key) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  }
  return SPEAKER_ACCENTS[Math.abs(hash) % SPEAKER_ACCENTS.length];
}

function resolveSpeaker(
  segment: TranscriptSegment,
  participants: AttendeeStackParticipant[],
  ownerEmail?: string | null,
): SpeakerIdentity {
  const source = segment.source === "mic" ? "mic" : "system";
  const rawSpeaker = segment.speaker?.trim();
  const participant =
    findParticipant(segment.speaker, participants) ||
    resolveParticipantForSpeaker(source, participants, ownerEmail);
  const participantName = participant?.name?.trim();
  const resolvedLabel = participantName || rawSpeaker;
  // Some providers (and our own seed fixture) tag unresolved segments with a
  // literal placeholder word instead of leaving speaker blank. Treat those the
  // same as "no label" on both sides so the UI falls back to the translated
  // Me/Them string instead of rendering the raw English placeholder verbatim.
  const isGenericPlaceholderLabel =
    !!resolvedLabel &&
    (source === "mic"
      ? /^(me|self|you)$/i.test(resolvedLabel)
      : /^them$/i.test(resolvedLabel));
  const label = isGenericPlaceholderLabel
    ? null
    : participantName || rawSpeaker || null;
  const key =
    source === "mic"
      ? source
      : participant?.email ||
        (rawSpeaker ? `speaker:${normalizeSpeaker(rawSpeaker)}` : source);

  return {
    key,
    label,
    initialsSource: participant ?? label ?? (source === "mic" ? "Me" : "Them"),
    isOwner: source === "mic",
    accentClass: accentForSpeaker(key, source === "mic"),
  };
}

// Splits `text` into plain/matched runs for a case-insensitive substring
// highlight. Returns the original text as a single run when there's no query
// or no match, so callers can render uniformly either way.
function highlightRuns(
  text: string,
  query: string,
): Array<{ text: string; match: boolean }> {
  if (!query) return [{ text, match: false }];
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  const runs: Array<{ text: string; match: boolean }> = [];
  let cursor = 0;
  while (cursor < text.length) {
    const at = lower.indexOf(needle, cursor);
    if (at === -1) {
      runs.push({ text: text.slice(cursor), match: false });
      break;
    }
    if (at > cursor) runs.push({ text: text.slice(cursor, at), match: false });
    runs.push({ text: text.slice(at, at + needle.length), match: true });
    cursor = at + needle.length;
  }
  return runs.length ? runs : [{ text, match: false }];
}

function groupConsecutive(
  segments: TranscriptSegment[],
  participants: AttendeeStackParticipant[],
  ownerEmail?: string | null,
): BubbleGroup[] {
  const groups: BubbleGroup[] = [];
  segments.forEach((seg, index) => {
    const speaker = resolveSpeaker(seg, participants, ownerEmail);
    const last = groups[groups.length - 1];
    if (last && last.speaker.key === speaker.key) {
      last.segments.push({ seg, index });
    } else {
      groups.push({ speaker, segments: [{ seg, index }] });
    }
  });
  return groups;
}

export function TranscriptBubbles({
  segments,
  isLive,
  participants = [],
  ownerEmail,
  registerScrollTo,
  title,
  headerActions,
}: TranscriptBubblesProps) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const liveEndRef = useRef<HTMLDivElement>(null);
  const userPausedRef = useRef(false);
  const segmentRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const flashTimeoutRef = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [matchCursor, setMatchCursor] = useState(0);
  const [keyboardSegmentIndex, setKeyboardSegmentIndex] = useState(0);
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(null);

  const groups = useMemo(
    () => groupConsecutive(segments, participants, ownerEmail),
    [segments, participants, ownerEmail],
  );

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const matchIndexes = useMemo(() => {
    if (!normalizedQuery) return [];
    const out: number[] = [];
    segments.forEach((seg, index) => {
      if (seg.text.toLowerCase().includes(normalizedQuery)) out.push(index);
    });
    return out;
  }, [segments, normalizedQuery]);

  // Keep the cursor in range as matches change (typing narrows the set).
  useEffect(() => {
    setMatchCursor(0);
  }, [normalizedQuery]);

  const scrollToSegmentRef = useRef<((segmentIndex: number) => void) | null>(
    null,
  );

  // Only scroll when the resolved target actually changes — during a live
  // meeting the segments array (and thus matchIndexes) gets a new identity on
  // every poll, and re-scrolling each time would fight the user's scrolling.
  const lastSearchScrollRef = useRef<string | null>(null);
  useEffect(() => {
    if (!normalizedQuery || !matchIndexes.length) {
      lastSearchScrollRef.current = null;
      return;
    }
    const target = matchIndexes[matchCursor % matchIndexes.length];
    const scrollKey = `${normalizedQuery}:${target}`;
    if (lastSearchScrollRef.current === scrollKey) return;
    lastSearchScrollRef.current = scrollKey;
    scrollToSegmentRef.current?.(target);
  }, [normalizedQuery, matchIndexes, matchCursor]);

  useEffect(() => {
    if (searchOpen) {
      const raf = requestAnimationFrame(() => searchInputRef.current?.focus());
      return () => cancelAnimationFrame(raf);
    }
  }, [searchOpen]);

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery("");
  };

  const goToMatch = (dir: 1 | -1) => {
    if (!matchIndexes.length) return;
    setMatchCursor(
      (prev) => (prev + dir + matchIndexes.length) % matchIndexes.length,
    );
  };

  const focusSegment = (index: number) => {
    const nextIndex = Math.max(0, Math.min(index, segments.length - 1));
    setKeyboardSegmentIndex(nextIndex);
    segmentRefs.current[nextIndex]?.focus();
  };

  const handleSegmentKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    index: number,
  ) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusSegment(index + (event.key === "ArrowDown" ? 1 : -1));
    }
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = () => {
      const distanceFromBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight;
      userPausedRef.current = distanceFromBottom > 80;
    };
    el.addEventListener("scroll", handler, { passive: true });
    return () => el.removeEventListener("scroll", handler);
  }, []);

  useEffect(() => {
    if (isLive && !userPausedRef.current) {
      liveEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [isLive, segments.length]);

  // Shared scroll-and-flash, used by both the parent's bullet-jump wiring
  // (registerScrollTo) and in-panel search navigation below. Highlight state
  // lives in React (not classList) so TranscriptSegmentRow can suppress its
  // own hover styling while the flash is active — see `highlighted` there.
  const scrollToAndFlash = useRef((segmentIndex: number) => {
    const node = segmentRefs.current[segmentIndex];
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedIndex(segmentIndex);
    if (flashTimeoutRef.current) window.clearTimeout(flashTimeoutRef.current);
    flashTimeoutRef.current = window.setTimeout(() => {
      setHighlightedIndex(null);
    }, 1500);
  }).current;

  useEffect(() => {
    scrollToSegmentRef.current = scrollToAndFlash;
  }, [scrollToAndFlash]);

  useEffect(() => {
    if (!registerScrollTo) return;
    registerScrollTo(scrollToAndFlash);
  }, [registerScrollTo, scrollToAndFlash]);

  useEffect(() => {
    return () => {
      if (flashTimeoutRef.current) window.clearTimeout(flashTimeoutRef.current);
    };
  }, []);

  if (segments.length === 0) {
    if (isLive) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center text-sm text-muted-foreground gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
          </span>
          {t("transcriptBubbles.listening")}
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center h-full text-center text-sm text-muted-foreground gap-2 px-6">
        <IconNotes className="h-6 w-6 text-muted-foreground/50" />
        <span>{t("transcriptBubbles.noTranscript")}</span>
        <span className="text-xs">
          {t("transcriptBubbles.liveTranscriptDescription")}
        </span>
      </div>
    );
  }

  const activeMatchIndex = matchIndexes.length
    ? matchIndexes[matchCursor % matchIndexes.length]
    : null;

  return (
    <div className="flex h-full flex-col">
      {/* Primary header — title/actions never get displaced by search, so the
          panel's identity stays put and this row's height always matches
          sibling panels. The search UI is a second row that only exists
          while search is actually open, not permanent chrome. */}
      <div
        className={cn(
          "flex h-11 shrink-0 items-center gap-1.5 px-4",
          // Only the last header row gets the divider below it — when
          // search is open that's the search row, not this one, so the two
          // read as one frame instead of stacked, separate boxes.
          !searchOpen && "border-b border-border",
        )}
      >
        <div className="flex flex-1 items-center gap-1.5 text-xs font-medium">
          {title}
        </div>
        {headerActions}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              aria-pressed={searchOpen}
              className={cn(
                "h-7 w-7 shrink-0 cursor-pointer",
                searchOpen && "bg-accent",
              )}
              aria-label={
                searchOpen
                  ? t("transcriptBubbles.searchClose")
                  : t("transcriptBubbles.searchTranscript")
              }
              // Without this, clicking here while the input is focused blurs
              // it first (onBlur may already auto-close on an empty query),
              // then this handler runs against state that just changed out
              // from under it — sometimes reopening what onBlur just closed.
              // Keeping focus on the input means blur never fires from this
              // click at all, so there's nothing left to race.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
            >
              <IconSearch className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {searchOpen
              ? t("transcriptBubbles.searchClose")
              : t("transcriptBubbles.searchTranscript")}
          </TooltipContent>
        </Tooltip>
      </div>

      {searchOpen && (
        <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-4 py-1.5">
          <Input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                closeSearch();
              } else if (e.key === "Enter") {
                e.preventDefault();
                goToMatch(e.shiftKey ? -1 : 1);
              }
            }}
            onBlur={() => {
              if (!searchQuery.trim()) closeSearch();
            }}
            placeholder={t("transcriptBubbles.searchPlaceholder")}
            className="h-7 flex-1 text-xs"
          />
          {normalizedQuery && (
            <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
              {matchIndexes.length > 0
                ? t("transcriptBubbles.searchMatchCount", {
                    current: (matchCursor % matchIndexes.length) + 1,
                    total: matchIndexes.length,
                  })
                : t("transcriptBubbles.searchNoMatches")}
            </span>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0 cursor-pointer"
            disabled={!matchIndexes.length}
            aria-label={t("transcriptBubbles.searchPrevMatch")}
            onClick={() => goToMatch(-1)}
          >
            <IconChevronUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0 cursor-pointer"
            disabled={!matchIndexes.length}
            aria-label={t("transcriptBubbles.searchNextMatch")}
            onClick={() => goToMatch(1)}
          >
            <IconChevronDown className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0 cursor-pointer"
            aria-label={t("transcriptBubbles.searchClose")}
            onClick={closeSearch}
          >
            <IconX className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
      <div ref={containerRef} className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-3xl space-y-4">
          {groups.map((group, gi) => {
            return (
              <section
                key={`${group.speaker.key}:${gi}`}
                className="space-y-0.5"
              >
                <div className="flex h-6 items-center gap-2">
                  <Avatar
                    className={cn("size-6 shrink-0", group.speaker.accentClass)}
                  >
                    <AvatarFallback
                      className={cn(
                        "text-[9px] font-semibold",
                        group.speaker.accentClass,
                      )}
                    >
                      {attendeeInitials(group.speaker.initialsSource)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex min-h-6 items-center">
                    <span
                      className={cn(
                        "text-xs font-semibold leading-6",
                        group.speaker.isOwner
                          ? "text-primary"
                          : "text-foreground",
                      )}
                    >
                      {group.speaker.label ||
                        (group.speaker.isOwner
                          ? t("transcriptBubbles.me")
                          : t("transcriptBubbles.them"))}
                    </span>
                  </div>
                </div>
                <div className="space-y-1">
                  {group.segments.map(({ seg, index }) => {
                    return (
                      <TranscriptSegmentRow
                        key={index}
                        startMs={seg.startMs}
                        highlighted={index === highlightedIndex}
                        tabIndex={index === keyboardSegmentIndex ? 0 : -1}
                        onKeyDown={(event) =>
                          handleSegmentKeyDown(event, index)
                        }
                        segmentRef={(el) => {
                          segmentRefs.current[index] = el;
                        }}
                        className="hover:bg-accent/30"
                      >
                        {normalizedQuery
                          ? highlightRuns(seg.text, normalizedQuery).map(
                              (run, ri) =>
                                run.match ? (
                                  <mark
                                    key={ri}
                                    className={cn(
                                      "rounded-sm bg-yellow-400/70 text-foreground",
                                      index === activeMatchIndex &&
                                        "bg-yellow-400 ring-1 ring-yellow-600",
                                    )}
                                  >
                                    {run.text}
                                  </mark>
                                ) : (
                                  <span key={ri}>{run.text}</span>
                                ),
                            )
                          : seg.text}
                      </TranscriptSegmentRow>
                    );
                  })}
                </div>
              </section>
            );
          })}
          <div ref={liveEndRef} />
        </div>
      </div>
    </div>
  );
}
