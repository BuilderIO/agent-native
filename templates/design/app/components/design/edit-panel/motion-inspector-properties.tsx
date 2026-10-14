import { useT } from "@agent-native/core/client/i18n";
import { IconLink, IconTarget, IconUnlink } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";

import { formatShortcutLabel } from "@/components/design/keyboard-shortcuts";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useApplePlatform } from "@/hooks/use-shortcut-label";
import { cn } from "@/lib/utils";

import type { ElementInfo } from "../types";
import {
  commitStylePatch,
  FieldTrailer,
  ScrubStyleInput,
} from "./field-primitives";
import { SectionIconToggle } from "./inspector-controls";
import { authoredStyleValue } from "./interaction-state-helpers";
import {
  INSPECTOR_GRID_MOTION_ACTION_SPAN,
  INSPECTOR_GRID_MOTION_COMPACT_FIELD_SPAN,
  INSPECTOR_GRID_MOTION_GUTTER_SPAN,
  INSPECTOR_GRID_PAIR_GUTTER_SPAN,
  INSPECTOR_GRID_PAIR_SPAN,
  InspectorGrid,
  InspectorGridCell,
  PanelSection,
  SubsectionLabel,
} from "./panel-primitives";
import { isMixedValue, MIXED_VALUE } from "./selection-helpers";
import type {
  BreakpointOverrideFieldContext,
  MotionKeyframeFieldContext,
  StyleChangeHandler,
  StylesChangeHandler,
} from "./style-change-types";

type MotionOrigin = { x: number; y: number; z?: string };

const ORIGIN_ANCHORS = [
  [0, 0, "topLeft"],
  [50, 0, "topCenter"],
  [100, 0, "topRight"],
  [0, 50, "middleLeft"],
  [50, 50, "center"],
  [100, 50, "middleRight"],
  [0, 100, "bottomLeft"],
  [50, 100, "bottomCenter"],
  [100, 100, "bottomRight"],
] as const;

function parseOriginCoordinate(
  token: string,
  size: number,
  axis: "x" | "y",
): number | null {
  const normalized = token.toLowerCase();
  if (normalized === "center") return 50;
  if (normalized === (axis === "x" ? "left" : "top")) return 0;
  if (normalized === (axis === "x" ? "right" : "bottom")) return 100;

  const match = /^(-?(?:\d+(?:\.\d*)?|\.\d+))(px|%)?$/u.exec(normalized);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  if (match[2] === "%") return value;
  if (size <= 0) return value === 0 ? 0 : null;
  return (value / size) * 100;
}

function parseMotionOrigin(
  value: string | undefined,
  width: number,
  height: number,
): MotionOrigin | null {
  if (value === undefined || value === "") return { x: 50, y: 50 };
  if (isMixedValue(value)) return null;

  const tokens = value.trim().split(/\s+/u);
  if (tokens.length > 3 || tokens.length === 0) return null;

  let xToken: string | undefined;
  let yToken: string | undefined;
  const lengths: string[] = [];
  for (const token of tokens) {
    const normalized = token.toLowerCase();
    if (normalized === "left" || normalized === "right") {
      if (xToken) return null;
      xToken = token;
    } else if (normalized === "top" || normalized === "bottom") {
      if (yToken) return null;
      yToken = token;
    } else if (normalized === "center") {
      if (!xToken) xToken = token;
      else if (!yToken) yToken = token;
      else return null;
    } else {
      lengths.push(token);
    }
  }

  if (lengths.length > 2) return null;
  for (const token of lengths) {
    if (!xToken) xToken = token;
    else if (!yToken) yToken = token;
    else return null;
  }

  // A single vertical keyword is centered on the other axis. A single
  // horizontal keyword or length follows CSS's horizontal-first shorthand.
  if (!xToken && yToken) xToken = "center";
  if (!yToken) yToken = "center";

  const x = parseOriginCoordinate(xToken ?? "center", width, "x");
  const y = parseOriginCoordinate(yToken, height, "y");
  if (x === null || y === null) return null;
  return {
    x,
    y,
    ...(tokens.length === 3 ? { z: tokens[2] } : {}),
  };
}

function formatOriginValue(origin: MotionOrigin): string {
  const coordinate = (value: number) => `${Number(value.toFixed(3))}%`;
  return [coordinate(origin.x), coordinate(origin.y), origin.z]
    .filter(Boolean)
    .join(" ");
}

function currentMotionOrigin(element: ElementInfo): MotionOrigin | null {
  const value =
    element.inlineStyles?.["transform-origin"] ??
    element.inlineStyles?.transformOrigin ??
    element.computedStyles["transform-origin"] ??
    element.computedStyles.transformOrigin ??
    authoredStyleValue(element, "transform-origin") ??
    authoredStyleValue(element, "transformOrigin");
  return parseMotionOrigin(
    value,
    element.boundingRect.width,
    element.boundingRect.height,
  );
}

export function MotionOriginControl({
  element,
  onStyleChange,
  onStylesChange,
  onEditingChange,
}: {
  element: ElementInfo;
  onStyleChange: StyleChangeHandler;
  onStylesChange?: StylesChangeHandler;
  onEditingChange?: (open: boolean) => void;
}) {
  const t = useT();
  const origin = currentMotionOrigin(element);
  const applePlatform = useApplePlatform();
  const [open, setOpen] = useState(false);
  const originSurfaceRef = useRef<HTMLDivElement>(null);
  const dragPointerIdRef = useRef<number | null>(null);
  const apply = (next: MotionOrigin) =>
    commitStylePatch(
      { "transform-origin": formatOriginValue(next) },
      onStyleChange,
      onStylesChange,
    );
  const updateFromPointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const bounds = originSurfaceRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0 || !origin) return;
    const x =
      Math.round(
        Math.max(
          0,
          Math.min(100, ((event.clientX - bounds.left) / bounds.width) * 100),
        ) * 100,
      ) / 100;
    const y =
      Math.round(
        Math.max(
          0,
          Math.min(100, ((event.clientY - bounds.top) / bounds.height) * 100),
        ) * 100,
      ) / 100;
    apply({ x, y, z: origin.z });
  };
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    onEditingChange?.(next);
  };

  useEffect(() => {
    return () => onEditingChange?.(false);
  }, [onEditingChange]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        (event.code !== "KeyR" && event.key.toLowerCase() !== "r")
      ) {
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName))
      ) {
        return;
      }
      event.preventDefault();
      handleOpenChange(!open);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onEditingChange, open]);

  const moveWithArrowKey = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!origin) return;
    const step = event.shiftKey ? 10 : 1;
    const next = { x: origin.x, y: origin.y, z: origin.z };
    if (event.key === "ArrowLeft") next.x = Math.max(0, next.x - step);
    else if (event.key === "ArrowRight") next.x = Math.min(100, next.x + step);
    else if (event.key === "ArrowUp") next.y = Math.max(0, next.y - step);
    else if (event.key === "ArrowDown") next.y = Math.min(100, next.y + step);
    else return;
    event.preventDefault();
    apply(next);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("designEditor.motion.origin")}
              aria-keyshortcuts="Alt+R"
              className="size-6 text-muted-foreground hover:text-foreground"
            >
              <IconTarget className="size-3.5" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {t("designEditor.motion.origin")}{" "}
          {formatShortcutLabel("alt+r", applePlatform)}
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="end" side="bottom" className="w-52 p-2">
        <div className="space-y-2">
          <div
            ref={originSurfaceRef}
            role="group"
            aria-label={t("editPanel.scale.anchor")}
            data-motion-origin-surface
            className="relative h-16 w-full touch-none select-none overflow-hidden rounded-sm border border-dashed border-muted-foreground/40 bg-muted/20"
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-border"
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-border"
            />
            <button
              type="button"
              aria-label={`${t("editPanel.scale.anchor")}: ${origin?.x ?? 50}%, ${origin?.y ?? 50}%`}
              aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
              disabled={!origin}
              data-motion-origin-handle
              onPointerDown={(event) => {
                if (event.button !== 0 || !origin) return;
                event.preventDefault();
                dragPointerIdRef.current = event.pointerId;
                event.currentTarget.setPointerCapture?.(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (dragPointerIdRef.current === event.pointerId) {
                  updateFromPointer(event);
                }
              }}
              onPointerUp={(event) => {
                if (dragPointerIdRef.current !== event.pointerId) return;
                dragPointerIdRef.current = null;
                if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
              }}
              onPointerCancel={() => {
                dragPointerIdRef.current = null;
              }}
              onKeyDown={moveWithArrowKey}
              style={{
                left: `${origin?.x ?? 50}%`,
                top: `${origin?.y ?? 50}%`,
              }}
              className="absolute z-10 flex size-5 -translate-x-1/2 -translate-y-1/2 cursor-move touch-none items-center justify-center rounded-full border border-[var(--design-editor-accent-color)] bg-background text-[var(--design-editor-accent-color)] shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)] disabled:cursor-default disabled:opacity-50"
            >
              <IconTarget className="size-3.5" />
            </button>
          </div>
          <div
            role="radiogroup"
            aria-label={t("editPanel.scale.anchor")}
            className="grid w-full grid-cols-3 gap-0"
          >
            {ORIGIN_ANCHORS.map(([x, y, key]) => {
              const label = t(`editPanel.scale.${key}`);
              const selected = origin?.x === x && origin?.y === y;
              return (
                <button
                  key={`${x}:${y}`}
                  type="button"
                  role="radio"
                  aria-label={label}
                  aria-checked={selected}
                  onClick={() => apply({ x, y, z: origin?.z })}
                  className={cn(
                    "flex h-5 w-full items-center justify-center rounded border border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
                    selected &&
                      "border-[var(--design-editor-accent-color)] bg-[var(--design-editor-selection-color)] text-[var(--design-editor-accent-color)]",
                  )}
                >
                  <span className="size-1.5 rounded-full bg-current" />
                </button>
              );
            })}
          </div>
          <InspectorGrid className="items-center" layout="pair">
            <InspectorGridCell span={INSPECTOR_GRID_PAIR_SPAN}>
              <ScrubStyleInput
                label="X"
                ariaLabel={`${t("designEditor.motion.origin")} X`}
                tooltipLabel={t("designEditor.motion.origin")}
                value={origin ? String(origin.x) : MIXED_VALUE}
                unit="%"
                precision={2}
                step={0.01}
                disabled={!origin}
                inputClassName="h-6"
                onChange={(x) => apply({ x, y: origin?.y ?? 50, z: origin?.z })}
              />
            </InspectorGridCell>
            <InspectorGridCell
              span={INSPECTOR_GRID_PAIR_GUTTER_SPAN}
              ariaHidden
            />
            <InspectorGridCell span={INSPECTOR_GRID_PAIR_SPAN}>
              <ScrubStyleInput
                label="Y"
                ariaLabel={`${t("designEditor.motion.origin")} Y`}
                tooltipLabel={t("designEditor.motion.origin")}
                value={origin ? String(origin.y) : MIXED_VALUE}
                unit="%"
                precision={2}
                step={0.01}
                disabled={!origin}
                inputClassName="h-6"
                onChange={(y) => apply({ x: origin?.x ?? 50, y, z: origin?.z })}
              />
            </InspectorGridCell>
          </InspectorGrid>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function currentDimension(element: ElementInfo, axis: "width" | "height") {
  const raw =
    element.computedStyles[axis] ??
    element.inlineStyles?.[axis] ??
    authoredStyleValue(element, axis);
  if (isMixedValue(raw)) return null;
  const parsed = Number.parseFloat(raw ?? "");
  if (Number.isFinite(parsed)) return parsed;
  const measured = element.boundingRect[axis];
  return Number.isFinite(measured) ? measured : null;
}

export function MotionDimensionsProperties({
  element,
  onStyleChange,
  onStylesChange,
  motionKeyframeContext,
  breakpointOverrideContext,
  children,
}: {
  element: ElementInfo;
  onStyleChange: StyleChangeHandler;
  onStylesChange?: StylesChangeHandler;
  motionKeyframeContext?: MotionKeyframeFieldContext;
  breakpointOverrideContext?: BreakpointOverrideFieldContext;
  children?: ReactNode;
}) {
  const t = useT();
  const width = currentDimension(element, "width");
  const height = currentDimension(element, "height");
  const [aspectLocked, setAspectLocked] = useState(false);
  const ratio = width && height ? width / height : null;

  const commitDimension = (
    axis: "width" | "height",
    value: number,
    meta?: Parameters<StyleChangeHandler>[2],
  ) => {
    const nextWidth = axis === "width" ? value : width;
    const nextHeight = axis === "height" ? value : height;
    const linkedValue =
      aspectLocked && ratio
        ? axis === "width"
          ? value / ratio
          : value * ratio
        : undefined;
    const patch = {
      ...(nextWidth !== null && {
        width: `${Number(nextWidth.toFixed(2))}px`,
      }),
      ...(nextHeight !== null && {
        height: `${Number(nextHeight.toFixed(2))}px`,
      }),
      ...(linkedValue !== undefined &&
        (axis === "width"
          ? { height: `${Number(linkedValue.toFixed(2))}px` }
          : { width: `${Number(linkedValue.toFixed(2))}px` })),
    };
    commitStylePatch(patch, onStyleChange, onStylesChange, meta);
  };

  return (
    <PanelSection title={t("designEditor.motion.layout")}>
      <div className="design-sidebar-property-group">
        <SubsectionLabel>{t("designEditor.motion.dimensions")}</SubsectionLabel>
        <InspectorGrid
          className="group/field relative items-center"
          layout="columns"
        >
          <InspectorGridCell
            span={INSPECTOR_GRID_MOTION_COMPACT_FIELD_SPAN}
            className="min-w-0"
          >
            <ScrubStyleInput
              label="W"
              ariaLabel={t("editPanel.labels.width")}
              tooltipLabel={t("designEditor.motion.dimensions")}
              unit=""
              precision={2}
              value={width === null ? MIXED_VALUE : String(width)}
              inputClassName="h-6"
              onChange={(value, meta) => commitDimension("width", value, meta)}
            />
          </InspectorGridCell>
          <InspectorGridCell
            span={INSPECTOR_GRID_MOTION_ACTION_SPAN}
            className="flex items-center justify-center"
          >
            <FieldTrailer
              element={element}
              motionCssProperty="width"
              overrideProperty="width"
              motionKeyframeContext={motionKeyframeContext}
              breakpointOverrideContext={breakpointOverrideContext}
            />
          </InspectorGridCell>
          <InspectorGridCell
            span={INSPECTOR_GRID_MOTION_GUTTER_SPAN}
            ariaHidden
          />
          <InspectorGridCell
            span={INSPECTOR_GRID_MOTION_COMPACT_FIELD_SPAN}
            className="min-w-0"
          >
            <ScrubStyleInput
              label="H"
              ariaLabel={t("editPanel.labels.height")}
              tooltipLabel={t("designEditor.motion.dimensions")}
              unit=""
              precision={2}
              value={height === null ? MIXED_VALUE : String(height)}
              inputClassName="h-6"
              onChange={(value, meta) => commitDimension("height", value, meta)}
            />
          </InspectorGridCell>
          <InspectorGridCell
            span={INSPECTOR_GRID_MOTION_ACTION_SPAN}
            className="flex items-center justify-center"
          >
            <FieldTrailer
              element={element}
              motionCssProperty="height"
              overrideProperty="height"
              motionKeyframeContext={motionKeyframeContext}
              breakpointOverrideContext={breakpointOverrideContext}
            />
          </InspectorGridCell>
          <InspectorGridCell
            span={INSPECTOR_GRID_MOTION_ACTION_SPAN}
            className="flex items-center justify-center"
          >
            <SectionIconToggle
              label={
                aspectLocked
                  ? t("editPanel.labels.unlockAspectRatio")
                  : t("editPanel.labels.lockAspectRatio")
              }
              active={aspectLocked}
              disabled={ratio === null}
              onClick={() => setAspectLocked((locked) => !locked)}
            >
              {aspectLocked ? (
                <IconLink className="size-3.5" />
              ) : (
                <IconUnlink className="size-3.5" />
              )}
            </SectionIconToggle>
          </InspectorGridCell>
        </InspectorGrid>
      </div>
      {children}
    </PanelSection>
  );
}
