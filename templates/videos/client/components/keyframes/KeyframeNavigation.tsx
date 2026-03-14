import { Button } from "../ui/button";

interface KeyframeNavigationProps {
  currentFrame: number;
  allKeyframes: number[];
  onSeek: (frame: number) => void;
  disabled?: boolean;
}

export function KeyframeNavigation({
  currentFrame,
  allKeyframes,
  onSeek,
  disabled = false,
}: KeyframeNavigationProps) {
  const prevFrames = allKeyframes.filter((f) => f < currentFrame);
  const nextFrames = allKeyframes.filter((f) => f > currentFrame);

  const handlePrev = () => {
    if (prevFrames.length > 0) {
      onSeek(prevFrames[prevFrames.length - 1]);
    }
  };

  const handleNext = () => {
    if (nextFrames.length > 0) {
      onSeek(nextFrames[0]);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={handlePrev}
        disabled={disabled || prevFrames.length === 0}
        className="flex-1 gap-1.5 text-xs border-muted-foreground/30 hover:bg-secondary/50 disabled:opacity-30"
      >
        <div className="relative w-3 h-3 flex items-center justify-center">
          <div className="w-2 h-2 rotate-45 bg-muted-foreground/40 border-l-2 border-b-2 border-muted-foreground/80" />
        </div>
        Previous
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={handleNext}
        disabled={disabled || nextFrames.length === 0}
        className="flex-1 gap-1.5 text-xs border-muted-foreground/30 hover:bg-secondary/50 disabled:opacity-30"
      >
        Next
        <div className="relative w-3 h-3 flex items-center justify-center">
          <div className="w-2 h-2 rotate-45 bg-muted-foreground/40 border-r-2 border-t-2 border-muted-foreground/80" />
        </div>
      </Button>
    </div>
  );
}
