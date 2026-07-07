import { useT } from "@agent-native/core/client";
import {
  parseCssColor,
  rgbaToCss,
  withColorOpacity,
} from "@shared/color-utils";
import {
  IconBackground,
  IconBlur,
  IconEye,
  IconEyeOff,
  IconMinus,
  IconPlus,
  IconShadow,
  IconWaveSine,
} from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { ScrubInput } from "../inspector";
import {
  GlslShaderEffectSection,
  useScreenGlslShaders,
  type GlslShaderPanelContext,
} from "../inspector/GlslShaderPanel";
import type { ElementInfo } from "../types";
import { elementIdentityKey } from "./element-identity";
import { FieldTrailer } from "./field-primitives";
import { splitCssLayers } from "./fill-gradient-helpers";
import {
  RowDragHandle,
  SectionIconButton,
  useRowDragReorder,
} from "./inspector-controls";
import { ColorInput, PanelSection } from "./panel-primitives";
import {
  colorHasVisibleAlpha,
  compactCssValue,
  cssColorOrFallback,
  swatchStyle,
} from "./position-helpers";
import type {
  MotionKeyframeFieldContext,
  StyleChangeHandler,
  StyleChangeMeta,
  StylesChangeHandler,
} from "./style-change-types";

interface ShadowLayer {
  id: string;
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
  inset: boolean;
}

function defaultDropShadowLayer(index: number): ShadowLayer {
  return {
    id: `shadow-${index}`,
    x: 0,
    y: 4,
    blur: 12,
    spread: 0,
    color: "rgba(0, 0, 0, 0.25)",
    inset: false,
  };
}

function parseShadowLayers(value: string | undefined): ShadowLayer[] {
  return splitCssLayers(value || "")
    .filter((layer) => layer && layer !== "none")
    .map((layer, index) => parseShadowLayer(layer, index));
}

function parseShadowLayer(layer: string, index: number): ShadowLayer {
  const tokens = splitCssTokens(layer);
  const inset = tokens.includes("inset");
  const colorToken =
    tokens.find((token) => parseCssColor(token) || token === "transparent") ??
    // Preserve a color we don't parse into RGBA (currentColor, var(--x), or any
    // unrecognized keyword): the color is the non-inset token that doesn't look
    // like a numeric length. Without this, tweaking x/y/blur would reset it to
    // the hardcoded default below.
    tokens.find((token) => token !== "inset" && !/^[-+]?[\d.]/.test(token)) ??
    "rgba(0, 0, 0, 0.25)";
  const numericTokens = tokens
    .filter((token) => token !== "inset" && token !== colorToken)
    .map((token) => parseFloat(token))
    .filter((value) => Number.isFinite(value));

  return {
    id: `shadow-${index}`,
    x: numericTokens[0] ?? 0,
    y: numericTokens[1] ?? 4,
    blur: numericTokens[2] ?? 12,
    spread: numericTokens[3] ?? 0,
    color: colorToken,
    inset,
  };
}

function splitCssTokens(value: string): string[] {
  const tokens: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (/\s/.test(char) && depth === 0) {
      const token = value.slice(start, index).trim();
      if (token) tokens.push(token);
      start = index + 1;
    }
  }
  const finalToken = value.slice(start).trim();
  if (finalToken) tokens.push(finalToken);
  return tokens;
}

function serializeShadowLayers(layers: ShadowLayer[]) {
  if (!layers.length) return "none";
  return layers
    .map((layer) =>
      [
        layer.inset ? "inset" : "",
        `${Math.round(layer.x)}px`,
        `${Math.round(layer.y)}px`,
        `${Math.max(0, Math.round(layer.blur))}px`,
        // Spread radius may legitimately be negative for either inset or
        // drop shadows — only blur-radius is clamped to >= 0 in CSS.
        `${Math.round(layer.spread)}px`,
        layer.color,
      ]
        .filter(Boolean)
        .join(" "),
    )
    .join(", ");
}

function readBlurFilter(value: string | undefined): number {
  const match = value?.match(/blur\((-?\d+(?:\.\d+)?)px\)/);
  return match ? Math.max(0, Number(match[1])) : 0;
}

function hasBlurFilter(value: string | undefined): boolean {
  return /blur\(/.test(value || "");
}

function setBlurFilterValue(value: string | undefined, blur: number): string {
  const blurFn = `blur(${Math.max(0, Math.round(blur))}px)`;
  const existing = compactCssValue(value, "");
  return existing.includes("blur(")
    ? existing.replace(/blur\([^)]*\)/, blurFn)
    : blurFn;
}

function shadowColorWithOpacity(color: string, opacity: number): string {
  const parsed = parseCssColor(color);
  return parsed
    ? rgbaToCss(withColorOpacity(parsed, opacity))
    : opacity <= 0
      ? "rgba(0, 0, 0, 0)"
      : color;
}

function ShadowEffectRow({
  layer,
  index,
  onChange,
  onRemove,
  onToggleVisibility,
  dragHandleLabel,
  dropIndicator,
  rowProps,
  handleProps,
  element,
  motionKeyframeContext,
}: {
  layer: ShadowLayer;
  index: number;
  onChange: (patch: Partial<ShadowLayer>, meta?: StyleChangeMeta) => void;
  onRemove: () => void;
  onToggleVisibility: () => void;
  dragHandleLabel: string;
  dropIndicator?: "before" | "after" | null;
  rowProps: ReturnType<ReturnType<typeof useRowDragReorder>["getRowProps"]>;
  handleProps: ReturnType<
    ReturnType<typeof useRowDragReorder>["getHandleProps"]
  >;
  /**
   * Optional — only needed for the keyframe diamond (drop shadow's motion
   * track keys the WHOLE `box-shadow` value, so there's one diamond for the
   * layer, not per x/y/blur field). No breakpoint override indicator here —
   * multi-layer `box-shadow` composition isn't covered by
   * `getBreakpointOverrideState`'s per-property model yet.
   */
  element?: ElementInfo;
  motionKeyframeContext?: MotionKeyframeFieldContext;
}) {
  const t = useT();
  const visible = colorHasVisibleAlpha(layer.color);
  return (
    <Popover>
      {/* design effect row: [grip] [swatch+label+x,y,blur trigger (flex-1)] [eye] [remove] */}
      <div className="group relative flex items-center gap-1.5" {...rowProps}>
        <RowDragHandle
          label={dragHandleLabel}
          dropIndicator={dropIndicator}
          {...handleProps}
        />
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 text-left !text-[11px] hover:bg-[var(--design-editor-panel-raised-bg)]"
          >
            <span
              className="size-4 shrink-0 rounded-sm border border-[var(--design-editor-control-border)]"
              style={swatchStyle(layer.color)}
            />
            <span className="min-w-0 flex-1 truncate font-medium text-foreground">
              {index === 0
                ? t("editPanel.labels.dropShadow")
                : `${t("editPanel.labels.dropShadow")} ${index + 1}`}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {Math.round(layer.x)}, {Math.round(layer.y)},{" "}
              {Math.round(layer.blur)}
            </span>
          </button>
        </PopoverTrigger>
        <SectionIconButton
          label={
            visible
              ? t("editPanel.labels.hideLayer")
              : t("editPanel.labels.showLayer")
          }
          onClick={onToggleVisibility}
        >
          {visible ? (
            <IconEye className="size-3.5" />
          ) : (
            <IconEyeOff className="size-3.5" />
          )}
        </SectionIconButton>
        <SectionIconButton
          label={t("editPanel.labels.removeLayer")}
          onClick={onRemove}
        >
          <IconMinus className="size-3.5" />
        </SectionIconButton>
        {index === 0 && element ? (
          <FieldTrailer
            element={element}
            motionCssProperty="box-shadow"
            motionKeyframeContext={motionKeyframeContext}
            hoverRevealClassName="opacity-0 group-hover:opacity-100"
          />
        ) : null}
      </div>
      <PopoverContent
        side="left"
        align="start"
        sideOffset={8}
        className="w-72 p-3"
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-foreground">
              {t("editPanel.labels.dropShadow")}
            </p>
            <button
              type="button"
              className={cn(
                "rounded border px-2 py-1 !text-[11px]",
                layer.inset
                  ? "border-[var(--design-editor-accent-color)] bg-[var(--design-editor-selection-color)] text-foreground"
                  : "border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] text-muted-foreground",
              )}
              onClick={() => onChange({ inset: !layer.inset })}
            >
              {t("editPanel.labels.innerShadow")}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <ScrubInput
              label="X"
              value={layer.x}
              onChange={(value, meta) =>
                onChange({ x: value }, { phase: meta?.phase })
              }
              unit="px"
              precision={1}
              inputClassName="h-6"
            />
            <ScrubInput
              label="Y"
              value={layer.y}
              onChange={(value, meta) =>
                onChange({ y: value }, { phase: meta?.phase })
              }
              unit="px"
              precision={1}
              inputClassName="h-6"
            />
            <ScrubInput
              label={t("editPanel.labels.blur")}
              value={layer.blur}
              onChange={(value, meta) =>
                onChange({ blur: Math.max(0, value) }, { phase: meta?.phase })
              }
              unit="px"
              min={0}
              precision={1}
              inputClassName="h-6"
            />
            <ScrubInput
              label={t("editPanel.labels.spread")}
              value={layer.spread}
              // Spread radius is valid negative for both inset AND drop
              // (non-inset) shadows in real CSS — negative spread shrinks
              // the shadow smaller than the box before blurring, a common
              // technique. Only blur-radius must stay >= 0.
              onChange={(value, meta) =>
                onChange({ spread: value }, { phase: meta?.phase })
              }
              unit="px"
              precision={1}
              inputClassName="h-6"
            />
          </div>
          <ColorInput
            label={t("editPanel.labels.color")}
            value={cssColorOrFallback(layer.color, "rgba(0, 0, 0, 0.25)")}
            onChange={(value, meta) => onChange({ color: value }, meta)}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function EffectsProperties({
  element,
  onStyleChange,
  onStylesChange,
  glslShaderContext,
  motionKeyframeContext,
}: {
  element: ElementInfo;
  onStyleChange: StyleChangeHandler;
  onStylesChange?: StylesChangeHandler;
  /**
   * Persistence context for the code-backed Shader effect type (GLSL
   * overlay rendered above the element's content, saved into the screen
   * HTML). When absent the Shader entry is hidden from the Add-effect menu.
   */
  glslShaderContext?: GlslShaderPanelContext;
  motionKeyframeContext?: MotionKeyframeFieldContext;
}) {
  const t = useT();
  const [shaderPickerOpen, setShaderPickerOpen] = useState(false);
  const styles = element.computedStyles;
  const blurValue = readBlurFilter(styles.filter);
  const filterHasBlur = hasBlurFilter(styles.filter);
  // M5 · Background (backdrop) blur is a distinct design effect type, backed by
  // CSS `backdrop-filter: blur()` (vs layer blur's `filter: blur()`).
  const backdropFilterValue =
    styles.backdropFilter || styles.webkitBackdropFilter;
  const backdropFilterHasBlur = hasBlurFilter(backdropFilterValue);
  const backdropBlurValue = readBlurFilter(backdropFilterValue);
  const [hiddenEffectStash, setHiddenEffectStash] = useState<
    Record<string, string>
  >({});
  const effectStashKey = elementIdentityKey(element);
  const layerBlurStashKey = `${effectStashKey}:filter:blur`;
  const backdropBlurStashKey = `${effectStashKey}:backdrop-filter:blur`;
  const shadowLayers = parseShadowLayers(styles.boxShadow);
  const setShadowLayers = (layers: ShadowLayer[], meta?: StyleChangeMeta) => {
    const boxShadow = serializeShadowLayers(layers);
    if (onStylesChange) onStylesChange({ boxShadow }, meta);
    else onStyleChange("boxShadow", boxShadow, meta);
  };
  const addDropShadow = () =>
    setShadowLayers([
      ...shadowLayers,
      defaultDropShadowLayer(shadowLayers.length),
    ]);
  const addLayerBlur = () => onStyleChange("filter", "blur(4px)");
  const addBackgroundBlur = () => onStyleChange("backdropFilter", "blur(8px)");
  const reorderShadowLayers = (from: number, to: number) => {
    const next = [...shadowLayers];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) return;
    next.splice(to, 0, moved);
    setShadowLayers(next);
  };
  const shadowDrag = useRowDragReorder(
    shadowLayers.length,
    reorderShadowLayers,
  );
  // `glslShaderContext?.nodeId` is the SELECTION target's node id — it is set
  // whenever the selected element is a valid shader-effect host, regardless
  // of whether a shader effect actually exists on it yet (it also describes
  // "could add a shader here"). Gating on its mere presence made the section
  // think it had content for every plain element with no effects at all.
  // Look up whether an effect-mode shader is actually MOUNTED on this node
  // (same screen.mounts lookup GlslShaderEffectSection performs internally)
  // so the gate reflects a real effect, not just a selectable target.
  const screenShaders = useScreenGlslShaders(glslShaderContext ?? {});
  const hasShaderEffect = Boolean(
    glslShaderContext?.nodeId &&
    screenShaders.mounts.some(
      (mount) =>
        mount.nodeId === glslShaderContext.nodeId && mount.mode === "effect",
    ),
  );
  // Whether there is anything at all to render below the header row. Each
  // effect kind below is its own top-level sibling conditional (not one
  // single ternary), so when every one of them is empty, JSX would still
  // hand PanelSection a real (truthy) array of `null`s as `children` — its
  // `children &&` guard can't tell that apart from "has content" and renders
  // an empty spacer div under the header. Gating the whole block behind one
  // boolean keeps `children` a real `null` in that case, matching how the
  // other sections (e.g. Fill) stay collapsed-empty.
  // Also true while the shader picker is open (adding a new shader effect,
  // not applied yet) — mirrors GlslShaderEffectSection's own
  // `!effectMount && !pickerOpen` early-return so opening the picker doesn't
  // get swallowed by this outer gate before it can render itself.
  const hasEffectsContent =
    shadowLayers.length > 0 ||
    filterHasBlur ||
    backdropFilterHasBlur ||
    hasShaderEffect ||
    shaderPickerOpen;

  return (
    <PanelSection
      title={t("editPanel.sections.effects")}
      actions={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 cursor-pointer rounded-md text-muted-foreground hover:text-foreground"
              aria-label={t("editPanel.labels.addLayer")}
            >
              <IconPlus className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuItem
              className="gap-2 !text-[11px]"
              onSelect={addDropShadow}
            >
              <IconShadow className="size-3.5" />
              {t("editPanel.labels.dropShadow")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2 !text-[11px]"
              onSelect={addLayerBlur}
            >
              <IconBlur className="size-3.5" />
              {t("editPanel.labels.layerBlur")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2 !text-[11px]"
              onSelect={addBackgroundBlur}
            >
              <IconBackground className="size-3.5" />
              {"Background blur" /* i18n-ignore design effect type */}
            </DropdownMenuItem>
            {glslShaderContext?.nodeId ? (
              <DropdownMenuItem
                className="gap-2 !text-[11px]"
                onSelect={() => {
                  // Defer past the dropdown's close so the inline picker's
                  // focus handling isn't clobbered by menu teardown.
                  setTimeout(() => setShaderPickerOpen(true), 0);
                }}
              >
                <IconWaveSine className="size-3.5" />
                {t("editPanel.labels.shaderEffectType")}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      {hasEffectsContent ? (
        <>
          {shadowLayers.length ? (
            <div className="space-y-1.5">
              {shadowLayers.map((layer, index) => (
                <ShadowEffectRow
                  key={layer.id}
                  layer={layer}
                  index={index}
                  dragHandleLabel={t("editPanel.labels.reorderLayer")}
                  dropIndicator={
                    shadowDrag.dragIndex != null &&
                    shadowDrag.overIndex === index
                      ? shadowDrag.overIndex > shadowDrag.dragIndex
                        ? "after"
                        : "before"
                      : null
                  }
                  rowProps={shadowDrag.getRowProps(index)}
                  handleProps={shadowDrag.getHandleProps(index)}
                  onChange={(patch, meta) => {
                    const next = shadowLayers.map((candidate) =>
                      candidate.id === layer.id
                        ? { ...candidate, ...patch }
                        : candidate,
                    );
                    setShadowLayers(next, meta);
                  }}
                  onToggleVisibility={() => {
                    const visible = colorHasVisibleAlpha(layer.color);
                    const shadowStashKey = `${effectStashKey}:shadow:${layer.id}`;
                    if (visible) {
                      setHiddenEffectStash((prev) => ({
                        ...prev,
                        [shadowStashKey]: layer.color,
                      }));
                      const next = shadowLayers.map((candidate) =>
                        candidate.id === layer.id
                          ? {
                              ...candidate,
                              color: shadowColorWithOpacity(candidate.color, 0),
                            }
                          : candidate,
                      );
                      setShadowLayers(next);
                      return;
                    }

                    const restored =
                      hiddenEffectStash[shadowStashKey] ??
                      shadowColorWithOpacity(layer.color, 25);
                    setHiddenEffectStash((prev) => {
                      const next = { ...prev };
                      delete next[shadowStashKey];
                      return next;
                    });
                    const next = shadowLayers.map((candidate) =>
                      candidate.id === layer.id
                        ? { ...candidate, color: restored }
                        : candidate,
                    );
                    setShadowLayers(next);
                  }}
                  onRemove={() =>
                    setShadowLayers(
                      shadowLayers.filter(
                        (candidate) => candidate.id !== layer.id,
                      ),
                    )
                  }
                  element={element}
                  motionKeyframeContext={motionKeyframeContext}
                />
              ))}
            </div>
          ) : null}
          {filterHasBlur ? (
            /* design effect row for layer blur: flat row matching shadow rows */
            <Popover>
              <div className="group flex items-center gap-1.5">
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 text-left !text-[11px] hover:bg-[var(--design-editor-panel-raised-bg)]"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                      {t("editPanel.labels.layerBlur")}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {Math.round(blurValue)}px
                    </span>
                  </button>
                </PopoverTrigger>
                <SectionIconButton
                  label={
                    blurValue > 0
                      ? t("editPanel.labels.hideLayer")
                      : t("editPanel.labels.showLayer")
                  }
                  onClick={() => {
                    if (blurValue > 0) {
                      setHiddenEffectStash((prev) => ({
                        ...prev,
                        [layerBlurStashKey]: String(blurValue),
                      }));
                      onStyleChange(
                        "filter",
                        setBlurFilterValue(styles.filter, 0),
                      );
                      return;
                    }

                    const restored = Number(
                      hiddenEffectStash[layerBlurStashKey],
                    );
                    const nextBlur =
                      Number.isFinite(restored) && restored > 0 ? restored : 4;
                    setHiddenEffectStash((prev) => {
                      const next = { ...prev };
                      delete next[layerBlurStashKey];
                      return next;
                    });
                    onStyleChange(
                      "filter",
                      setBlurFilterValue(styles.filter, nextBlur),
                    );
                  }}
                >
                  {blurValue > 0 ? (
                    <IconEye className="size-3.5" />
                  ) : (
                    <IconEyeOff className="size-3.5" />
                  )}
                </SectionIconButton>
                <SectionIconButton
                  label={t("editPanel.labels.removeLayer")}
                  onClick={() => onStyleChange("filter", "none")}
                  disabled={!filterHasBlur}
                >
                  <IconMinus className="size-3.5" />
                </SectionIconButton>
              </div>
              <PopoverContent
                side="left"
                align="start"
                sideOffset={8}
                className="w-56 p-3"
              >
                <ScrubInput
                  label={t("editPanel.labels.blur")}
                  value={blurValue}
                  onChange={(value, meta) =>
                    onStyleChange(
                      "filter",
                      setBlurFilterValue(styles.filter, value),
                      meta,
                    )
                  }
                  unit="px"
                  min={0}
                  precision={1}
                  labelClassName="w-16"
                  inputClassName="h-6"
                />
              </PopoverContent>
            </Popover>
          ) : null}
          {backdropFilterHasBlur ? (
            /* M5 · Background (backdrop) blur effect row — mirrors the layer-blur row */
            <Popover>
              <div className="group flex items-center gap-1.5">
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 text-left !text-[11px] hover:bg-[var(--design-editor-panel-raised-bg)]"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                      {"Background blur" /* i18n-ignore design effect type */}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {Math.round(backdropBlurValue)}px
                    </span>
                  </button>
                </PopoverTrigger>
                <SectionIconButton
                  label={
                    backdropBlurValue > 0
                      ? t("editPanel.labels.hideLayer")
                      : t("editPanel.labels.showLayer")
                  }
                  onClick={() => {
                    if (backdropBlurValue > 0) {
                      setHiddenEffectStash((prev) => ({
                        ...prev,
                        [backdropBlurStashKey]: String(backdropBlurValue),
                      }));
                      onStyleChange(
                        "backdropFilter",
                        setBlurFilterValue(backdropFilterValue, 0),
                      );
                      return;
                    }

                    const restored = Number(
                      hiddenEffectStash[backdropBlurStashKey],
                    );
                    const nextBlur =
                      Number.isFinite(restored) && restored > 0 ? restored : 8;
                    setHiddenEffectStash((prev) => {
                      const next = { ...prev };
                      delete next[backdropBlurStashKey];
                      return next;
                    });
                    onStyleChange(
                      "backdropFilter",
                      setBlurFilterValue(backdropFilterValue, nextBlur),
                    );
                  }}
                >
                  {backdropBlurValue > 0 ? (
                    <IconEye className="size-3.5" />
                  ) : (
                    <IconEyeOff className="size-3.5" />
                  )}
                </SectionIconButton>
                <SectionIconButton
                  label={t("editPanel.labels.removeLayer")}
                  onClick={() => onStyleChange("backdropFilter", "none")}
                  disabled={!backdropFilterHasBlur}
                >
                  <IconMinus className="size-3.5" />
                </SectionIconButton>
              </div>
              <PopoverContent
                side="left"
                align="start"
                sideOffset={8}
                className="w-56 p-3"
              >
                <ScrubInput
                  label={t("editPanel.labels.blur")}
                  value={backdropBlurValue}
                  onChange={(value, meta) =>
                    onStyleChange(
                      "backdropFilter",
                      setBlurFilterValue(backdropFilterValue, value),
                      meta,
                    )
                  }
                  unit="px"
                  min={0}
                  precision={1}
                  labelClassName="w-16"
                  inputClassName="h-6"
                />
              </PopoverContent>
            </Popover>
          ) : null}
          {glslShaderContext?.nodeId ? (
            /* Code-backed GLSL shader effect — overlay canvas above the
           element's content, persisted as editable GLSL in the screen HTML
           (see shared/shader-fills.ts). Renders its row (when applied) and
           the picker (when adding). */
            <GlslShaderEffectSection
              context={glslShaderContext}
              pickerOpen={shaderPickerOpen}
              onPickerOpenChange={setShaderPickerOpen}
            />
          ) : null}
        </>
      ) : null}
    </PanelSection>
  );
}
