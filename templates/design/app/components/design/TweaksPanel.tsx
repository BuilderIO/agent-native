import { useT } from "@agent-native/core/client";
import type { TweakDefinition } from "@shared/api";
import {
  IconX,
  IconGripHorizontal,
  IconPlus,
  IconAdjustmentsHorizontal,
} from "@tabler/icons-react";
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

interface TweaksPanelContentProps {
  tweaks: TweakDefinition[];
  values: Record<string, string | number | boolean>;
  onChange: (id: string, value: string | number | boolean) => void;
  onRequestTweaks?: (anchor: HTMLElement) => void;
  className?: string;
}

export function TweaksPanelContent({
  tweaks,
  values,
  onChange,
  onRequestTweaks,
  className,
}: TweaksPanelContentProps) {
  const t = useT();

  return (
    <div className={cn("space-y-1.5", className)}>
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
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <IconAdjustmentsHorizontal className="size-5 text-muted-foreground/40" />
          <p className="text-[11px] leading-snug text-muted-foreground/70">
            {t("designEditor.noTweakControls")}
          </p>
          {onRequestTweaks && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 cursor-pointer px-2.5 text-[11px]"
              onClick={(e) => onRequestTweaks(e.currentTarget)}
            >
              <IconPlus className="size-3" />
              {t("designEditor.addTweakControls")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
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
      {/* Header — drag handle + collapse toggle + actions */}
      <div
        className="flex min-h-8 cursor-grab select-none items-center justify-between px-3 active:cursor-grabbing"
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-1.5">
          <IconGripHorizontal className="size-3 text-muted-foreground/40" />
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setCollapsed((c) => !c)}
            className="cursor-pointer text-[11px] font-semibold text-foreground hover:text-foreground/80"
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
                  className="size-6 cursor-pointer text-muted-foreground/60 hover:text-foreground"
                  aria-label={t("designEditor.addTweaks")}
                >
                  <IconPlus className="size-3" />
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
            className="flex size-6 cursor-pointer items-center justify-center rounded text-muted-foreground/60 hover:bg-accent hover:text-foreground"
            aria-label={t("designEditor.closeTweaks")}
          >
            <IconX className="size-3" />
          </button>
        </div>
      </div>

      {/* Body */}
      {!collapsed && (
        <>
          <div className="mx-3 border-t border-border/60" />
          <TweaksPanelContent
            tweaks={tweaks}
            values={values}
            onChange={onChange}
            onRequestTweaks={onRequestTweaks}
            className="px-3 py-2"
          />
        </>
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
  // Toggle gets an inline row; other types get a label above
  if (tweak.type === "toggle") {
    return (
      <div className="flex h-6 items-center justify-between gap-1.5">
        <span className="text-[11px] text-muted-foreground">{tweak.label}</span>
        <Switch
          checked={!!value}
          onCheckedChange={(checked) => onChange(checked)}
          className="scale-[0.7] origin-right"
        />
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <span className="text-[11px] text-muted-foreground">{tweak.label}</span>

      {((tweak.type as string) === "color-swatch" ||
        (tweak.type as string) === "color-swatches") && (
        <div className="flex gap-1.5">
          {tweak.options?.map((opt) => (
            <Tooltip key={opt.value}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onChange(opt.value)}
                  className={cn(
                    "size-4 cursor-pointer rounded-sm transition-all",
                    value === opt.value
                      ? "ring-2 ring-foreground/80 ring-offset-1 ring-offset-card"
                      : "ring-1 ring-border/60 hover:ring-border",
                  )}
                  style={{ backgroundColor: opt.color ?? opt.value }}
                />
              </TooltipTrigger>
              <TooltipContent>{opt.label}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      )}

      {tweak.type === "segment" && (
        <div className="flex h-6 overflow-hidden rounded border border-border">
          {tweak.options?.map((opt) => (
            <button
              type="button"
              key={opt.value}
              onClick={() => onChange(opt.value)}
              className={cn(
                "flex flex-1 cursor-pointer items-center justify-center px-2 text-[11px] font-medium transition-colors",
                value === opt.value
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground/70 hover:bg-accent/50 hover:text-foreground",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {tweak.type === "slider" && (
        <div className="flex h-6 items-center gap-1.5">
          <Slider
            min={tweak.min ?? 0}
            max={tweak.max ?? 100}
            step={tweak.step ?? 1}
            value={[typeof value === "number" ? value : 50]}
            onValueChange={([v]) => onChange(v)}
            className="flex-1"
          />
          <span className="min-w-[2ch] text-right text-[11px] tabular-nums text-muted-foreground">
            {typeof value === "number" ? value : 50}
            {tweak.unit ??
              (tweak.cssVar?.toLowerCase().includes("radius") ? "px" : "")}
          </span>
        </div>
      )}
    </div>
  );
}
