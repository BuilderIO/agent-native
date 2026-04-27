import { useState, useRef, useCallback } from "react";
import { IconX, IconGripHorizontal } from "@tabler/icons-react";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { TweakDefinition } from "@shared/api";

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
      // Only start drag on left click
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
      className="fixed z-30 w-60 rounded-xl border border-white/[0.06] bg-[hsl(240,5%,8%)] shadow-2xl backdrop-blur-sm"
      style={{ left: position.x, bottom: position.y }}
    >
      {/* Header — drag handle + collapse toggle */}
      <div
        className="flex cursor-grab select-none items-center justify-between px-3 pt-2.5 pb-1.5 active:cursor-grabbing"
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-1.5">
          <IconGripHorizontal className="h-3 w-3 text-white/20" />
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-white/40 hover:text-white/60"
          >
            Tweaks
          </button>
        </div>
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="cursor-pointer text-white/30 hover:text-white/60"
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
      <div className="mb-1.5 text-[11px] text-white/40">{tweak.label}</div>

      {tweak.type === "color-swatch" && (
        <div className="flex gap-2">
          {tweak.options?.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onChange(opt.value)}
              className={cn(
                "h-6 w-6 cursor-pointer rounded-full",
                value === opt.value
                  ? "ring-2 ring-white ring-offset-2 ring-offset-[hsl(240,5%,8%)]"
                  : "ring-1 ring-white/10 hover:ring-white/30",
              )}
              style={{ backgroundColor: opt.color || opt.value }}
              title={opt.label}
            />
          ))}
        </div>
      )}

      {tweak.type === "segment" && (
        <div className="flex overflow-hidden rounded-lg border border-white/[0.08]">
          {tweak.options?.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onChange(opt.value)}
              className={cn(
                "flex-1 cursor-pointer px-2.5 py-1 text-[11px] font-medium",
                value === opt.value
                  ? "bg-white/10 text-white"
                  : "text-white/30 hover:text-white/50",
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
          <span className="min-w-[2rem] text-right text-[11px] text-white/50">
            {typeof value === "number" ? value : 50}
            {tweak.cssVar?.includes("radius") ? "px" : ""}
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
