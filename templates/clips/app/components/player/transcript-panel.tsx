import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconSearch,
  IconCopy,
  IconDownload,
  IconCheck,
  IconExternalLink,
  IconKey,
  IconLoader2,
  IconBolt,
  IconChevronDown,
  IconChevronUp,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { msToClock } from "./scrubber";
import { agentNativePath } from "@agent-native/core/client";

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

  // Surface the setup card when transcription failed due to a provider
  // configuration issue — missing key, quota error, rejected key, etc.
  // Builder connection is the recommended fix in all these cases.
  const needsSetup = isTranscriptionSetupNeeded(failureReason);

  if (status === "failed" && needsSetup) {
    return (
      <TranscriptSetupCard failureReason={failureReason} onRetry={onRetry} />
    );
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
        <div className="text-sm text-destructive">
          Transcription failed: {failureReason ?? "Unknown error"}
        </div>
        <div className="flex items-center gap-2">
          {onRetry ? (
            <Button size="sm" variant="outline" onClick={onRetry}>
              Retry
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              window.open(
                new URL(
                  agentNativePath("/_agent-native/builder/connect"),
                  window.location.origin,
                ).toString(),
                "_blank",
                "noopener,noreferrer",
              );
            }}
            className="inline-flex items-center gap-1.5"
          >
            <IconBolt className="h-3.5 w-3.5" />
            Connect Builder.io
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Builder.io provides free transcription — no API key needed.
        </p>
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
                      "w-full text-left px-3 py-2 flex gap-3 items-start hover:bg-accent/50",
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

/**
 * Returns true when the transcription failure is due to a provider
 * configuration problem — missing key, quota exceeded, key rejected,
 * no provider at all. Builder connection fixes all of these.
 */
function isTranscriptionSetupNeeded(
  reason: string | null | undefined,
): boolean {
  if (!reason) return false;
  const r = reason.toLowerCase();
  return (
    r.includes("openai_api_key") ||
    r.includes("groq_api_key") ||
    r.includes("api key") ||
    r.includes("not configured") ||
    r.includes("no transcription") ||
    r.includes("quota") ||
    r.includes("rate limit") ||
    r.includes("rejected the api key") ||
    r.includes("connect builder")
  );
}

/**
 * Inline card shown when transcription needs a provider set up.
 *
 * Builder.io is the primary/recommended path — free, one-click, no separate
 * API key required (uses BUILDER_PRIVATE_KEY once the user connects).
 * BYOK (Groq preferred, OpenAI fallback) is the secondary option.
 */
function TranscriptSetupCard({
  failureReason,
  onRetry,
}: {
  failureReason?: string | null;
  onRetry?: () => void;
}) {
  const [builderConfigured, setBuilderConfigured] = useState<boolean | null>(
    null,
  );
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const [showByok, setShowByok] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveToast, setSaveToast] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    fetch(agentNativePath("/_agent-native/builder/status"))
      .then((r) =>
        r.ok ? (r.json() as Promise<{ configured: boolean }>) : null,
      )
      .then((s) => {
        if (mountedRef.current) setBuilderConfigured(s?.configured ?? false);
      })
      .catch(() => {
        if (mountedRef.current) setBuilderConfigured(false);
      });
    return () => {
      mountedRef.current = false;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleConnect = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    setConnecting(true);
    setConnectError(null);

    window.open(
      new URL(
        agentNativePath("/_agent-native/builder/connect"),
        window.location.origin,
      ).toString(),
      "_blank",
      "noopener,noreferrer",
    );

    const start = Date.now();
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(agentNativePath("/_agent-native/builder/status"));
        if (!r.ok) return;
        const s = (await r.json()) as { configured: boolean };
        if (!mountedRef.current) {
          clearInterval(pollRef.current!);
          return;
        }
        if (s.configured) {
          clearInterval(pollRef.current!);
          setBuilderConfigured(true);
          setConnecting(false);
          onRetry?.();
        } else if (Date.now() - start > 5 * 60 * 1000) {
          clearInterval(pollRef.current!);
          setConnecting(false);
          setConnectError(
            "Didn't hear back from Builder. Allow popups and try again.",
          );
        }
      } catch {
        // transient poll error — keep trying
      }
    }, 2000);
  }, [onRetry]);

  async function saveApiKey() {
    if (!apiKey.trim() || saving) return;
    setSaving(true);
    try {
      // Route gsk_… to GROQ_API_KEY (faster, preferred), else OPENAI_API_KEY
      const secretKey = apiKey.trim().startsWith("gsk_")
        ? "GROQ_API_KEY"
        : "OPENAI_API_KEY";
      const res = await fetch(
        agentNativePath(`/_agent-native/secrets/${secretKey}`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: apiKey.trim() }),
        },
      );
      if (!res.ok) {
        const err = await res
          .json()
          .then((j: { error?: string }) => j.error)
          .catch(() => null);
        setSaveToast({
          kind: "err",
          text: err ?? `Save failed (${res.status})`,
        });
        return;
      }
      setApiKey("");
      setSaveToast({ kind: "ok", text: "Saved. Retrying transcription…" });
      onRetry?.();
      setTimeout(() => setSaveToast(null), 2500);
    } finally {
      setSaving(false);
    }
  }

  const isProviderError =
    failureReason?.toLowerCase().includes("quota") ||
    failureReason?.toLowerCase().includes("rate limit") ||
    failureReason?.toLowerCase().includes("rejected the api key");

  return (
    <div className="p-4">
      <div className="rounded-md border border-border bg-accent/30 p-3 space-y-3">
        <div>
          <p className="text-sm font-medium">
            {isProviderError
              ? "Transcription provider error"
              : "Enable transcription"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {isProviderError
              ? "Your API key hit a quota or auth error. Switch to Builder.io (free) or update your key."
              : "Unlock auto-captions, transcript search, and AI summaries for this Clip."}
          </p>
        </div>

        {/* Builder — primary recommended option */}
        <div
          className={cn(
            "rounded-md border p-3 transition-colors",
            builderConfigured
              ? "border-green-500/30 bg-green-500/5"
              : "border-border bg-background",
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2 min-w-0">
              <IconBolt className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="text-xs font-semibold">
                    {builderConfigured
                      ? "Builder.io connected"
                      : "Connect Builder.io"}
                  </p>
                  {!builderConfigured && (
                    <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                      Free
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {builderConfigured
                    ? "High-quality transcription — no API key needed."
                    : "One-click setup. No API key required."}
                </p>
              </div>
            </div>
            {builderConfigured ? (
              <span className="flex items-center gap-1 text-[10px] text-green-600 shrink-0 mt-0.5">
                <IconCheck className="h-3 w-3" />
                Connected
              </span>
            ) : (
              <button
                type="button"
                onClick={handleConnect}
                disabled={connecting || builderConfigured === null}
                className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium border border-border rounded px-2 py-1 bg-background hover:bg-accent disabled:opacity-50 transition-colors"
              >
                {connecting ? (
                  <>
                    <IconLoader2 className="h-3 w-3 animate-spin" />
                    Waiting…
                  </>
                ) : (
                  <>
                    <IconExternalLink className="h-3 w-3" />
                    Connect
                  </>
                )}
              </button>
            )}
          </div>
          {connectError && (
            <p className="text-[11px] text-destructive mt-2">{connectError}</p>
          )}
        </div>

        {/* BYOK — secondary option, collapsed by default */}
        {!builderConfigured && (
          <div>
            <button
              type="button"
              onClick={() => setShowByok((v) => !v)}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <IconKey className="h-3.5 w-3.5" />
              {isProviderError
                ? "Update your API key"
                : "Or use your own API key (Groq / OpenAI)"}
              {showByok ? (
                <IconChevronUp className="h-3 w-3" />
              ) : (
                <IconChevronDown className="h-3 w-3" />
              )}
            </button>

            {showByok && (
              <div className="mt-2 space-y-2 pl-1">
                <p className="text-[11px] text-muted-foreground">
                  Groq key starts with <code className="font-mono">gsk_</code>{" "}
                  (fast, recommended) or OpenAI starts with{" "}
                  <code className="font-mono">sk-</code>.
                </p>
                <div className="flex gap-1.5">
                  <Input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveApiKey();
                    }}
                    placeholder="gsk_… or sk-…"
                    className="h-8 text-xs"
                  />
                  <Button
                    size="sm"
                    onClick={saveApiKey}
                    disabled={!apiKey.trim() || saving}
                  >
                    {saving ? (
                      <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      "Save"
                    )}
                  </Button>
                </div>
                <div className="flex items-center gap-3">
                  <a
                    href="https://console.groq.com/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    Get Groq key
                    <IconExternalLink className="h-3 w-3" />
                  </a>
                  <a
                    href="https://platform.openai.com/api-keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    Get OpenAI key
                    <IconExternalLink className="h-3 w-3" />
                  </a>
                </div>
                {saveToast && (
                  <p
                    className={cn(
                      "text-[11px]",
                      saveToast.kind === "ok"
                        ? "text-green-600"
                        : "text-destructive",
                    )}
                  >
                    {saveToast.text}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
