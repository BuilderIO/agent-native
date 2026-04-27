import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router";
import {
  IconArrowLeft,
  IconPlayerPlay,
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
} from "@tabler/icons-react";
import {
  AgentSidebar,
  AgentToggleButton,
  useActionQuery,
  sendToAgentChat,
} from "@agent-native/core/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DesignCanvas } from "@/components/design/DesignCanvas";
import type {
  ElementInfo,
  DeviceFrameType,
  ViewportTab,
  DrawAnnotation,
} from "@/components/design/types";
import { ZOOM_PRESETS } from "@/components/design/types";

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
  const [selectedElement, setSelectedElement] = useState<ElementInfo | null>(
    null,
  );
  const [hoveredElement, setHoveredElement] = useState<ElementInfo | null>(
    null,
  );
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [tweaksVisible, setTweaksVisible] = useState(false);
  const [tweakValues, setTweakValues] = useState<Record<string, string>>({});
  const [drawAnnotations, setDrawAnnotations] = useState<DrawAnnotation[]>([]);

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
      <div className="h-screen bg-[hsl(240,5%,5%)] flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white/30" />
      </div>
    );
  }

  if (!design) {
    return (
      <div className="h-screen bg-[hsl(240,5%,5%)] flex flex-col items-center justify-center gap-4">
        <p className="text-white/50">Design not found</p>
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
    <AgentSidebar
      position="right"
      emptyStateText="Describe changes to make"
      suggestions={[
        "Change the primary color to blue",
        "Make the layout more responsive",
        "Add a hero section",
      ]}
    >
      <div className="h-screen flex flex-col bg-[hsl(240,5%,5%)]">
        {/* Toolbar */}
        <header className="h-12 border-b border-white/[0.06] flex items-center justify-between px-3 shrink-0">
          <div className="flex items-center gap-2">
            <Link
              to="/"
              className="flex items-center gap-1 text-sm text-white/50 hover:text-white/80"
            >
              <IconArrowLeft className="w-4 h-4" />
            </Link>
            <span className="text-sm font-medium text-white/80 truncate max-w-[200px]">
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

            <div className="w-px h-5 bg-white/[0.06] mx-1" />

            {/* Device frame */}
            <div className="flex items-center gap-0.5">
              <Button
                variant={deviceFrame === "none" ? "secondary" : "ghost"}
                size="icon"
                className="h-7 w-7 cursor-pointer"
                onClick={() => setDeviceFrame("none")}
                title="No frame"
              >
                <IconDeviceDesktopOff className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant={deviceFrame === "desktop" ? "secondary" : "ghost"}
                size="icon"
                className="h-7 w-7 cursor-pointer"
                onClick={() => setDeviceFrame("desktop")}
                title="Desktop"
              >
                <IconDeviceDesktop className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant={deviceFrame === "tablet" ? "secondary" : "ghost"}
                size="icon"
                className="h-7 w-7 cursor-pointer"
                onClick={() => setDeviceFrame("tablet")}
                title="Tablet"
              >
                <IconDeviceTablet className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant={deviceFrame === "mobile" ? "secondary" : "ghost"}
                size="icon"
                className="h-7 w-7 cursor-pointer"
                onClick={() => setDeviceFrame("mobile")}
                title="Mobile"
              >
                <IconDeviceMobile className="w-3.5 h-3.5" />
              </Button>
            </div>

            <div className="w-px h-5 bg-white/[0.06] mx-1" />

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
              <span className="text-xs text-white/50 w-10 text-center tabular-nums">
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

            <div className="w-px h-5 bg-white/[0.06] mx-1" />

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
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 cursor-pointer"
              onClick={() => navigate(`/present/${id}`)}
            >
              <IconPlayerPlay className="w-3.5 h-3.5" />
              Present
            </Button>
            <AgentToggleButton />
          </div>
        </header>

        {/* Viewport tabs */}
        {viewportTabs.length > 1 && (
          <div className="h-8 border-b border-white/[0.06] flex items-center gap-1 px-3 shrink-0">
            {viewportTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveFileId(tab.id)}
                className={`px-2.5 py-1 rounded text-xs cursor-pointer ${
                  tab.id === activeFileId
                    ? "bg-white/[0.08] text-white/80"
                    : "text-white/40 hover:text-white/60"
                }`}
              >
                {tab.filename}
              </button>
            ))}
          </div>
        )}

        {/* Main canvas area */}
        <div className="flex-1 flex overflow-hidden relative">
          {/* Canvas */}
          {activeFile ? (
            <DesignCanvas
              content={activeFile.content}
              zoom={zoom}
              deviceFrame={deviceFrame}
              editMode={mode === "edit"}
              onElementSelect={handleElementSelect}
              onElementHover={handleElementHover}
              tweakValues={tweakValues}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <p className="text-sm text-white/40 mb-3">
                  No files yet. Ask the agent to generate a design.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="cursor-pointer"
                  onClick={() => {
                    sendToAgentChat({
                      message: `Generate the initial design files for the "${design.title}" project.`,
                    });
                  }}
                >
                  <IconPlus className="w-3.5 h-3.5" />
                  Generate Design
                </Button>
              </div>
            </div>
          )}

          {/* Edit panel (right side) */}
          {mode === "edit" && selectedElement && (
            <div className="w-64 border-l border-white/[0.06] bg-[hsl(240,5%,6%)] p-4 overflow-y-auto shrink-0">
              <h3 className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-3">
                Element
              </h3>
              <div className="space-y-3">
                <div>
                  <span className="text-[10px] text-white/40 uppercase">
                    Tag
                  </span>
                  <p className="text-sm text-white/80 font-mono">
                    {selectedElement.tagName}
                    {selectedElement.id ? `#${selectedElement.id}` : ""}
                  </p>
                </div>
                {selectedElement.classes.length > 0 && (
                  <div>
                    <span className="text-[10px] text-white/40 uppercase">
                      Classes
                    </span>
                    <p className="text-xs text-white/60 font-mono break-all">
                      {selectedElement.classes.join(" ")}
                    </p>
                  </div>
                )}
                {selectedElement.textContent && (
                  <div>
                    <span className="text-[10px] text-white/40 uppercase">
                      Text
                    </span>
                    <p className="text-xs text-white/60 line-clamp-3">
                      {selectedElement.textContent}
                    </p>
                  </div>
                )}
                <div>
                  <span className="text-[10px] text-white/40 uppercase">
                    Size
                  </span>
                  <p className="text-xs text-white/60">
                    {Math.round(selectedElement.boundingRect.width)} x{" "}
                    {Math.round(selectedElement.boundingRect.height)}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] text-white/40 uppercase">
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
                          <span className="text-white/40 font-mono">{key}</span>
                          <span className="text-white/60 font-mono truncate ml-2 max-w-[120px]">
                            {value}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tweaks panel (floating) */}
          {tweaksVisible && (
            <div className="absolute top-4 right-4 w-56 bg-[hsl(240,5%,8%)] border border-white/[0.08] rounded-xl p-4 shadow-2xl z-10">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-white/60 uppercase tracking-wider">
                  Tweaks
                </h3>
                <button
                  onClick={() => setTweaksVisible(false)}
                  className="text-white/30 hover:text-white/50 text-xs cursor-pointer"
                >
                  Close
                </button>
              </div>
              <p className="text-xs text-white/30">
                CSS custom property overrides will appear here when the design
                uses configurable tokens.
              </p>
            </div>
          )}

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
      </div>
    </AgentSidebar>
  );
}
