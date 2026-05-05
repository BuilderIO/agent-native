import { useState, useRef, useCallback } from "react";
import { IconX, IconGripHorizontal } from "@tabler/icons-react";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { TweakDefinition } from "@/lib/design-systems";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ── Default tweaks for video compositions ─────────────────────────────────────

export const DEFAULT_COMPOSITION_TWEAKS: TweakDefinition[] = [
  {
    id: "accentColor",
    label: "Accent color",
    type: "color-swatches",
    options: [
      { value: "#00E5FF", label: "Cyan", color: "#00E5FF" },
      { value: "#609FF8", label: "Blue", color: "#609FF8" },
      { value: "#4ADE80", label: "Green", color: "#4ADE80" },
      { value: "#F472B6", label: "Pink", color: "#F472B6" },
      { value: "#FBBF24", label: "Gold", color: "#FBBF24" },
    ],
    defaultValue: "#00E5FF",
    cssVar: "--ds-accent",
  },
  {
    id: "bgColor",
    label: "Background",
    type: "color-swatches",
    options: [
      { value: "#000000", label: "Black", color: "#000000" },
      { value: "#0F172A", label: "Slate", color: "#0F172A" },
      { value: "#18181B", label: "Zinc", color: "#18181B" },
      { value: "#1C1917", label: "Stone", color: "#1C1917" },
      { value: "#FFFFFF", label: "White", color: "#FFFFFF" },
    ],
    defaultValue: "#000000",
    cssVar: "--ds-background",
  },
  {
    id: "fps",
    label: "Frame rate",
    type: "segment",
    options: [
      { value: "24", label: "24" },
      { value: "30", label: "30" },
      { value: "60", label: "60" },
    ],
    defaultValue: "30",
  },
  {
    id: "easing",
    label: "Default easing",
    type: "segment",
    options: [
      { value: "linear", label: "Linear" },
      { value: "spring", label: "Spring" },
      { value: "expoOut", label: "Expo" },
    ],
    defaultValue: "spring",
  },
  {
    id: "animationSpeed",
    label: "Animation speed",
    type: "slider",
    defaultValue: 50,
    min: 0,
    max: 100,
    step: 5,
  },
  {
    id: "motionBlur",
    label: "Motion blur",
    type: "toggle",
    defaultValue: false,
  },
];

// ── Panel component ───────────────────────────────────────────────────────────

interface TweaksPanelProps {
  tweaks: TweakDefinition[];
  values: Record<string, string | number | boolean>;
  onChange: (id: string, value: string | number | boolean) => void;
  visible: boolean;
}

export function TweaksPanel({
  tweaks,
  values,
  onChange,
  visible,
}: TweaksPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [position, setPosition] = useState({ x: 16, y: 16 });
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      dragging.current = true;
      dragOffset.current = {
        x: e.clientX - position.x,
        y: e.clientY - position.y,
      };

      const handleMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        setPosition({
          x: ev.clientX - dragOffset.current.x,
          y: ev.clientY - dragOffset.current.y,
        });
      };

      const handleMouseUp = () => {
        dragging.current = false;
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [position],
  );

  if (!visible) return null;

  return (
    <div
      className="fixed z-30 w-60 rounded-xl border border-border bg-card shadow-2xl backdrop-blur-sm"
      style={{ left: position.x, bottom: position.y }}
    >
      {/* Header — drag handle + collapse toggle */}
      <div
        className="flex cursor-grab select-none items-center justify-between px-3 pt-2.5 pb-1.5 active:cursor-grabbing"
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-1.5">
          <IconGripHorizontal className="h-3 w-3 text-muted-foreground/60" />
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-muted-foreground"
          >
            Tweaks
          </button>
        </div>
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="cursor-pointer text-muted-foreground/70 hover:text-muted-foreground"
        >
          <IconX className="h-3 w-3" />
        </button>
      </div>

      {/* Body */}
      {!collapsed && (
        <div className="space-y-3.5 px-3 pb-3.5">
          {tweaks.map((tweak) => (
            <TweakControl
              key={tweak.id}
              tweak={tweak}
              value={values[tweak.id] ?? tweak.defaultValue}
              onChange={(v) => onChange(tweak.id, v)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Individual tweak control ──────────────────────────────────────────────────

function TweakControl({
  tweak,
  value,
  onChange,
}: {
  tweak: TweakDefinition;
  value: string | number | boolean;
  onChange: (v: string | number | boolean) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] text-muted-foreground">
        {tweak.label}
      </div>

      {tweak.type === "color-swatches" && (
        <div className="flex gap-2">
          {tweak.options?.map((opt) => (
            <Tooltip key={opt.value}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => onChange(opt.value)}
                  className={cn(
                    "h-6 w-6 cursor-pointer rounded-full",
                    value === opt.value
                      ? "ring-2 ring-foreground ring-offset-2 ring-offset-card"
                      : "ring-1 ring-border hover:ring-foreground/30",
                  )}
                  style={{ backgroundColor: opt.color || opt.value }}
                />
              </TooltipTrigger>
              <TooltipContent>{opt.label}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      )}

      {tweak.type === "segment" && (
        <div className="flex overflow-hidden rounded-lg border border-border">
          {tweak.options?.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onChange(opt.value)}
              className={cn(
                "flex-1 cursor-pointer px-2.5 py-1 text-[11px] font-medium",
                String(value) === opt.value
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground/70 hover:text-muted-foreground",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {tweak.type === "slider" && (
        <div className="flex items-center gap-2">
          <Slider
            min={tweak.min ?? 0}
            max={tweak.max ?? 100}
            step={tweak.step ?? 1}
            value={[typeof value === "number" ? value : 50]}
            onValueChange={([v]) => onChange(v)}
            className="flex-1"
          />
          <span className="min-w-[2rem] text-right text-[11px] text-muted-foreground">
            {typeof value === "number" ? value : 50}
          </span>
        </div>
      )}

      {tweak.type === "toggle" && (
        <Switch
          checked={!!value}
          onCheckedChange={(checked) => onChange(checked)}
        />
      )}
    </div>
  );
}
