import { useMemo, useState } from "react";
import {
  IconSearch,
  IconCopy,
  IconDownload,
  IconCheck,
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
}

export function TranscriptPanel(props: TranscriptPanelProps) {
  const { segments, currentMs, onSeek, status, failureReason, recordingTitle } =
    props;
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

  if (status === "pending") {
    return (
      <div className="p-4 text-sm text-muted-foreground">Transcribing…</div>
    );
  }

  if (status === "failed") {
    return (
      <div className="p-4 text-sm text-red-600">
        Transcription failed: {failureReason ?? "Unknown error"}
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
