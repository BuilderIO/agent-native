import {
  useActionQuery,
  useActionMutation,
  useSession,
  useCollaborativeDoc,
  isReconcileLeadClient,
  generateTabId,
  emailToColor,
  emailToName,
  PresenceBar,
  AgentToggleButton,
  NotificationsBell,
  ShareButton,
  isEmbedAuthActive,
  sendToAgentChat,
  getBrowserTabId,
  readClientAppState,
  setClientAppState,
  useReconciledState,
  usePresence,
  useFollowUser,
  LiveCursorOverlay,
  useT,
  type CollabUser,
  type PromptComposerSubmitOptions,
} from "@agent-native/core/client";
import type { TweakDefinition } from "@shared/api";
import {
  resolveTweaksToCssVars,
  type TweakSelections,
} from "@shared/resolve-tweaks";
import {
  IconArrowLeft,
  IconPencil,
  IconMessage,
  IconBrush,
  IconAdjustmentsHorizontal,
  IconZoomIn,
  IconZoomOut,
  IconDeviceDesktop,
  IconDeviceTablet,
  IconDeviceMobile,
  IconViewportWide,
  IconPlus,
  IconLayoutGrid,
  IconX,
  IconPin,
  IconCode,
  IconArchive,
  IconPhoto,
  IconRefresh,
  IconMenu2,
  IconChevronDown,
  IconCheck,
  IconDotsVertical,
  IconArrowBackUp,
  IconArrowForwardUp,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router";
import { toast } from "sonner";
import * as Y from "yjs";

import { DesignCanvas } from "@/components/design/DesignCanvas";
import { DesignEditorSkeleton } from "@/components/design/DesignEditorSkeleton";
import { EditPanel } from "@/components/design/EditPanel";
import { MultiScreenCanvas } from "@/components/design/MultiScreenCanvas";
import { QuestionFlow } from "@/components/design/QuestionFlow";
import { TweaksPanel } from "@/components/design/TweaksPanel";
import type {
  ElementInfo,
  DeviceFrameType,
  ViewportTab,
} from "@/components/design/types";
import { ZOOM_PRESETS } from "@/components/design/types";
import { VariantGrid } from "@/components/design/VariantGrid";
import { VariantHandoffCard } from "@/components/design/VariantHandoffCard";
import PromptPopover from "@/components/editor/PromptDialog";
import type { UploadedFile } from "@/components/editor/PromptDialog";
import { useOpenMobileSidebar } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAgentGenerating } from "@/hooks/use-agent-generating";
import { useDesignSystems } from "@/hooks/use-design-systems";
import { useQuestionFlow } from "@/hooks/use-question-flow";
import {
  DESIGN_VARIANT_PICKED_EVENT,
  useVariantFlow,
} from "@/hooks/use-variant-flow";
import {
  clearPendingGeneration,
  hasFreshPendingGeneration,
  isPendingGenerationStale,
  patchPendingGeneration,
  PENDING_GENERATION_STALE_MS,
  readPendingGeneration,
} from "@/lib/pending-generation";
import { prettyScreenName } from "@/lib/screen-names";
import { cn } from "@/lib/utils";

const TAB_ID = generateTabId();

// Selection is tab-scoped (like navigation) so a second editor tab cannot
// overwrite this tab's selection context. The global key is mirrored as a
// fallback for CLI/external agents that do not send a browser tab id.
function designSelectionStateKeys(): string[] {
  const tabId = getBrowserTabId();
  return tabId
    ? [`design-selection:${tabId}`, "design-selection"]
    : ["design-selection"];
}
// Stable symbol used as the Yjs transaction origin for all local user edits.
// The UndoManager tracks only this origin so remote peers' and the agent's
// edits are never undone by this user's Cmd+Z.
const LOCAL_EDIT_ORIGIN = TAB_ID + ":local";
const MAX_GENERATION_ATTEMPTS = 3;
const AUTO_RETRY_DELAY_MS = 1200;

type EditorMode = "comment" | "edit" | "draw";

interface DesignFile {
  id: string;
  filename: string;
  fileType: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface DesignData {
  id: string;
  title: string;
  description?: string;
  projectType: string;
  designSystemId?: string | null;
  data?: string | null;
  files: DesignFile[];
}

function formatUploadedFileContext(files: UploadedFile[]): string {
  if (files.length === 0) return "";

  const lines: string[] = [
    "",
    `The user uploaded ${files.length} file(s) for context:`,
  ];

  files.forEach((file, index) => {
    lines.push(
      `${index + 1}. ${file.originalName} (${file.type}, ${(file.size / 1024).toFixed(1)}KB) at path: ${file.path}`,
    );
    const text = file.textContent?.trim();
    if (text) {
      lines.push(
        `Extracted text${file.textTruncated ? " (truncated)" : ""}:\n${text}`,
      );
    }
  });

  return lines.join("\n");
}

function imageAttachmentsFromUploadedFiles(files: UploadedFile[]): string[] {
  return files
    .map((file) => file.dataUrl)
    .filter((dataUrl): dataUrl is string => !!dataUrl?.trim());
}

function formatTweakDefinitionsContext(tweaks: TweakDefinition[]): string {
  if (tweaks.length === 0) return "None yet.";
  return JSON.stringify(
    tweaks.map((tweak) => ({
      id: tweak.id,
      label: tweak.label,
      type: tweak.type,
      cssVar: tweak.cssVar,
      defaultValue: tweak.defaultValue,
      options: tweak.options,
      min: tweak.min,
      max: tweak.max,
      step: tweak.step,
    })),
    null,
    2,
  );
}

function designSystemGenerationDirectives(
  designSystemId?: string | null,
): string[] {
  if (!designSystemId) return [];
  return [
    `Use design system id "${designSystemId}" for this generation.`,
    "Before generating visual code, call `get-design-system` for that id and follow its tokens, assets, and custom instructions.",
    `When calling \`generate-design\`, pass \`designSystemId: "${designSystemId}"\` so the design remains linked.`,
  ];
}

function designIntakeQuestionDirectives(
  designId: string,
  designSystemId?: string | null,
): string[] {
  return [
    `This is a new UI-started design for design id "${designId}". The design shell already exists - DO NOT call create-design.`,
    ...designSystemGenerationDirectives(designSystemId),
    "First, call `show-design-questions` with 4-6 tailored questions and then stop. Do NOT call generate-design or present-design-variants until the user submits or skips the questions.",
    "Make the questions feel like Claude Design intake: form factor, aesthetic direction, important features/content, special interactions/polish, and whether to explore variations. Omit or rephrase anything the user's prompt already answered.",
    "Use concise option chips with `allowOther: true`; include a practical `Decide for me` option where useful. Use `multiSelect: true` for feature/interactions questions.",
    "Set a specific title like `Quick questions about your todo app` and a short description. After `show-design-questions` succeeds, wait for the user's answers.",
  ];
}

function designGenerationDirectives(
  designId: string,
  designSystemId?: string | null,
): string[] {
  return [
    `Use the \`generate-design --designId="${designId}"\` action with exactly one complete, renderable \`index.html\` file first. The design already exists - DO NOT call create-design.`,
    ...designSystemGenerationDirectives(designSystemId),
    "If the user asked to explore variations, call `present-design-variants` with 2-5 complete HTML directions and wait for their pick before calling generate-design. Otherwise generate one polished first direction.",
    "Keep the first pass bounded enough to finish quickly: one self-contained Alpine.js + Tailwind CDN HTML document, polished but concise. Add 3-6 tweaks only when they naturally fit the design.",
    "After generate-design succeeds, stop and summarize what was created.",
  ];
}

function applyInlineStyleToHtml(
  content: string,
  selector: string,
  property: string,
  value: string,
): string | null {
  if (typeof window === "undefined") return null;
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const element = doc.querySelector(selector) as HTMLElement | null;
    if (!element) return null;
    (element.style as any)[property] = value;
    return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
  } catch {
    return null;
  }
}

function getBodyInlineStyles(content: string): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const doc = new DOMParser().parseFromString(content, "text/html");
    const body = doc.body;
    if (!body) return {};
    return {
      backgroundColor: body.style.backgroundColor,
      fontFamily: body.style.fontFamily,
      fontSize: body.style.fontSize,
    };
  } catch {
    return {};
  }
}

function isDesignData(
  data: DesignData | string | undefined,
): data is DesignData {
  return !!data && typeof data === "object" && Array.isArray(data.files);
}

function areTweakSelectionsEqual(
  a: TweakSelections,
  b: TweakSelections,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => Object.is(a[key], b[key]));
}

function buildAuthoritativeTweakSelections(
  tweaks: TweakDefinition[],
  persistedSelections: TweakSelections,
): TweakSelections {
  const selections: TweakSelections = {};
  for (const tweak of tweaks) {
    selections[tweak.id] =
      persistedSelections[tweak.id] !== undefined
        ? persistedSelections[tweak.id]
        : tweak.defaultValue;
  }
  return selections;
}

export default function DesignEditor() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const openMobileSidebar = useOpenMobileSidebar();
  const embedded = isEmbedAuthActive();

  // Editor state
  const [mode, setMode] = useState<EditorMode>("comment");
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [zoom, setZoom] = useState(100);
  const [deviceFrame, setDeviceFrame] = useState<DeviceFrameType>("none");
  const [viewMode, setViewMode] = useState<"single" | "overview">("single");
  const [selectedElement, setSelectedElement] = useState<ElementInfo | null>(
    null,
  );
  const [hoveredElement, setHoveredElement] = useState<ElementInfo | null>(
    null,
  );
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [tweaksVisible, setTweaksVisible] = useState(false);
  // Undo/redo state driven by Y.UndoManager
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const undoManagerRef = useRef<Y.UndoManager | null>(null);
  const persistedSelectionStateRef = useRef<string | null>(null);
  const designSelectionOwnerIdRef = useRef(`${TAB_ID}:${generateTabId()}`);
  const [tweakSaveActive, setTweakSaveActive] = useState(false);
  // Shared visual-editor modes (overlays the iframe). drawMode toggles the
  // pencil overlay, pinMode lets the user drop comment pins. They're
  // mutually exclusive — turning one on turns the other off.
  const [drawMode, setDrawMode] = useState(false);
  const [pinMode, setPinMode] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [showTweakPrompt, setShowTweakPrompt] = useState(false);
  const [svgExporting, setSvgExporting] = useState(false);
  const generateBtnRef = useRef<HTMLButtonElement | null>(null);
  const promptAnchorRef = useRef<HTMLElement | null>(null);
  const tweakPromptAnchorRef = useRef<HTMLElement | null>(null);
  promptAnchorRef.current = generateBtnRef.current;
  const [hasPendingGeneration, setHasPendingGeneration] = useState(() =>
    hasFreshPendingGeneration(id),
  );
  const [generationChatTabId, setGenerationChatTabId] = useState<string | null>(
    null,
  );
  const [generationIssue, setGenerationIssue] = useState<string | null>(null);
  const [promptDesignSystemId, setPromptDesignSystemId] = useState<
    string | null | undefined
  >(undefined);

  useEffect(() => {
    return () => {
      void (async () => {
        const keys = designSelectionStateKeys();
        const current = await readClientAppState(keys[0]).catch(() => null);
        const ownerId =
          current && typeof current === "object"
            ? (current as { ownerId?: unknown }).ownerId
            : undefined;
        if (ownerId !== designSelectionOwnerIdRef.current) return;
        persistedSelectionStateRef.current = null;
        for (const key of designSelectionStateKeys()) {
          await setClientAppState(key, null, {
            keepalive: true,
          }).catch(() => {});
        }
      })();
    };
  }, []);
  // When generation stalls we keep the original prompt + files around so the
  // user can retry with one click instead of re-typing. Cleared as soon as the
  // user kicks off a new run (retry or fresh prompt).
  const [retryablePrompt, setRetryablePrompt] = useState<{
    prompt: string;
    files: UploadedFile[];
    model?: PromptComposerSubmitOptions["model"];
    engine?: PromptComposerSubmitOptions["engine"];
    effort?: PromptComposerSubmitOptions["effort"];
    designSystemId?: string | null;
    attempt?: number;
  } | null>(null);
  const generationOutputReadyRef = useRef(false);
  const generationCompleteTimerRef = useRef<number | null>(null);
  const autoRetryTimerRef = useRef<number | null>(null);
  const clearGenerationCompleteTimer = useCallback(() => {
    if (generationCompleteTimerRef.current !== null) {
      window.clearTimeout(generationCompleteTimerRef.current);
      generationCompleteTimerRef.current = null;
    }
  }, []);
  const clearAutoRetryTimer = useCallback(() => {
    if (autoRetryTimerRef.current !== null) {
      window.clearTimeout(autoRetryTimerRef.current);
      autoRetryTimerRef.current = null;
    }
  }, []);
  const staleToastShownRef = useRef(false);
  const rememberPendingGenerationForRetry = useCallback(() => {
    const pending = readPendingGeneration(id);
    if (pending?.prompt) {
      setRetryablePrompt({
        prompt: pending.prompt,
        files: Array.isArray(pending.files) ? pending.files : [],
        model: pending.model,
        engine: pending.engine,
        effort: pending.effort,
        designSystemId: pending.designSystemId,
        attempt: pending.attempt ?? 1,
      });
      return true;
    }
    return false;
  }, [id]);
  const markGenerationStale = useCallback(() => {
    clearGenerationCompleteTimer();
    // Capture the original prompt before clearing so the user can retry without
    // re-typing it. The full pending payload (model/engine/effort) is preserved
    // so the retry runs with identical settings.
    rememberPendingGenerationForRetry();
    clearPendingGeneration(id);
    setHasPendingGeneration(false);
    setGenerationIssue(t("designEditor.generationMayHaveStopped"));
    if (!staleToastShownRef.current) {
      staleToastShownRef.current = true;
      toast.info(t("designEditor.generationMayHaveStoppedToast"));
    }
  }, [clearGenerationCompleteTimer, id, rememberPendingGenerationForRetry, t]);
  const handleGenerationComplete = useCallback(() => {
    clearGenerationCompleteTimer();
    generationCompleteTimerRef.current = window.setTimeout(() => {
      generationCompleteTimerRef.current = null;
      const hasOutput = generationOutputReadyRef.current;
      const preservedForRetry = hasOutput
        ? false
        : rememberPendingGenerationForRetry();
      clearPendingGeneration(id);
      setHasPendingGeneration(false);
      staleToastShownRef.current = false;
      setGenerationIssue(
        hasOutput
          ? null
          : preservedForRetry
            ? t("designEditor.generationStoppedRetry")
            : t("designEditor.generationStoppedCheckAgent"),
      );
    }, 4000);
  }, [clearGenerationCompleteTimer, id, rememberPendingGenerationForRetry, t]);
  const {
    generating,
    submit: agentSubmit,
    reset: resetAgentGenerating,
    track: trackAgentGeneration,
  } = useAgentGenerating({
    onComplete: handleGenerationComplete,
    onStale: markGenerationStale,
    shouldAdoptRunningTab: () =>
      Boolean(id) && !generationOutputReadyRef.current,
    onAdoptRunningTab: (tabId) => {
      setGenerationChatTabId(tabId);
      setHasPendingGeneration(true);
    },
  });
  const handleQuestionFlowContinue = useCallback(
    (runTabId: string) => {
      clearGenerationCompleteTimer();
      setGenerationIssue(null);
      setRetryablePrompt(null);
      setGenerationChatTabId(runTabId);
      const pending = readPendingGeneration(id, { allowUntimestamped: true });
      patchPendingGeneration(id, {
        prompt: pending?.prompt ?? "Continue from answered design questions.",
        files: pending?.files ?? [],
        title: pending?.title,
        designSystemId: pending?.designSystemId,
        model: pending?.model,
        engine: pending?.engine,
        effort: pending?.effort,
        runTabId,
        attempt: pending?.attempt ?? 1,
        startedAt: Date.now(),
      });
      setHasPendingGeneration(true);
      trackAgentGeneration(runTabId);
    },
    [clearGenerationCompleteTimer, id, trackAgentGeneration],
  );

  // Question flow + variant flow — full-canvas overlays driven by the agent.
  const {
    questions: pendingQuestions,
    title: pendingQuestionsTitle,
    description: pendingQuestionsDescription,
    skipLabel: pendingQuestionsSkipLabel,
    submitLabel: pendingQuestionsSubmitLabel,
    handleSubmit: handleQuestionsSubmit,
    handleSkip: handleQuestionsSkip,
  } = useQuestionFlow(id, {
    continuationTabId: generationChatTabId,
    onContinue: handleQuestionFlowContinue,
  });
  const {
    state: pendingVariants,
    useVariant: handleVariantChoice,
    dismiss: handleVariantsDismiss,
    standalonePick,
    dismissStandalonePick,
  } = useVariantFlow(id);

  const { session } = useSession();
  const pendingVariantKey = useMemo(
    () =>
      pendingVariants
        ? `${pendingVariants.designId}:${pendingVariants.variants
            .map((variant) => variant.id)
            .join(",")}`
        : "",
    [pendingVariants],
  );
  const [selectedVariantId, setSelectedVariantId] = useState<
    string | undefined
  >();
  const initialVariantId = pendingVariants?.variants[0]?.id;

  useEffect(() => {
    setSelectedVariantId(initialVariantId);
  }, [initialVariantId, pendingVariantKey]);

  useEffect(() => {
    return () => clearGenerationCompleteTimer();
  }, [clearGenerationCompleteTimer]);
  useEffect(() => {
    return () => clearAutoRetryTimer();
  }, [clearAutoRetryTimer]);

  // Current user info for collaborative presence
  const currentUser: CollabUser | undefined = session?.email
    ? {
        name: emailToName(session.email),
        email: session.email,
        color: emailToColor(session.email),
      }
    : undefined;

  // Data fetching
  useEffect(() => {
    if (!id) return;
    const pending = readPendingGeneration(id);
    if (!pending) {
      setHasPendingGeneration(false);
      return;
    }
    if (isPendingGenerationStale(pending)) {
      markGenerationStale();
      return;
    }
    setHasPendingGeneration(true);
    if (pending.runTabId) {
      setGenerationChatTabId(pending.runTabId);
      trackAgentGeneration(pending.runTabId);
    }
  }, [id, markGenerationStale, trackAgentGeneration]);

  const pendingGenerationActive =
    hasPendingGeneration && !!readPendingGeneration(id);

  const { data: designResult, isLoading: designLoading } = useActionQuery<
    DesignData | string
  >(
    "get-design",
    { id: id! },
    {
      refetchInterval: pendingGenerationActive || generating ? 1000 : false,
    },
  );

  useEffect(() => {
    if (!id || !hasPendingGeneration) return;
    const pending = readPendingGeneration(id);
    if (!pending) {
      setHasPendingGeneration(false);
      return;
    }
    if (isPendingGenerationStale(pending)) {
      markGenerationStale();
      return;
    }

    const timestamp = pending.startedAt ?? pending.createdAt ?? Date.now();
    const remaining = Math.max(
      0,
      PENDING_GENERATION_STALE_MS - (Date.now() - timestamp),
    );
    const timer = window.setTimeout(() => {
      const latest = readPendingGeneration(id);
      if (isPendingGenerationStale(latest)) {
        markGenerationStale();
      }
    }, remaining + 250);

    return () => window.clearTimeout(timer);
  }, [id, hasPendingGeneration, markGenerationStale]);

  const updateFileMutation = useActionMutation("update-file");
  const updateDesignMutation = useActionMutation("update-design");
  const applyTweaksMutation = useActionMutation("apply-tweaks");
  const createCodingHandoffMutation = useActionMutation(
    "export-coding-handoff",
  );
  const exportHtmlMutation = useActionMutation("export-html");
  const exportZipMutation = useActionMutation("export-zip");
  const pendingFileSaveRef = useRef<{ id: string; content: string } | null>(
    null,
  );
  const fileSaveTimerRef = useRef<number | null>(null);

  const queueFileContentSave = useCallback(
    (fileId: string, content: string) => {
      pendingFileSaveRef.current = { id: fileId, content };
      if (fileSaveTimerRef.current) {
        window.clearTimeout(fileSaveTimerRef.current);
      }
      fileSaveTimerRef.current = window.setTimeout(() => {
        const pending = pendingFileSaveRef.current;
        pendingFileSaveRef.current = null;
        fileSaveTimerRef.current = null;
        if (!pending) return;
        updateFileMutation.mutate({
          id: pending.id,
          content: pending.content,
        } as any);
      }, 400);
    },
    [updateFileMutation],
  );

  useEffect(() => {
    return () => {
      if (fileSaveTimerRef.current) {
        window.clearTimeout(fileSaveTimerRef.current);
      }
    };
  }, []);

  // Debounced persistence of the user's live tweak knob values into
  // designs.data.tweakSelections (additive JSON merge, server-side). This is
  // what makes the visual-tune survive reload and feeds the snapshot/handoff
  // round-trip so external agents continue from the *tuned* design.
  const pendingTweakSaveRef = useRef<{
    selections: TweakSelections;
    revision: number;
  } | null>(null);
  const tweakSaveTimerRef = useRef<number | null>(null);
  const tweakSaveRevisionRef = useRef(0);
  const queueTweakSave = useCallback(
    (selections: TweakSelections) => {
      if (!id) return;
      const revision = tweakSaveRevisionRef.current + 1;
      tweakSaveRevisionRef.current = revision;
      setTweakSaveActive(true);
      pendingTweakSaveRef.current = { selections, revision };
      if (tweakSaveTimerRef.current) {
        window.clearTimeout(tweakSaveTimerRef.current);
      }
      tweakSaveTimerRef.current = window.setTimeout(() => {
        const pending = pendingTweakSaveRef.current;
        pendingTweakSaveRef.current = null;
        tweakSaveTimerRef.current = null;
        if (!pending) return;
        applyTweaksMutation.mutate(
          {
            designId: id,
            selections: pending.selections,
          } as any,
          {
            onSettled: () => {
              if (tweakSaveRevisionRef.current === pending.revision) {
                setTweakSaveActive(false);
              }
            },
          },
        );
      }, 600);
    },
    [id, applyTweaksMutation],
  );

  useEffect(() => {
    return () => {
      if (tweakSaveTimerRef.current) {
        window.clearTimeout(tweakSaveTimerRef.current);
      }
    };
  }, []);

  const design = isDesignData(designResult) ? designResult : null;
  const {
    designSystems,
    defaultSystem,
    isLoading: designSystemsLoading,
  } = useDesignSystems();

  const resolvePromptDesignSystemId = useCallback(
    () =>
      design?.designSystemId ??
      defaultSystem?.id ??
      designSystems[0]?.id ??
      null,
    [defaultSystem?.id, design?.designSystemId, designSystems],
  );

  const selectedPromptDesignSystemId =
    promptDesignSystemId === undefined
      ? resolvePromptDesignSystemId()
      : promptDesignSystemId;

  const handlePromptOpenChange = useCallback(
    (open: boolean) => {
      setShowPrompt(open);
      if (open) {
        setPromptDesignSystemId(resolvePromptDesignSystemId());
      } else {
        setPromptDesignSystemId(undefined);
      }
    },
    [resolvePromptDesignSystemId],
  );

  const handleTweakPromptOpenChange = useCallback((open: boolean) => {
    setShowTweakPrompt(open);
    if (!open) {
      tweakPromptAnchorRef.current = null;
    }
  }, []);

  const handleRequestTweaks = useCallback((anchor: HTMLElement) => {
    tweakPromptAnchorRef.current = anchor;
    setTweaksVisible(true);
    setShowTweakPrompt(true);
  }, []);

  const persistPromptDesignSystem = useCallback(
    (designSystemId: string | null) => {
      if (!id || design?.designSystemId === designSystemId) return;
      queryClient.setQueryData(["action", "get-design", { id }], (old: any) => {
        if (!old || typeof old !== "object") return old;
        return { ...old, designSystemId };
      });
      updateDesignMutation.mutate({ id, designSystemId } as any, {
        onError: () => {
          queryClient.invalidateQueries({ queryKey: ["action", "get-design"] });
        },
      });
    },
    [design?.designSystemId, id, queryClient, updateDesignMutation],
  );

  useEffect(() => {
    if (!design?.title) return;
    const nextTitle = `${design.title} — Design`;
    const previousTitle = document.title;
    document.title = nextTitle;
    return () => {
      if (document.title === nextTitle) {
        document.title = previousTitle;
      }
    };
  }, [design?.title]);

  const commitTitleEdit = useCallback(() => {
    setTitleEditing(false);
    if (!id) return;
    const next = titleDraft.trim();
    if (!next || next === design?.title) return;

    queryClient.setQueryData(["action", "get-design", { id }], (old: any) => {
      if (!old || typeof old !== "object") return old;
      return { ...old, title: next };
    });
    queryClient.setQueryData(
      ["action", "list-designs", undefined],
      (old: any) => {
        if (!old) return old;
        return {
          ...old,
          designs: (old.designs ?? []).map((d: any) =>
            d.id === id ? { ...d, title: next } : d,
          ),
        };
      },
    );

    updateDesignMutation.mutate({ id, title: next } as any, {
      onError: () => {
        queryClient.invalidateQueries({ queryKey: ["action", "get-design"] });
      },
    });
  }, [id, titleDraft, design?.title, updateDesignMutation, queryClient]);

  const files = design?.files ?? [];

  generationOutputReadyRef.current =
    files.length > 0 ||
    (pendingQuestions?.length ?? 0) > 0 ||
    !!pendingVariants;

  useEffect(() => {
    if (!id || files.length === 0) return;
    clearGenerationCompleteTimer();
    clearPendingGeneration(id);
    setHasPendingGeneration(false);
    setGenerationIssue(null);
    setRetryablePrompt(null);
    staleToastShownRef.current = false;
  }, [clearGenerationCompleteTimer, id, files.length]);

  useEffect(() => {
    if (!id || !design || files.length > 0) return;

    const pending = readPendingGeneration(id);
    if (!pending) {
      setHasPendingGeneration(false);
      return;
    }

    if (isPendingGenerationStale(pending)) {
      markGenerationStale();
      return;
    }

    if (pending.runTabId) {
      setGenerationIssue(null);
      setHasPendingGeneration(true);
      setGenerationChatTabId(pending.runTabId);
      trackAgentGeneration(pending.runTabId);
      return;
    }

    const prompt =
      pending.prompt?.trim() || `Create an initial design for ${design.title}.`;
    const uploadedFiles = Array.isArray(pending.files) ? pending.files : [];
    const fileContext = formatUploadedFileContext(uploadedFiles);
    const images = imageAttachmentsFromUploadedFiles(uploadedFiles);
    const sourceContext = pending.source
      ? `The user picked the "${pending.source}" template.`
      : "The user just created a new empty design.";
    const pendingDesignSystemId =
      pending.designSystemId === undefined
        ? design.designSystemId
        : pending.designSystemId;

    if (pending.autoGenerate === false) {
      setGenerationIssue(null);
      setHasPendingGeneration(true);
      return;
    }

    const context = [
      sourceContext,
      `Design id: "${id}"`,
      `Design title: "${design.title}"`,
      `User request: "${prompt}"`,
      pendingDesignSystemId
        ? `Design system id: "${pendingDesignSystemId}"`
        : "",
      fileContext,
      "",
      ...designIntakeQuestionDirectives(id, pendingDesignSystemId),
    ].join("\n");

    clearGenerationCompleteTimer();
    setGenerationIssue(null);
    const runTabId = agentSubmit(`Create design: ${prompt}`, context, {
      model: pending.model,
      engine: pending.engine,
      effort: pending.effort,
      newTab: true,
      images,
    });
    setGenerationChatTabId(runTabId);
    patchPendingGeneration(id, {
      runTabId,
      attempt: pending.attempt ?? 1,
      designSystemId: pendingDesignSystemId,
      startedAt: Date.now(),
    });
    setHasPendingGeneration(true);
  }, [
    id,
    design,
    files.length,
    agentSubmit,
    markGenerationStale,
    trackAgentGeneration,
    clearGenerationCompleteTimer,
  ]);

  useEffect(() => {
    return () => clearPendingGeneration(id);
  }, [id]);

  // Set active file to first file when data loads
  useEffect(() => {
    if (files.length > 0 && !activeFileId) {
      setActiveFileId(files[0].id);
    }
  }, [files, activeFileId]);

  const activeFile = files.find((f) => f.id === activeFileId) ?? files[0];

  // Collaborative editing for the active file
  const { ydoc, awareness, isSynced, activeUsers, agentActive } =
    useCollaborativeDoc({
      docId: activeFileId,
      requestSource: TAB_ID,
      user: currentUser,
    });

  // Track collab-sourced content for the active file.
  // When Y.Doc is synced and has content, use it as the source of truth
  // instead of the DB-fetched content so live remote edits appear instantly.
  const [collabContent, setCollabContent] = useState<string | null>(null);
  const prevActiveFileIdRef = useRef<string | null>(null);
  // `updatedAt` of the DB content this preview currently reflects. A poll that
  // returns an older-or-equal value is a stale snapshot and is ignored; a newer
  // one is a genuine external edit (agent / peer-via-SQL) and is reconciled in.
  // Mirrors the content template's VisualEditor `lastAppliedUpdatedAt` gate.
  const lastAppliedFileUpdatedAtRef = useRef<string | null>(null);
  // The last content this client itself wrote into the Y.Doc (inline-style
  // edits) — so the reconcile/observe doesn't treat our own echo as external.
  const lastLocalContentRef = useRef<string | null>(null);
  // Freshest known DB `updatedAt` for the active file, kept in a ref so the
  // Yjs observe handler can advance the reconcile watermark without re-subscribing.
  const documentFileUpdatedAtRef = useRef<string | null>(null);
  const documentFileContentRef = useRef<string | null>(null);
  const collabContentRef = useRef<string | null>(null);
  const staleAgentCollabRecoveryTimerRef = useRef<number | null>(null);
  const clearStaleAgentCollabRecovery = useCallback(() => {
    if (staleAgentCollabRecoveryTimerRef.current !== null) {
      window.clearTimeout(staleAgentCollabRecoveryTimerRef.current);
      staleAgentCollabRecoveryTimerRef.current = null;
    }
  }, []);

  // Whether this client applies authoritative external snapshots into the
  // shared Y.Doc. Exactly one client (the lead) does, so an agent/peer edit
  // that arrives via the get-design refetch isn't diffed into the CRDT by every
  // open client and duplicated. Re-elected on awareness / visibility changes.
  const [isLeadClient, setIsLeadClient] = useState(true);
  useEffect(() => {
    if (!awareness || !ydoc) {
      setIsLeadClient(true);
      return;
    }
    const update = () =>
      setIsLeadClient(isReconcileLeadClient(awareness, ydoc.clientID));
    update();
    awareness.on("change", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      awareness.off("change", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [awareness, ydoc]);

  // Reset per-file reconcile state when switching files
  useEffect(() => {
    if (activeFileId !== prevActiveFileIdRef.current) {
      prevActiveFileIdRef.current = activeFileId;
      setCollabContent(null);
      lastAppliedFileUpdatedAtRef.current = null;
      lastLocalContentRef.current = null;
      clearStaleAgentCollabRecovery();
    }
  }, [activeFileId, clearStaleAgentCollabRecovery]);

  useEffect(() => {
    return clearStaleAgentCollabRecovery;
  }, [clearStaleAgentCollabRecovery]);

  // Seed collab content from Y.Doc once synced
  useEffect(() => {
    if (!ydoc || !isSynced || !activeFileId) return;
    const ytext = ydoc.getText("content");
    const text = ytext.toString();
    if (text.length > 0) {
      // Y.Doc snapshots are a render seed, not the SQL source of truth; the
      // reconcile effect below advances the updatedAt watermark only after it
      // confirms or applies the current DB content.
      setCollabContent(text);
    }
  }, [ydoc, isSynced, activeFileId]);

  // Keep the freshest DB `updatedAt` in a ref the observe handler can read.
  useEffect(() => {
    documentFileUpdatedAtRef.current = activeFile?.updatedAt ?? null;
    documentFileContentRef.current = activeFile?.content ?? null;
  }, [activeFile?.content, activeFile?.updatedAt]);

  useEffect(() => {
    collabContentRef.current = collabContent;
  }, [collabContent]);

  // Observe Y.Text changes for live updates from remote editors (peers + the
  // agent's in-process applyText). This is the instant peer-to-peer path.
  useEffect(() => {
    if (!ydoc || !isSynced) return;
    const ytext = ydoc.getText("content");
    const handler = (_event: unknown, transaction?: { origin?: unknown }) => {
      const next = ytext.toString();
      setCollabContent(next);
      // UndoManager fires with itself as the origin; treat those as local too
      // so the reconcile watermark and stale-selection fix are consistent.
      const isLocalEdit =
        transaction?.origin === TAB_ID ||
        transaction?.origin === LOCAL_EDIT_ORIGIN ||
        transaction?.origin === undoManagerRef.current;
      if (isLocalEdit) {
        lastLocalContentRef.current = next;
      }
      // Only advance the DB reconcile watermark when the live CRDT text
      // actually matches the current SQL snapshot. Otherwise an intermediate
      // or malformed Yjs update can shadow valid saved HTML until reload.
      if (next === documentFileContentRef.current) {
        lastAppliedFileUpdatedAtRef.current =
          documentFileUpdatedAtRef.current ??
          lastAppliedFileUpdatedAtRef.current;
      }
      // Stale-selection fix: when a remote/agent edit changes the document,
      // verify the selected element still exists in the new DOM. If not, clear
      // selection and hover so the Edit panel doesn't operate on a ghost element.
      if (!isLocalEdit) {
        setSelectedElement((prev) => {
          if (!prev) return prev;
          try {
            const iframe = document.querySelector<HTMLIFrameElement>(
              "iframe[data-design-preview-iframe]",
            );
            const doc = iframe?.contentDocument;
            if (doc && (!prev.selector || !doc.querySelector(prev.selector))) {
              return null;
            }
          } catch {
            // iframe not accessible yet — clear defensively
            return null;
          }
          return prev;
        });
        setHoveredElement((prev) => {
          if (!prev) return prev;
          try {
            const iframe = document.querySelector<HTMLIFrameElement>(
              "iframe[data-design-preview-iframe]",
            );
            const doc = iframe?.contentDocument;
            if (doc && (!prev.selector || !doc.querySelector(prev.selector))) {
              return null;
            }
          } catch {
            return null;
          }
          return prev;
        });
      }
    };
    ytext.observe(handler);
    return () => {
      ytext.unobserve(handler);
    };
  }, [ydoc, isSynced]);

  // Create / recreate the UndoManager whenever the active file's ydoc changes.
  // Tracks only LOCAL_EDIT_ORIGIN so remote peers' and agent edits are never
  // undone by this user's Cmd+Z. captureTimeout=800ms coalesces rapid slider
  // drags into a single undo step.
  useEffect(() => {
    if (!ydoc || !isSynced) {
      undoManagerRef.current?.destroy();
      undoManagerRef.current = null;
      setCanUndo(false);
      setCanRedo(false);
      return;
    }
    const ytext = ydoc.getText("content");
    const um = new Y.UndoManager(ytext, {
      trackedOrigins: new Set([LOCAL_EDIT_ORIGIN]),
      captureTimeout: 800,
    });

    const syncState = () => {
      setCanUndo(um.canUndo());
      setCanRedo(um.canRedo());
    };
    um.on("stack-item-added", syncState);
    um.on("stack-item-updated", syncState);
    um.on("stack-item-popped", syncState);
    um.on("stack-cleared", syncState);

    undoManagerRef.current = um;
    syncState();

    return () => {
      um.destroy();
      undoManagerRef.current = null;
      setCanUndo(false);
      setCanRedo(false);
    };
  }, [ydoc, isSynced]);

  // Reconcile authoritative external DB content (agent edit / peer-via-SQL) into
  // the live preview. This is the robustness fallback the Yjs observe path can't
  // guarantee on its own: a collab poll can be missed or paused (e.g. the tab
  // was backgrounded, or refetchInterval is off for a normal agent edit), but
  // get-design still refetches via the action-change invalidate. Driven by
  // `updatedAt`: only content genuinely newer than what the preview reflects is
  // adopted, so a lagging poll can never revert live edits. The lead client also
  // writes it into the Y.Doc so peers receive it and it persists.
  useEffect(() => {
    if (!activeFile || !isSynced) return;
    const dbContent = activeFile.content ?? "";
    const dbUpdatedAt = activeFile.updatedAt ?? null;

    // Already reflecting this exact content (our own echo or Yjs already
    // delivered it) — just advance the watermark and stop.
    if (
      collabContent === dbContent ||
      lastLocalContentRef.current === dbContent
    ) {
      if (dbUpdatedAt) lastAppliedFileUpdatedAtRef.current = dbUpdatedAt;
      return;
    }

    // Only adopt genuinely newer content. No baseline yet (fresh file load)
    // always adopts so a stale persisted Y.Doc can't shadow newer SQL.
    const applied = lastAppliedFileUpdatedAtRef.current;
    const externalNewer = !applied || (!!dbUpdatedAt && dbUpdatedAt > applied);
    const staleAgentEchoPossible =
      agentActive &&
      !!applied &&
      !!dbUpdatedAt &&
      dbUpdatedAt === applied &&
      lastLocalContentRef.current !== collabContent;
    if (!externalNewer) {
      if (staleAgentEchoPossible) {
        if (staleAgentCollabRecoveryTimerRef.current === null) {
          const expectedContent = dbContent;
          const expectedUpdatedAt = dbUpdatedAt;
          staleAgentCollabRecoveryTimerRef.current = window.setTimeout(() => {
            staleAgentCollabRecoveryTimerRef.current = null;
            const currentCollab = collabContentRef.current;
            if (documentFileUpdatedAtRef.current !== expectedUpdatedAt) return;
            if (documentFileContentRef.current !== expectedContent) return;
            if (currentCollab === expectedContent) return;
            if (lastLocalContentRef.current === currentCollab) return;

            setCollabContent(expectedContent);
            lastLocalContentRef.current = expectedContent;
            lastAppliedFileUpdatedAtRef.current = expectedUpdatedAt;

            if (isLeadClient && ydoc) {
              const ytext = ydoc.getText("content");
              if (ytext.toString() !== expectedContent) {
                ydoc.transact(() => {
                  ytext.delete(0, ytext.length);
                  ytext.insert(0, expectedContent);
                }, TAB_ID);
              }
            }
          }, 1200);
        }
      } else {
        clearStaleAgentCollabRecovery();
      }
      return;
    }
    clearStaleAgentCollabRecovery();

    // Render the newer content immediately so the preview is never stale.
    setCollabContent(dbContent);
    lastLocalContentRef.current = dbContent;
    if (dbUpdatedAt) lastAppliedFileUpdatedAtRef.current = dbUpdatedAt;

    // Lead client mirrors it into the shared Y.Doc so other open clients
    // receive it through Yjs and the durable collab state stays in step. The
    // agent's update-file/generate-design already wrote the Y.Doc in-process,
    // so in the common case this is a no-op diff; it only does real work when
    // the Yjs update was missed (the failure this fallback exists to cover).
    if (isLeadClient && ydoc) {
      const ytext = ydoc.getText("content");
      if (ytext.toString() !== dbContent) {
        ydoc.transact(() => {
          ytext.delete(0, ytext.length);
          ytext.insert(0, dbContent);
        }, TAB_ID);
      }
    }
  }, [
    activeFile,
    agentActive,
    clearStaleAgentCollabRecovery,
    collabContent,
    isSynced,
    isLeadClient,
    ydoc,
  ]);

  useEffect(() => {
    const handleVariantPicked = (event: Event) => {
      const detail = (
        event as CustomEvent<{ designId?: string; content?: string }>
      ).detail;
      if (detail?.designId !== id || typeof detail.content !== "string") {
        return;
      }
      setCollabContent(detail.content);
      lastLocalContentRef.current = detail.content;
    };
    window.addEventListener(DESIGN_VARIANT_PICKED_EVENT, handleVariantPicked);
    return () => {
      window.removeEventListener(
        DESIGN_VARIANT_PICKED_EVENT,
        handleVariantPicked,
      );
    };
  }, [id]);

  // Set awareness local state to include which file the user is viewing
  useEffect(() => {
    if (awareness && activeFileId) {
      awareness.setLocalStateField("activeFileId", activeFileId);
    }
  }, [awareness, activeFileId]);

  // Presence kit — others + setPresence for cursor/selection broadcasting.
  const { others, setPresence } = usePresence(
    awareness,
    ydoc?.clientID ?? null,
  );

  // Canvas container ref for cursor overlay coordinate mapping.
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  // Broadcast pointer position (normalized to canvas container) and
  // selected element selector so peers can see where the user is working.
  const handleCanvasPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const container = canvasContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      setPresence({
        cursor: {
          x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
          y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
        },
      });
    },
    [setPresence],
  );

  // Broadcast selected element selector via presence so peers can render a ring.
  useEffect(() => {
    setPresence({ selection: selectedElement?.selector ?? null });
  }, [selectedElement?.selector, setPresence]);

  // Broadcast viewport (active file + zoom) via presence for follow mode.
  useEffect(() => {
    setPresence({
      viewport: { fileId: activeFileId ?? undefined, zoom },
    });
  }, [activeFileId, zoom, setPresence]);

  // Follow mode — clicking an avatar in the toolbar follows that participant.
  const [followingEmail, setFollowingEmail] = useState<string | null>(null);
  const followingId = useMemo(() => {
    if (!followingEmail) return null;
    const lc = followingEmail.trim().toLowerCase();
    const match = others.find((o) => o.user.email.trim().toLowerCase() === lc);
    return match?.clientId ?? null;
  }, [followingEmail, others]);

  const { stopFollowing } = useFollowUser({
    others,
    followingId,
    viewportKey: "viewport",
    onViewport: (vp) => {
      if (vp.fileId && vp.fileId !== activeFileId) {
        setActiveFileId(vp.fileId);
      }
      if (typeof vp.zoom === "number") {
        setZoom(vp.zoom);
      }
    },
  });

  const handleAvatarClick = useCallback(
    (user: CollabUser | null) => {
      const email = user?.email ?? "agent@system";
      const lc = email.trim().toLowerCase();
      if (followingEmail?.trim().toLowerCase() === lc) {
        // Already following — stop.
        setFollowingEmail(null);
        stopFollowing();
      } else {
        setFollowingEmail(email);
      }
    },
    [followingEmail, stopFollowing],
  );

  // Resolve the content to render: prefer collab content, fall back to DB
  const activeContent = collabContent ?? activeFile?.content ?? "";
  const pageStyles = useMemo(
    () => getBodyInlineStyles(activeContent),
    [activeContent],
  );

  useEffect(() => {
    if (files.length > 0) resetAgentGenerating();
  }, [files.length, resetAgentGenerating]);

  // Parse design.data for agent-supplied tweaks. The agent writes a JSON blob
  // to designs.data containing { tweaks: TweakDefinition[], ... }; we surface
  // the tweaks as live controls bound to the design's CSS custom properties.
  const tweaks: TweakDefinition[] = useMemo(() => {
    if (!design?.data) return [];
    try {
      const parsed = JSON.parse(design.data);
      if (Array.isArray(parsed?.tweaks)) return parsed.tweaks;
      return [];
    } catch {
      return [];
    }
  }, [design?.data]);

  // Persisted user knob values live in designs.data.tweakSelections (written by
  // the apply-tweaks action). Restoring them on load is what makes the
  // visual-tune round-trip survive a refresh and feed the snapshot/handoff.
  const persistedSelections: TweakSelections = useMemo(() => {
    if (!design?.data) return {};
    try {
      const parsed = JSON.parse(design.data);
      const sel = parsed?.tweakSelections;
      return sel && typeof sel === "object" && !Array.isArray(sel) ? sel : {};
    } catch {
      return {};
    }
  }, [design?.data]);

  // Tweak values are keyed by tweak id while in the panel, then mapped to
  // CSS-var -> value for the iframe so the design's :root block picks them up.
  // Persisted selections are authoritative for agent edits; a local queued
  // save temporarily pauses adoption so stale refetches don't clobber a drag.
  const authoritativeTweakSelections = useMemo(
    () => buildAuthoritativeTweakSelections(tweaks, persistedSelections),
    [tweaks, persistedSelections],
  );
  const [tweakSelections, setTweakSelections] = useReconciledState(
    authoritativeTweakSelections,
    {
      active: tweakSaveActive,
      equals: areTweakSelectionsEqual,
    },
  );

  // Map tweak selections (id -> value) to CSS-var assignments (--var -> value)
  // for the iframe bridge. Shared with the snapshot/handoff actions via
  // `@shared/resolve-tweaks` so the UI and external agents resolve identically.
  const cssVarValues = useMemo(
    () => resolveTweaksToCssVars(tweaks, tweakSelections),
    [tweaks, tweakSelections],
  );

  const handleTweakPromptSubmit = useCallback(
    (
      prompt: string,
      files: UploadedFile[],
      options: PromptComposerSubmitOptions,
    ) => {
      if (!design) return;
      const trimmed = prompt.trim();
      if (!trimmed) return;
      const fileContext = formatUploadedFileContext(files);
      const images = imageAttachmentsFromUploadedFiles(files);
      const currentSelections =
        Object.keys(tweakSelections).length > 0
          ? JSON.stringify(tweakSelections, null, 2)
          : "None yet.";
      const context = [
        `The user is in the Design editor tweaks panel for design id "${id}" (title: "${design.title}").`,
        activeFile
          ? `Active file: "${activeFile.filename}" (file id: "${activeFile.id}").`
          : "There is no active file yet.",
        `User request: "${trimmed}"`,
        "",
        "Existing tweak definitions:",
        formatTweakDefinitionsContext(tweaks),
        "",
        "Current selected tweak values:",
        currentSelections,
        fileContext,
        "",
        "Add or update live tweak controls for this design. Keep existing useful tweak controls unless the user explicitly asks to replace them.",
        "If a requested control needs a new CSS custom property, first read the live design with `get-design-snapshot`, update the relevant HTML/CSS so the property is used, then persist the complete updated tweak definition list through `generate-design`.",
        "For tiny source changes, prefer `edit-design`, but make sure the tweak definitions are saved so the Tweaks panel updates.",
      ].join("\n");

      sendToAgentChat({
        message: `Add tweak controls to "${design.title}": ${trimmed}`,
        context,
        submit: true,
        openSidebar: true,
        model: options.model,
        engine: options.engine,
        effort: options.effort,
        images,
      });
      handleTweakPromptOpenChange(false);
    },
    [
      activeFile,
      design,
      handleTweakPromptOpenChange,
      id,
      tweakSelections,
      tweaks,
    ],
  );

  // Expose selection state for agent context
  useEffect(() => {
    if (!id) return;
    const selection = {
      designId: id,
      designTitle: design?.title ?? null,
      activeFileId: activeFile?.id ?? null,
      activeFilename: activeFile?.filename ?? null,
      selectedElement,
      hoveredElement,
      mode,
    };
    (window as any).__designSelection = selection;
    const persistedSelection = {
      designId: selection.designId,
      designTitle: selection.designTitle,
      activeFileId: selection.activeFileId,
      activeFilename: selection.activeFilename,
      selectedElement: selection.selectedElement,
      mode: selection.mode,
      ownerId: designSelectionOwnerIdRef.current,
    };
    const persistedKey = JSON.stringify(persistedSelection);
    if (persistedSelectionStateRef.current !== persistedKey) {
      persistedSelectionStateRef.current = persistedKey;
      for (const key of designSelectionStateKeys()) {
        setClientAppState(key, persistedSelection, {
          keepalive: true,
        }).catch(() => {});
      }
    }
    const el = document.documentElement;
    el.dataset.designId = id;
    if (activeFile?.id) el.dataset.fileId = activeFile.id;
    return () => {
      delete (window as any).__designSelection;
      delete el.dataset.designId;
      delete el.dataset.fileId;
    };
  }, [id, design, activeFile, selectedElement, hoveredElement, mode]);

  const handleElementSelect = useCallback((info: ElementInfo) => {
    setSelectedElement(info);
  }, []);

  const handleElementHover = useCallback((info: ElementInfo) => {
    setHoveredElement(info);
  }, []);

  const handleStyleChange = useCallback(
    (property: string, value: string) => {
      if (!activeFile) return;
      const selector = selectedElement?.selector ?? "body";
      const sendStyleChange = (window as any).__designCanvasSendStyle;
      if (typeof sendStyleChange === "function") {
        sendStyleChange(selector, property, value);
      }

      const nextContent = applyInlineStyleToHtml(
        activeContent,
        selector,
        property,
        value,
      );
      if (!nextContent) return;

      setCollabContent(nextContent);
      // Mark as our own write so the get-design reconcile + Yjs observe don't
      // treat the echo as an external edit and fight the live value.
      lastLocalContentRef.current = nextContent;
      // Write the edit into the shared Y.Doc so other open clients see it live
      // through Yjs (not only via the slower update-file → applyText round-trip).
      // Use LOCAL_EDIT_ORIGIN so the UndoManager captures this transaction.
      if (ydoc && isSynced) {
        const ytext = ydoc.getText("content");
        if (ytext.toString() !== nextContent) {
          ydoc.transact(() => {
            ytext.delete(0, ytext.length);
            ytext.insert(0, nextContent);
          }, LOCAL_EDIT_ORIGIN);
        }
      }
      queueFileContentSave(activeFile.id, nextContent);
      setSelectedElement((prev) =>
        prev
          ? {
              ...prev,
              computedStyles: { ...prev.computedStyles, [property]: value },
            }
          : prev,
      );
    },
    [
      activeContent,
      activeFile,
      queueFileContentSave,
      selectedElement,
      ydoc,
      isSynced,
    ],
  );

  // Handle undo: pop from UndoManager, then queue SQL persist.
  // The Y.Text observer already calls setCollabContent when the doc changes,
  // but undo/redo transactions use the UndoManager as origin so we must also
  // advance lastLocalContentRef and trigger the debounced save here.
  const handleUndo = useCallback(() => {
    const um = undoManagerRef.current;
    if (!um || !um.canUndo()) return;
    um.undo();
    if (ydoc && activeFile) {
      const next = ydoc.getText("content").toString();
      lastLocalContentRef.current = next;
      queueFileContentSave(activeFile.id, next);
    }
  }, [ydoc, activeFile, queueFileContentSave]);

  const handleRedo = useCallback(() => {
    const um = undoManagerRef.current;
    if (!um || !um.canRedo()) return;
    um.redo();
    if (ydoc && activeFile) {
      const next = ydoc.getText("content").toString();
      lastLocalContentRef.current = next;
      queueFileContentSave(activeFile.id, next);
    }
  }, [ydoc, activeFile, queueFileContentSave]);

  // Keyboard shortcuts for undo (Cmd/Ctrl+Z) and redo (Shift+Cmd/Ctrl+Z or Ctrl+Y).
  // Guards: does not fire when focus is inside an input, textarea, select, or
  // contentEditable element (title editing, prompt composer, etc.).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip if focus is in a text input / editable area in the parent app.
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName.toLowerCase();
        if (
          tag === "input" ||
          tag === "textarea" ||
          tag === "select" ||
          target.isContentEditable
        ) {
          return;
        }
      }

      const isMac = navigator.platform.toLowerCase().startsWith("mac");
      const modKey = isMac ? e.metaKey : e.ctrlKey;

      const isUndo = modKey && !e.shiftKey && e.key === "z";
      const isRedo =
        (modKey && e.shiftKey && e.key === "z") ||
        (e.ctrlKey && !e.shiftKey && e.key === "y");

      if (isUndo) {
        e.preventDefault();
        handleUndo();
      } else if (isRedo) {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleUndo, handleRedo]);

  const handleZoomIn = useCallback(() => {
    setZoom((z) => {
      const next = ZOOM_PRESETS.find((p) => p > z);
      return next ?? z;
    });
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((z) => {
      const prev = [...ZOOM_PRESETS].reverse().find((p) => p < z);
      return prev ?? z;
    });
  }, []);

  const handleModeChange = useCallback(
    (next: EditorMode) => {
      if (next === "draw" && (!activeFile || viewMode === "overview")) return;

      setMode(next);
      setSelectedElement(null);

      if (next === "draw") {
        setDrawMode(true);
        setPinMode(false);
      } else if (next === "comment") {
        setDrawMode(false);
        setPinMode(Boolean(activeFile && viewMode !== "overview"));
      } else {
        setDrawMode(false);
        if (next === "edit") setPinMode(false);
      }
    },
    [activeFile, viewMode],
  );

  useEffect(() => {
    if (
      embedded ||
      mode !== "comment" ||
      !activeFile ||
      viewMode === "overview"
    ) {
      return;
    }
    setPinMode(true);
  }, [activeFile?.id, embedded, mode, viewMode]);

  const handleCommentTabClick = useCallback(() => {
    if (mode !== "comment" || !activeFile || viewMode === "overview") return;
    setPinMode(true);
    setDrawMode(false);
  }, [activeFile, mode, viewMode]);

  const handleViewModeToggle = useCallback(() => {
    setDrawMode(false);
    setPinMode(false);
    if (viewMode === "single") setMode("comment");
    setViewMode((current) => {
      return current === "overview" ? "single" : "overview";
    });
  }, [viewMode]);

  const handlePinToolToggle = useCallback(() => {
    if (!activeFile || viewMode === "overview") return;
    if (pinMode) {
      setPinMode(false);
      return;
    }
    setMode("comment");
    setPinMode(true);
    setDrawMode(false);
  }, [activeFile, pinMode, viewMode]);

  const startRetryGeneration = useCallback(
    (
      promptState: NonNullable<typeof retryablePrompt>,
      attempt: number,
      mode: "manual" | "auto",
    ) => {
      if (!id || !design) return;
      clearAutoRetryTimer();
      const fileContext = formatUploadedFileContext(promptState.files);
      const images = imageAttachmentsFromUploadedFiles(promptState.files);
      const retryLine =
        mode === "auto"
          ? `(Automatically retrying attempt ${attempt} of ${MAX_GENERATION_ATTEMPTS} — the previous attempt did not complete.)`
          : "(Retrying — the previous attempt did not complete.)";
      const context = [
        `The user has design "${id}" (title: "${design.title}") open and wants to fill it with design files.`,
        `User request: "${promptState.prompt}"`,
        promptState.designSystemId
          ? `Design system id: "${promptState.designSystemId}"`
          : "",
        fileContext,
        "",
        retryLine,
        ...designGenerationDirectives(id, promptState.designSystemId),
      ].join("\n");
      clearGenerationCompleteTimer();
      setGenerationIssue(null);
      const runTabId = agentSubmit(
        `Generate design for "${design.title}": ${promptState.prompt}`,
        context,
        {
          model: promptState.model,
          engine: promptState.engine,
          effort: promptState.effort,
          images,
        },
      );
      setGenerationChatTabId(runTabId);
      patchPendingGeneration(id, {
        prompt: promptState.prompt,
        files: promptState.files,
        title: design.title,
        designSystemId: promptState.designSystemId,
        model: promptState.model,
        engine: promptState.engine,
        effort: promptState.effort,
        attempt,
        runTabId,
        startedAt: Date.now(),
      });
      setHasPendingGeneration(true);
      setRetryablePrompt(null);
    },
    [
      id,
      design,
      agentSubmit,
      clearAutoRetryTimer,
      clearGenerationCompleteTimer,
    ],
  );

  const handleRetryGeneration = useCallback(() => {
    if (!retryablePrompt) return;
    startRetryGeneration(
      retryablePrompt,
      (retryablePrompt.attempt ?? 1) + 1,
      "manual",
    );
  }, [retryablePrompt, startRetryGeneration]);

  useEffect(() => {
    clearAutoRetryTimer();
    if (
      !retryablePrompt ||
      !generationIssue ||
      generating ||
      pendingGenerationActive
    ) {
      return;
    }
    const completedAttempt = retryablePrompt.attempt ?? 1;
    if (completedAttempt >= MAX_GENERATION_ATTEMPTS) return;

    autoRetryTimerRef.current = window.setTimeout(() => {
      autoRetryTimerRef.current = null;
      startRetryGeneration(retryablePrompt, completedAttempt + 1, "auto");
    }, AUTO_RETRY_DELAY_MS);

    return clearAutoRetryTimer;
  }, [
    retryablePrompt,
    generationIssue,
    generating,
    pendingGenerationActive,
    startRetryGeneration,
    clearAutoRetryTimer,
  ]);

  const handleCopyCodingHandoff = useCallback(() => {
    if (!id) return;
    createCodingHandoffMutation.mutate(
      {
        id,
        origin: window.location.origin,
        format: "markdown",
      } as any,
      {
        onSuccess: async (result: any) => {
          const text =
            typeof result?.clipboardText === "string"
              ? result.clipboardText
              : typeof result?.prompt === "string"
                ? result.prompt
                : "";
          if (!text) {
            toast.error(t("designEditor.toasts.codingHandoffError"));
            return;
          }
          try {
            await navigator.clipboard.writeText(text);
            toast.success(t("designEditor.toasts.codingHandoffCopied"));
          } catch {
            toast.error(t("designEditor.toasts.clipboardBlocked"));
          }
        },
        onError: (error) => {
          toast.error(
            error.message || t("designEditor.toasts.codingHandoffError"),
          );
        },
      },
    );
  }, [createCodingHandoffMutation, id, t]);

  const triggerBlobDownload = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }, []);

  const fallbackExportName = useCallback(
    (extension: string) => {
      const safeTitle =
        design?.title?.replace(/[^a-zA-Z0-9_-]/g, "-") || "design";
      return `${safeTitle}.${extension}`;
    },
    [design?.title],
  );

  const handleDownloadHtml = useCallback(() => {
    if (!id) return;
    exportHtmlMutation.mutate({ id } as any, {
      onSuccess: (result: any) => {
        if (typeof result?.html !== "string") {
          toast.error(t("designEditor.toasts.htmlCreateError"));
          return;
        }
        triggerBlobDownload(
          new Blob([result.html], { type: "text/html;charset=utf-8" }),
          result.filename || fallbackExportName("html"),
        );
        toast.success(t("designEditor.toasts.htmlDownloaded"));
      },
      onError: (error) => {
        toast.error(error.message || t("designEditor.toasts.htmlExportError"));
      },
    });
  }, [exportHtmlMutation, fallbackExportName, id, t, triggerBlobDownload]);

  const handleDownloadZip = useCallback(() => {
    if (!id) return;
    exportZipMutation.mutate({ id } as any, {
      onSuccess: (result: any) => {
        if (typeof result?.zipBase64 !== "string") {
          toast.error(t("designEditor.toasts.zipCreateError"));
          return;
        }
        const binary = window.atob(result.zipBase64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
          bytes[i] = binary.charCodeAt(i);
        }
        triggerBlobDownload(
          new Blob([bytes], { type: "application/zip" }),
          result.filename || fallbackExportName("zip"),
        );
        toast.success(t("designEditor.toasts.zipDownloaded"));
      },
      onError: (error) => {
        toast.error(error.message || t("designEditor.toasts.zipExportError"));
      },
    });
  }, [exportZipMutation, fallbackExportName, id, t, triggerBlobDownload]);

  const handleDownloadPng = useCallback(async () => {
    const iframe = document.querySelector<HTMLIFrameElement>(
      "iframe[data-design-preview-iframe]",
    );
    const doc = iframe?.contentDocument;
    if (!doc?.documentElement) {
      toast.error(t("designEditor.toasts.openScreenPng"));
      return;
    }
    try {
      const html2canvas = (await import("html2canvas")).default;
      const width = Math.max(
        doc.documentElement.scrollWidth,
        doc.body?.scrollWidth ?? 0,
        iframe?.clientWidth ?? 0,
      );
      const height = Math.max(
        doc.documentElement.scrollHeight,
        doc.body?.scrollHeight ?? 0,
        iframe?.clientHeight ?? 0,
      );
      const canvas = await html2canvas(doc.documentElement, {
        width,
        height,
        windowWidth: width,
        windowHeight: height,
        scale: Math.min(2, window.devicePixelRatio || 1),
        useCORS: true,
        backgroundColor: null,
      });
      canvas.toBlob((blob) => {
        try {
          if (!blob) {
            toast.error(t("designEditor.toasts.pngCreateError"));
            return;
          }
          triggerBlobDownload(blob, fallbackExportName("png"));
          toast.success(t("designEditor.toasts.pngDownloaded"));
        } catch (callbackError) {
          // `triggerBlobDownload` does DOM mutation + `URL.createObjectURL`,
          // either of which can throw inside this async callback — outside
          // the outer try/catch. Surface the failure instead of silently
          // dropping it.
          console.error("PNG export failed during download:", callbackError);
          toast.error(
            callbackError instanceof Error
              ? callbackError.message
              : t("designEditor.toasts.pngSaveError"),
          );
        }
      }, "image/png");
    } catch (error) {
      console.error("PNG export failed:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : t("designEditor.toasts.pngExportError"),
      );
    }
  }, [fallbackExportName, t, triggerBlobDownload]);

  const handleDownloadSvg = useCallback(async () => {
    const iframe = document.querySelector<HTMLIFrameElement>(
      "iframe[data-design-preview-iframe]",
    );
    const doc = iframe?.contentDocument;
    if (!doc?.documentElement) {
      toast.error(t("designEditor.toasts.openScreenSvg"));
      return;
    }

    setSvgExporting(true);
    try {
      const width = Math.max(
        doc.documentElement.scrollWidth,
        doc.body?.scrollWidth ?? 0,
        iframe?.clientWidth ?? 0,
      );
      const height = Math.max(
        doc.documentElement.scrollHeight,
        doc.body?.scrollHeight ?? 0,
        iframe?.clientHeight ?? 0,
      );
      const clone = doc.documentElement.cloneNode(true) as HTMLElement;
      clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
      const stylesheetLinks = Array.from(
        doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]'),
      );
      const clonedStylesheetLinks = Array.from(
        clone.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]'),
      );
      const stylesheets = Array.from(doc.styleSheets);

      stylesheetLinks.forEach((link, index) => {
        const sheet = stylesheets.find(
          (candidate) =>
            (candidate as StyleSheet & { ownerNode?: Node | null })
              .ownerNode === link,
        ) as CSSStyleSheet | undefined;
        let cssText = "";
        try {
          cssText = Array.from(sheet?.cssRules ?? [])
            .map((rule) => rule.cssText)
            .join("\n");
        } catch {
          // Cross-origin stylesheets cannot be read. Leave the original link in
          // place instead of failing the whole export.
          return;
        }
        if (!cssText.trim()) return;
        const style = doc.createElement("style");
        style.setAttribute(
          "data-agent-native-inlined-stylesheet",
          link.getAttribute("href") ?? "",
        );
        style.textContent = cssText;
        clonedStylesheetLinks[index]?.replaceWith(style);
      });
      clone.querySelectorAll("script").forEach((node) => node.remove());
      clone.style.width = `${width}px`;
      clone.style.minHeight = `${height}px`;

      const body = clone.querySelector("body") as HTMLElement | null;
      if (body) {
        body.style.margin = body.style.margin || "0";
        body.style.width = `${width}px`;
        body.style.minHeight = `${height}px`;
      }

      const serializedHtml = new XMLSerializer().serializeToString(clone);
      const safeTitle =
        design?.title
          ?.replace(/&/g, "&amp;")
          .replace(/"/g, "&quot;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;") || t("designEditor.designExport");
      const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${safeTitle}">
  <title>${safeTitle}</title>
  <foreignObject width="${width}" height="${height}">
${serializedHtml}
  </foreignObject>
</svg>`;

      triggerBlobDownload(
        new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
        fallbackExportName("svg"),
      );
      toast.success(t("designEditor.toasts.svgDownloaded"));
    } catch (error) {
      console.error("SVG export failed:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : t("designEditor.toasts.svgExportError"),
      );
    } finally {
      setSvgExporting(false);
    }
  }, [design?.title, fallbackExportName, t, triggerBlobDownload]);

  const zoomLabel = `${Math.round(zoom)}%`;

  if (!id) {
    navigate("/");
    return null;
  }

  if (designLoading || (!design && pendingGenerationActive)) {
    return <DesignEditorSkeleton embedded={embedded} />;
  }

  if (!design) {
    return (
      <div className="flex-1 bg-background flex flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">{t("designEditor.notFound")}</p>
        <Button
          variant="outline"
          onClick={() => navigate("/")}
          className="cursor-pointer"
        >
          <IconArrowLeft className="w-4 h-4" />
          {t("designEditor.backToDesigns")}
        </Button>
      </div>
    );
  }

  const viewportTabs: ViewportTab[] = files.map((f) => ({
    id: f.id,
    filename: f.filename,
  }));
  const hideEmbeddedVariantToolbar = embedded && !!pendingVariants;

  return (
    // h-full not flex-1: the parent <main> uses overflow-y-auto, not flex,
    // so flex-1 on the child doesn't resolve to the available height. h-full
    // works because main itself has a definite height (flex-1 inside a
    // flex-col page shell). Without this the canvas collapses to ~150px.
    <div className="h-full flex flex-col overflow-hidden bg-background">
      {/* Toolbar */}
      <header
        className={cn(
          "shrink-0 overflow-x-auto overflow-y-hidden overscroll-x-contain border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          embedded ? "h-10" : "h-12",
          hideEmbeddedVariantToolbar && "hidden",
        )}
      >
        <div className="flex h-full min-w-max w-full items-center gap-2 px-3">
          {openMobileSidebar && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 cursor-pointer md:hidden"
              onClick={openMobileSidebar}
              aria-label={t("navigation.openNavigation")}
            >
              <IconMenu2 className="w-4 h-4" />
            </Button>
          )}
          <Link
            to="/"
            className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground hover:text-foreground/90"
          >
            <IconArrowLeft className="w-4 h-4" />
          </Link>
          {titleEditing ? (
            <Input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitleEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitTitleEdit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setTitleEditing(false);
                }
              }}
              className="h-7 w-40 text-sm sm:w-[240px]"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setTitleDraft(design.title);
                setTitleEditing(true);
              }}
              title={t("designEditor.clickToRename")}
              className="max-w-[38vw] cursor-text truncate rounded px-1 -mx-1 text-left text-sm font-medium text-foreground/90 hover:bg-accent/50 sm:max-w-[240px]"
            >
              {design.title}
            </button>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-1 pl-2">
            {!embedded && (
              <>
                {/* Mode switcher */}
                <Tabs
                  value={mode}
                  onValueChange={(v) => handleModeChange(v as EditorMode)}
                >
                  <TabsList className="h-8">
                    <TabsTrigger
                      value="comment"
                      className="h-6 px-2 text-xs gap-1"
                      onClick={handleCommentTabClick}
                    >
                      <IconMessage className="w-3 h-3" />
                      {t("designEditor.modes.comment")}
                    </TabsTrigger>
                    <TabsTrigger
                      value="edit"
                      className="h-6 px-2 text-xs gap-1"
                    >
                      <IconPencil className="w-3 h-3" />
                      {t("designEditor.modes.edit")}
                    </TabsTrigger>
                    <TabsTrigger
                      value="draw"
                      className="h-6 px-2 text-xs gap-1"
                      disabled={!activeFile || viewMode === "overview"}
                    >
                      <IconBrush className="w-3 h-3" />
                      {t("designEditor.modes.draw")}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>

                {/* Undo / redo */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 cursor-pointer"
                      onClick={handleUndo}
                      disabled={!canUndo}
                      aria-label={t("designEditor.undo")}
                    >
                      <IconArrowBackUp className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t("designEditor.undoShortcut")}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 cursor-pointer"
                      onClick={handleRedo}
                      disabled={!canRedo}
                      aria-label={t("designEditor.redo")}
                    >
                      <IconArrowForwardUp className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t("designEditor.redoShortcut")}
                  </TooltipContent>
                </Tooltip>

                <div className="w-px h-5 bg-accent mx-1" />
              </>
            )}

            {/* Overview / single-screen toggle. Clicking Overview shows every
              file in the design as a Figma-style pannable lineup. */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={viewMode === "overview" ? "secondary" : "ghost"}
                  size="icon"
                  className="h-7 w-7 cursor-pointer"
                  onClick={handleViewModeToggle}
                  aria-label={
                    viewMode === "overview"
                      ? t("designEditor.returnToCurrentScreen")
                      : t("designEditor.openScreenOverview")
                  }
                >
                  <IconLayoutGrid className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {viewMode === "overview"
                  ? t("designEditor.currentScreen")
                  : t("designEditor.screenOverview")}
              </TooltipContent>
            </Tooltip>

            {!embedded && (
              <>
                {/* Device preview — collapsed into a single menu. */}
                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 px-2 cursor-pointer"
                          disabled={viewMode === "overview"}
                        >
                          {deviceFrame === "desktop" ? (
                            <IconDeviceDesktop className="w-3.5 h-3.5" />
                          ) : deviceFrame === "tablet" ? (
                            <IconDeviceTablet className="w-3.5 h-3.5" />
                          ) : deviceFrame === "mobile" ? (
                            <IconDeviceMobile className="w-3.5 h-3.5" />
                          ) : (
                            <IconViewportWide className="w-3.5 h-3.5" />
                          )}
                          <IconChevronDown className="w-3 h-3 opacity-60" />
                        </Button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t("designEditor.devicePreview")}
                    </TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuRadioGroup
                      value={deviceFrame}
                      onValueChange={(v) =>
                        setDeviceFrame(v as DeviceFrameType)
                      }
                    >
                      <DropdownMenuRadioItem value="none">
                        <IconViewportWide className="mr-2 h-4 w-4" />
                        {t("designEditor.devices.responsive")}
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="desktop">
                        <IconDeviceDesktop className="mr-2 h-4 w-4" />
                        {t("designEditor.devices.desktop")}
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="tablet">
                        <IconDeviceTablet className="mr-2 h-4 w-4" />
                        {t("designEditor.devices.tablet")}
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="mobile">
                        <IconDeviceMobile className="mr-2 h-4 w-4" />
                        {t("designEditor.devices.mobile")}
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* Zoom — collapsed into a single menu. */}
                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 px-2 text-xs tabular-nums text-muted-foreground cursor-pointer"
                        >
                          {zoomLabel}
                          <IconChevronDown className="w-3 h-3 opacity-60" />
                        </Button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent>{t("designEditor.zoom")}</TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="end" className="w-40">
                    <DropdownMenuItem onClick={handleZoomOut}>
                      <IconZoomOut className="mr-2 h-4 w-4" />
                      {t("designEditor.zoomOut")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleZoomIn}>
                      <IconZoomIn className="mr-2 h-4 w-4" />
                      {t("designEditor.zoomIn")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {ZOOM_PRESETS.map((preset) => (
                      <DropdownMenuItem
                        key={preset}
                        onClick={() => setZoom(preset)}
                        className="justify-between"
                      >
                        <span>{preset}%</span>
                        {Math.round(zoom) === preset && (
                          <IconCheck className="h-4 w-4" />
                        )}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <div className="mx-1 h-5 w-px bg-border" />
              </>
            )}

            {!embedded && (
              <ShareButton
                resourceType="design"
                resourceId={id}
                resourceTitle={design.title}
              />
            )}

            {/* More: comment pin + export (progressive disclosure). */}
            {!embedded && (
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="relative h-7 w-7 cursor-pointer"
                      >
                        <IconDotsVertical className="w-3.5 h-3.5" />
                        {pinMode && (
                          <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[#609FF8]" />
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent>{t("designEditor.more")}</TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem
                    onClick={handlePinToolToggle}
                    disabled={!activeFile || viewMode === "overview"}
                  >
                    <IconPin className="mr-2 h-4 w-4" />
                    {pinMode
                      ? t("designEditor.stopPinningComments")
                      : t("designEditor.pinComment")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                    {t("designEditor.export")}
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    onClick={handleDownloadHtml}
                    disabled={!activeFile || exportHtmlMutation.isPending}
                  >
                    <IconCode className="mr-2 h-4 w-4" />
                    {t("designEditor.downloadHtml")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={handleDownloadPng}
                    disabled={!activeFile}
                  >
                    <IconPhoto className="mr-2 h-4 w-4" />
                    {t("designEditor.downloadPng")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={handleDownloadSvg}
                    disabled={!activeFile || svgExporting}
                  >
                    <IconCode className="mr-2 h-4 w-4" />
                    {t("designEditor.downloadSvg")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={handleDownloadZip}
                    disabled={!activeFile || exportZipMutation.isPending}
                  >
                    <IconArchive className="mr-2 h-4 w-4" />
                    {t("designEditor.downloadZip")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={handleCopyCodingHandoff}
                    disabled={
                      !activeFile || createCodingHandoffMutation.isPending
                    }
                  >
                    <IconCode className="mr-2 h-4 w-4" />
                    {t("designEditor.copyCodingHandoff")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {!embedded && (
              <>
                <PresenceBar
                  activeUsers={activeUsers}
                  agentActive={agentActive}
                  currentUserEmail={session?.email}
                  onAvatarClick={handleAvatarClick}
                  followingEmail={followingEmail}
                />
                <NotificationsBell />
                <AgentToggleButton />
              </>
            )}
          </div>
        </div>
      </header>

      {/* Viewport tabs. Filenames map to friendly screen names — designers
          shouldn't see "mobile.html" in the chrome of their canvas. The
          full filename is still the title attribute for power users + a11y. */}
      {viewportTabs.length > 1 && (
        <div className="h-8 shrink-0 overflow-x-auto overflow-y-hidden overscroll-x-contain border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex h-full min-w-max items-center gap-1 px-3">
            {viewportTabs.map((tab) => (
              <Tooltip key={tab.id}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setActiveFileId(tab.id)}
                    className={`shrink-0 cursor-pointer rounded px-2.5 py-1 text-xs ${
                      tab.id === activeFileId
                        ? "bg-accent text-foreground/90"
                        : "text-muted-foreground hover:text-muted-foreground"
                    }`}
                  >
                    {prettyScreenName(tab.filename)}
                  </button>
                </TooltipTrigger>
                <TooltipContent>{tab.filename}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>
      )}

      {/* Main canvas area */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Question flow overlay — full canvas takeover, blocks editing while
            the user answers. Closes itself on submit/skip.
            Variants take precedence: when both states are set (rare race when
            the agent hasn't cleared the question flow before opening variants),
            we hide questions so the user only sees the most recent step. */}
        {pendingQuestions &&
          pendingQuestions.length > 0 &&
          !pendingVariants && (
            <div className="absolute inset-0 z-40 bg-background">
              <QuestionFlow
                questions={pendingQuestions}
                onSubmit={handleQuestionsSubmit}
                onSkip={handleQuestionsSkip}
                title={pendingQuestionsTitle}
                description={pendingQuestionsDescription}
                skipLabel={pendingQuestionsSkipLabel}
                submitLabel={pendingQuestionsSubmitLabel}
              />
            </div>
          )}

        {/* Variant grid overlay — full canvas takeover with 2-5 candidate
            designs. "Use this direction" persists the chosen content as index.html. */}
        {pendingVariants && (
          <div className="absolute inset-0 z-40 flex flex-col bg-background">
            <div
              className={`flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 ${
                embedded ? "h-10" : "h-12"
              }`}
            >
              <div className="min-w-0">
                <span className="block truncate text-sm font-medium text-foreground/90">
                  {pendingVariants.prompt ?? t("designEditor.pickDirection")}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("designEditor.variations", {
                    count: pendingVariants.variants.length,
                  })}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="cursor-pointer"
                onClick={handleVariantsDismiss}
              >
                <IconX className="w-3.5 h-3.5" />
                {t("designEditor.close")}
              </Button>
            </div>
            <div className="flex-1 overflow-hidden">
              <VariantGrid
                variants={pendingVariants.variants}
                selectedId={selectedVariantId}
                onSelect={setSelectedVariantId}
                onUse={handleVariantChoice}
                compact={embedded}
              />
            </div>
          </div>
        )}

        {/* Link-only (CLI / Codex / Claude Code) paste-back: after a pick there
            is no chat bridge, so surface a copyable summary to continue. */}
        {standalonePick && (
          <VariantHandoffCard
            pick={standalonePick}
            onDismiss={dismissStandalonePick}
          />
        )}

        {/* Canvas */}
        {!pendingVariants &&
          (activeFile ? (
            viewMode === "overview" ? (
              <MultiScreenCanvas
                screens={files.map((f) => ({
                  id: f.id,
                  filename: f.filename,
                  content: f.content,
                }))}
                zoom={zoom}
                activeId={activeFileId}
                onPick={(id) => {
                  setActiveFileId(id);
                  setViewMode("single");
                }}
              />
            ) : (
              <div
                ref={canvasContainerRef}
                className="relative flex-1 h-full overflow-hidden"
                onPointerMove={handleCanvasPointerMove}
              >
                <DesignCanvas
                  content={activeContent}
                  zoom={zoom}
                  onZoomChange={setZoom}
                  deviceFrame={deviceFrame}
                  editMode={mode === "edit"}
                  onElementSelect={handleElementSelect}
                  onElementHover={handleElementHover}
                  tweakValues={cssVarValues}
                  drawMode={drawMode}
                  onExitDrawMode={() => {
                    setDrawMode(false);
                    setMode("comment");
                  }}
                  pinMode={pinMode}
                  onExitPinMode={() => setPinMode(false)}
                  designId={id}
                  designTitle={design?.title}
                  commentContextId={`${id}:${activeFile.id}`}
                  commentContextLabel={`${design?.title ?? t("navigation.brand")} / ${prettyScreenName(activeFile.filename)}`}
                  onPrototypeNavigate={(screen) => {
                    if (!screen) return;
                    const norm = (s: string) =>
                      s
                        .replace(/^\.?\//, "")
                        .replace(/\.html?$/i, "")
                        .toLowerCase();
                    const target = norm(screen);
                    if (!target) return;
                    // Exact (normalized) filename match only — a substring match
                    // could send "board" to "dashboard.html".
                    const match = files.find(
                      (f) => norm(f.filename) === target,
                    );
                    if (match) {
                      setViewMode("single");
                      setActiveFileId(match.id);
                    }
                  }}
                />
                {/* Presence: live cursor overlay for remote participants */}
                {others.length > 0 && (
                  <LiveCursorOverlay
                    others={others}
                    containerRef={canvasContainerRef}
                  />
                )}
              </div>
            )
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                {generating || pendingGenerationActive ? (
                  <>
                    <Spinner className="mx-auto mb-3 size-6 text-foreground/30" />
                    <p className="text-sm text-muted-foreground">
                      {t("designEditor.generating")}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground mb-3">
                      {generationIssue ?? t("designEditor.noFiles")}
                    </p>
                    {retryablePrompt ? (
                      <p className="text-xs text-muted-foreground/70 mb-4 max-w-sm mx-auto italic">
                        "{retryablePrompt.prompt}"
                      </p>
                    ) : null}
                    <div className="flex items-center justify-center gap-2">
                      {retryablePrompt ? (
                        <Button
                          size="sm"
                          className="cursor-pointer"
                          onClick={handleRetryGeneration}
                        >
                          <IconRefresh className="w-3.5 h-3.5" />
                          {t("designEditor.tryAgain")}
                        </Button>
                      ) : null}
                      <Button
                        ref={generateBtnRef}
                        variant={retryablePrompt ? "ghost" : "outline"}
                        size="sm"
                        className="cursor-pointer"
                        onClick={() => {
                          setRetryablePrompt(null);
                          handlePromptOpenChange(true);
                        }}
                      >
                        <IconPlus className="w-3.5 h-3.5" />
                        {retryablePrompt
                          ? t("designEditor.newPrompt")
                          : t("designEditor.generateDesign")}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}

        {!pendingVariants && activeFile && viewMode === "single" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant={tweaksVisible ? "secondary" : "outline"}
                size="icon"
                className="absolute bottom-4 right-4 z-[70] size-9 cursor-pointer rounded-full bg-background/95 shadow-lg backdrop-blur"
                onClick={() => setTweaksVisible((visible) => !visible)}
                aria-label={
                  tweaksVisible
                    ? t("designEditor.hideTweaks")
                    : t("designEditor.showTweaks")
                }
              >
                <IconAdjustmentsHorizontal className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              {t("designEditor.tweaks")}
            </TooltipContent>
          </Tooltip>
        )}

        {/* Edit panel (right side) */}
        {mode === "edit" && (
          <EditPanel
            selectedElement={selectedElement}
            pageStyles={pageStyles}
            onStyleChange={handleStyleChange}
          />
        )}

        {/* Tweaks panel (floating, draggable). Renders agent-defined knobs
            (color swatches, segments, sliders, toggles) bound to CSS custom
            properties in the design. Empty state when the design has no
            tweak definitions. */}
        {tweaksVisible && (
          <TweaksPanel
            tweaks={tweaks}
            values={tweakSelections}
            onChange={(tweakId, value) =>
              setTweakSelections((prev) => {
                const next = { ...prev, [tweakId]: value };
                queueTweakSave(next);
                return next;
              })
            }
            onClose={() => setTweaksVisible(false)}
            onRequestTweaks={handleRequestTweaks}
            visible
          />
        )}
      </div>

      <PromptPopover
        open={showPrompt}
        onOpenChange={handlePromptOpenChange}
        title={t("designEditor.generateDesign")}
        placeholder={t("designEditor.generatePlaceholder")}
        onSubmit={(
          prompt: string,
          files: UploadedFile[],
          options: PromptComposerSubmitOptions,
        ) => {
          const designSystemId = selectedPromptDesignSystemId;
          persistPromptDesignSystem(designSystemId);
          const fileContext = formatUploadedFileContext(files);
          const images = imageAttachmentsFromUploadedFiles(files);
          const context = [
            `The user has design "${id}" (title: "${design.title}") open and wants to fill it with design files.`,
            `User request: "${prompt}"`,
            designSystemId ? `Design system id: "${designSystemId}"` : "",
            fileContext,
            "",
            ...designIntakeQuestionDirectives(id, designSystemId),
          ].join("\n");
          clearGenerationCompleteTimer();
          setGenerationIssue(null);
          const runTabId = agentSubmit(
            `Prepare design questions for "${design.title}": ${prompt}`,
            context,
            { ...options, newTab: true, images },
          );
          setGenerationChatTabId(runTabId);
          patchPendingGeneration(id, {
            prompt,
            files,
            title: design.title,
            designSystemId,
            ...options,
            runTabId,
            attempt: 1,
            startedAt: Date.now(),
          });
          setHasPendingGeneration(true);
          handlePromptOpenChange(false);
        }}
        loading={generating}
        anchorRef={promptAnchorRef}
        designSystems={designSystems}
        designSystemsLoading={designSystemsLoading}
        selectedDesignSystemId={selectedPromptDesignSystemId}
        onDesignSystemChange={setPromptDesignSystemId}
        onCreateDesignSystem={() => {
          handlePromptOpenChange(false);
          navigate("/design-systems/setup");
        }}
      />
      <PromptPopover
        open={showTweakPrompt}
        onOpenChange={handleTweakPromptOpenChange}
        title={t("designEditor.tweaksPromptTitle")}
        placeholder={t("designEditor.tweaksPlaceholder")}
        onSubmit={handleTweakPromptSubmit}
        anchorRef={tweakPromptAnchorRef}
      />
    </div>
  );
}
