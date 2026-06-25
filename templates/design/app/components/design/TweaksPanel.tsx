import { useT } from "@agent-native/core/client";
import type { TweakDefinition } from "@shared/api";
import { IconX, IconGripHorizontal, IconPlus } from "@tabler/icons-react";
import { useState, useRef, useCallback } from "react";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface TweaksPanelProps {
  tweaks: TweakDefinition[];
  values: Record<string, string | number | boolean>;
  onChange: (id: string, value: string | number | boolean) => void;
  onClose: () => void;
  onRequestTweaks?: (anchor: HTMLElement) => void;
  visible: boolean;
}

export function TweaksPanel({
  tweaks,
  values,
  onChange,
  onClose,
  onRequestTweaks,
  visible,
}: TweaksPanelProps) {
  const t = useT();
  const [collapsed, setCollapsed] = useState(false);
  const [position, setPosition] = useState({ x: 16, y: 64 });
  const panelRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only start drag on left click
      if (e.button !== 0) return;
      e.preventDefault();
      dragging.current = true;
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = document.documentElement.clientHeight;
      dragOffset.current = {
        x: viewportWidth - e.clientX - position.x,
        y: viewportHeight - e.clientY - position.y,
      };

      const handleMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const rect = panelRef.current?.getBoundingClientRect();
        const viewportWidth = document.documentElement.clientWidth;
        const viewportHeight = document.documentElement.clientHeight;
        const panelWidth = rect?.width ?? 240;
        const panelHeight = rect?.height ?? 220;
        const nextX = viewportWidth - ev.clientX - dragOffset.current.x;
        const nextY = viewportHeight - ev.clientY - dragOffset.current.y;
        setPosition({
          x: Math.min(Math.max(nextX, 8), viewportWidth - panelWidth - 8),
          y: Math.min(Math.max(nextY, 8), viewportHeight - panelHeight - 8),
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
      ref={panelRef}
      className="fixed z-[70] w-60 rounded-xl border border-border bg-card shadow-2xl backdrop-blur-sm"
      style={{ right: position.x, bottom: position.y }}
    >
      {/* Header — drag handle + collapse toggle */}
      <div
        className="flex cursor-grab select-none items-center justify-between px-3 pt-2.5 pb-1.5 active:cursor-grabbing"
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-1.5">
          <IconGripHorizontal className="h-3 w-3 text-muted-foreground/60" />
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setCollapsed((c) => !c)}
            className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-muted-foreground"
          >
            {t("designEditor.tweaks")}
          </button>
        </div>
        <div className="flex items-center gap-0.5">
          {onRequestTweaks && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRequestTweaks(e.currentTarget);
                  }}
                  className="size-6 cursor-pointer text-muted-foreground/70 hover:text-foreground"
                  aria-label={t("designEditor.addTweaks")}
                >
                  <IconPlus className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("designEditor.addTweaks")}</TooltipContent>
            </Tooltip>
          )}
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground/70 hover:bg-accent hover:text-muted-foreground"
            aria-label={t("designEditor.closeTweaks")}
          >
            <IconX className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Body */}
      {!collapsed && (
        <div className="space-y-3.5 px-3 pb-3.5">
          {tweaks.length > 0 ? (
            tweaks.map((tweak) => (
              <TweakControl
                key={tweak.id}
                tweak={tweak}
                value={values[tweak.id] ?? tweak.defaultValue}
                onChange={(v) => onChange(tweak.id, v)}
              />
            ))
          ) : (
            <div className="space-y-2 rounded-lg border border-dashed border-border/80 bg-muted/20 p-3">
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t("designEditor.noTweakControls")}
              </p>
              {onRequestTweaks && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 w-full cursor-pointer text-xs"
                  onClick={(e) => onRequestTweaks(e.currentTarget)}
                >
                  <IconPlus className="h-3.5 w-3.5" />
                  {t("designEditor.addTweakControls")}
                </Button>
              )}
            </div>
          )}
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
      <div className="mb-1.5 text-[11px] text-muted-foreground">
        {tweak.label}
      </div>

      {(tweak.type as string) === "color-swatch" ||
      (tweak.type as string) === "color-swatches" ? (
        <div className="flex gap-2">
          {tweak.options?.map((opt) => (
            <Tooltip key={opt.value}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onChange(opt.value)}
                  className={cn(
                    "h-6 w-6 cursor-pointer rounded-full",
                    value === opt.value
                      ? "ring-2 ring-white ring-offset-2 ring-offset-[hsl(240,5%,8%)]"
                      : "ring-1 ring-white/10 hover:ring-white/30",
                  )}
                  style={{ backgroundColor: opt.color || opt.value }}
                />
              </TooltipTrigger>
              <TooltipContent>{opt.label}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      ) : null}

      {tweak.type === "segment" && (
        <div className="flex overflow-hidden rounded-lg border border-border">
          {tweak.options?.map((opt) => (
            <button
              type="button"
              key={opt.value}
              onClick={() => onChange(opt.value)}
              className={cn(
                "flex-1 cursor-pointer px-2.5 py-1 text-[11px] font-medium",
                value === opt.value
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
