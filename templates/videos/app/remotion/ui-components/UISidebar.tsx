import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import {
  Layers,
  SlidersHorizontal,
  Camera,
  Mouse,
  ChevronRight,
  Plus,
} from "lucide-react";
import type { InteractiveComponentState } from "../hooks/useInteractiveComponent";
import { AnimatedElement } from "../components/AnimatedElement";

export interface UISidebarProps {
  x: number;
  y: number;
  width: number;
  height: number;
  activeTab?: "compositions" | "properties";
  cameraPanelOpen?: boolean;
  cameraPanelProgress?: number; // 0-1 progress for spring animation
  compositionsTab?: InteractiveComponentState;
  propertiesTab?: InteractiveComponentState;
  newCompButton?: InteractiveComponentState;
  cameraAccordion?: InteractiveComponentState;
  cursorAccordion?: InteractiveComponentState;
  animationTrackAccordion?: InteractiveComponentState;
}

export function UISidebar({
  x,
  y,
  width,
  height,
  activeTab = "compositions",
  cameraPanelOpen = false,
  cameraPanelProgress = 0,
  compositionsTab,
  propertiesTab,
  newCompButton,
  cameraAccordion,
  cursorAccordion,
  animationTrackAccordion,
}: UISidebarProps) {
  // Use the provided progress value directly (no hardcoded frame timing)
  const panelSpring = cameraPanelProgress;

  // CRITICAL: Chevron rotation is decoupled from panel spring animation
  // Chevron rotates instantly (via CSS transition) when state changes
  // Panel content animates with spring for smooth reveal
  // This prevents "painfully slow" chevron rotation - see AGENTS.md
  const chevronRotation = cameraPanelOpen ? 90 : 0;

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width,
        height,
      }}
    >
      {/* Sidebar container */}
      <div className="h-full bg-card/40 border-r border-border flex flex-col">
        {/* Tabs */}
        <div className="flex border-b border-border">
          <div style={{ position: "relative", flex: 1 }}>
            <AnimatedElement
              interactive={
                compositionsTab || {
                  id: "",
                  hover: { isHovering: false, progress: 0 },
                  click: { isClicking: false, progress: 0 },
                  combinedProgress: 0,
                  cursorType: "default",
                  cursorX: 0,
                  cursorY: 0,
                  zone: { x: 0, y: 0, width: 0, height: 0 },
                  animatedProperties: {},
                }
              }
              as="button"
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
                padding: "10px 12px",
                fontSize: "13px",
                fontWeight: 500,
                color:
                  activeTab === "compositions"
                    ? "rgba(255, 255, 255, 0.9)"
                    : "rgba(255, 255, 255, 0.5)",
                backgroundColor: "transparent",
                cursor: "pointer",
              }}
            >
              <Layers size={16} />
              Compositions
            </AnimatedElement>
            {activeTab === "compositions" && (
              <div
                style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: "2px",
                  backgroundColor: "#6366f1",
                }}
              />
            )}
          </div>

          <div style={{ position: "relative", flex: 1 }}>
            <AnimatedElement
              interactive={
                propertiesTab || {
                  id: "",
                  hover: { isHovering: false, progress: 0 },
                  click: { isClicking: false, progress: 0 },
                  combinedProgress: 0,
                  cursorType: "default",
                  cursorX: 0,
                  cursorY: 0,
                  zone: { x: 0, y: 0, width: 0, height: 0 },
                  animatedProperties: {},
                }
              }
              as="button"
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "6px",
                padding: "10px 12px",
                fontSize: "13px",
                fontWeight: 500,
                color:
                  activeTab === "properties"
                    ? "rgba(255, 255, 255, 0.9)"
                    : "rgba(255, 255, 255, 0.5)",
                backgroundColor: "transparent",
                cursor: "pointer",
              }}
            >
              <SlidersHorizontal size={16} />
              Properties
            </AnimatedElement>
            {activeTab === "properties" && (
              <div
                style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: "2px",
                  backgroundColor: "#6366f1",
                }}
              />
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden p-2.5 space-y-1.5">
          {activeTab === "compositions" ? (
            <>
              {/* New Composition Button */}
              <div className="flex items-center justify-center gap-2 px-2 py-1.5 rounded-lg bg-muted/30 border border-border text-muted-foreground cursor-pointer hover:bg-muted/40 transition-all">
                <Plus className="w-4 h-4" />
                <span className="text-sm font-medium">New Composition</span>
              </div>

              {/* Mock Composition Cards */}
              <MockCompositionCard
                title="Kinetic Text"
                duration="2.6s"
                dimensions="1920×1080"
              />
              <MockCompositionCard
                title="Logo Reveal"
                duration="3.0s"
                dimensions="1080×1080"
                isSelected
              />
              <MockCompositionCard
                title="Slideshow"
                duration="9.8s"
                dimensions="1920×1080"
              />
            </>
          ) : (
            <div className="space-y-3">
              {/* Camera Panel */}
              <div className="rounded-lg">
                <AnimatedElement
                  interactive={
                    cameraAccordion || {
                      id: "",
                      hover: { isHovering: false, progress: 0 },
                      click: { isClicking: false, progress: 0 },
                      combinedProgress: 0,
                      cursorType: "default",
                      cursorX: 0,
                      cursorY: 0,
                      zone: { x: 0, y: 0, width: 0, height: 0 },
                      animatedProperties: {},
                    }
                  }
                  as="div"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "8px",
                    borderRadius: "6px",
                    cursor: "pointer",
                  }}
                  className="hover:bg-secondary/50 transition-colors"
                >
                  <Camera className="w-4 h-4 text-blue-400 mr-1 ml-[3px]" />
                  <span className="text-sm font-medium">Camera</span>
                  <ChevronRight
                    className="w-3.5 h-3.5 ml-auto text-muted-foreground"
                    style={{
                      transform: `rotate(${chevronRotation}deg)`,
                      transition: "transform 0.3s ease-out",
                    }}
                  />
                </AnimatedElement>
                {cameraPanelOpen && (
                  <div
                    className="mt-1 px-2 py-3 bg-muted/30 rounded border border-border/50 overflow-hidden"
                    style={{
                      opacity: panelSpring,
                      height: panelSpring * 440,
                    }}
                  >
                    <div className="space-y-3 text-xs">
                      {/* Keyframe Navigation */}
                      <div className="flex gap-2 pb-2 border-b border-border/30">
                        <button className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded bg-secondary/50 text-muted-foreground hover:bg-secondary transition-colors">
                          <ChevronRight className="w-3 h-3 rotate-180" />
                          <span className="text-[10px]">Previous</span>
                        </button>
                        <button className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded bg-secondary/50 text-muted-foreground hover:bg-secondary transition-colors">
                          <span className="text-[10px]">Next</span>
                          <ChevronRight className="w-3 h-3" />
                        </button>
                      </div>

                      {/* Pan Controls */}
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="flex items-center gap-1 text-[10px] text-muted-foreground mb-1">
                            <span className="opacity-60">↔</span> Pan X
                          </label>
                          <input
                            type="text"
                            value="1553"
                            readOnly
                            className="w-full px-2 py-1.5 text-xs font-mono bg-background border border-border rounded"
                          />
                        </div>
                        <div>
                          <label className="flex items-center gap-1 text-[10px] text-muted-foreground mb-1">
                            <span className="opacity-60">↕</span> Pan Y
                          </label>
                          <input
                            type="text"
                            value="870"
                            readOnly
                            className="w-full px-2 py-1.5 text-xs font-mono bg-background border border-border rounded"
                          />
                        </div>
                      </div>

                      {/* Tilt Controls */}
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="flex items-center gap-1 text-[10px] text-muted-foreground mb-1">
                            <span className="opacity-60">↻</span> Tilt X
                          </label>
                          <input
                            type="text"
                            value="0"
                            readOnly
                            className="w-full px-2 py-1.5 text-xs font-mono bg-background border border-border rounded"
                          />
                        </div>
                        <div>
                          <label className="flex items-center gap-1 text-[10px] text-muted-foreground mb-1">
                            <span className="opacity-60">↺</span> Tilt Y
                          </label>
                          <input
                            type="text"
                            value="0"
                            readOnly
                            className="w-full px-2 py-1.5 text-xs font-mono bg-background border border-border rounded"
                          />
                        </div>
                      </div>

                      {/* Zoom & Perspective */}
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="flex items-center gap-1 text-[10px] text-muted-foreground mb-1">
                            <span className="opacity-60">🔍</span> Zoom
                          </label>
                          <input
                            type="text"
                            value="2.6"
                            readOnly
                            className="w-full px-2 py-1.5 text-xs font-mono bg-background border border-border rounded"
                          />
                        </div>
                        <div>
                          <label className="flex items-center gap-1 text-[10px] text-muted-foreground mb-1">
                            <span className="opacity-60">👁</span> Perspective
                          </label>
                          <input
                            type="text"
                            value="800"
                            readOnly
                            className="w-full px-2 py-1.5 text-xs font-mono bg-background border border-border rounded"
                          />
                        </div>
                      </div>

                      {/* Motion Curve */}
                      <div>
                        <label className="text-[10px] text-muted-foreground mb-1 block">
                          Motion Curve (arriving)
                        </label>
                        <select className="w-full px-2 py-1.5 text-xs bg-background border border-border rounded">
                          <option>Expo InOut</option>
                        </select>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex gap-2 pt-2 border-t border-border/30">
                        <button className="p-2 rounded bg-secondary/50 hover:bg-secondary transition-colors">
                          <span className="text-sm">📋</span>
                        </button>
                        <button className="p-2 rounded bg-secondary/50 hover:bg-secondary transition-colors">
                          <span className="text-sm">↻</span>
                        </button>
                        <button className="flex-1" />
                        <button className="p-2 rounded bg-destructive/10 hover:bg-destructive/20 transition-colors">
                          <span className="text-sm text-destructive">🗑</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Cursor Panel */}
              <AnimatedElement
                interactive={
                  cursorAccordion || {
                    id: "",
                    hover: { isHovering: false, progress: 0 },
                    click: { isClicking: false, progress: 0 },
                    combinedProgress: 0,
                    cursorType: "default",
                    cursorX: 0,
                    cursorY: 0,
                    zone: { x: 0, y: 0, width: 0, height: 0 },
                    animatedProperties: {},
                  }
                }
                as="div"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
                className="hover:bg-secondary/50 transition-colors"
              >
                <Mouse className="w-4 h-4 text-purple-400" />
                <span className="text-sm font-medium">Cursor</span>
                <ChevronRight className="w-3.5 h-3.5 ml-auto text-muted-foreground" />
              </AnimatedElement>

              {/* Track Properties Panel */}
              <AnimatedElement
                interactive={
                  animationTrackAccordion || {
                    id: "",
                    hover: { isHovering: false, progress: 0 },
                    click: { isClicking: false, progress: 0 },
                    combinedProgress: 0,
                    cursorType: "default",
                    cursorX: 0,
                    cursorY: 0,
                    zone: { x: 0, y: 0, width: 0, height: 0 },
                    animatedProperties: {},
                  }
                }
                as="div"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px",
                  borderRadius: "6px",
                  cursor: "pointer",
                }}
                className="hover:bg-secondary/50 transition-colors"
              >
                <SlidersHorizontal className="w-4 h-4 text-amber-400" />
                <span className="text-sm font-medium">Animation Track</span>
                <ChevronRight className="w-3.5 h-3.5 ml-auto text-muted-foreground" />
              </AnimatedElement>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MockCompositionCard({
  title,
  duration,
  dimensions,
  isSelected = false,
}: {
  title: string;
  duration: string;
  dimensions: string;
  isSelected?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 px-2 py-1.5 rounded-lg transition-all cursor-pointer ${
        isSelected
          ? "bg-accent/60 ring-1 ring-primary/25"
          : "bg-transparent hover:bg-secondary/60"
      }`}
    >
      {/* Thumbnail */}
      <div className="w-14 h-10 flex-shrink-0 rounded-md bg-background border border-border flex items-center justify-center">
        <div className="w-8 h-6 rounded bg-gradient-to-br from-indigo-500/20 to-pink-500/20 border border-indigo-500/30" />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h3
          className={`text-sm font-medium truncate ${
            isSelected ? "text-accent-foreground" : "text-foreground/80"
          }`}
        >
          {title}
        </h3>
        <span className="text-xs text-muted-foreground font-mono">
          {duration} · {dimensions}
        </span>
      </div>
    </div>
  );
}
