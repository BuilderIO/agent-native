import { useMemo, useState } from "react";
import {
  IconSearch,
  IconCopy,
  IconDownload,
  IconCheck,
  IconExternalLink,
  IconKey,
  IconLoader2,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { msToClock } from "./scrubber";

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface TranscriptPanelProps {
  segments: TranscriptSegment[];
  currentMs: number;
  onSeek: (ms: number) => void;
  status?: "pending" | "ready" | "failed";
  failureReason?: string | null;
  recordingTitle?: string;
  /** Called when the user asks us to retry transcription after fixing an error. */
  onRetry?: () => void;
}

export function TranscriptPanel(props: TranscriptPanelProps) {
  const {
    segments,
    currentMs,
    onSeek,
    status,
    failureReason,
    recordingTitle,
    onRetry,
  } = props;
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);

  const filtered = useMemo(() => {
    if (!query.trim()) return segments;
    const q = query.toLowerCase();
    return segments.filter((s) => s.text.toLowerCase().includes(q));
  }, [segments, query]);

  const activeIndex = useMemo(
    () =>
      segments.findIndex((s) => currentMs >= s.startMs && currentMs <= s.endMs),
    [segments, currentMs],
  );

  function copyAll() {
    const text = segments.map((s) => s.text).join(" ");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function downloadSrt() {
    const srt = toSrt(segments);
    const blob = new Blob([srt], { type: "text/srt;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sanitizeFilename(recordingTitle ?? "transcript")}.srt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // When the pending row has sat there for a while with no progress AND we
  // already know the API key isn't configured, surface the key-setup card
  // instead of an infinite spinner. We detect "missing key" two ways: the
  // explicit failed-status path below, and — as a safety net — if status is
  // pending but the failureReason field on the row already says so (happens
  // when a prior run failed and the UI hasn't refreshed yet).
  const missingKey = isMissingApiKeyFailure(failureReason);

  if (status === "failed" && missingKey) {
    return <MissingOpenAiKeyCard onRetry={onRetry} />;
  }

  if (status === "pending") {
    return (
      <div className="p-4 text-sm text-muted-foreground flex items-start gap-2">
        <IconLoader2 className="h-4 w-4 animate-spin mt-0.5 shrink-0" />
        <div>
          <p>Transcribing…</p>
          <p className="text-xs mt-1">
            Whisper is analyzing this recording. This usually takes about as
            long as the video itself.
          </p>
        </div>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="p-4 space-y-3">
        <div className="text-sm text-red-600">
          Transcription failed: {failureReason ?? "Unknown error"}
        </div>
        {onRetry ? (
          <Button size="sm" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 p-3 border-b border-border">
        <div className="relative flex-1">
          <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search transcript"
            className="pl-8 h-8 text-xs"
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={copyAll}
          title="Copy transcript"
        >
          {copied ? (
            <IconCheck className="h-4 w-4 text-green-600" />
          ) : (
            <IconCopy className="h-4 w-4" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={downloadSrt}
          title="Download .srt"
        >
          <IconDownload className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            {query ? "No matches." : "No transcript yet."}
          </div>
        ) : (
          <ul className="py-1">
            {filtered.map((seg) => {
              const isActive = segments[activeIndex] === seg;
              return (
                <li key={seg.startMs}>
                  <button
                    onClick={() => onSeek(seg.startMs)}
                    className={cn(
                      "w-full text-left px-3 py-2 flex gap-3 items-start hover:bg-accent/50 transition-colors",
                      isActive && "bg-accent",
                    )}
                  >
                    <span className="text-[11px] text-muted-foreground font-mono tabular-nums pt-0.5 shrink-0">
                      {msToClock(seg.startMs)}
                    </span>
                    <span
                      className={cn(
                        "text-sm leading-relaxed",
                        isActive ? "text-foreground" : "text-foreground/80",
                      )}
                      dangerouslySetInnerHTML={{
                        __html: highlight(seg.text, query),
                      }}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function highlight(text: string, q: string): string {
  const escaped = text.replace(/[&<>]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;",
  );
  if (!q.trim()) return escaped;
  const safe = q.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  return escaped.replace(
    new RegExp(safe, "gi"),
    (match) =>
      `<mark class="bg-yellow-200 text-black rounded px-0.5">${match}</mark>`,
  );
}

function msToSrtTime(ms: number): string {
  const h = String(Math.floor(ms / 3600000)).padStart(2, "0");
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0");
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  const millis = String(ms % 1000).padStart(3, "0");
  return `${h}:${m}:${s},${millis}`;
}

function toSrt(segments: TranscriptSegment[]): string {
  return segments
    .map((seg, i) => {
      return `${i + 1}\n${msToSrtTime(seg.startMs)} --> ${msToSrtTime(
        seg.endMs,
      )}\n${seg.text}\n`;
    })
    .join("\n");
}

function sanitizeFilename(s: string): string {
  return s.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase();
}

function isMissingApiKeyFailure(reason: string | null | undefined): boolean {
  if (!reason) return false;
  const r = reason.toLowerCase();
  return (
    r.includes("openai_api_key") ||
    r.includes("api key") ||
    r.includes("not configured")
  );
}

/**
 * Inline card shown when transcription failed because no OpenAI API key is
 * configured. Posts to the framework's `/_agent-native/secrets/OPENAI_API_KEY`
 * endpoint — the same endpoint the sidebar settings Secrets section uses — so
 * the user can unblock captions without leaving the player.
 */
function MissingOpenAiKeyCard({ onRetry }: { onRetry?: () => void }) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  async function save() {
    if (!value.trim() || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/_agent-native/secrets/OPENAI_API_KEY", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: value.trim() }),
      });
      if (!res.ok) {
        const err = await res
          .json()
          .then((j: { error?: string }) => j.error)
          .catch(() => null);
        setToast({ kind: "err", text: err ?? `Save failed (${res.status})` });
        return;
      }
      setValue("");
      setToast({ kind: "ok", text: "Saved. Retrying transcription…" });
      // Kick the parent to refresh / retry once the key is saved.
      onRetry?.();
      setTimeout(() => setToast(null), 2500);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4">
      <div className="rounded-md border border-border bg-accent/30 p-3 space-y-3">
        <div className="flex items-start gap-2">
          <IconKey className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Transcription isn’t available</p>
            <p className="text-xs text-muted-foreground mt-1">
              Set your OpenAI API key to enable auto-captions, search, and AI
              summaries for this clip. Your key is stored encrypted and only you
              can use it.
            </p>
          </div>
        </div>
        <div className="flex gap-1.5">
          <Input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
            }}
            placeholder="sk-…"
            className="h-8 text-xs"
          />
          <Button size="sm" onClick={save} disabled={!value.trim() || saving}>
            {saving ? (
              <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              "Save key"
            )}
          </Button>
        </div>
        <div className="flex items-center justify-between gap-2">
          <a
            href="https://platform.openai.com/api-keys"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Get an API key
            <IconExternalLink className="h-3 w-3" />
          </a>
          <a
            href="#secrets:OPENAI_API_KEY"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Open settings
          </a>
        </div>
        {toast ? (
          <p
            className={cn(
              "text-xs",
              toast.kind === "ok" ? "text-green-600" : "text-red-600",
            )}
          >
            {toast.text}
          </p>
        ) : null}
      </div>
    </div>
  );
}
