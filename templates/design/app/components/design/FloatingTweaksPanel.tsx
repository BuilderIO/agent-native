import { useT } from "@agent-native/core/client/i18n";
import type { TweakDefinition } from "@shared/api";
import {
  IconChevronDown,
  IconChevronUp,
  IconGripHorizontal,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import { TweakProperties } from "./edit-panel/tweak-properties";
import { resolveFloatingTweaksPosition } from "./floating-tweaks-layout";

type TweakValue = string | number | boolean;

export function FloatingTweaksPanel({
  tweaks,
  values,
  onChange,
  open,
  collapsed,
  position,
  onOpenChange,
  onCollapsedChange,
  onPositionChange,
}: {
  tweaks: TweakDefinition[];
  values: Record<string, TweakValue>;
  onChange: (id: string, value: TweakValue) => void;
  open: boolean;
  collapsed: boolean;
  position: { x: number; y: number };
  onOpenChange: (open: boolean) => void;
  onCollapsedChange: (collapsed: boolean) => void;
  onPositionChange: (position: { x: number; y: number }) => void;
}) {
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const [dragPosition, setDragPosition] = useState(position);
  const [layoutPosition, setLayoutPosition] = useState({ x: 16, y: 16 });
  useEffect(() => setDragPosition(position), [position.x, position.y]);
  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const canvas = document.querySelector<HTMLElement>(
        "[data-design-canvas-container]",
      );
      const rect = canvas?.getBoundingClientRect();
      const panelRect = panelRef.current?.getBoundingClientRect();
      const viewport = {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight,
      };
      const canvasRect = rect ?? {
        left: 0,
        top: 0,
        right: viewport.width,
        bottom: viewport.height,
      };
      const getObstruction = (selector: string) =>
        document.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
      setLayoutPosition(
        resolveFloatingTweaksPosition({
          canvas: canvasRect,
          panel: {
            width: panelRect?.width ?? 288,
            height: panelRect?.height ?? 220,
          },
          viewport,
          position: dragPosition,
          leftObstruction: getObstruction(
            '[data-design-chrome-region="left-shell"]',
          ),
          rightObstruction: getObstruction(
            '[data-design-chrome-region="right-panel"]',
          ),
          bottomObstruction: getObstruction("[data-design-bottom-toolbar]"),
        }),
      );
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    const observer = new ResizeObserver(updatePosition);
    for (const selector of [
      "[data-design-canvas-container]",
      '[data-design-chrome-region="left-shell"]',
      '[data-design-chrome-region="right-panel"]',
      "[data-design-bottom-toolbar]",
    ]) {
      const element = document.querySelector(selector);
      if (element) observer.observe(element);
    }
    return () => {
      window.removeEventListener("resize", updatePosition);
      observer.disconnect();
    };
  }, [dragPosition, open, collapsed, tweaks.length]);
  if (!open || tweaks.length === 0) return null;

  const startDrag = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const start = { x: event.clientX, y: event.clientY };
    const origin = dragPosition;
    let next = origin;
    const move = (moveEvent: PointerEvent) => {
      const rect = panelRef.current?.getBoundingClientRect();
      const width = document.documentElement.clientWidth;
      const height = document.documentElement.clientHeight;
      next = {
        x: Math.max(
          8,
          Math.min(
            width - (rect?.width ?? 280) - 8,
            origin.x + start.x - moveEvent.clientX,
          ),
        ),
        y: Math.max(
          8,
          Math.min(
            height - (rect?.height ?? 220) - 8,
            origin.y + start.y - moveEvent.clientY,
          ),
        ),
      };
      setDragPosition(next);
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      onPositionChange(next);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
  };

  return (
    <section
      ref={panelRef}
      data-design-floating-tweaks
      className="fixed z-[80] w-72 max-h-[min(70vh,36rem)] overflow-auto rounded-lg border border-border bg-[var(--design-editor-panel-bg)] shadow-2xl"
      style={{ left: layoutPosition.x, top: layoutPosition.y }}
      aria-label={t("designEditor.tweaks")}
    >
      <header className="sticky top-0 flex h-9 items-center gap-1 border-b border-border/60 bg-[var(--design-editor-panel-bg)] px-2">
        <button
          type="button"
          onPointerDown={startDrag}
          className="flex min-w-0 flex-1 cursor-grab items-center gap-1.5 text-left text-xs font-medium active:cursor-grabbing"
        >
          <IconGripHorizontal className="size-3.5 text-muted-foreground" />
          {t("designEditor.tweaks")}
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label={
            collapsed
              ? t("designEditor.expandTweaks")
              : t("designEditor.collapseTweaks")
          }
          onClick={() => onCollapsedChange(!collapsed)}
        >
          {collapsed ? (
            <IconChevronUp className="size-3.5" />
          ) : (
            <IconChevronDown className="size-3.5" />
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label={t("designEditor.closeTweaks")}
          onClick={() => onOpenChange(false)}
        >
          <IconX className="size-3.5" />
        </Button>
      </header>
      {!collapsed && (
        <div className="flex flex-col gap-[var(--design-inspector-grid-gap)] p-3">
          <TweakProperties
            tweaks={tweaks}
            values={values}
            onChange={onChange}
          />
        </div>
      )}
    </section>
  );
}
