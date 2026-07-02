import {
  useActionMutation,
  useActionQuery,
  useT,
} from "@agent-native/core/client";
import {
  IconArrowsExchange,
  IconChevronDown,
  IconChevronRight,
  IconCommand,
  IconCopy,
  IconDeviceDesktop,
  IconDownload,
  IconKeyboard,
  IconLoader2,
  IconMicrophone2,
  IconPlayerPlay,
  IconPlayerStop,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { CaptureInstallButton } from "@/components/capture-install-options";
import { PageHeader } from "@/components/library/page-header";
import { DayHeader } from "@/components/meetings/day-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useDesktopPromo } from "@/hooks/use-desktop-promo";
import enMessages from "@/i18n/en-US";
import { cn, shortcutLabel, shortcutModifierLabel } from "@/lib/utils";

export function meta() {
  return [{ title: enMessages.dictateRoute.pageTitle }];
}

interface Dictation {
  id: string;
  fullText: string;
  cleanedText?: string | null;
  durationMs?: number | null;
  audioUrl?: string | null;
  source?: "fn-hold" | "cmd-shift-space" | string;
  createdAt: string;
}

type SourceFilter = "all" | "fn-hold" | "cmd-shift-space" | "manual";
type BrowserDictationSource = "manual" | "cmd-shift-space";

interface SpeechRecognitionAlternative {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternative | undefined;
}

interface SpeechRecognitionResultListLike {
  length: number;
  [index: number]: SpeechRecognitionResultLike | undefined;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike {
  error?: string;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const w = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    target.isContentEditable
  );
}

function formatDuration(ms?: number | null): string {
  if (!ms || ms <= 0) return "—";
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function dayBucket(iso: string): string {
  try {
    const d = new Date(iso);
    const today = new Date();
    const startOfDay = (x: Date) =>
      new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const ms = 24 * 60 * 60 * 1000;
    const diff = Math.round((startOfDay(today) - startOfDay(d)) / ms);
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    if (diff > 1 && diff <= 6) {
      return d.toLocaleDateString([], {
        weekday: "long",
        month: "short",
        day: "numeric",
      });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return "Earlier";
  }
}

function sourceMeta(
  source: string | undefined,
  t: ReturnType<typeof useT>,
): {
  label: string;
  icon: React.ReactNode;
} {
  switch (source) {
    case "fn-hold":
      return {
        label: t("dictateRoute.holdFn"),
        icon: <IconKeyboard className="h-3 w-3" />,
      };
    case "cmd-shift-space":
      return {
        label: shortcutLabel("cmd+shift+space"),
        icon: <IconCommand className="h-3 w-3" />,
      };
    case "manual":
      return {
        label: t("dictateRoute.browserDictation"),
        icon: <IconMicrophone2 className="h-3 w-3" />,
      };
    default:
      return {
        label: source ?? "Voice",
        icon: <IconMicrophone2 className="h-3 w-3" />,
      };
  }
}

async function copyToClipboard(text: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`Copied ${label}`);
  } catch {
    toast.error("Couldn't copy");
  }
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium text-foreground shadow-sm">
      {children}
    </kbd>
  );
}

function HowToCard({ defaultOpen = true }: { defaultOpen?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-lg border border-border bg-accent/20 mb-6"
    >
      <CollapsibleTrigger className="w-full flex items-center justify-between px-4 py-3 cursor-pointer">
        <div className="flex items-center gap-2">
          <IconMicrophone2 className="h-4 w-4 text-foreground" />
          <span className="text-sm font-medium">
            {t("dictateRoute.howToUse")}
          </span>
        </div>
        {open ? (
          <IconChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <IconChevronRight className="h-4 w-4 text-muted-foreground rtl:-scale-x-100" />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-md border border-border bg-background px-3 py-3">
            <div className="flex items-center gap-2 mb-1.5">
              <IconMicrophone2 className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium">
                {t("dictateRoute.browserDictation")}
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t("dictateRoute.browserDictationDescription")}
            </p>
          </div>
          <div className="rounded-md border border-border bg-background px-3 py-3">
            <div className="flex items-center gap-2 mb-1.5">
              <IconDeviceDesktop className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium">
                {t("dictateRoute.desktopShortcuts")}
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Hold <Kbd>Fn</Kbd> anywhere on your Mac, or use{" "}
              <Kbd>{shortcutModifierLabel()}</Kbd> <Kbd>⇧</Kbd> <Kbd>Space</Kbd>
              {t("dictateRoute.desktopShortcutsDescriptionSuffix")}
            </p>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function FilterTabs({
  value,
  onChange,
  counts,
}: {
  value: SourceFilter;
  onChange: (next: SourceFilter) => void;
  counts: Record<SourceFilter, number>;
}) {
  const t = useT();
  const tabs: Array<{ id: SourceFilter; label: string }> = [
    { id: "all", label: "All" },
    { id: "manual", label: t("dictateRoute.browserDictation") },
    { id: "fn-hold", label: t("dictateRoute.holdFn") },
    { id: "cmd-shift-space", label: shortcutLabel("cmd+shift+space") },
  ];
  return (
    <div className="flex items-center gap-1 mb-3">
      {tabs.map((t) => {
        const active = value === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs cursor-pointer transition-colors",
              active
                ? "bg-foreground text-background"
                : "bg-accent/40 text-foreground hover:bg-accent/70",
            )}
          >
            {t.label}
            <span
              className={cn(
                "tabular-nums text-[10px]",
                active ? "text-background/70" : "text-muted-foreground",
              )}
            >
              {counts[t.id]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function WebDictationPanel({
  supported,
  listening,
  saving,
  draftText,
  interimText,
  onStart,
  onStop,
}: {
  supported: boolean;
  listening: boolean;
  saving: boolean;
  draftText: string;
  interimText: string;
  onStart: () => void;
  onStop: () => void;
}) {
  const t = useT();
  const preview = [draftText, interimText].filter(Boolean).join(" ").trim();
  return (
    <div className="mb-6 rounded-lg border border-border bg-background px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            <IconMicrophone2 className="h-4 w-4 text-foreground" />
            {t("dictateRoute.browserDictation")}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Press{" "}
            <span className="inline-flex items-center gap-1">
              <Kbd>{shortcutModifierLabel()}</Kbd>
              <Kbd>⇧</Kbd>
              <Kbd>Space</Kbd>
            </span>{" "}
            while this tab is focused to toggle.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={listening ? onStop : onStart}
          disabled={!supported || saving}
          className="gap-1.5"
        >
          {saving ? (
            <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
          ) : listening ? (
            <IconPlayerStop className="h-3.5 w-3.5" />
          ) : (
            <IconPlayerPlay className="h-3.5 w-3.5" />
          )}
          {saving ? "Saving" : listening ? "Stop" : "Start dictation"}
        </Button>
      </div>

      {!supported ? (
        <div className="mt-3 rounded-md border border-border bg-accent/20 px-3 py-2 text-xs text-muted-foreground">
          {t("dictateRoute.browserUnavailable")}
        </div>
      ) : listening || preview ? (
        <div className="mt-3 rounded-md border border-border bg-accent/20 px-3 py-2">
          <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase text-muted-foreground">
            {listening && (
              <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
            )}
            {listening ? "Listening" : "Last capture"}
          </div>
          <p className="min-h-5 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {preview || (
              <span className="text-muted-foreground">
                {t("dictateRoute.startSpeaking")}
              </span>
            )}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function DictationRow({ dictation }: { dictation: Dictation }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const qc = useQueryClient();
  const cleanup = useActionMutation<any, { id: string }>("cleanup-dictation");
  const replaceOriginal = useActionMutation<
    any,
    { id: string; fullText: string }
  >("update-dictation");
  const { label, icon } = sourceMeta(dictation.source, t);

  const preview = (dictation.cleanedText || dictation.fullText || "").slice(
    0,
    140,
  );

  const handleCleanup = (e: React.MouseEvent) => {
    e.stopPropagation();
    cleanup.mutate(
      { id: dictation.id },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ["action", "list-dictations"] });
        },
      },
    );
  };

  const handleReplaceOriginal = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!dictation.cleanedText) return;
    const next = dictation.cleanedText;
    // Optimistic — patch the list cache immediately.
    qc.setQueryData<any>(["action", "list-dictations", {}], (prev: any) => {
      if (!prev) return prev;
      const list: Dictation[] = Array.isArray(prev) ? prev : prev.dictations;
      if (!list) return prev;
      const updated = list.map((d) =>
        d.id === dictation.id ? { ...d, fullText: next } : d,
      );
      return Array.isArray(prev) ? updated : { ...prev, dictations: updated };
    });
    replaceOriginal.mutate(
      { id: dictation.id, fullText: next },
      {
        onSuccess: () => {
          toast.success(t("dictateRoute.replacedOriginal"));
          qc.invalidateQueries({ queryKey: ["action", "list-dictations"] });
        },
        onError: () => {
          toast.error("Couldn't replace");
          qc.invalidateQueries({ queryKey: ["action", "list-dictations"] });
        },
      },
    );
  };

  return (
    <div
      className={cn(
        "border-b border-border last:border-b-0 cursor-pointer",
        expanded ? "bg-accent/20" : "hover:bg-accent/10",
      )}
      onClick={() => setExpanded((v) => !v)}
    >
      <div className="grid grid-cols-12 items-center gap-3 px-4 py-2.5 text-sm">
        <div className="col-span-2 flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
          {expanded ? (
            <IconChevronDown className="h-3.5 w-3.5" />
          ) : (
            <IconChevronRight className="h-3.5 w-3.5 rtl:-scale-x-100" />
          )}
          {formatTime(dictation.createdAt)}
        </div>
        <div className="col-span-2">
          <Badge variant="secondary" className="text-[10px] gap-1 font-normal">
            {icon}
            {label}
          </Badge>
        </div>
        <div className="col-span-6 truncate text-foreground/90">
          {preview || (
            <span className="text-muted-foreground italic">
              {t("dictateRoute.noText")}
            </span>
          )}
        </div>
        <div className="col-span-1 text-end text-xs text-muted-foreground tabular-nums">
          {formatDuration(dictation.durationMs)}
        </div>
        <div className="col-span-1 flex justify-end">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  void copyToClipboard(
                    dictation.cleanedText || dictation.fullText || "",
                    "text",
                  );
                }}
                className="h-7 w-7 p-0 cursor-pointer"
              >
                <IconCopy className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Copy</TooltipContent>
          </Tooltip>
        </div>
      </div>
      {expanded && (
        <div className="px-4 pb-4 pt-1 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-md border border-border bg-background px-3 py-2.5">
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Original
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    void copyToClipboard(dictation.fullText || "", "original");
                  }}
                  className="h-6 gap-1 text-[10px] cursor-pointer"
                >
                  <IconCopy className="h-3 w-3" />
                  Copy
                </Button>
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {dictation.fullText || (
                  <span className="text-muted-foreground italic">
                    {t("dictateRoute.emptyTranscript")}
                  </span>
                )}
              </p>
            </div>
            <div className="rounded-md border border-border bg-background px-3 py-2.5">
              <div className="flex items-center justify-between mb-1 gap-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Cleaned
                </div>
                <div className="flex items-center gap-1">
                  {dictation.cleanedText && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          void copyToClipboard(
                            dictation.cleanedText || "",
                            "cleaned",
                          );
                        }}
                        className="h-6 gap-1 text-[10px] cursor-pointer"
                      >
                        <IconCopy className="h-3 w-3" />
                        Copy
                      </Button>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={handleReplaceOriginal}
                            disabled={replaceOriginal.isPending}
                            className="h-6 gap-1 text-[10px] cursor-pointer"
                          >
                            {replaceOriginal.isPending ? (
                              <IconLoader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <IconArrowsExchange className="h-3 w-3" />
                            )}
                            Replace
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t("dictateRoute.replaceOriginal")}
                        </TooltipContent>
                      </Tooltip>
                    </>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleCleanup}
                    disabled={cleanup.isPending}
                    className="h-6 gap-1 text-[10px] cursor-pointer"
                  >
                    {cleanup.isPending ? (
                      <IconLoader2 className="h-3 w-3 animate-spin" />
                    ) : null}
                    {t("dictateRoute.cleanupWithAi")}
                  </Button>
                </div>
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {dictation.cleanedText || (
                  <span className="text-muted-foreground italic">
                    {t("dictateRoute.cleanupHint")}
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ isDesktopApp }: { isDesktopApp: boolean }) {
  const t = useT();
  return (
    <div className="rounded-xl border border-dashed border-border bg-gradient-to-br from-accent/30 via-transparent to-transparent px-6 py-16 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-foreground text-background">
        <IconMicrophone2 className="h-6 w-6" />
      </div>
      <p className="mt-4 text-base font-medium text-foreground">
        {t("dictateRoute.startFirst")}
      </p>
      {isDesktopApp ? (
        <>
          <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">
            {t("dictateRoute.emptyDesktopDescription", {
              fnKey: "Fn",
              modifierKey: shortcutModifierLabel(),
            })}
          </p>
        </>
      ) : (
        <>
          <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">
            {t("dictateRoute.emptyWebDescription")}
          </p>
          <div className="mt-5 flex items-center justify-center">
            <CaptureInstallButton size="sm" className="gap-1.5">
              <IconDownload className="h-3.5 w-3.5" />
              {t("dictateRoute.downloadDesktopApp")}
            </CaptureInstallButton>
          </div>
          <div className="mt-3 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Kbd>Fn</Kbd>
            <span className="text-muted-foreground/60">
              {t("dictateRoute.holdToDictate")}
            </span>
            <span className="text-muted-foreground/40">·</span>
            <Kbd>{shortcutModifierLabel()}</Kbd>
            <Kbd>⇧</Kbd>
            <Kbd>Space</Kbd>
            <span className="text-muted-foreground/60">
              {t("dictateRoute.toggle")}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function DownloadDesktopAppCard() {
  const t = useT();
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-accent/20 px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-medium">
          <IconDeviceDesktop className="h-4 w-4 text-foreground" />
          {t("dictateRoute.desktopCtaTitle")}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t("dictateRoute.desktopCtaDescription", {
            modifierKey: shortcutModifierLabel(),
          })}
        </p>
      </div>
      <CaptureInstallButton size="sm" className="gap-1.5">
        <IconDownload className="h-3.5 w-3.5" />
        {t("dictateRoute.downloadDesktopApp")}
      </CaptureInstallButton>
    </div>
  );
}

export default function DictateRoute() {
  const t = useT();
  const { data, isLoading, isError } = useActionQuery<
    { dictations: Dictation[] } | Dictation[] | undefined
  >("list-dictations", {}, { retry: false });

  const { isDesktopApp } = useDesktopPromo();
  const [filter, setFilter] = useState<SourceFilter>("all");
  const [listening, setListening] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [interimText, setInterimText] = useState("");
  const [speechSupported, setSpeechSupported] = useState(false);
  const qc = useQueryClient();
  const createDictation = useActionMutation("create-dictation");

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptRef = useRef("");
  const interimRef = useRef("");
  const startedAtRef = useRef(0);
  const startedAtIsoRef = useRef("");
  const sourceRef = useRef<BrowserDictationSource>("manual");
  const saveOnEndRef = useRef(false);
  const finishingRef = useRef(false);

  useEffect(() => {
    setSpeechSupported(getSpeechRecognitionCtor() !== null);
  }, []);

  const finishBrowserDictation = useCallback(() => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    const shouldSave = saveOnEndRef.current;
    saveOnEndRef.current = false;
    setListening(false);

    const text = [transcriptRef.current, interimRef.current]
      .filter(Boolean)
      .join(" ")
      .trim();
    setDraftText(text);
    setInterimText("");
    interimRef.current = "";

    if (!shouldSave) {
      finishingRef.current = false;
      return;
    }
    if (!text) {
      toast.error(t("dictateRoute.noSpeechCaptured"));
      finishingRef.current = false;
      return;
    }

    const durationMs =
      startedAtRef.current > 0 ? Date.now() - startedAtRef.current : 0;
    createDictation.mutate(
      {
        fullText: text,
        durationMs,
        source: sourceRef.current,
        startedAt: startedAtIsoRef.current || new Date().toISOString(),
      },
      {
        onSuccess: () => {
          toast.success(t("dictateRoute.dictationSaved"));
          qc.invalidateQueries({ queryKey: ["action", "list-dictations"] });
        },
        onError: (err: Error) => {
          toast.error(err.message || "Couldn't save dictation");
        },
        onSettled: () => {
          finishingRef.current = false;
        },
      },
    );
  }, [createDictation, qc]);

  const stopBrowserDictation = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) {
      finishBrowserDictation();
      return;
    }
    try {
      recognition.stop();
    } catch {
      finishBrowserDictation();
    }
  }, [finishBrowserDictation]);

  const startBrowserDictation = useCallback(
    (source: BrowserDictationSource = "manual") => {
      if (listening || createDictation.isPending) return;
      const Recognition = getSpeechRecognitionCtor();
      if (!Recognition) {
        toast.error(t("dictateRoute.browserUnavailableShort"));
        return;
      }

      const recognition = new Recognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = navigator.language || "en-US";
      recognitionRef.current = recognition;
      transcriptRef.current = "";
      interimRef.current = "";
      startedAtRef.current = Date.now();
      startedAtIsoRef.current = new Date().toISOString();
      sourceRef.current = source;
      saveOnEndRef.current = true;
      finishingRef.current = false;
      setDraftText("");
      setInterimText("");

      recognition.onresult = (event) => {
        let finalText = transcriptRef.current;
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const text = result?.[0]?.transcript ?? "";
          if (!text) continue;
          if (result?.isFinal) finalText = `${finalText} ${text}`.trim();
          else interim = `${interim} ${text}`.trim();
        }
        transcriptRef.current = finalText;
        interimRef.current = interim;
        setDraftText(finalText);
        setInterimText(interim);
      };
      recognition.onerror = (event) => {
        const error = event.error ?? "speech-recognition";
        if (error !== "no-speech" && error !== "aborted") {
          toast.error(
            error === "not-allowed"
              ? "Allow microphone access to dictate in the browser"
              : `Dictation error: ${error}`,
          );
        }
      };
      recognition.onend = () => {
        if (recognitionRef.current === recognition) {
          recognitionRef.current = null;
        }
        finishBrowserDictation();
      };

      try {
        recognition.start();
        setListening(true);
      } catch (err) {
        recognitionRef.current = null;
        saveOnEndRef.current = false;
        finishingRef.current = false;
        toast.error(err instanceof Error ? err.message : "Couldn't start");
      }
    },
    [createDictation.isPending, finishBrowserDictation, listening],
  );

  useEffect(() => {
    // Inside the desktop app the global Rust shortcut owns Cmd+Shift+Space, so
    // the in-page handler must run only in a plain browser to avoid firing
    // dictation twice.
    if (isDesktopApp) return;
    function onKeyDown(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) return;
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.code === "Space"
      ) {
        event.preventDefault();
        if (listening) stopBrowserDictation();
        else startBrowserDictation("cmd-shift-space");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isDesktopApp, listening, startBrowserDictation, stopBrowserDictation]);

  useEffect(() => {
    return () => {
      saveOnEndRef.current = false;
      try {
        recognitionRef.current?.abort();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    };
  }, []);

  const dictations: Dictation[] = useMemo(() => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    return data.dictations ?? [];
  }, [data]);

  const counts = useMemo<Record<SourceFilter, number>>(() => {
    const c: Record<SourceFilter, number> = {
      all: dictations.length,
      "fn-hold": 0,
      "cmd-shift-space": 0,
      manual: 0,
    };
    for (const d of dictations) {
      if (d.source === "fn-hold") c["fn-hold"]++;
      else if (d.source === "cmd-shift-space") c["cmd-shift-space"]++;
      else if (d.source === "manual") c.manual++;
    }
    return c;
  }, [dictations]);

  const filtered = useMemo(() => {
    if (filter === "all") return dictations;
    return dictations.filter((d) => d.source === filter);
  }, [dictations, filter]);

  const grouped = useMemo<Array<[string, Dictation[]]>>(() => {
    const map = new Map<string, Dictation[]>();
    // Already comes back desc; keep order.
    for (const d of filtered) {
      const k = dayBucket(d.createdAt);
      const arr = map.get(k) ?? [];
      arr.push(d);
      map.set(k, arr);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const isEmpty = !isLoading && !isError && dictations.length === 0;

  return (
    <>
      <PageHeader>
        <h1 className="text-base font-semibold tracking-tight truncate">
          Dictate
        </h1>
      </PageHeader>
      <div className="p-6 max-w-5xl mx-auto w-full">
        <div className="mb-6">
          <p className="text-sm text-muted-foreground">
            {t("dictateRoute.voiceToTextDescription")}
          </p>
        </div>

        {isDesktopApp ? (
          <>
            <HowToCard defaultOpen={isEmpty} />
            <WebDictationPanel
              supported={speechSupported}
              listening={listening}
              saving={createDictation.isPending}
              draftText={draftText}
              interimText={interimText}
              onStart={() => startBrowserDictation("manual")}
              onStop={stopBrowserDictation}
            />
          </>
        ) : (
          <DownloadDesktopAppCard />
        )}

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : isError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {t("dictateRoute.loadFailed")}
          </div>
        ) : isEmpty ? (
          <EmptyState isDesktopApp={isDesktopApp} />
        ) : (
          <>
            <FilterTabs value={filter} onChange={setFilter} counts={counts} />

            {filtered.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-accent/20 px-6 py-10 text-center text-sm text-muted-foreground">
                {t("dictateRoute.noFilterMatches")}
              </div>
            ) : (
              <div className="space-y-6">
                {grouped.map(([day, items]) => (
                  <div key={day} className="space-y-2">
                    <DayHeader label={day} />
                    <div className="rounded-lg border border-border bg-background overflow-hidden">
                      <div className="grid grid-cols-12 items-center gap-3 px-4 py-2 border-b border-border bg-accent/20 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        <div className="col-span-2">When</div>
                        <div className="col-span-2">Source</div>
                        <div className="col-span-6">Text</div>
                        <div className="col-span-1 text-end">Duration</div>
                        <div className="col-span-1" />
                      </div>
                      <div>
                        {items.map((d) => (
                          <DictationRow key={d.id} dictation={d} />
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
