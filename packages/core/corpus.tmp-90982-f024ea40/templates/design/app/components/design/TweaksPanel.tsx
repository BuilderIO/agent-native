import { useT, VisualTweakControl } from "@agent-native/core/client";
import type { TweakDefinition } from "@shared/api";
import {
  IconX,
  IconGripHorizontal,
  IconPlus,
  IconAdjustmentsHorizontal,
} from "@tabler/icons-react";
import { useState, useRef, useCallback } from "react";

import { Button } from "@/components/ui/button";
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
          <p className="!text-[11px] leading-snug text-muted-foreground/70">
            {t("designEditor.noTweakControls")}
          </p>
          {onRequestTweaks && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 cursor-pointer border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-2.5 !text-[11px] text-foreground shadow-none hover:bg-[var(--design-editor-panel-raised-bg)] hover:text-foreground focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)] focus-visible:ring-offset-0"
              onClick={(e) => onRequestTweaks(e.currentTarget)}
            >
              <IconPlus className="size-3" />
              {t("designEditor.addTweakControls")}
            </Button>
          )}
        </div>
      )}
      <p
        data-tweaks-help
        className="mt-2 border-t border-border/60 pt-2 !text-[10px] leading-relaxed text-muted-foreground/70"
      >
        {t("designEditor.tweaksHelp")}{" "}
        <a
          href="/docs/template-design#tweaks"
          target="_blank"
          rel="noreferrer"
          className="font-medium text-foreground/80 underline-offset-2 hover:text-foreground hover:underline"
        >
          {t("designEditor.tweaksDocs")}
        </a>
      </p>
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
            className="cursor-pointer !text-[11px] font-semibold text-foreground hover:text-foreground/80"
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
  return (
    <VisualTweakControl
      tweak={tweak}
      value={value}
      onChange={onChange}
      className="min-w-0"
    />
  );
}
