import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router";
import {
  IconArrowLeft,
  IconPencil,
  IconMessage,
  IconBrush,
  IconSettings,
  IconZoomIn,
  IconZoomOut,
  IconDeviceDesktop,
  IconDeviceTablet,
  IconDeviceMobile,
  IconDeviceDesktopOff,
  IconPlus,
  IconLayoutGrid,
  IconX,
  IconPencilPlus,
  IconPin,
  IconDownload,
  IconCode,
  IconRefresh,
} from "@tabler/icons-react";
import {
  useActionQuery,
  useActionMutation,
  useSession,
  useCollaborativeDoc,
  generateTabId,
  emailToColor,
  emailToName,
  PresenceBar,
  AgentToggleButton,
  NotificationsBell,
  type CollabUser,
  type PromptComposerSubmitOptions,
} from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DesignCanvas } from "@/components/design/DesignCanvas";
import { EditPanel } from "@/components/design/EditPanel";
import { MultiScreenCanvas } from "@/components/design/MultiScreenCanvas";
import { QuestionFlow } from "@/components/design/QuestionFlow";
import { TweaksPanel } from "@/components/design/TweaksPanel";
import { VariantGrid } from "@/components/design/VariantGrid";
import { SaveStatusIndicator } from "@/components/visual-editor";
import PromptPopover from "@/components/editor/PromptDialog";
import type { UploadedFile } from "@/components/editor/PromptDialog";
import { useAgentGenerating } from "@/hooks/use-agent-generating";
import { useQuestionFlow } from "@/hooks/use-question-flow";
import { useVariantFlow } from "@/hooks/use-variant-flow";
import type {
  ElementInfo,
  DeviceFrameType,
  ViewportTab,
} from "@/components/design/types";
import { ZOOM_PRESETS } from "@/components/design/types";
import { prettyScreenName } from "@/lib/screen-names";
import {
  clearPendingGeneration,
  hasFreshPendingGeneration,
  isPendingGenerationStale,
  patchPendingGeneration,
  PENDING_GENERATION_STALE_MS,
  readPendingGeneration,
} from "@/lib/pending-generation";
import type { TweakDefinition } from "@shared/api";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";

const TAB_ID = generateTabId();

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

function designGenerationDirectives(designId: string): string[] {
  return [
    `Use the \`generate-design --designId="${designId}"\` action with exactly one complete, renderable \`index.html\` file first. The design already exists - DO NOT call create-design.`,
    "Do not call show-questions or write design-variants for this UI-started generation unless the user explicitly asks for options or questions.",
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

export default function DesignEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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
  // Tweak values: keyed by tweak id while in the panel; mapped to CSS-var ->
  // value when sent to the iframe so the design's :root block picks them up.
  const [tweakSelections, setTweakSelections] = useState<
    Record<string, string | number | boolean>
  >({});
  // Shared visual-editor modes (overlays the iframe). drawMode toggles the
  // pencil overlay, pinMode lets the user drop comment pins. They're
  // mutually exclusive — turning one on turns the other off.
  const [drawMode, setDrawMode] = useState(false);
  const [pinMode, setPinMode] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const generateBtnRef = useRef<HTMLButtonElement | null>(null);
  const promptAnchorRef = useRef<HTMLElement | null>(null);
  promptAnchorRef.current = generateBtnRef.current;
  const [hasPendingGeneration, setHasPendingGeneration] = useState(() =>
    hasFreshPendingGeneration(id),
  );
  const [generationIssue, setGenerationIssue] = useState<string | null>(null);
  // When generation stalls we keep the original prompt + files around so the
  // user can retry with one click instead of re-typing. Cleared as soon as the
  // user kicks off a new run (retry or fresh prompt).
  const [retryablePrompt, setRetryablePrompt] = useState<{
    prompt: string;
    files: UploadedFile[];
    model?: PromptComposerSubmitOptions["model"];
    engine?: PromptComposerSubmitOptions["engine"];
    effort?: PromptComposerSubmitOptions["effort"];
  } | null>(null);
  const generationOutputReadyRef = useRef(false);
  const generationCompleteTimerRef = useRef<number | null>(null);
  const clearGenerationCompleteTimer = useCallback(() => {
    if (generationCompleteTimerRef.current !== null) {
      window.clearTimeout(generationCompleteTimerRef.current);
      generationCompleteTimerRef.current = null;
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
    setGenerationIssue(
      "Generation may have stopped before creating files. Check the agent message or try again.",
    );
    if (!staleToastShownRef.current) {
      staleToastShownRef.current = true;
      toast.info("Generation may have stopped before creating files.");
    }
  }, [clearGenerationCompleteTimer, id, rememberPendingGenerationForRetry]);
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
            ? "Generation stopped before creating files. Try again to continue from the same prompt."
            : "Generation stopped before creating files. Check the agent message or try again.",
      );
    }, 4000);
  }, [clearGenerationCompleteTimer, id, rememberPendingGenerationForRetry]);
  const {
    generating,
    submit: agentSubmit,
    reset: resetAgentGenerating,
    track: trackAgentGeneration,
  } = useAgentGenerating({
    onComplete: handleGenerationComplete,
    onStale: markGenerationStale,
  });

  // Question flow + variant flow — full-canvas overlays driven by the agent.
  const {
    questions: pendingQuestions,
    title: pendingQuestionsTitle,
    description: pendingQuestionsDescription,
    skipLabel: pendingQuestionsSkipLabel,
    submitLabel: pendingQuestionsSubmitLabel,
    handleSubmit: handleQuestionsSubmit,
    handleSkip: handleQuestionsSkip,
  } = useQuestionFlow(id);
  const {
    state: pendingVariants,
    useVariant: handleUseVariant,
    dismiss: handleVariantsDismiss,
  } = useVariantFlow(id);

  const { session } = useSession();

  useEffect(() => clearGenerationCompleteTimer, [clearGenerationCompleteTimer]);

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
      trackAgentGeneration(pending.runTabId);
    }
  }, [id, markGenerationStale, trackAgentGeneration]);

  const { data: designResult, isLoading: designLoading } = useActionQuery<
    DesignData | string
  >(
    "get-design",
    { id: id! },
    {
      refetchInterval: hasPendingGeneration || generating ? 1000 : false,
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
  const createCodingHandoffMutation = useActionMutation(
    "export-coding-handoff",
  );
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

  const design = isDesignData(designResult) ? designResult : null;

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
      trackAgentGeneration(pending.runTabId);
      return;
    }

    const prompt =
      pending.prompt?.trim() || `Create an initial design for ${design.title}.`;
    const uploadedFiles = Array.isArray(pending.files) ? pending.files : [];
    const fileContext = formatUploadedFileContext(uploadedFiles);
    const sourceContext = pending.source
      ? `The user picked the "${pending.source}" example template.`
      : "The user just created a new empty design.";

    const context = [
      sourceContext,
      `Design id: "${id}"`,
      `Design title: "${design.title}"`,
      `User request: "${prompt}"`,
      fileContext,
      "",
      ...designGenerationDirectives(id),
    ].join("\n");

    clearGenerationCompleteTimer();
    setGenerationIssue(null);
    const runTabId = agentSubmit(`Create design: ${prompt}`, context, {
      model: pending.model,
      engine: pending.engine,
      effort: pending.effort,
      newTab: true,
    });
    patchPendingGeneration(id, {
      runTabId,
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

  // Reset collab content when switching files
  useEffect(() => {
    if (activeFileId !== prevActiveFileIdRef.current) {
      prevActiveFileIdRef.current = activeFileId;
      setCollabContent(null);
    }
  }, [activeFileId]);

  // Seed collab content from Y.Doc once synced
  useEffect(() => {
    if (!ydoc || !isSynced || !activeFileId) return;
    const ytext = ydoc.getText("content");
    const text = ytext.toString();
    if (text.length > 0) {
      setCollabContent(text);
    }
  }, [ydoc, isSynced, activeFileId]);

  // Observe Y.Text changes for live updates from remote editors
  useEffect(() => {
    if (!ydoc || !isSynced) return;
    const ytext = ydoc.getText("content");
    const handler = () => {
      setCollabContent(ytext.toString());
    };
    ytext.observe(handler);
    return () => {
      ytext.unobserve(handler);
    };
  }, [ydoc, isSynced]);

  // Set awareness local state to include which file the user is viewing
  useEffect(() => {
    if (awareness && activeFileId) {
      awareness.setLocalStateField("activeFileId", activeFileId);
    }
  }, [awareness, activeFileId]);

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

  // Initialize tweak selections from defaults the first time we see a tweak set.
  useEffect(() => {
    if (tweaks.length === 0) return;
    setTweakSelections((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const t of tweaks) {
        if (next[t.id] === undefined) {
          next[t.id] = t.defaultValue;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [tweaks]);

  // Map tweak selections (id -> value) to CSS-var assignments (--var -> value)
  // for the iframe bridge. Toggle booleans become "1"/"0"; numbers get the
  // unit they're declared with (px for radius, otherwise unitless).
  const cssVarValues = useMemo(() => {
    const out: Record<string, string> = {};
    for (const t of tweaks) {
      if (!t.cssVar) continue;
      const v = tweakSelections[t.id] ?? t.defaultValue;
      if (typeof v === "boolean") {
        out[t.cssVar] = v ? "1" : "0";
      } else if (typeof v === "number") {
        const unit = t.cssVar.toLowerCase().includes("radius") ? "px" : "";
        out[t.cssVar] = `${v}${unit}`;
      } else {
        out[t.cssVar] = String(v);
      }
    }
    return out;
  }, [tweaks, tweakSelections]);

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
    [activeContent, activeFile, queueFileContentSave, selectedElement],
  );

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

  const handleCommentTabClick = useCallback(() => {
    if (mode !== "comment" || !activeFile || viewMode === "overview") return;
    setPinMode((current) => !current);
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

  const handleDrawToolToggle = useCallback(() => {
    if (!activeFile || viewMode === "overview") return;
    if (drawMode) {
      setDrawMode(false);
      setMode("comment");
      return;
    }
    setMode("draw");
    setDrawMode(true);
    setPinMode(false);
  }, [activeFile, drawMode, viewMode]);

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

  const handleRetryGeneration = useCallback(() => {
    if (!id || !design || !retryablePrompt) return;
    const fileContext = formatUploadedFileContext(retryablePrompt.files);
    const context = [
      `The user has design "${id}" (title: "${design.title}") open and wants to fill it with design files.`,
      `User request: "${retryablePrompt.prompt}"`,
      fileContext,
      "",
      "(Retrying — the previous attempt did not complete.)",
      ...designGenerationDirectives(id),
    ].join("\n");
    clearGenerationCompleteTimer();
    setGenerationIssue(null);
    const runTabId = agentSubmit(
      `Generate design for "${design.title}": ${retryablePrompt.prompt}`,
      context,
      {
        model: retryablePrompt.model,
        engine: retryablePrompt.engine,
        effort: retryablePrompt.effort,
      },
    );
    patchPendingGeneration(id, {
      prompt: retryablePrompt.prompt,
      files: retryablePrompt.files,
      title: design.title,
      model: retryablePrompt.model,
      engine: retryablePrompt.engine,
      effort: retryablePrompt.effort,
      runTabId,
      startedAt: Date.now(),
    });
    setHasPendingGeneration(true);
    setRetryablePrompt(null);
  }, [id, design, retryablePrompt, agentSubmit, clearGenerationCompleteTimer]);

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
            toast.error("Could not create coding handoff");
            return;
          }
          try {
            await navigator.clipboard.writeText(text);
            toast.success("Coding handoff copied");
          } catch {
            toast.error("Clipboard blocked");
          }
        },
        onError: (error) => {
          toast.error(error.message || "Could not create coding handoff");
        },
      },
    );
  }, [createCodingHandoffMutation, id]);

  if (!id) {
    navigate("/");
    return null;
  }

  if (designLoading || (!design && hasPendingGeneration)) {
    return (
      <div className="flex-1 bg-background flex items-center justify-center">
        <Spinner className="size-8 text-foreground/30" />
      </div>
    );
  }

  if (!design) {
    return (
      <div className="flex-1 bg-background flex flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Design not found</p>
        <Button
          variant="outline"
          onClick={() => navigate("/")}
          className="cursor-pointer"
        >
          <IconArrowLeft className="w-4 h-4" />
          Back to designs
        </Button>
      </div>
    );
  }

  const viewportTabs: ViewportTab[] = files.map((f) => ({
    id: f.id,
    filename: f.filename,
  }));

  return (
    // h-full not flex-1: the parent <main> uses overflow-y-auto, not flex,
    // so flex-1 on the child doesn't resolve to the available height. h-full
    // works because main itself has a definite height (flex-1 inside a
    // flex-col page shell). Without this the canvas collapses to ~150px.
    <div className="h-full flex flex-col overflow-hidden bg-background">
      {/* Toolbar */}
      <header className="h-12 border-b border-border flex items-center justify-between px-3 shrink-0">
        <div className="flex items-center gap-2">
          <Link
            to="/"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground/90"
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
              className="h-7 w-[240px] text-sm"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setTitleDraft(design.title);
                setTitleEditing(true);
              }}
              title="Click to rename"
              className="text-sm font-medium text-foreground/90 truncate max-w-[240px] cursor-text rounded px-1 -mx-1 hover:bg-accent/50 text-left"
            >
              {design.title}
            </button>
          )}
          <Badge variant="secondary" className="text-[10px]">
            {design.projectType}
          </Badge>
        </div>

        <div className="flex items-center gap-1">
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
                Comment
              </TabsTrigger>
              <TabsTrigger value="edit" className="h-6 px-2 text-xs gap-1">
                <IconPencil className="w-3 h-3" />
                Edit
              </TabsTrigger>
              <TabsTrigger
                value="draw"
                className="h-6 px-2 text-xs gap-1"
                disabled={!activeFile || viewMode === "overview"}
              >
                <IconBrush className="w-3 h-3" />
                Draw
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="w-px h-5 bg-accent mx-1" />

          {/* Overview / single-screen toggle. Clicking Overview shows every
              file in the design as a Figma-style pannable lineup. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={viewMode === "overview" ? "secondary" : "ghost"}
                size="icon"
                className="h-7 w-7 cursor-pointer"
                onClick={handleViewModeToggle}
              >
                <IconLayoutGrid className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {viewMode === "overview" ? "Single screen" : "All screens"}
            </TooltipContent>
          </Tooltip>

          <div className="w-px h-5 bg-accent mx-1" />

          {/* Device frame — only meaningful in single-screen mode. */}
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={deviceFrame === "none" ? "secondary" : "ghost"}
                  size="icon"
                  className="h-7 w-7 cursor-pointer"
                  onClick={() => setDeviceFrame("none")}
                  disabled={viewMode === "overview"}
                >
                  <IconDeviceDesktopOff className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>No frame</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={deviceFrame === "desktop" ? "secondary" : "ghost"}
                  size="icon"
                  className="h-7 w-7 cursor-pointer"
                  onClick={() => setDeviceFrame("desktop")}
                  disabled={viewMode === "overview"}
                >
                  <IconDeviceDesktop className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Desktop</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={deviceFrame === "tablet" ? "secondary" : "ghost"}
                  size="icon"
                  className="h-7 w-7 cursor-pointer"
                  onClick={() => setDeviceFrame("tablet")}
                  disabled={viewMode === "overview"}
                >
                  <IconDeviceTablet className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Tablet</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={deviceFrame === "mobile" ? "secondary" : "ghost"}
                  size="icon"
                  className="h-7 w-7 cursor-pointer"
                  onClick={() => setDeviceFrame("mobile")}
                  disabled={viewMode === "overview"}
                >
                  <IconDeviceMobile className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Mobile</TooltipContent>
            </Tooltip>
          </div>

          <div className="w-px h-5 bg-accent mx-1" />

          {/* Zoom */}
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 cursor-pointer"
              onClick={handleZoomOut}
            >
              <IconZoomOut className="w-3.5 h-3.5" />
            </Button>
            <span className="text-xs text-muted-foreground w-10 text-center tabular-nums">
              {zoom}%
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 cursor-pointer"
              onClick={handleZoomIn}
            >
              <IconZoomIn className="w-3.5 h-3.5" />
            </Button>
          </div>

          <div className="w-px h-5 bg-accent mx-1" />

          {/* Actions */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 cursor-pointer"
                onClick={() => setTweaksVisible(!tweaksVisible)}
              >
                <IconSettings className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Tweaks</TooltipContent>
          </Tooltip>

          {/* Draw on canvas — overlays the iframe with pencil + text. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={drawMode ? "secondary" : "ghost"}
                size="icon"
                className="h-7 w-7 cursor-pointer"
                data-toolbar-draw-button
                onClick={handleDrawToolToggle}
                disabled={!activeFile || viewMode === "overview"}
              >
                <IconPencilPlus className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {viewMode === "overview"
                ? "Open a single screen to draw"
                : drawMode
                  ? "Exit draw mode"
                  : "Draw on current screen"}
            </TooltipContent>
          </Tooltip>

          {/* Drop comment pin — overlays the iframe with click-to-comment. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={pinMode ? "secondary" : "ghost"}
                size="icon"
                className="h-7 w-7 cursor-pointer"
                data-toolbar-pin-button
                onClick={handlePinToolToggle}
                disabled={!activeFile || viewMode === "overview"}
              >
                <IconPin className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {viewMode === "overview"
                ? "Open a single screen to comment"
                : pinMode
                  ? "Exit comment pin mode"
                  : "Drop comment pin"}
            </TooltipContent>
          </Tooltip>

          {/* Save state — currently the design template doesn't expose a
              dedicated "save in flight" signal (file edits go through Yjs +
              update-file actions). Surface the indicator so the UX matches
              slides; flip `saving` off until we wire a real source. */}
          <SaveStatusIndicator saving={false} className="ml-1 mr-1" />

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 cursor-pointer"
                    disabled={
                      !activeFile || createCodingHandoffMutation.isPending
                    }
                  >
                    <IconDownload className="w-3.5 h-3.5" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Export</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem
                onClick={handleCopyCodingHandoff}
                disabled={!activeFile || createCodingHandoffMutation.isPending}
              >
                <IconCode className="mr-2 h-4 w-4" />
                Copy coding handoff
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <PresenceBar
            activeUsers={activeUsers}
            agentActive={agentActive}
            currentUserEmail={session?.email}
          />
          <NotificationsBell />
          <AgentToggleButton />
        </div>
      </header>

      {/* Viewport tabs. Filenames map to friendly screen names — designers
          shouldn't see "mobile.html" in the chrome of their canvas. The
          full filename is still the title attribute for power users + a11y. */}
      {viewportTabs.length > 1 && (
        <div className="h-8 border-b border-border flex items-center gap-1 px-3 shrink-0">
          {viewportTabs.map((tab) => (
            <Tooltip key={tab.id}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setActiveFileId(tab.id)}
                  className={`px-2.5 py-1 rounded text-xs cursor-pointer ${
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
            designs. "Use this one" persists the chosen content as index.html. */}
        {pendingVariants && (
          <div className="absolute inset-0 z-40 flex flex-col bg-background">
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
              <div>
                <span className="text-sm font-medium text-foreground/90">
                  {pendingVariants.prompt ?? "Pick a direction"}
                </span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {pendingVariants.variants.length} variations
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="cursor-pointer"
                onClick={handleVariantsDismiss}
              >
                <IconX className="w-3.5 h-3.5" />
                Close
              </Button>
            </div>
            <div className="flex-1 overflow-hidden">
              <VariantGrid
                variants={pendingVariants.variants}
                onSelect={handleUseVariant}
                onUse={handleUseVariant}
              />
            </div>
          </div>
        )}

        {/* Canvas */}
        {activeFile ? (
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
            />
          )
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              {generating || hasPendingGeneration ? (
                <>
                  <Spinner className="mx-auto mb-3 size-6 text-foreground/30" />
                  <p className="text-sm text-muted-foreground">
                    Generating design...
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground mb-3">
                    {generationIssue ??
                      "No files yet. Ask the agent to generate a design."}
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
                        Try again
                      </Button>
                    ) : null}
                    <Button
                      ref={generateBtnRef}
                      variant={retryablePrompt ? "ghost" : "outline"}
                      size="sm"
                      className="cursor-pointer"
                      onClick={() => {
                        setRetryablePrompt(null);
                        setShowPrompt(true);
                      }}
                    >
                      <IconPlus className="w-3.5 h-3.5" />
                      {retryablePrompt ? "New prompt" : "Generate Design"}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
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
        {tweaksVisible &&
          (tweaks.length > 0 ? (
            <TweaksPanel
              tweaks={tweaks}
              values={tweakSelections}
              onChange={(id, value) =>
                setTweakSelections((prev) => ({ ...prev, [id]: value }))
              }
              onClose={() => setTweaksVisible(false)}
              visible
            />
          ) : (
            <div className="absolute bottom-4 left-4 z-30 w-60 rounded-xl border border-border bg-card p-4 shadow-2xl">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Tweaks
                </h3>
                <button
                  onClick={() => setTweaksVisible(false)}
                  className="cursor-pointer text-muted-foreground/70 hover:text-muted-foreground"
                >
                  <IconX className="h-3 w-3" />
                </button>
              </div>
              <p className="text-xs text-muted-foreground/70 leading-relaxed">
                Ask the agent to add knobs to this design (e.g. "let me toggle
                the accent color and density"). They'll appear here as live
                controls.
              </p>
            </div>
          ))}
      </div>

      <PromptPopover
        open={showPrompt}
        onOpenChange={setShowPrompt}
        title="Generate design"
        placeholder="Describe what you want to build..."
        skipLabel="Skip prompt"
        onSkip={() => {
          clearGenerationCompleteTimer();
          setGenerationIssue(null);
          const runTabId = agentSubmit(
            `Generate the initial design files for the "${design.title}" project.`,
            [
              `The user has design "${id}" (title: "${design.title}") open and wants to fill it with design files.`,
              ...designGenerationDirectives(id),
            ].join("\n"),
          );
          patchPendingGeneration(id, {
            prompt: `Create an initial design for ${design.title}.`,
            files: [],
            title: design.title,
            runTabId,
            startedAt: Date.now(),
          });
          setHasPendingGeneration(true);
          setShowPrompt(false);
        }}
        onSubmit={(
          prompt: string,
          files: UploadedFile[],
          options: PromptComposerSubmitOptions,
        ) => {
          const fileContext = formatUploadedFileContext(files);
          const context = [
            `The user has design "${id}" (title: "${design.title}") open and wants to fill it with design files.`,
            `User request: "${prompt}"`,
            fileContext,
            "",
            ...designGenerationDirectives(id),
          ].join("\n");
          clearGenerationCompleteTimer();
          setGenerationIssue(null);
          const runTabId = agentSubmit(
            `Generate design for "${design.title}": ${prompt}`,
            context,
            options,
          );
          patchPendingGeneration(id, {
            prompt,
            files,
            title: design.title,
            ...options,
            runTabId,
            startedAt: Date.now(),
          });
          setHasPendingGeneration(true);
          setShowPrompt(false);
        }}
        loading={generating}
        anchorRef={promptAnchorRef}
      />
    </div>
  );
}
