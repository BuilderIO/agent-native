import { Player } from "@remotion/player";
import type { CompositionEntry } from "@/remotion/registry";
import { cn } from "@/lib/utils";

type CompositionCardProps = {
  composition: CompositionEntry;
  isSelected: boolean;
  onClick: () => void;
};

export function CompositionCard({
  composition,
  isSelected,
  onClick,
}: CompositionCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 px-2 py-1.5 rounded-lg transition-all group cursor-pointer relative",
        isSelected
          ? "bg-accent/60 ring-1 ring-primary/25"
          : "bg-transparent hover:bg-secondary/60",
      )}
    >
      {/* Thumbnail */}
      <div className="w-14 h-10 flex-shrink-0 rounded-md overflow-hidden bg-background border border-border">
        <Player
          component={composition.component}
          compositionWidth={composition.width}
          compositionHeight={composition.height}
          durationInFrames={composition.durationInFrames}
          fps={composition.fps}
          inputProps={composition.defaultProps}
          style={{ width: "100%", height: "100%", pointerEvents: "none" }}
          autoPlay={false}
          loop={false}
        />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h3
          className={cn(
            "text-xs font-medium truncate",
            isSelected ? "text-accent-foreground" : "text-foreground/80",
          )}
        >
          {composition.title}
        </h3>
        <span className="text-[10px] text-muted-foreground font-mono">
          {(composition.durationInFrames / composition.fps).toFixed(1)}s{" · "}
          {composition.width}×{composition.height}
        </span>
      </div>
    </div>
  );
}
