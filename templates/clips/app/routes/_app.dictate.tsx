import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useFormatters, useT } from "@agent-native/core/client/i18n";
import { useLabState } from "@agent-native/core/client/labs";
import { CLIPS_WISPRFLOW } from "@shared/labs";
import {
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconInfoCircle,
  IconKeyboard,
  IconLoader2,
  IconMicrophone2,
  IconPlayerStop,
  IconTrash,
  IconWand,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router";
import { toast } from "sonner";

import { CaptureInstallButton } from "@/components/capture-install-options";
import { VocabularyManager } from "@/components/dictate/vocabulary-section";
import { AppEmptyState } from "@/components/library/empty-state";
import {
  PageBreadcrumb,
  PageHeader,
  PageHeaderPrimaryAction,
} from "@/components/library/page-header";
import { groupByCalendarDay } from "@/components/meetings/day-grouped-card";
import { DayHeader, formatDayLabel } from "@/components/meetings/day-header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { Kbd } from "@/components/ui/kbd";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useDesktopPromo } from "@/hooks/use-desktop-promo";
import enMessages from "@/i18n/en-US";
import { cn, shortcutModifierLabel } from "@/lib/utils";

export function meta() {
  return [{ title: enMessages.dictateRoute.pageTitle }];
}

interface Dictation {
  id: string;
  fullText: string;
  cleanedText?: string | null;
  durationMs?: number | null;
  source?: "fn-hold" | "cmd-shift-space" | (string & {});
  startedAt?: string;
  createdAt: string;
}

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

function formatDuration(
  ms: number | null | undefined,
  formatters: ReturnType<typeof useFormatters>,
): string {
  if (!ms || ms <= 0) return "—";
  const total = Math.round(ms / 1000);
  const seconds = (value: number) =>
    formatters.formatNumber(value, {
      style: "unit",
      unit: "second",
      unitDisplay: "short",
    });
  if (total < 60) return seconds(total);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${formatters.formatNumber(m, { style: "unit", unit: "minute", unitDisplay: "short" })} ${seconds(s)}`;
}

function dictationTimestamp(dictation: Dictation): string {
  return dictation.startedAt ?? dictation.createdAt;
}

function timestampValue(iso: string): number {
  const value = Date.parse(iso);
  return Number.isNaN(value) ? 0 : value;
}

export function dictationsRefetchInterval(isActive: boolean): number | false {
  return isActive ? 2_000 : false;
}

async function copyToClipboard(
  text: string,
  copiedMessage: string,
  errorMessage: string,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(copiedMessage);
  } catch {
    toast.error(errorMessage);
  }
}

function HowToCard({ defaultOpen = true }: { defaultOpen?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="mb-4 rounded-lg border border-border bg-accent/20"
    >
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between px-4 py-2.5">
        <div className="flex items-center gap-2">
          <IconKeyboard className="h-4 w-4 text-foreground" />
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
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/70 px-4 pb-3 pt-3 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            {t("dictateRoute.desktopShortcuts")}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>Fn</Kbd>
            <span>{t("dictateRoute.holdToDictate")}</span>
          </span>
          <span className="text-muted-foreground/50">·</span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>{shortcutModifierLabel()}</Kbd>
            <Kbd>⇧</Kbd>
            <Kbd>Space</Kbd>
            <span>{t("dictateRoute.toggle")}</span>
          </span>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function DictationCaptureStatus({
  supported,
  desktopApp,
  listening,
  saving,
  draftText,
  interimText,
}: {
  supported: boolean;
  desktopApp: boolean;
  listening: boolean;
  saving: boolean;
  draftText: string;
  interimText: string;
}) {
  const t = useT();
  const preview = [draftText, interimText].filter(Boolean).join(" ").trim();

  if (!supported && !desktopApp) {
    return (
      <div className="mb-4 rounded-md border border-border bg-accent/20 px-3 py-2 text-xs text-muted-foreground">
        {t("dictateRoute.browserUnavailable")}
      </div>
    );
  }

  if (!listening && !saving) return null;

  return (
    <div
      className="mb-4 rounded-md border border-border bg-accent/20 px-3 py-2"
      aria-live="polite"
    >
      <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase text-muted-foreground">
        {listening && (
          <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
        )}
        {saving ? t("dictateRoute.saving") : t("dictateRoute.listening")}
      </div>
      <p className="min-h-5 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
        {preview || (
          <span className="text-muted-foreground">
            {t("dictateRoute.startSpeaking")}
          </span>
        )}
      </p>
    </div>
  );
}

function DictationInfoPopover({ dictation }: { dictation: Dictation }) {
  const t = useT();
  const formatters = useFormatters();
  const timestamp = dictationTimestamp(dictation);

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={t("dictateRoute.info")}
              className="size-8 text-muted-foreground"
            >
              <IconInfoCircle aria-hidden="true" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{t("dictateRoute.info")}</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        aria-label={t("dictateRoute.info")}
        className="w-64 cursor-default"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <dt className="text-muted-foreground">{t("dictateRoute.time")}</dt>
          <dd className="text-end tabular-nums">
            <time dateTime={timestamp}>
              {formatters.formatDate(timestamp, { timeStyle: "short" })}
            </time>
          </dd>
          <dt className="text-muted-foreground">
            {t("dictateRoute.duration")}
          </dt>
          <dd className="text-end tabular-nums">
            {formatDuration(dictation.durationMs, formatters)}
          </dd>
        </dl>
      </PopoverContent>
    </Popover>
  );
}

function DictationActions({
  dictation,
  onCopy,
  onCleanup,
  cleanupPending,
  onDelete,
  deletePending,
}: {
  dictation: Dictation;
  onCopy: () => void;
  onCleanup: () => void;
  cleanupPending: boolean;
  onDelete: () => void;
  deletePending: boolean;
}) {
  const t = useT();
  const processed = Boolean(dictation.cleanedText);

  return (
    <div className="flex flex-wrap items-center justify-end gap-3 pt-3">
      <ItemActions className="ms-auto">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={
                processed
                  ? t("dictateRoute.aiCleaned")
                  : t("dictateRoute.cleanupWithAi")
              }
              onClick={() => {
                if (!processed && !cleanupPending) onCleanup();
              }}
              aria-disabled={processed || cleanupPending}
              aria-busy={cleanupPending}
              className={
                processed
                  ? "size-8 bg-success/10 text-success hover:bg-success/10 hover:text-success"
                  : "size-8 text-muted-foreground"
              }
            >
              {cleanupPending ? (
                <IconLoader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <IconWand aria-hidden="true" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {processed
              ? t("dictateRoute.aiCleaned")
              : t("dictateRoute.cleanupWithAi")}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={t("dictateRoute.copy")}
              onClick={onCopy}
              className="size-8 text-muted-foreground"
            >
              <IconCopy />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("dictateRoute.copy")}</TooltipContent>
        </Tooltip>
        <DictationInfoPopover dictation={dictation} />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={t("dictateRoute.delete")}
              onClick={onDelete}
              disabled={deletePending}
              className="size-8 text-muted-foreground"
            >
              {deletePending ? (
                <IconLoader2 className="animate-spin" />
              ) : (
                <IconTrash />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("dictateRoute.delete")}</TooltipContent>
        </Tooltip>
      </ItemActions>
    </div>
  );
}

function DictationCard({
  dictation,
  initialExpanded = false,
}: {
  dictation: Dictation;
  initialExpanded?: boolean;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(initialExpanded);
  const rowRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const cleanup = useActionMutation<any, { id: string }>("cleanup-dictation");
  const deleteDictation = useActionMutation<any, { id: string }>(
    "delete-dictation",
  );
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    if (!initialExpanded) return;
    setExpanded(true);
    rowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [initialExpanded]);

  useEffect(() => {
    if (!expanded) return;

    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !rowRef.current?.contains(target)) {
        setExpanded(false);
      }
    };

    document.addEventListener("pointerdown", handleOutsidePointerDown);
    return () =>
      document.removeEventListener("pointerdown", handleOutsidePointerDown);
  }, [expanded]);

  const displayText = dictation.cleanedText || dictation.fullText;

  const handleCleanup = () => {
    cleanup.mutate(
      { id: dictation.id },
      {
        onSuccess: () => {
          toast.success(t("dictateRoute.cleanupComplete"));
          void qc.invalidateQueries({
            queryKey: ["action", "list-dictations"],
          });
        },
        onError: (error) => {
          toast.error(
            actionErrorMessage(error) ?? t("dictateRoute.cleanupFailed"),
          );
        },
      },
    );
  };

  const handleDelete = () => {
    deleteDictation.mutate(
      { id: dictation.id },
      {
        onSuccess: () => {
          setDeleteOpen(false);
          toast.success(t("dictateRoute.deleted"));
          void qc.invalidateQueries({
            queryKey: ["action", "list-dictations"],
          });
        },
        onError: () => {
          toast.error(t("dictateRoute.deleteFailed"));
        },
      },
    );
  };

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded} asChild>
      <Item asChild variant="outline" size="sm" className="gap-y-0 bg-card">
        <div
          ref={rowRef}
          role="listitem"
          className="cursor-pointer"
          onClick={(event) => {
            if (
              event.target instanceof Element &&
              event.target.closest("button, a, input, textarea, select")
            ) {
              return;
            }
            setExpanded((value) => !value);
          }}
        >
          <ItemContent className="min-w-0 self-start py-0.5">
            <ItemTitle
              className={cn(
                "block min-w-0 w-full text-base font-normal leading-relaxed",
                expanded ? "whitespace-pre-wrap break-words" : "truncate",
              )}
            >
              {displayText || (
                <span className="text-muted-foreground italic">
                  {t("dictateRoute.noText")}
                </span>
              )}
            </ItemTitle>
          </ItemContent>

          <ItemActions className="ms-auto shrink-0 self-start gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={
                      expanded
                        ? t("dictateRoute.hideDetails")
                        : t("dictateRoute.showDetails")
                    }
                    className="size-8 text-muted-foreground"
                  >
                    <IconChevronRight
                      aria-hidden="true"
                      className={cn(
                        "transition-transform duration-150 motion-reduce:transition-none",
                        expanded && "rotate-90",
                      )}
                    />
                  </Button>
                </CollapsibleTrigger>
              </TooltipTrigger>
              <TooltipContent>
                {expanded
                  ? t("dictateRoute.hideDetails")
                  : t("dictateRoute.showDetails")}
              </TooltipContent>
            </Tooltip>
          </ItemActions>

          <CollapsibleContent className="clips-collapsible-content w-full">
            <DictationActions
              dictation={dictation}
              onCopy={() =>
                void copyToClipboard(
                  displayText,
                  t("dictateRoute.copied"),
                  t("dictateRoute.copyFailed"),
                )
              }
              onCleanup={handleCleanup}
              cleanupPending={cleanup.isPending}
              onDelete={() => setDeleteOpen(true)}
              deletePending={deleteDictation.isPending}
            />
          </CollapsibleContent>

          <AlertDialog
            open={deleteOpen}
            onOpenChange={(nextOpen) => {
              if (!nextOpen && !deleteDictation.isPending) {
                setDeleteOpen(false);
              }
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t("dictateRoute.deleteDictationTitle")}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t("dictateRoute.deleteDictationDescription")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleteDictation.isPending}>
                  {t("common.cancel")}
                </AlertDialogCancel>
                <AlertDialogAction
                  disabled={deleteDictation.isPending}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={(event) => {
                    event.preventDefault();
                    handleDelete();
                  }}
                >
                  {deleteDictation.isPending ? (
                    <IconLoader2 className="animate-spin" />
                  ) : null}
                  {t("dictateRoute.delete")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </Item>
    </Collapsible>
  );
}

function DictationEmptyState({
  isDesktopApp,
  speechSupported,
  disabled,
  onNewDictation,
}: {
  isDesktopApp: boolean;
  speechSupported: boolean;
  disabled: boolean;
  onNewDictation: () => void;
}) {
  const t = useT();

  return (
    <AppEmptyState
      icon={IconMicrophone2}
      title={t("dictateRoute.startFirst")}
      description={
        isDesktopApp
          ? t("dictateRoute.emptyDesktopDescription", {
              fnKey: "Fn",
              modifierKey: shortcutModifierLabel(),
            })
          : speechSupported
            ? t("dictateRoute.browserDictationDescription")
            : t("dictateRoute.browserUnavailable")
      }
      content={
        isDesktopApp ? null : speechSupported ? (
          <Button
            type="button"
            size="sm"
            onClick={onNewDictation}
            disabled={disabled}
          >
            {t("dictateRoute.newDictation")}
          </Button>
        ) : (
          <CaptureInstallButton
            size="sm"
            downloadedChildren={t("captureInstall.openDesktopApp")}
          >
            {t("dictateRoute.downloadDesktopApp")}
          </CaptureInstallButton>
        )
      }
    />
  );
}

export default function DictateRoute() {
  const lab = useLabState(CLIPS_WISPRFLOW.key);
  const t = useT();
  const [searchParams] = useSearchParams();
  const selectedDictationId = searchParams.get("dictationId");
  const { isDesktopApp } = useDesktopPromo();
  const [listening, setListening] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [interimText, setInterimText] = useState("");
  const [speechSupported, setSpeechSupported] = useState(false);
  const qc = useQueryClient();
  const createDictation = useActionMutation("create-dictation");
  const { data, isLoading, isError } = useActionQuery<
    { dictations: Dictation[] } | Dictation[] | undefined
  >(
    "list-dictations",
    {},
    {
      retry: false,
      refetchInterval: () =>
        dictationsRefetchInterval(listening || createDictation.isPending),
    },
  );

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
          void qc.invalidateQueries({
            queryKey: ["action", "list-dictations"],
          });
        },
        onError: (err: Error) => {
          toast.error(err.message || "Couldn't save dictation");
        },
        onSettled: () => {
          finishingRef.current = false;
        },
      },
    );
  }, [createDictation, qc, t]);

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
    [createDictation.isPending, finishBrowserDictation, listening, t],
  );

  useEffect(() => {
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

  const grouped = useMemo(() => {
    return groupByCalendarDay(
      dictations,
      dictationTimestamp,
      (a, b) =>
        timestampValue(dictationTimestamp(b)) -
        timestampValue(dictationTimestamp(a)),
    );
  }, [dictations]);
  const hasCaptureActivity = listening || createDictation.isPending;

  if (lab.isSuccess && !lab.enabled) {
    return <Navigate replace to="/library" />;
  }

  return (
    <>
      <PageHeader>
        <div className="min-w-0 flex-1">
          <PageBreadcrumb items={[{ label: t("navigation.dictate") }]} />
        </div>
        <div className="ms-auto flex shrink-0 items-center gap-2">
          <VocabularyManager />
          {(dictations.length > 0 || hasCaptureActivity) && (
            <PageHeaderPrimaryAction
              type="button"
              onClick={
                listening
                  ? stopBrowserDictation
                  : () => startBrowserDictation("manual")
              }
              disabled={!speechSupported || createDictation.isPending}
              aria-label={
                createDictation.isPending
                  ? t("dictateRoute.saving")
                  : listening
                    ? t("dictateRoute.stop")
                    : t("dictateRoute.newDictation")
              }
              className="gap-1.5"
            >
              {createDictation.isPending ? (
                <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
              ) : listening ? (
                <IconPlayerStop className="h-3.5 w-3.5" />
              ) : (
                <IconMicrophone2 className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">
                {createDictation.isPending
                  ? t("dictateRoute.saving")
                  : listening
                    ? t("dictateRoute.stop")
                    : t("dictateRoute.newDictation")}
              </span>
            </PageHeaderPrimaryAction>
          )}
        </div>
      </PageHeader>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-5">
        {isDesktopApp ? <HowToCard defaultOpen={false} /> : null}
        <DictationCaptureStatus
          supported={speechSupported}
          desktopApp={isDesktopApp}
          listening={listening}
          saving={createDictation.isPending}
          draftText={draftText}
          interimText={interimText}
        />

        {isLoading ? (
          <div className="space-y-2" aria-busy="true">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-36 w-full rounded-lg" />
            ))}
          </div>
        ) : isError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {t("dictateRoute.loadFailed")}
          </div>
        ) : dictations.length > 0 ? (
          <div className="space-y-6">
            {grouped.map(([key, items]) => (
              <div key={key} className="space-y-2">
                <DayHeader
                  label={formatDayLabel(dictationTimestamp(items[0]!))}
                />
                <ItemGroup className="gap-2">
                  {items.map((dictation) => (
                    <DictationCard
                      key={dictation.id}
                      dictation={dictation}
                      initialExpanded={dictation.id === selectedDictationId}
                    />
                  ))}
                </ItemGroup>
              </div>
            ))}
          </div>
        ) : hasCaptureActivity ? null : (
          <DictationEmptyState
            isDesktopApp={isDesktopApp}
            speechSupported={speechSupported}
            disabled={createDictation.isPending}
            onNewDictation={() => startBrowserDictation("manual")}
          />
        )}
      </div>
    </>
  );
}
