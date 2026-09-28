import { useT } from "@agent-native/core/client/i18n";
import {
  parseCssColor,
  rgbaToCss,
  withColorOpacity,
} from "@shared/color-utils";
import {
  IconBackground,
  IconBlur,
  IconChevronDown,
  IconDroplet,
  IconEye,
  IconEyeOff,
  IconLayoutGrid,
  IconMinus,
  IconPlus,
  IconShadow,
  IconSquare,
  IconSun,
  IconWaveSine,
} from "@tabler/icons-react";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import {
  GlslShaderEffectSection,
  useScreenGlslShaders,
  type GlslShaderPanelContext,
} from "../inspector/GlslShaderPanel";
import {
  InspectorControlField,
  InspectorControlPopoverContent,
} from "../inspector/InspectorControlPopover";
import type { ElementInfo } from "../types";
import { isTextElement } from "./element-classification";
import { elementStableKey } from "./element-identity";
import { FieldTrailer } from "./field-primitives";
import { splitCssLayers } from "./fill-gradient-helpers";
import {
  RowDragHandle,
  SectionIconButton,
  useRowDragReorder,
} from "./inspector-controls";
import { InspectorGridCell, InspectorPaintRow } from "./inspector-grid";
import { ColorInput, PanelSection } from "./panel-primitives";
import {
  colorHasVisibleAlpha,
  compactCssValue,
  cssColorOrFallback,
  roundToOneDecimal,
} from "./position-helpers";
import { isMixedValue } from "./selection-helpers";
import type {
  MotionKeyframeFieldContext,
  StyleChangeHandler,
  StyleChangeMeta,
  StylesChangeHandler,
} from "./style-change-types";

export interface ShadowLayer {
  id: string;
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
  inset: boolean;
}

// guard:allow-raw-color — authored shadows need a concrete CSS color fallback.
const DEFAULT_DROP_SHADOW_COLOR = "rgba(0, 0, 0, 0.25)";

function defaultDropShadowLayer(index: number): ShadowLayer {
  return {
    id: `shadow-${index}`,
    x: 0,
    y: 4,
    blur: 12,
    spread: 0,
    color: DEFAULT_DROP_SHADOW_COLOR,
    inset: false,
  };
}

export function parseShadowLayers(value: string | undefined): ShadowLayer[] {
  return splitCssLayers(value || "")
    .filter((layer) => layer && layer !== "none")
    .map((layer, index) => parseShadowLayer(layer, index));
}

function parseShadowLayer(layer: string, index: number): ShadowLayer {
  const tokens = splitCssTokens(layer);
  const inset = tokens.includes("inset");
  const colorToken =
    tokens.find((token) => parseCssColor(token) || token === "transparent") ??
    tokens.find((token) => token !== "inset" && !/^[-+]?[\d.]/.test(token)) ??
    DEFAULT_DROP_SHADOW_COLOR;
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

export function serializeShadowLayers(layers: ShadowLayer[]) {
  if (!layers.length) return "none";
  return layers
    .map((layer) =>
      [
        layer.inset ? "inset" : "",
        `${roundToOneDecimal(layer.x)}px`,
        `${roundToOneDecimal(layer.y)}px`,
        `${Math.max(0, roundToOneDecimal(layer.blur))}px`,
        `${roundToOneDecimal(layer.spread)}px`,
        layer.color,
      ]
        .filter(Boolean)
        .join(" "),
    )
    .join(", ");
}

export function serializeTextShadowLayers(layers: ShadowLayer[]) {
  const visible = layers.filter((layer) => !layer.inset);
  if (!visible.length) return "none";
  return visible
    .map((layer) =>
      [
        `${roundToOneDecimal(layer.x)}px`,
        `${roundToOneDecimal(layer.y)}px`,
        `${Math.max(0, roundToOneDecimal(layer.blur))}px`,
        layer.color,
      ].join(" "),
    )
    .join(", ");
}

export function readBlurFilter(value: string | undefined): number {
  const match = value?.match(/blur\((-?(?:\d+(?:\.\d+)?|\.\d+))px\)/);
  return match ? Math.max(0, Number(match[1])) : 0;
}

function hasBlurFilter(value: string | undefined): boolean {
  return /blur\(/.test(value || "");
}

export function setBlurFilterValue(
  value: string | undefined,
  blur: number,
): string {
  const blurFn = `blur(${Math.max(0, roundToOneDecimal(blur))}px)`;
  const existing = compactCssValue(value, "");
  return existing.includes("blur(")
    ? existing.replace(/blur\([^)]*\)/, blurFn)
    : existing && existing !== "none"
      ? `${existing} ${blurFn}`
      : blurFn;
}

export function removeBlurFilterValue(value: string | undefined): string {
  const existing = compactCssValue(value, "");
  if (!existing || existing === "none") return "none";
  const remaining = existing
    .replace(/blur\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return remaining || "none";
}

export function remapIndexedShadowStash(
  stash: Record<string, string>,
  elementKey: string,
  nextLayers: readonly Pick<ShadowLayer, "id">[],
): Record<string, string> {
  const prefix = `${elementKey}:shadow:`;
  const moved = nextLayers.flatMap((layer, index) => {
    const value = stash[`${prefix}${layer.id}`];
    return value === undefined ? [] : [[`${prefix}shadow-${index}`, value]];
  });
  if (!Object.keys(stash).some((key) => key.startsWith(prefix))) return stash;
  const next = Object.fromEntries(
    Object.entries(stash).filter(([key]) => !key.startsWith(prefix)),
  );
  for (const [key, value] of moved) next[key] = value;
  const stashEntries = Object.entries(stash);
  if (
    stashEntries.length === Object.keys(next).length &&
    stashEntries.every(([key, value]) => next[key] === value)
  ) {
    return stash;
  }
  return next;
}

function shadowColorWithOpacity(color: string, opacity: number): string {
  const parsed = parseCssColor(color);
  return parsed
    ? rgbaToCss(withColorOpacity(parsed, opacity))
    : opacity <= 0
      ? "rgba(0, 0, 0, 0)"
      : color;
}

export function effectsSelectionIsMixed(styles: {
  boxShadow?: string;
  filter?: string;
  backdropFilter?: string;
  webkitBackdropFilter?: string;
}): boolean {
  return [
    styles.boxShadow,
    styles.filter,
    styles.backdropFilter,
    styles.webkitBackdropFilter,
  ].some(isMixedValue);
}

function EffectPopoverRow({
  title,
  icon,
  visible,
  onToggleVisibility,
  onRemove,
  dragHandleLabel,
  dropIndicator,
  rowProps,
  handleProps,
  trailer,
  titleAccessory,
  headerActions,
  footer,
  children,
}: {
  title: string;
  icon: ReactNode;
  visible: boolean;
  onToggleVisibility: () => void;
  onRemove: () => void;
  dragHandleLabel?: string;
  dropIndicator?: "before" | "after" | null;
  rowProps?: ReturnType<ReturnType<typeof useRowDragReorder>["getRowProps"]>;
  handleProps?: ReturnType<
    ReturnType<typeof useRowDragReorder>["getHandleProps"]
  >;
  trailer?: ReactNode;
  titleAccessory?: ReactNode;
  headerActions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <InspectorPaintRow {...rowProps} draggable={Boolean(handleProps)}>
        {handleProps ? (
          <InspectorGridCell span={1}>
            <RowDragHandle
              label={dragHandleLabel ?? t("editPanel.labels.reorderLayer")}
              dropIndicator={dropIndicator}
              {...handleProps}
            />
          </InspectorGridCell>
        ) : null}
        <InspectorGridCell span={20}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex h-6 w-full min-w-0 items-center gap-1.5 rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 text-left !text-[11px] hover:bg-[var(--design-editor-panel-raised-bg)]"
            >
              <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                {icon}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                {title}
              </span>
            </button>
          </PopoverTrigger>
        </InspectorGridCell>
        <InspectorGridCell span={4} className="flex justify-center">
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
        </InspectorGridCell>
        <InspectorGridCell span={4} className="flex justify-center">
          <SectionIconButton
            label={t("editPanel.labels.removeLayer")}
            onClick={onRemove}
          >
            <IconMinus className="size-3.5" />
          </SectionIconButton>
        </InspectorGridCell>
        {trailer ? (
          <InspectorGridCell span={1} className="flex justify-center">
            {trailer}
          </InspectorGridCell>
        ) : null}
      </InspectorPaintRow>
      <InspectorControlPopoverContent
        title={title}
        icon={icon}
        titleAccessory={titleAccessory}
        headerActions={headerActions}
        onClose={() => setOpen(false)}
        footer={footer}
      >
        {children}
      </InspectorControlPopoverContent>
    </Popover>
  );
}

function useNumericEffectDraft(value: number, min?: number) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const parse = (raw: string) => {
    const parsed = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(parsed)) return null;
    return min === undefined ? parsed : Math.max(min, parsed);
  };

  return {
    draft,
    preview(
      raw: string,
      onChange: (value: number, meta: StyleChangeMeta) => void,
    ) {
      setDraft(raw);
      const next = parse(raw);
      if (next !== null) onChange(next, { phase: "preview" });
    },
    commit(onChange: (value: number, meta: StyleChangeMeta) => void) {
      const next = parse(draft) ?? value;
      setDraft(String(next));
      onChange(next, { phase: "commit" });
    },
  };
}

export function BlurControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number, meta: StyleChangeMeta) => void;
}) {
  const numberDraft = useNumericEffectDraft(value, 0);
  return (
    <InspectorControlField label={label}>
      <Input
        type="number"
        min={0}
        step={1}
        value={numberDraft.draft}
        aria-label={`${label} value`}
        className="h-6 border-0 bg-[var(--design-editor-control-bg)] px-2 !text-[11px] shadow-none"
        onChange={(event) =>
          numberDraft.preview(event.currentTarget.value, onChange)
        }
        onBlur={() => numberDraft.commit(onChange)}
      />
    </InspectorControlField>
  );
}

export function ShadowNumberControl({
  label,
  ariaLabel,
  value,
  min,
  onChange,
}: {
  label: ReactNode;
  ariaLabel: string;
  value: number;
  min?: number;
  onChange: (value: number, meta: StyleChangeMeta) => void;
}) {
  const numberDraft = useNumericEffectDraft(value, min);
  return (
    <div className="design-inspector-popover-number grid h-6 min-w-0 overflow-hidden rounded-md bg-[var(--design-editor-control-bg)]">
      <span className="flex items-center justify-center !text-[11px] text-muted-foreground">
        {label}
      </span>
      <Input
        type="number"
        value={numberDraft.draft}
        min={min}
        step={1}
        aria-label={`${ariaLabel} value`}
        className="h-6 min-w-0 border-0 bg-transparent px-1 !text-[11px] shadow-none focus-visible:ring-0"
        onChange={(event) =>
          numberDraft.preview(event.currentTarget.value, onChange)
        }
        onBlur={() => numberDraft.commit(onChange)}
      />
    </div>
  );
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
  element?: ElementInfo;
  motionKeyframeContext?: MotionKeyframeFieldContext;
}) {
  const t = useT();
  const effectType = layer.inset
    ? t("editPanel.labels.innerShadow")
    : t("editPanel.labels.dropShadow");
  const title = index === 0 ? effectType : `${effectType} ${index + 1}`;
  return (
    <EffectPopoverRow
      title={title}
      icon={
        <IconSquare className="size-3.5 drop-shadow-[0_2px_0_var(--design-editor-control-border)]" />
      }
      visible={colorHasVisibleAlpha(layer.color)}
      onToggleVisibility={onToggleVisibility}
      dragHandleLabel={dragHandleLabel}
      dropIndicator={dropIndicator}
      rowProps={rowProps}
      handleProps={handleProps}
      onRemove={onRemove}
      titleAccessory={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex size-5 items-center justify-center rounded-md text-muted-foreground hover:bg-[var(--design-editor-control-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={"Change shadow type" /* i18n-ignore */}
            >
              <IconChevronDown className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-36">
            <DropdownMenuItem
              className="!text-[11px]"
              onSelect={() => onChange({ inset: false })}
            >
              {t("editPanel.labels.dropShadow")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="!text-[11px]"
              onSelect={() => onChange({ inset: true })}
            >
              {t("editPanel.labels.innerShadow")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
      headerActions={
        <span
          className="flex size-6 items-center justify-center text-muted-foreground"
          aria-hidden
        >
          <IconDroplet className="size-3.5" />
        </span>
      }
      trailer={
        index === 0 && element ? (
          <FieldTrailer
            element={element}
            motionCssProperty="box-shadow"
            motionKeyframeContext={motionKeyframeContext}
            hoverRevealClassName="opacity-0 group-hover:opacity-100"
          />
        ) : undefined
      }
    >
      <div className="design-sidebar-control-stack">
        <InspectorControlField label={t("editPanel.labels.position")}>
          <div className="design-sidebar-control-stack">
            <ShadowNumberControl
              label="X"
              ariaLabel="X"
              value={layer.x}
              onChange={(value, meta) => onChange({ x: value }, meta)}
            />
            <ShadowNumberControl
              label="Y"
              ariaLabel="Y"
              value={layer.y}
              onChange={(value, meta) => onChange({ y: value }, meta)}
            />
          </div>
        </InspectorControlField>
      </div>
      <InspectorControlField label={t("editPanel.labels.blur")}>
        <ShadowNumberControl
          label={<IconBlur className="size-3.5" />}
          ariaLabel={t("editPanel.labels.blur")}
          value={layer.blur}
          min={0}
          onChange={(value, meta) => onChange({ blur: value }, meta)}
        />
      </InspectorControlField>
      <InspectorControlField label={t("editPanel.labels.spread")}>
        <ShadowNumberControl
          label={<IconSun className="size-3.5" />}
          ariaLabel={t("editPanel.labels.spread")}
          value={layer.spread}
          onChange={(value, meta) => onChange({ spread: value }, meta)}
        />
      </InspectorControlField>
      <InspectorControlField label={t("editPanel.labels.color")}>
        <ColorInput
          label={t("editPanel.labels.color")}
          value={cssColorOrFallback(layer.color, DEFAULT_DROP_SHADOW_COLOR)}
          onChange={(value, meta) => onChange({ color: value }, meta)}
        />
      </InspectorControlField>
    </EffectPopoverRow>
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
  glslShaderContext?: GlslShaderPanelContext;
  motionKeyframeContext?: MotionKeyframeFieldContext;
}) {
  const t = useT();
  const [shaderPickerOpen, setShaderPickerOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const styles = element.computedStyles;
  const backdropFilterValue =
    styles.backdropFilter || styles.webkitBackdropFilter;
  const effectsAreMixed = effectsSelectionIsMixed({
    boxShadow: styles.boxShadow,
    filter: styles.filter,
    backdropFilter: styles.backdropFilter,
    webkitBackdropFilter: styles.webkitBackdropFilter,
  });
  const blurValue = readBlurFilter(styles.filter);
  const filterHasBlur = !effectsAreMixed && hasBlurFilter(styles.filter);
  const backdropFilterHasBlur =
    !effectsAreMixed && hasBlurFilter(backdropFilterValue);
  const backdropBlurValue = readBlurFilter(backdropFilterValue);
  const [hiddenEffectStash, setHiddenEffectStash] = useState<
    Record<string, string>
  >({});
  const effectStashKey = elementStableKey(element);
  const layerBlurStashKey = `${effectStashKey}:filter:blur`;
  const backdropBlurStashKey = `${effectStashKey}:backdrop-filter:blur`;
  const shadowTargetsText = isTextElement(element);
  const shadowLayers = effectsAreMixed
    ? []
    : parseShadowLayers(
        shadowTargetsText ? styles.textShadow : styles.boxShadow,
      );
  const setShadowLayers = (layers: ShadowLayer[], meta?: StyleChangeMeta) => {
    setHiddenEffectStash((stash) =>
      remapIndexedShadowStash(stash, effectStashKey, layers),
    );
    if (shadowTargetsText) {
      const textShadow = serializeTextShadowLayers(layers);
      if (onStylesChange) onStylesChange({ textShadow }, meta);
      else onStyleChange("textShadow", textShadow, meta);
      return;
    }
    const boxShadow = serializeShadowLayers(layers);
    if (onStylesChange) onStylesChange({ boxShadow }, meta);
    else onStyleChange("boxShadow", boxShadow, meta);
  };
  const addDropShadow = () =>
    setShadowLayers([
      ...shadowLayers,
      defaultDropShadowLayer(shadowLayers.length),
    ]);
  const addLayerBlur = () =>
    onStyleChange("filter", setBlurFilterValue(styles.filter, 4));
  const addBackgroundBlur = () =>
    onStyleChange("backdropFilter", setBlurFilterValue(backdropFilterValue, 8));
  const reorderShadowLayers = (from: number, to: number) => {
    const next = [...shadowLayers];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    setShadowLayers(next);
  };
  const shadowDrag = useRowDragReorder(
    shadowLayers.length,
    reorderShadowLayers,
  );
  const screenShaders = useScreenGlslShaders(glslShaderContext ?? {});
  const hasShaderEffect = Boolean(
    glslShaderContext?.nodeId &&
    screenShaders.mounts.some(
      (mount) =>
        mount.nodeId === glslShaderContext.nodeId && mount.mode === "effect",
    ),
  );
  const hasEffectsContent =
    effectsAreMixed ||
    shadowLayers.length > 0 ||
    filterHasBlur ||
    backdropFilterHasBlur ||
    hasShaderEffect ||
    shaderPickerOpen;

  return (
    <PanelSection
      title={t("editPanel.sections.effects")}
      onEmptyTitleClick={() => setAddMenuOpen(true)}
      actions={
        <>
          <SectionIconButton
            label={t("editPanel.labels.stylesComingSoon")}
            disabled
          >
            <IconLayoutGrid className="size-3.5" />
          </SectionIconButton>
          <DropdownMenu open={addMenuOpen} onOpenChange={setAddMenuOpen}>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6 cursor-pointer rounded-md text-muted-foreground hover:text-foreground"
                    aria-label={t("editPanel.labels.addEffect")}
                  >
                    <IconPlus className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>{t("editPanel.labels.addEffect")}</TooltipContent>
            </Tooltip>
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
                    setTimeout(() => setShaderPickerOpen(true), 0);
                  }}
                >
                  <IconWaveSine className="size-3.5" />
                  {t("editPanel.labels.shaderEffectType")}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    >
      {hasEffectsContent ? (
        <>
          {effectsAreMixed ? (
            <p className="px-1.5 py-2 !text-[11px] text-muted-foreground">
              {
                "Click + to replace mixed content" /* i18n-ignore figma mixed effects hint */
              }
            </p>
          ) : (
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
                                  color: shadowColorWithOpacity(
                                    candidate.color,
                                    0,
                                  ),
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
                <EffectPopoverRow
                  title={t("editPanel.labels.layerBlur")}
                  icon={<IconBlur className="size-3.5" />}
                  visible={blurValue > 0}
                  onToggleVisibility={() => {
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
                  onRemove={() =>
                    onStyleChange(
                      "filter",
                      removeBlurFilterValue(styles.filter),
                    )
                  }
                >
                  <BlurControl
                    label={t("editPanel.labels.blur")}
                    value={blurValue}
                    onChange={(value, meta) =>
                      onStyleChange(
                        "filter",
                        setBlurFilterValue(styles.filter, value),
                        meta,
                      )
                    }
                  />
                </EffectPopoverRow>
              ) : null}
              {backdropFilterHasBlur ? (
                <EffectPopoverRow
                  title={"Background blur" /* i18n-ignore design effect type */}
                  icon={<IconBackground className="size-3.5" />}
                  visible={backdropBlurValue > 0}
                  onToggleVisibility={() => {
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
                  onRemove={() =>
                    onStyleChange(
                      "backdropFilter",
                      removeBlurFilterValue(backdropFilterValue),
                    )
                  }
                >
                  <BlurControl
                    label={t("editPanel.labels.blur")}
                    value={backdropBlurValue}
                    onChange={(value, meta) =>
                      onStyleChange(
                        "backdropFilter",
                        setBlurFilterValue(backdropFilterValue, value),
                        meta,
                      )
                    }
                  />
                </EffectPopoverRow>
              ) : null}
            </>
          )}
          {glslShaderContext?.nodeId ? (
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
