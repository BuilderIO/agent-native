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
} from "@tabler/icons-react";
import {
  useActionQuery,
  useSession,
  useCollaborativeDoc,
  generateTabId,
  emailToColor,
  emailToName,
  PresenceBar,
  AgentToggleButton,
  type CollabUser,
} from "@agent-native/core/client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DesignCanvas } from "@/components/design/DesignCanvas";
import { MultiScreenCanvas } from "@/components/design/MultiScreenCanvas";
import { QuestionFlow } from "@/components/design/QuestionFlow";
import { TweaksPanel } from "@/components/design/TweaksPanel";
import { VariantGrid } from "@/components/design/VariantGrid";
import PromptPopover from "@/components/editor/PromptDialog";
import type { UploadedFile } from "@/components/editor/PromptDialog";
import { useAgentGenerating } from "@/hooks/use-agent-generating";
import { useQuestionFlow } from "@/hooks/use-question-flow";
import { useVariantFlow } from "@/hooks/use-variant-flow";
import type {
  ElementInfo,
  DeviceFrameType,
  ViewportTab,
  DrawAnnotation,
} from "@/components/design/types";
import { ZOOM_PRESETS } from "@/components/design/types";
import { prettyScreenName } from "@/lib/screen-names";
import type { TweakDefinition } from "@shared/api";

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

export default function DesignEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // Editor state
  const [mode, setMode] = useState<EditorMode>("comment");
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
  const [drawAnnotations, setDrawAnnotations] = useState<DrawAnnotation[]>([]);
  const [showPrompt, setShowPrompt] = useState(false);
  const generateBtnRef = useRef<HTMLButtonElement | null>(null);
  const promptAnchorRef = useRef<HTMLElement | null>(null);
  promptAnchorRef.current = generateBtnRef.current;
  const { generating, submit: agentSubmit } = useAgentGenerating();

  // Question flow + variant flow — full-canvas overlays driven by the agent.
  const {
    questions: pendingQuestions,
    handleSubmit: handleQuestionsSubmit,
    handleSkip: handleQuestionsSkip,
  } = useQuestionFlow(id);
  const {
    state: pendingVariants,
    useVariant: handleUseVariant,
    dismiss: handleVariantsDismiss,
  } = useVariantFlow(id);

  const { session } = useSession();

  // Current user info for collaborative presence
  const currentUser: CollabUser | undefined = session?.email
    ? {
        name: emailToName(session.email),
        email: session.email,
        color: emailToColor(session.email),
      }
    : undefined;

  // Data fetching
  const { data: design, isLoading: designLoading } = useActionQuery<DesignData>(
    "get-design",
    { id: id! },
  );

  const files = design?.files ?? [];

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
  }, [id, design, activeFile, selectedElement, mode]);

  const handleElementSelect = useCallback((info: ElementInfo) => {
    setSelectedElement(info);
  }, []);

  const handleElementHover = useCallback((info: ElementInfo) => {
    setHoveredElement(info);
  }, []);

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

  if (!id) {
    navigate("/");
    return null;
  }

  if (designLoading) {
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
          <span className="text-sm font-medium text-foreground/90 truncate max-w-[200px]">
            {design.title}
          </span>
          <Badge variant="secondary" className="text-[10px]">
            {design.projectType}
          </Badge>
        </div>

        <div className="flex items-center gap-1">
          {/* Mode switcher */}
          <Tabs value={mode} onValueChange={(v) => setMode(v as EditorMode)}>
            <TabsList className="h-8">
              <TabsTrigger value="comment" className="h-6 px-2 text-xs gap-1">
                <IconMessage className="w-3 h-3" />
                Comment
              </TabsTrigger>
              <TabsTrigger value="edit" className="h-6 px-2 text-xs gap-1">
                <IconPencil className="w-3 h-3" />
                Edit
              </TabsTrigger>
              <TabsTrigger value="draw" className="h-6 px-2 text-xs gap-1">
                <IconBrush className="w-3 h-3" />
                Draw
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="w-px h-5 bg-accent mx-1" />

          {/* Overview / single-screen toggle. Clicking Overview shows every
              file in the design as a Figma-style pannable lineup. */}
          <Button
            variant={viewMode === "overview" ? "secondary" : "ghost"}
            size="icon"
            className="h-7 w-7 cursor-pointer"
            onClick={() =>
              setViewMode((v) => (v === "overview" ? "single" : "overview"))
            }
            title={viewMode === "overview" ? "Single screen" : "All screens"}
          >
            <IconLayoutGrid className="w-3.5 h-3.5" />
          </Button>

          <div className="w-px h-5 bg-accent mx-1" />

          {/* Device frame — only meaningful in single-screen mode. */}
          <div className="flex items-center gap-0.5">
            <Button
              variant={deviceFrame === "none" ? "secondary" : "ghost"}
              size="icon"
              className="h-7 w-7 cursor-pointer"
              onClick={() => setDeviceFrame("none")}
              disabled={viewMode === "overview"}
              title="No frame"
            >
              <IconDeviceDesktopOff className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant={deviceFrame === "desktop" ? "secondary" : "ghost"}
              size="icon"
              className="h-7 w-7 cursor-pointer"
              onClick={() => setDeviceFrame("desktop")}
              disabled={viewMode === "overview"}
              title="Desktop"
            >
              <IconDeviceDesktop className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant={deviceFrame === "tablet" ? "secondary" : "ghost"}
              size="icon"
              className="h-7 w-7 cursor-pointer"
              onClick={() => setDeviceFrame("tablet")}
              disabled={viewMode === "overview"}
              title="Tablet"
            >
              <IconDeviceTablet className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant={deviceFrame === "mobile" ? "secondary" : "ghost"}
              size="icon"
              className="h-7 w-7 cursor-pointer"
              onClick={() => setDeviceFrame("mobile")}
              disabled={viewMode === "overview"}
              title="Mobile"
            >
              <IconDeviceMobile className="w-3.5 h-3.5" />
            </Button>
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
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 cursor-pointer"
            onClick={() => setTweaksVisible(!tweaksVisible)}
            title="Tweaks"
          >
            <IconSettings className="w-3.5 h-3.5" />
          </Button>
          <PresenceBar
            activeUsers={activeUsers}
            agentActive={agentActive}
            currentUserEmail={session?.email}
          />
          <AgentToggleButton className="h-8 w-8 rounded-md hover:bg-accent" />
        </div>
      </header>

      {/* Viewport tabs. Filenames map to friendly screen names — designers
          shouldn't see "mobile.html" in the chrome of their canvas. The
          full filename is still the title attribute for power users + a11y. */}
      {viewportTabs.length > 1 && (
        <div className="h-8 border-b border-border flex items-center gap-1 px-3 shrink-0">
          {viewportTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveFileId(tab.id)}
              title={tab.filename}
              className={`px-2.5 py-1 rounded text-xs cursor-pointer ${
                tab.id === activeFileId
                  ? "bg-accent text-foreground/90"
                  : "text-muted-foreground hover:text-muted-foreground"
              }`}
            >
              {prettyScreenName(tab.filename)}
            </button>
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
              />
            </div>
          )}

        {/* Variant grid overlay — full canvas takeover with 2-5 candidate
            designs. "Use this one" persists the chosen content as index.html. */}
        {pendingVariants && (
          <div className="absolute inset-0 z-40 flex flex-col bg-background">
            <div className="flex h-12 items-center justify-between border-b border-border px-4">
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
              deviceFrame={deviceFrame}
              editMode={mode === "edit"}
              onElementSelect={handleElementSelect}
              onElementHover={handleElementHover}
              tweakValues={cssVarValues}
            />
          )
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-3">
                No files yet. Ask the agent to generate a design.
              </p>
              <Button
                ref={generateBtnRef}
                variant="outline"
                size="sm"
                className="cursor-pointer"
                onClick={() => setShowPrompt(true)}
              >
                <IconPlus className="w-3.5 h-3.5" />
                Generate Design
              </Button>
            </div>
          </div>
        )}

        {/* Edit panel (right side) */}
        {mode === "edit" && selectedElement && (
          <div className="w-64 border-l border-border bg-background p-4 overflow-y-auto shrink-0">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Element
            </h3>
            <div className="space-y-3">
              <div>
                <span className="text-[10px] text-muted-foreground uppercase">
                  Tag
                </span>
                <p className="text-sm text-foreground/90 font-mono">
                  {selectedElement.tagName}
                  {selectedElement.id ? `#${selectedElement.id}` : ""}
                </p>
              </div>
              {selectedElement.classes.length > 0 && (
                <div>
                  <span className="text-[10px] text-muted-foreground uppercase">
                    Classes
                  </span>
                  <p className="text-xs text-muted-foreground font-mono break-all">
                    {selectedElement.classes.join(" ")}
                  </p>
                </div>
              )}
              {selectedElement.textContent && (
                <div>
                  <span className="text-[10px] text-muted-foreground uppercase">
                    Text
                  </span>
                  <p className="text-xs text-muted-foreground line-clamp-3">
                    {selectedElement.textContent}
                  </p>
                </div>
              )}
              <div>
                <span className="text-[10px] text-muted-foreground uppercase">
                  Size
                </span>
                <p className="text-xs text-muted-foreground">
                  {Math.round(selectedElement.boundingRect.width)} x{" "}
                  {Math.round(selectedElement.boundingRect.height)}
                </p>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground uppercase">
                  Styles
                </span>
                <div className="space-y-1 mt-1">
                  {Object.entries(selectedElement.computedStyles)
                    .filter(
                      ([, v]) =>
                        v &&
                        v !== "normal" &&
                        v !== "none" &&
                        v !== "0px" &&
                        v !== "auto",
                    )
                    .slice(0, 12)
                    .map(([key, value]) => (
                      <div
                        key={key}
                        className="flex items-center justify-between text-[10px]"
                      >
                        <span className="text-muted-foreground font-mono">
                          {key}
                        </span>
                        <span className="text-muted-foreground font-mono truncate ml-2 max-w-[120px]">
                          {value}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>
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

        {/* Draw overlay */}
        {mode === "draw" && (
          <div className="absolute inset-0 pointer-events-none z-10">
            <svg className="w-full h-full">
              {drawAnnotations.map((ann) =>
                ann.type === "path" && ann.pathData ? (
                  <path
                    key={ann.id}
                    d={ann.pathData}
                    stroke={ann.color}
                    strokeWidth={ann.lineWidth}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ) : null,
              )}
            </svg>
          </div>
        )}
      </div>

      <PromptPopover
        open={showPrompt}
        onOpenChange={setShowPrompt}
        title="Generate design"
        placeholder="Describe what you want to build..."
        skipLabel="Skip prompt"
        onSkip={() => {
          agentSubmit(
            `Generate the initial design files for the "${design.title}" project.`,
            `The user has design "${id}" open and wants to fill it with files. Use the \`generate-design --designId="${id}"\` action with one or more files (index.html, etc.). DO NOT call create-design (the design already exists).`,
          );
          setShowPrompt(false);
        }}
        onSubmit={(prompt: string, files: UploadedFile[]) => {
          const fileContext =
            files.length > 0
              ? `\n\nThe user uploaded ${files.length} file(s) for context:\n${files.map((f) => `- ${f.originalName} (${f.type}, ${(f.size / 1024).toFixed(1)}KB) at path: ${f.path}`).join("\n")}`
              : "";
          const context = [
            `The user has design "${id}" (title: "${design.title}") open and wants to fill it with design files.`,
            `User request: "${prompt}"`,
            fileContext,
            "",
            `Use the \`generate-design --designId="${id}"\` action with one or more files (index.html, etc.). The design already exists — DO NOT call create-design.`,
            "Each file's content must be complete, self-contained HTML with Alpine.js + Tailwind via CDN. HTML templates are in your AGENTS.md.",
          ].join("\n");
          agentSubmit(
            `Generate design for "${design.title}": ${prompt}`,
            context,
          );
          setShowPrompt(false);
        }}
        loading={generating}
        anchorRef={promptAnchorRef}
      />
    </div>
  );
}
