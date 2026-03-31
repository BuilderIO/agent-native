import { useState, useEffect, useRef } from "react";
import { compositions } from "@/remotion/registry";
import { CompositionCard } from "@/components/CompositionCard";
import { PropsEditor } from "@/components/PropsEditor";
import { TrackPropertiesPanel } from "@/components/TrackPropertiesPanel";
import { CompSettingsEditor } from "@/components/CompSettingsEditor";
import { CameraControls } from "@/components/CameraControls";
import { CursorControls } from "@/components/CursorControls";
import { CurrentElementPanel } from "@/components/CurrentElementPanel";
import {
  IconAdjustmentsHorizontal,
  IconCamera,
  IconMouse,
  IconChevronRight,
  IconSettings,
  IconFileText,
  IconClick,
} from "@tabler/icons-react";
import { NewCompositionPopover } from "@/components/NewCompositionPopover";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useComposition } from "@/contexts/CompositionContext";
import { useTimeline } from "@/contexts/TimelineContext";
import { usePlayback } from "@/contexts/PlaybackContext";

type SidebarProps = {
  open: boolean;
  cameraControlsTrigger?: number; // Increment this to open camera controls
  cursorControlsTrigger?: number; // Increment this to open cursor controls
  compSettingsTrigger?: number; // Increment this to open composition settings
  onGeneratingChange?: (generating: boolean) => void;
};

export function Sidebar({
  open,
  cameraControlsTrigger,
  cursorControlsTrigger,
  compSettingsTrigger,
  onGeneratingChange,
}: SidebarProps) {
  // Get state from contexts
  const {
    compositionId,
    isNew,
    selected,
    currentProps,
    compSettings,
    onNavigate,
    onDelete,
    onPropsChange,
    onTitleChange,
    onCompSettingsChange,
  } = useComposition();

  const {
    tracks: timelineTracks,
    selectedTrackId,
    selectTrack: onSelectTrack,
    updateTrack: onUpdateTrack,
    addTrack: onAddTrack,
  } = useTimeline();

  const { currentFrame, fps, onSeek } = usePlayback();

  const [tab, setTab] = useState<"compositions" | "properties">("compositions");
  const cameraDetailsRef = useRef<HTMLDetailsElement>(null);
  const cursorDetailsRef = useRef<HTMLDetailsElement>(null);
  const trackDetailsRef = useRef<HTMLDetailsElement>(null);
  const compSettingsDetailsRef = useRef<HTMLDetailsElement>(null);

  const selectedTrack =
    timelineTracks.find((t) => t.id === selectedTrackId) ?? null;
  const cameraTrack = timelineTracks.find((t) => t.id === "camera");
  const cursorTrack = timelineTracks.find((t) => t.id === "cursor");

  // Auto-switch to Properties tab when a track is selected from the timeline
  useEffect(() => {
    if (selectedTrackId) {
      setTab("properties");

      // Auto-open and scroll to track panel (skip camera and cursor tracks)
      if (selectedTrackId !== "camera" && selectedTrackId !== "cursor") {
        setTimeout(() => {
          // Close camera and cursor panels
          if (cameraDetailsRef.current) cameraDetailsRef.current.open = false;
          if (cursorDetailsRef.current) cursorDetailsRef.current.open = false;
          if (compSettingsDetailsRef.current)
            compSettingsDetailsRef.current.open = false;

          // Open track panel
          if (trackDetailsRef.current) {
            trackDetailsRef.current.open = true;

            setTimeout(() => {
              trackDetailsRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "nearest",
              });
            }, 50);
          }
        }, 150);
      }
    }
  }, [selectedTrackId]);

  // Handle camera keyframe clicks - open camera panel and close others
  useEffect(() => {
    if (cameraControlsTrigger && cameraControlsTrigger > 0) {
      // Switch to properties tab
      setTab("properties");

      // Wait for tab switch to complete, then close other panels and open camera
      setTimeout(() => {
        // Close other panels
        if (cursorDetailsRef.current) cursorDetailsRef.current.open = false;
        if (trackDetailsRef.current) trackDetailsRef.current.open = false;
        if (compSettingsDetailsRef.current)
          compSettingsDetailsRef.current.open = false;

        // Open camera panel
        if (cameraDetailsRef.current) {
          cameraDetailsRef.current.open = true;

          // Additional delay for smooth scroll after opening
          setTimeout(() => {
            cameraDetailsRef.current?.scrollIntoView({
              behavior: "smooth",
              block: "nearest",
            });
          }, 50);
        }
      }, 150);
    }
  }, [cameraControlsTrigger]);

  // Handle cursor keyframe clicks - open cursor panel and close others
  useEffect(() => {
    if (cursorControlsTrigger && cursorControlsTrigger > 0) {
      // Switch to properties tab
      setTab("properties");

      // Wait for tab switch to complete, then close other panels and open cursor
      setTimeout(() => {
        // Close other panels
        if (cameraDetailsRef.current) cameraDetailsRef.current.open = false;
        if (trackDetailsRef.current) trackDetailsRef.current.open = false;
        if (compSettingsDetailsRef.current)
          compSettingsDetailsRef.current.open = false;

        // Open cursor panel
        if (cursorDetailsRef.current) {
          cursorDetailsRef.current.open = true;

          // Additional delay for smooth scroll after opening
          setTimeout(() => {
            cursorDetailsRef.current?.scrollIntoView({
              behavior: "smooth",
              block: "nearest",
            });
          }, 50);
        }
      }, 150);
    }
  }, [cursorControlsTrigger]);

  // Handle composition settings clicks - open comp settings panel and close others
  useEffect(() => {
    if (compSettingsTrigger && compSettingsTrigger > 0) {
      // Switch to properties tab
      setTab("properties");

      // Wait for tab switch to complete, then close other panels and open comp settings
      setTimeout(() => {
        // Close other panels
        if (cameraDetailsRef.current) cameraDetailsRef.current.open = false;
        if (cursorDetailsRef.current) cursorDetailsRef.current.open = false;
        if (trackDetailsRef.current) trackDetailsRef.current.open = false;

        // Open comp settings panel
        if (compSettingsDetailsRef.current) {
          compSettingsDetailsRef.current.open = true;

          // Additional delay for smooth scroll after opening
          setTimeout(() => {
            compSettingsDetailsRef.current?.scrollIntoView({
              behavior: "smooth",
              block: "nearest",
            });
          }, 50);
        }
      }, 150);
    }
  }, [compSettingsTrigger]);

  return (
    <div
      className={cn(
        "relative flex-shrink-0 border-r border-border bg-card/40 transition-all duration-200 overflow-hidden h-full",
        open ? "w-64 lg:w-72" : "w-0",
      )}
    >
      <div className="w-64 lg:w-72 h-full flex flex-col">
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as "compositions" | "properties")}
          className="flex flex-col h-full"
        >
          <TabsList className="w-full rounded-none border-b border-border bg-transparent h-auto p-0">
            <TabsTrigger
              value="compositions"
              className="flex-1 rounded-none border-b-2 border-transparent px-3 py-2.5 text-[11px] font-medium text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              Compositions
            </TabsTrigger>
            <TabsTrigger
              value="properties"
              className="flex-1 rounded-none border-b-2 border-transparent px-3 py-2.5 text-[11px] font-medium text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
            >
              Properties
              {selectedTrackId && (
                <span className="ml-1 w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="compositions"
            className="flex-1 overflow-y-auto p-2.5 space-y-1.5 scrollbar-thin mt-0"
          >
            <NewCompositionPopover
              isNew={isNew}
              onNavigate={onNavigate}
              onGeneratingChange={onGeneratingChange}
            />

            {compositions.map((comp) => (
              <CompositionCard
                key={comp.id}
                composition={comp}
                isSelected={comp.id === compositionId}
                onClick={() => onNavigate(`/c/${comp.id}`)}
              />
            ))}
          </TabsContent>

          <TabsContent
            value="properties"
            className="flex-1 overflow-y-auto p-2.5 space-y-1.5 scrollbar-thin mt-0"
          >
            {selected ? (
              <div className="space-y-3">
                {/* IconCamera controls */}
                {cameraTrack && (
                  <details ref={cameraDetailsRef} className="group">
                    <summary className="cursor-pointer list-none">
                      <div className="flex items-center gap-2 p-2 rounded hover:bg-secondary/50 transition-colors">
                        <IconCamera className="w-3.5 h-3.5 text-blue-400 mr-1 ml-[3px]" />
                        <span className="text-xs font-medium">IconCamera</span>
                        <IconChevronRight className="w-3 h-3 ml-auto group-open:rotate-90 transition-transform text-muted-foreground" />
                      </div>
                    </summary>
                    <div className="mt-1">
                      <CameraControls
                        currentFrame={currentFrame}
                        fps={fps}
                        tracks={timelineTracks}
                        onUpdateTrack={onUpdateTrack}
                        onAddTrack={onAddTrack}
                        onSeek={onSeek}
                        durationInFrames={compSettings?.durationInFrames}
                      />
                    </div>
                  </details>
                )}

                {/* Cursor controls */}
                <details ref={cursorDetailsRef} className="group">
                  <summary className="cursor-pointer list-none">
                    <div className="flex items-center gap-2 p-2 rounded hover:bg-secondary/50 transition-colors">
                      <IconMouse className="w-3.5 h-3.5 text-purple-400" />
                      <span className="text-xs font-medium">Cursor</span>
                      <IconChevronRight className="w-3 h-3 ml-auto group-open:rotate-90 transition-transform text-muted-foreground" />
                    </div>
                  </summary>
                  <div className="mt-1">
                    <CursorControls
                      currentFrame={currentFrame}
                      fps={fps}
                      tracks={timelineTracks}
                      onUpdateTrack={onUpdateTrack}
                      onAddTrack={onAddTrack}
                      onSeek={onSeek}
                      durationInFrames={
                        compSettings?.durationInFrames ??
                        selected?.durationInFrames
                      }
                      compositionWidth={compSettings?.width ?? selected?.width}
                      compositionHeight={
                        compSettings?.height ?? selected?.height
                      }
                      compositionId={compositionId}
                    />
                  </div>
                </details>

                {/* Cursor Interactions */}
                {cursorTrack && (
                  <details className="group">
                    <summary className="cursor-pointer list-none">
                      <div className="flex items-center gap-2 p-2 rounded hover:bg-secondary/50 transition-colors">
                        <IconClick className="w-3.5 h-3.5 text-green-400" />
                        <span className="text-xs font-medium">
                          Cursor Interactions
                        </span>
                        <IconChevronRight className="w-3 h-3 ml-auto group-open:rotate-90 transition-transform text-muted-foreground" />
                      </div>
                    </summary>
                    <div className="mt-1">
                      <CurrentElementPanel />
                    </div>
                  </details>
                )}

                {/* Track properties */}
                <details
                  ref={trackDetailsRef}
                  className="group"
                  open={!!selectedTrack}
                >
                  <summary className="cursor-pointer list-none">
                    <div className="flex items-center gap-2 p-2 rounded hover:bg-secondary/50 transition-colors">
                      <IconAdjustmentsHorizontal className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-xs font-medium">
                        Animation Track
                      </span>
                      {selectedTrack && (
                        <span className="text-[9px] font-mono text-muted-foreground/60 ml-auto mr-2">
                          {selectedTrack.label}
                        </span>
                      )}
                      <IconChevronRight className="w-3 h-3 ml-auto group-open:rotate-90 transition-transform text-muted-foreground" />
                    </div>
                  </summary>
                  <div className="mt-1">
                    {selectedTrack &&
                    selectedTrack.id !== "camera" &&
                    selectedTrack.id !== "cursor" ? (
                      <TrackPropertiesPanel
                        track={selectedTrack}
                        fps={selected.fps}
                        durationInFrames={selected.durationInFrames}
                        onUpdateTrack={onUpdateTrack}
                      />
                    ) : (
                      <div className="text-center py-6 px-4 bg-muted/30 rounded-lg border border-dashed border-border">
                        <p className="text-xs text-muted-foreground">
                          Select a track to edit its properties
                        </p>
                        <p className="text-xs text-muted-foreground/60 mt-1">
                          Click any track in the timeline below
                        </p>
                      </div>
                    )}
                  </div>
                </details>

                {/* Composition properties */}
                <details className="group" open>
                  <summary className="cursor-pointer list-none">
                    <div className="flex items-center gap-2 p-2 rounded hover:bg-secondary/50 transition-colors">
                      <IconFileText className="w-3.5 h-3.5 text-blue-400" />
                      <span className="text-xs font-medium">Properties</span>
                      <IconChevronRight className="w-3 h-3 ml-auto group-open:rotate-90 transition-transform text-muted-foreground" />
                    </div>
                  </summary>
                  <div className="mt-1">
                    <PropsEditor
                      composition={selected}
                      props={currentProps}
                      onPropsChange={onPropsChange}
                    />
                  </div>
                </details>

                {/* Composition settings */}
                {compSettings && (
                  <details ref={compSettingsDetailsRef} className="group" open>
                    <summary className="cursor-pointer list-none">
                      <div className="flex items-center gap-2 p-2 rounded hover:bg-secondary/50 transition-colors">
                        <IconSettings className="w-3.5 h-3.5 text-red-400" />
                        <span className="text-xs font-medium">Composition</span>
                        <IconChevronRight className="w-3 h-3 ml-auto group-open:rotate-90 transition-transform text-muted-foreground" />
                      </div>
                    </summary>
                    <div className="mt-1">
                      <CompSettingsEditor
                        settings={compSettings}
                        onChange={onCompSettingsChange}
                      />
                    </div>
                  </details>
                )}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground text-center py-8">
                Select a composition to edit properties
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
