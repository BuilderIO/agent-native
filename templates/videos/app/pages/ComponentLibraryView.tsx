import { useRef, useState, useCallback, useEffect } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import type { LibraryComponentEntry } from "@/remotion/componentRegistry";
import {
  IconPlayerPlay,
  IconPlayerPause,
  IconPlayerSkipBack,
  IconDeviceFloppy,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import type { Zone } from "@/remotion/hooks/useEditableZones";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type ComponentLibraryViewProps = {
  component: LibraryComponentEntry;
  initialFrame?: number;
  propValues?: Record<string, any>;
};

export function ComponentLibraryView({
  component,
  initialFrame,
  propValues,
}: ComponentLibraryViewProps) {
  const playerRef = useRef<PlayerRef>(null);
  const [playing, setPlaying] = useState(false);
  const [currentFrame, setCurrentFrame] = useState(initialFrame || 0);
  const [inputText, setInputText] = useState("");
  const [debugMode, setDebugMode] = useState(false);

  // Keyboard shortcut to toggle debug mode
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Don't trigger when typing in inputs/textareas
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }
      if (e.key === "d" || e.key === "D") {
        setDebugMode((prev) => {
          console.log(
            `Component Debug Mode: ${!prev ? "ON" : "OFF"} - ${!prev ? "Zones editable" : "Normal mode"}`,
          );
          return !prev;
        });
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, []);

  const handleTextChange = useCallback((value: string) => {
    setInputText(value);
  }, []);

  const handleSend = useCallback(() => {
    console.log("Sent:", inputText);
    setInputText("");
  }, [inputText]);

  // Seek to initial frame when component or initialFrame changes
  useEffect(() => {
    if (playerRef.current && initialFrame !== undefined) {
      playerRef.current.seekTo(initialFrame);
    }
  }, [component.id, initialFrame]);

  // Set up event listeners for the player
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onFrame = (e: { detail: { frame: number } }) => {
      setCurrentFrame(e.detail.frame);
    };

    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);
    // @ts-ignore - frameupdate is valid but not in types
    player.addEventListener("frameupdate", onFrame);

    return () => {
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
      // @ts-ignore
      player.removeEventListener("frameupdate", onFrame);
    };
  }, []);

  const handlePlayPause = useCallback(() => {
    if (playing) {
      playerRef.current?.pause();
    } else {
      playerRef.current?.play();
    }
  }, [playing]);

  const handleRestart = useCallback(() => {
    playerRef.current?.seekTo(0);
    playerRef.current?.pause();
  }, []);

  const handleSaveZones = useCallback(() => {
    // Read zones from localStorage
    const storedZones = localStorage.getItem(
      "videos-zones:create-project-prompt",
    );
    if (!storedZones) {
      alert(
        "No zones found. Press D to enable debug mode and adjust zones first.",
      );
      return;
    }

    const relativeZones: Record<string, Zone> = JSON.parse(storedZones);

    // Calculate absolute positions (matching the composition layout)
    const outerPadding = 100;
    const sidebarWidth = 73;
    const screenPadding = 83;
    const promptWidth = 790;
    const contentWidth =
      component.width - outerPadding * 2 - sidebarWidth - screenPadding * 2;
    const promptXInContent = (contentWidth - promptWidth) / 2;
    const promptX =
      outerPadding + sidebarWidth + screenPadding + promptXInContent;
    const promptY = outerPadding + 67;

    const absoluteZones: Record<string, Zone> = {};
    Object.entries(relativeZones).forEach(([key, zone]) => {
      absoluteZones[key] = {
        x: promptX + zone.x,
        y: promptY + zone.y,
        width: zone.width,
        height: zone.height,
      };
    });

    // Log coordinates
    console.log("=== ZONE COORDINATES TO UPDATE ===");
    console.log(
      "Copy these values and let me know - I'll update the composition.tsx:",
    );
    console.log("");
    Object.entries(absoluteZones).forEach(([key, zone]) => {
      console.log(
        `  ${key}: { x: ${Math.round(zone.x)}, y: ${Math.round(zone.y)}, width: ${Math.round(zone.width)}, height: ${Math.round(zone.height)} },`,
      );
    });
    console.log("===================================");

    alert(
      `✅ Zone coordinates logged to console!\n\nShare them with me and I'll update the composition.tsx automatically.`,
    );
  }, [component.width]);

  const fmtSec = (frames: number) => {
    const seconds = frames / component.fps;
    return seconds.toFixed(1) + "s";
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-3 sm:px-6 py-3 sm:py-4 border-b border-border">
        <h1 className="text-lg sm:text-xl font-semibold">{component.title}</h1>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1 line-clamp-2 sm:line-clamp-none">
          {component.description}
        </p>
      </div>

      {/* Preview Section */}
      <div className="flex-1 flex flex-col items-center justify-center p-3 sm:p-6 overflow-auto">
        {/* Debug Mode Indicator */}
        {debugMode && (
          <div className="mb-4 w-full max-w-4xl">
            <div className="bg-orange-500/90 text-white px-3 sm:px-6 py-2 sm:py-3 rounded-lg shadow-lg flex items-center justify-between gap-2">
              <div className="font-bold text-xs sm:text-sm min-w-0">
                DEBUG MODE - Press 'D' to toggle
              </div>
              <button
                onClick={handleSaveZones}
                className="flex items-center gap-2 bg-white/20 hover:bg-white/30 px-4 py-2 rounded transition-colors"
              >
                <Save className="w-4 h-4" />
                <span className="text-sm font-semibold">Save Zones</span>
              </button>
            </div>
          </div>
        )}

        {/* Video Container */}
        <div className="w-full max-w-4xl">
          <div
            className="relative bg-black rounded-lg overflow-hidden shadow-2xl"
            style={{
              aspectRatio: `${component.width} / ${component.height}`,
            }}
          >
            <Player
              ref={playerRef}
              component={component.component}
              inputProps={{
                ...component.defaultProps,
                ...(propValues || {}),
                tracks: component.tracks,
                // Interactive props for CreateProjectPrompt
                interactive: true,
                value: inputText,
                onChange: handleTextChange,
                onSend: handleSend,
                hasText: inputText.length > 0,
                debugMode: debugMode,
              }}
              durationInFrames={component.durationInFrames}
              fps={component.fps}
              compositionWidth={component.width}
              compositionHeight={component.height}
              style={{
                width: "100%",
                height: "100%",
              }}
              controls={false}
              loop={false}
              autoPlay={false}
              errorFallback={(error) => (
                <div style={{ color: "red", padding: 20 }}>
                  <h2>Remotion Error:</h2>
                  <pre>{error.message}</pre>
                  <pre>{error.stack}</pre>
                </div>
              )}
            />

            {/* Custom Controls Overlay */}
            <div className="absolute bottom-0 left-0 right-0 p-2 sm:p-4">
              <div className="flex items-center gap-2 sm:gap-3">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={handleRestart}
                      className="p-2.5 sm:p-2 hover:bg-white/10 rounded"
                      aria-label="Restart"
                    >
                      <IconPlayerSkipBack className="w-4 h-4 text-white" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Restart</TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={handlePlayPause}
                      className="p-2.5 sm:p-2 hover:bg-white/10 rounded"
                      aria-label={playing ? "Pause" : "Play"}
                    >
                      {playing ? (
                        <IconPlayerPause className="w-5 h-5 sm:w-4 sm:h-4 text-white" />
                      ) : (
                        <IconPlayerPlay className="w-5 h-5 sm:w-4 sm:h-4 text-white" />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{playing ? "Pause" : "Play"}</TooltipContent>
                </Tooltip>

                <div className="flex-1 text-xs sm:text-sm text-white/80 font-mono">
                  {fmtSec(currentFrame)} / {fmtSec(component.durationInFrames)}
                </div>

                <div className="hidden sm:block text-xs text-white/60">
                  {component.durationInFrames}f @ {component.fps}fps
                </div>
              </div>
            </div>
          </div>

          {/* Info Card */}
          <div className="mt-4 sm:mt-6 p-3 sm:p-4 bg-secondary/50 rounded-lg border border-border space-y-3">
            <div>
              <h3 className="text-sm font-semibold mb-2">Preview Timeline</h3>
              <p className="text-xs text-muted-foreground mb-3">
                Press <strong>Play</strong> to see the cursor demonstrate hover
                and click interactions:
              </p>
              <ul className="text-xs text-muted-foreground space-y-1 ml-4 list-disc">
                <li>
                  <strong>0.0s - 1.3s</strong>: Cursor approaches
                </li>
                <li>
                  <strong>1.3s - 2.7s</strong>: Hovers over component
                </li>
                <li>
                  <strong>2.7s</strong>: Clicks component
                </li>
                <li>
                  <strong>3.0s - 3.7s</strong>: Continues hovering
                </li>
                <li>
                  <strong>3.7s - 5.0s</strong>: Cursor exits
                </li>
              </ul>
            </div>

            <div className="pt-3 border-t border-border">
              <p className="text-xs font-medium text-foreground mb-1">
                Quick Debug
              </p>
              <p className="text-xs text-muted-foreground">
                Jump to specific frames using URL params:
              </p>
              <code className="text-[10px] text-muted-foreground font-mono mt-1 block break-all">
                ?frame=60 (hover) or ?frame=80 (click)
              </code>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
