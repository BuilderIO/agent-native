import { cn } from "@/lib/utils";

export type CompSettings = {
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
};

const SIZE_PRESETS = [
  { label: "Square", description: "1080×1080", width: 1080, height: 1080 },
  { label: "Wide", description: "1920×1080", width: 1920, height: 1080 },
] as const;

type CompSettingsEditorProps = {
  settings: CompSettings;
  onChange: (patch: Partial<CompSettings>) => void;
};

export function CompSettingsEditor({
  settings,
  onChange,
}: CompSettingsEditorProps) {
  const durationSeconds = +(settings.durationInFrames / settings.fps).toFixed(
    2,
  );

  const handleDurationSeconds = (raw: string) => {
    const seconds = parseFloat(raw);
    if (isNaN(seconds)) return;
    const clamped = Math.max(0.5, Math.min(600, seconds));
    onChange({ durationInFrames: Math.round(clamped * settings.fps) });
  };

  return (
    <div className="space-y-3 p-4 border-t">
      <div className="space-y-3">
        {/* Duration */}
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Duration</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="0.5"
              min="0.5"
              max="600"
              value={durationSeconds}
              onChange={(e) => handleDurationSeconds(e.target.value)}
              className="flex-1 text-xs bg-secondary border border-border rounded-lg px-3 py-2 text-foreground/80 font-mono focus:outline-none focus:ring-1 focus:ring-primary/40"
            />
            <span className="text-xs text-muted-foreground flex-shrink-0">
              sec
            </span>
          </div>
          <span className="text-[10px] text-muted-foreground/45 font-mono">
            {settings.durationInFrames}f · {durationSeconds}s · {settings.fps}
            fps
          </span>
        </div>

        {/* Size presets */}
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Output Size</label>
          <div className="flex gap-1">
            {SIZE_PRESETS.map((preset) => {
              const active =
                settings.width === preset.width &&
                settings.height === preset.height;
              return (
                <button
                  key={preset.label}
                  onClick={() =>
                    onChange({ width: preset.width, height: preset.height })
                  }
                  className={cn(
                    "flex-1 flex flex-col items-center py-1.5 rounded-lg border",
                    active
                      ? "bg-primary/15 border-primary/40 text-primary"
                      : "bg-secondary border-border text-muted-foreground hover:border-primary/30 hover:text-foreground/70",
                  )}
                >
                  <span className="text-[10px] font-medium">
                    {preset.label}
                  </span>
                  <span className="text-[9px] font-mono opacity-60">
                    {preset.description}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="text-[10px] text-muted-foreground/60">
            Output:{" "}
            <span className="font-mono">
              {settings.width}×{settings.height}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
