import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  IconPlayerPlay,
  IconPlayerPause,
  IconPlayerSkipBack,
  IconPlayerSkipForward,
  IconVolume,
  IconVolumeOff,
  IconShare,
  IconScissors,
  IconBadgeCc,
  IconMessage,
} from "@tabler/icons-react";
import {
  useActionMutation,
  AgentToggleButton,
} from "@agent-native/core/client";
import { formatMs } from "@/lib/timestamp-format";
import { useCallPlayer } from "@/hooks/use-call-player";
import { useTalkTracks } from "@/hooks/use-talk-tracks";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";

import { TranscriptPane } from "./transcript-pane";
import { AiSummaryPanel } from "./ai-summary-panel";
import { PoiTabs, type PoiTab } from "./poi-tabs";
import { StatsRail } from "./stats-rail";
import { SpeakerAvatars, type SpeakerParticipant } from "./speaker-avatars";
import { TalkTracks } from "./talk-tracks";
import { Waveform } from "./waveform";
import { ChaptersRail, type Chapter } from "./chapters-rail";
import { CommentRail, type CommentRow } from "./comment-rail";
import { SnippetDialog } from "./snippet-dialog";
import { ShareDialog } from "./share-dialog";

import type { CallSummary, TranscriptSegment, TrackerHit } from "@shared/api";

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export interface CallPlayerCall {
  id: string;
  title: string;
  description?: string | null;
  durationMs: number;
  mediaUrl?: string | null;
  mediaKind?: "video" | "audio" | string;
  thumbnailUrl?: string | null;
  status?: string;
  accountId?: string | null;
  accountName?: string | null;
  dealStage?: string | null;
  dealStageLabel?: string | null;
  defaultSpeed?: number;
  enableComments?: boolean;
  createdAt?: string;
  password?: string | null;
  expiresAt?: string | null;
  shareIncludesSummary?: boolean;
  shareIncludesTranscript?: boolean;
  chapters?: Chapter[];
}

export interface CallPlayerData {
  call: CallPlayerCall;
  transcript: {
    status?: "pending" | "ready" | "failed";
    failureReason?: string | null;
    language?: string;
    segments: TranscriptSegment[];
    fullText?: string;
  };
  summary: CallSummary | null;
  participants: SpeakerParticipant[];
  trackerHits: TrackerHit[];
  tags?: string[];
  comments?: CommentRow[];
  snippets?: Array<{
    id: string;
    title: string;
    startMs: number;
    endMs: number;
  }>;
  currentUserEmail?: string;
}

export interface CallPlayerProps {
  data: CallPlayerData;
  onRefetch?: () => void;
  className?: string;
  initialSpeed?: number;
  startMs?: number;
  boundsMs?: { startMs: number; endMs: number };
  compact?: boolean;
  readonly?: boolean;
  autoPlay?: boolean;
  muted?: boolean;
  hideSummary?: boolean;
  hideTranscript?: boolean;
  onEvent?: (type: string, payload?: unknown) => void;
}

export function CallPlayer({
  data,
  onRefetch,
  className,
  initialSpeed,
  startMs,
  boundsMs,
  compact,
  readonly,
  autoPlay,
  muted,
  hideSummary,
  hideTranscript,
  onEvent,
}: CallPlayerProps) {
  void initialSpeed;
  void startMs;
  void boundsMs;
  void compact;
  void readonly;
  void autoPlay;
  void muted;
  void hideSummary;
  void hideTranscript;
  void onEvent;
  const navigate = useNavigate();
  const mediaRef = useRef<HTMLVideoElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const {
    call,
    transcript,
    summary,
    participants,
    trackerHits,
    comments = [],
    currentUserEmail,
  } = data;

  const player = useCallPlayer({
    mediaRef,
    durationMs: call.durationMs,
    defaultSpeed: call.defaultSpeed ?? 1,
    callId: call.id,
  });

  const trackerHitsBySegment = useMemo(() => {
    const map: Record<number, TrackerHit[]> = {};
    const segments = transcript.segments;
    for (const h of trackerHits) {
      let idx = segments.findIndex(
        (s) => s.startMs <= h.segmentStartMs && s.endMs >= h.segmentStartMs,
      );
      if (idx === -1) {
        for (let i = 0; i < segments.length; i++) {
          if (segments[i].startMs > h.segmentStartMs) {
            idx = Math.max(0, i - 1);
            break;
          }
        }
      }
      if (idx === -1 && segments.length) idx = segments.length - 1;
      if (idx < 0) continue;
      (map[idx] ||= []).push(h);
    }
    return map;
  }, [trackerHits, transcript.segments]);

  const tracks = useTalkTracks(transcript.segments, call.durationMs);

  const totalQuestions = useMemo(
    () =>
      summary?.questions?.length ??
      participants.reduce(
        (acc, p) =>
          acc +
          ((p as SpeakerParticipant & { questionsCount?: number })
            .questionsCount ?? 0),
        0,
      ),
    [summary, participants],
  );

  const totalInterruptions = useMemo(
    () =>
      participants.reduce(
        (acc, p) =>
          acc +
          ((p as SpeakerParticipant & { interruptionsCount?: number })
            .interruptionsCount ?? 0),
        0,
      ),
    [participants],
  );

  const [snippetOpen, setSnippetOpen] = useState(false);
  const [snippetRange, setSnippetRange] = useState<{
    startMs: number;
    endMs: number;
    title?: string;
    text?: string;
  }>({ startMs: 0, endMs: 0 });
  const [shareOpen, setShareOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(call.title);
  const [poiTab, setPoiTab] = useState<PoiTab>("questions");
  const [showTranscript, setShowTranscript] = useState(true);
  const [showSummary, setShowSummary] = useState(true);

  const updateCall = useActionMutation("update-call", {
    onSuccess: () => onRefetch?.(),
  });

  function openSnippet(seg?: TranscriptSegment) {
    const startMs = seg ? seg.startMs : Math.max(0, player.currentMs - 5000);
    const endMs = seg
      ? seg.endMs
      : Math.min(call.durationMs, player.currentMs + 15000);
    setSnippetRange({
      startMs,
      endMs,
      title: undefined,
      text: seg?.text,
    });
    setSnippetOpen(true);
  }

  function shareMoment(seg?: TranscriptSegment) {
    if (seg)
      navigate(`?t=${Math.floor(seg.startMs / 1000)}`, { replace: true });
    setShareOpen(true);
  }

  useKeyboardShortcuts({
    Space: () => player.toggle(),
    j: () => player.skip(-10000),
    k: () => player.toggle(),
    l: () => player.skip(10000),
    "/": () => searchInputRef.current?.focus(),
    i: () => setSnippetRange((r) => ({ ...r, startMs: player.currentMs })),
    o: () => setSnippetRange((r) => ({ ...r, endMs: player.currentMs })),
    Enter: () => {
      if (snippetRange.endMs > snippetRange.startMs) setSnippetOpen(true);
    },
    t: () => setShowTranscript((v) => !v),
    s: () => setShowSummary((v) => !v),
    "1": () => setPoiTab("questions"),
    "2": () => setPoiTab("trackers"),
    "3": () => setPoiTab("actions"),
    "4": () => setPoiTab("filler"),
    Escape: () => {
      if (commentsOpen) setCommentsOpen(false);
      else if (shareOpen) setShareOpen(false);
      else if (snippetOpen) setSnippetOpen(false);
    },
    "g l": () => navigate("/library"),
    "g s": () => navigate("/search"),
  });

  function saveTitle() {
    const next = titleDraft.trim();
    setTitleEditing(false);
    if (next && next !== call.title) {
      updateCall.mutate({ id: call.id, title: next } as any);
    } else {
      setTitleDraft(call.title);
    }
  }

  return (
    <div
      className={cn(
        "flex flex-col min-h-screen bg-background text-foreground",
        className,
      )}
    >
      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
        <div className="px-5 py-3 flex items-center gap-3">
          <div className="flex-1 min-w-0 flex items-center gap-2">
            {titleEditing ? (
              <Input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={saveTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveTitle();
                  if (e.key === "Escape") {
                    setTitleDraft(call.title);
                    setTitleEditing(false);
                  }
                }}
                className="h-8 text-base font-semibold max-w-2xl"
              />
            ) : (
              <button
                onClick={() => setTitleEditing(true)}
                className="truncate text-base font-semibold text-left hover:bg-accent rounded px-1 -mx-1"
                title="Click to rename"
              >
                {call.title}
              </button>
            )}
            {call.accountName ? (
              <span className="text-xs text-muted-foreground border border-border rounded-full px-2 py-0.5 truncate max-w-[160px]">
                {call.accountName}
              </span>
            ) : null}
            {call.createdAt ? (
              <span className="text-xs text-muted-foreground">
                {new Date(call.createdAt).toLocaleDateString()}
              </span>
            ) : null}
            <span className="text-xs text-muted-foreground font-mono">
              {formatMs(call.durationMs)}
            </span>
          </div>
          <ShareDialog
            resourceType="call"
            resourceId={call.id}
            title={call.title}
            open={shareOpen}
            onOpenChange={setShareOpen}
            password={call.password}
            expiresAt={call.expiresAt}
            shareIncludesSummary={call.shareIncludesSummary}
            shareIncludesTranscript={call.shareIncludesTranscript}
          >
            <Button size="sm" variant="outline" className="gap-2">
              <IconShare className="h-4 w-4" />
              Share
            </Button>
          </ShareDialog>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => openSnippet()}
            className="gap-2"
          >
            <IconScissors className="h-4 w-4" />
            Snippet
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setCommentsOpen((v) => !v)}
            className="gap-2"
          >
            <IconMessage className="h-4 w-4" />
            Comments
          </Button>
          <AgentToggleButton className="h-8 w-8 rounded-md hover:bg-accent" />
        </div>
      </header>

      <main
        className={cn(
          "flex-1 grid gap-0 min-h-0",
          commentsOpen
            ? "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_320px]"
            : "grid-cols-[minmax(0,7fr)_minmax(0,5fr)]",
        )}
        style={{
          gridTemplateColumns: commentsOpen
            ? undefined
            : showTranscript
              ? "minmax(0,7fr) minmax(0,5fr)"
              : "0fr minmax(0,1fr)",
        }}
      >
        {/* Left column: transcript */}
        {showTranscript ? (
          <section className="min-w-0 border-r border-border flex flex-col">
            <TranscriptPane
              segments={transcript.segments}
              participants={participants}
              currentMs={player.currentMs}
              onSeek={player.seek}
              trackerHitsBySegment={trackerHitsBySegment}
              onCreateSnippet={(seg) => openSnippet(seg)}
              onShareMoment={(seg) => shareMoment(seg)}
              onComment={() => setCommentsOpen(true)}
              searchInputRef={searchInputRef}
              status={transcript.status}
              failureReason={transcript.failureReason}
              className="flex-1 min-h-0"
            />
          </section>
        ) : null}

        {/* Right column: media + panels */}
        <section className="min-w-0 flex flex-col min-h-0 overflow-y-auto">
          <div className="p-4 space-y-3">
            <div className="rounded-lg overflow-hidden bg-black aspect-video relative">
              {call.mediaUrl ? (
                call.mediaKind === "audio" ? (
                  <audio
                    ref={mediaRef as any}
                    src={call.mediaUrl}
                    className="w-full"
                    preload="metadata"
                  />
                ) : (
                  <video
                    ref={mediaRef}
                    src={call.mediaUrl}
                    poster={call.thumbnailUrl ?? undefined}
                    className="w-full h-full object-contain"
                    playsInline
                  />
                )
              ) : (
                <div className="flex items-center justify-center w-full h-full text-white/50 text-sm">
                  No media available
                </div>
              )}
            </div>

            <SpeakerAvatars
              callId={call.id}
              participants={participants}
              onRefetch={onRefetch}
            />

            <div className="space-y-2">
              <Waveform
                callId={call.id}
                durationMs={call.durationMs}
                currentMs={player.currentMs}
                onSeek={player.seek}
              />
              {call.chapters?.length ? (
                <ChaptersRail
                  chapters={call.chapters}
                  durationMs={call.durationMs}
                  currentMs={player.currentMs}
                  onSeek={player.seek}
                />
              ) : null}
              <TalkTracks
                tracks={tracks}
                participants={participants}
                durationMs={call.durationMs}
                currentMs={player.currentMs}
                onSeek={player.seek}
              />
            </div>

            <TransportControls
              playing={player.playing}
              currentMs={player.currentMs}
              durationMs={call.durationMs}
              speed={player.speed}
              muted={player.muted}
              captionsOn={player.captionsOn}
              onToggle={player.toggle}
              onSkip={player.skip}
              onSpeedChange={player.setSpeed}
              onToggleMute={player.toggleMute}
              onToggleCaptions={player.toggleCaptions}
            />
          </div>

          {showSummary ? (
            <div className="px-4 pb-4">
              <AiSummaryPanel
                callId={call.id}
                summary={summary}
                onSeek={player.seek}
                onRefetch={onRefetch}
              />
            </div>
          ) : null}

          <div className="px-4 pb-4">
            <div className="rounded-lg border border-border bg-card flex flex-col min-h-[260px]">
              <div className="px-4 py-3 border-b border-border">
                <h3 className="text-sm font-semibold tracking-tight">
                  Points of interest
                </h3>
              </div>
              <div className="p-3 flex-1">
                <PoiTabs
                  summary={summary}
                  trackerHits={trackerHits}
                  onSeek={player.seek}
                  value={poiTab}
                  onValueChange={setPoiTab}
                />
              </div>
            </div>
          </div>

          <div className="px-4 pb-6">
            <StatsRail
              participants={participants}
              durationMs={call.durationMs}
              questionsCount={totalQuestions}
              interruptionsCount={totalInterruptions}
            />
          </div>
        </section>

        {/* Comment rail */}
        {commentsOpen ? (
          <aside className="min-w-0">
            <CommentRail
              callId={call.id}
              comments={comments}
              currentMs={player.currentMs}
              currentUserEmail={currentUserEmail}
              enableComments={call.enableComments ?? true}
              open={true}
              onOpenChange={setCommentsOpen}
              onSeek={player.seek}
              onRefetch={onRefetch}
              className="h-full"
            />
          </aside>
        ) : null}
      </main>

      <SnippetDialog
        callId={call.id}
        mediaUrl={call.mediaUrl}
        durationMs={call.durationMs}
        initialStartMs={snippetRange.startMs}
        initialEndMs={snippetRange.endMs}
        initialTitle={snippetRange.title}
        initialText={snippetRange.text}
        open={snippetOpen}
        onOpenChange={setSnippetOpen}
      />
    </div>
  );
}

function TransportControls({
  playing,
  currentMs,
  durationMs,
  speed,
  muted,
  captionsOn,
  onToggle,
  onSkip,
  onSpeedChange,
  onToggleMute,
  onToggleCaptions,
}: {
  playing: boolean;
  currentMs: number;
  durationMs: number;
  speed: number;
  muted: boolean;
  captionsOn: boolean;
  onToggle: () => void;
  onSkip: (deltaMs: number) => void;
  onSpeedChange: (speed: number) => void;
  onToggleMute: () => void;
  onToggleCaptions: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Skip back 10 seconds"
        onClick={() => onSkip(-10000)}
      >
        <IconPlayerSkipBack className="h-4 w-4" />
      </Button>
      <Button
        size="icon"
        aria-label={playing ? "Pause" : "Play"}
        onClick={onToggle}
      >
        {playing ? (
          <IconPlayerPause className="h-4 w-4" />
        ) : (
          <IconPlayerPlay className="h-4 w-4" />
        )}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Skip forward 10 seconds"
        onClick={() => onSkip(10000)}
      >
        <IconPlayerSkipForward className="h-4 w-4" />
      </Button>
      <div className="text-xs font-mono text-muted-foreground tabular-nums ml-1">
        {formatMs(currentMs)} / {formatMs(durationMs)}
      </div>
      <div className="flex-1" />
      <Button
        variant="ghost"
        size="icon"
        onClick={onToggleCaptions}
        title="Toggle captions"
      >
        <IconBadgeCc className={cn("h-4 w-4", !captionsOn && "opacity-40")} />
      </Button>
      <Button variant="ghost" size="icon" onClick={onToggleMute} title="Mute">
        {muted ? (
          <IconVolumeOff className="h-4 w-4" />
        ) : (
          <IconVolume className="h-4 w-4" />
        )}
      </Button>
      <Select
        value={String(speed)}
        onValueChange={(v) => onSpeedChange(Number(v))}
      >
        <SelectTrigger className="text-xs h-8 w-[4.5rem]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SPEED_OPTIONS.map((s) => (
            <SelectItem key={s} value={String(s)}>
              {s}x
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
