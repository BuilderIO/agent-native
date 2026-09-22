import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useLabState } from "@agent-native/core/client/labs";
import { CLIPS_WISPRFLOW } from "@shared/labs";
import {
  IconChevronDown,
  IconChevronRight,
  IconCopy,
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
import { Badge } from "@/components/ui/badge";
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
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useDesktopPromo } from "@/hooks/use-desktop-promo";
import enMessages from "@/i18n/en-US";
import { shortcutLabel, shortcutModifierLabel } from "@/lib/utils";

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

function sourceMeta(
  source: string | undefined,
  t: ReturnType<typeof useT>,
): string {
  switch (source) {
    case "fn-hold":
      return t("dictateRoute.holdFn");
    case "cmd-shift-space":
      return shortcutLabel("cmd+shift+space");
    case "manual":
      return t("dictateRoute.browserDictation");
    case "mobile":
      return t("dictateRoute.mobileDictation");
    case "fn":
      return t("dictateRoute.fnShortcut");
    case "custom":
      return t("dictateRoute.customShortcut");
    case "other":
      return t("dictateRoute.otherSource");
    default:
      return t("dictateRoute.voiceSource");
  }
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

function DictationExpandedContent({
  dictation,
  displayText,
  onCopy,
  onCleanup,
  cleanupPending,
  onDelete,
  deletePending,
}: {
  dictation: Dictation;
  displayText: string;
  onCopy: (text: string) => void;
  onCleanup: () => void;
  cleanupPending: boolean;
  onDelete: () => void;
  deletePending: boolean;
}) {
  const t = useT();
  const [view, setView] = useState<"processed" | "original">(
    dictation.cleanedText ? "processed" : "original",
  );

  useEffect(() => {
    if (view === "processed" && !dictation.cleanedText) setView("original");
  }, [dictation.cleanedText, view]);

  return (
    <div className="basis-full min-w-0 space-y-4 pt-1">
      <Tabs
        value={view}
        onValueChange={(next) => setView(next as "processed" | "original")}
        className="gap-4"
      >
        <TabsContent value="processed" className="mt-0">
          <p className="whitespace-pre-wrap text-base leading-relaxed">
            {displayText || t("dictateRoute.noText")}
          </p>
        </TabsContent>
        <TabsContent value="original" className="mt-0">
          <p className="whitespace-pre-wrap text-base leading-relaxed">
            {dictation.fullText || t("dictateRoute.noText")}
          </p>
        </TabsContent>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList className="w-fit">
            <TabsTrigger value="processed" disabled={!dictation.cleanedText}>
              {t("dictateRoute.aiProcessed")}
            </TabsTrigger>
            <TabsTrigger value="original">
              {t("dictateRoute.original")}
            </TabsTrigger>
          </TabsList>

          <ItemActions className="ms-auto">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={t("dictateRoute.copy")}
                  onClick={() =>
                    onCopy(
                      view === "processed" ? displayText : dictation.fullText,
                    )
                  }
                  className="size-8 text-muted-foreground"
                >
                  <IconCopy />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("dictateRoute.copy")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={t("dictateRoute.cleanupWithAi")}
                  onClick={onCleanup}
                  disabled={cleanupPending}
                  className="size-8 text-muted-foreground"
                >
                  {cleanupPending ? (
                    <IconLoader2 className="animate-spin" />
                  ) : (
                    <IconWand />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("dictateRoute.cleanupWithAi")}</TooltipContent>
            </Tooltip>
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
            <Tooltip>
              <TooltipTrigger asChild>
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={t("dictateRoute.hideDetails")}
                    className="size-8 text-muted-foreground"
                  >
                    <IconChevronDown />
                  </Button>
                </CollapsibleTrigger>
              </TooltipTrigger>
              <TooltipContent>{t("dictateRoute.hideDetails")}</TooltipContent>
            </Tooltip>
          </ItemActions>
        </div>
      </Tabs>
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
  const label = sourceMeta(dictation.source, t);

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
  const timestamp = dictationTimestamp(dictation);

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
      <Item asChild variant="outline" size="sm" className="bg-card">
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
          <ItemContent
            className={expanded ? "basis-full min-w-0" : "min-w-0 gap-1.5"}
          >
            {!expanded ? (
              <>
                <ItemTitle className="min-w-0 w-full line-clamp-2 whitespace-pre-wrap break-words text-base font-normal leading-relaxed">
                  {displayText || (
                    <span className="text-muted-foreground italic">
                      {t("dictateRoute.noText")}
                    </span>
                  )}
                </ItemTitle>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <ItemDescription className="text-xs tabular-nums">
                    {formatTime(timestamp)}
                  </ItemDescription>
                  <span className="text-muted-foreground" aria-hidden="true">
                    ·
                  </span>
                  <Badge variant="outline">{label}</Badge>
                  <span className="text-muted-foreground" aria-hidden="true">
                    ·
                  </span>
                  <ItemDescription className="text-xs tabular-nums">
                    {formatDuration(dictation.durationMs)}
                  </ItemDescription>
                  {dictation.cleanedText ? (
                    <Badge variant="secondary">
                      {t("dictateRoute.aiCleaned")}
                    </Badge>
                  ) : null}
                </div>
              </>
            ) : null}

            <CollapsibleContent className="clips-collapsible-content w-full">
              <DictationExpandedContent
                dictation={dictation}
                displayText={displayText}
                onCopy={(text) =>
                  void copyToClipboard(
                    text,
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
          </ItemContent>

          {!expanded ? (
            <ItemActions className="ms-auto self-start">
              <Tooltip>
                <TooltipTrigger asChild>
                  <CollapsibleTrigger asChild>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={t("dictateRoute.showDetails")}
                      className="size-8 text-muted-foreground"
                    >
                      <IconChevronRight />
                    </Button>
                  </CollapsibleTrigger>
                </TooltipTrigger>
                <TooltipContent>{t("dictateRoute.showDetails")}</TooltipContent>
              </Tooltip>
            </ItemActions>
          ) : null}

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
      // Action-backed mutations invalidate this query when a desktop-created
      // dictation lands. Poll only while browser work is active or saving,
      // rather than running a permanent interval over idle history.
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
        {(dictations.length > 0 || hasCaptureActivity) && (
          <div className="ms-auto flex shrink-0 items-center gap-2">
            <VocabularyManager />
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
          </div>
        )}
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
