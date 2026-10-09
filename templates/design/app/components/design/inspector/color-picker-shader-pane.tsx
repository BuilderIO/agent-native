import { useT } from "@agent-native/core/client/i18n";
import { parseCssColorExtended, rgbaToHex } from "@shared/color-utils";
import {
  shaderUniformLabel,
  type GlslShaderDef,
  type GlslUniformValue,
} from "@shared/shader-fills";
import {
  IconDots,
  IconSearch,
  IconSparkles,
  IconWaveSine,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useRef, useState, type MutableRefObject } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { ColorValueField } from "./color-picker-fields";
import type { RenderNestedColorPicker } from "./color-picker-nested";
import { swatchStyle } from "./color-picker-swatch";
import {
  isPresetStamp,
  PresetThumb,
  useGlslShaderSession,
  type GlslShaderPanelContext,
} from "./GlslShaderPanel";
import type { ScrubInputChangeMeta } from "./ScrubInput";

/** How the picker takes the shader off the element when the paint changes. */
export interface ShaderPaneController {
  hasShader: () => boolean;
  /** Whether the shader came off the element. */
  remove: () => Promise<boolean>;
}

const FIELD =
  "flex h-6 min-w-0 items-center rounded-md bg-[var(--design-editor-control-bg)]";
const ICON_BUTTON =
  "flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--design-editor-control-bg)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";
const BROWSE_VALUE = "__browse__";

/** A shader color is an opaque `#rrggbb`; anything the field reads is flattened to it on purpose. */
function uniformHex(css: string): string | null {
  const parsed = parseCssColorExtended(css);
  return parsed ? rgbaToHex(parsed) : null;
}

function decimalsOf(step: number): number {
  const text = String(step);
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

function KnobRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-6 grid-cols-[4.5rem_minmax(0,1fr)] items-center">
      <span className="truncate !text-[11px] text-muted-foreground">
        {label}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function ColorKnobRow({
  label,
  hex,
  disabled,
  renderColorPicker,
  onChange,
}: {
  label: string;
  hex: string;
  disabled: boolean;
  renderColorPicker?: RenderNestedColorPicker;
  onChange: (hex: string, phase: ScrubInputChangeMeta["phase"]) => void;
}) {
  const t = useT();
  const rowRef = useRef<HTMLDivElement>(null);
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);
  const write = (css: string, phase: ScrubInputChangeMeta["phase"]) => {
    const next = uniformHex(css);
    if (next) onChange(next, phase);
  };
  return (
    <>
      <div ref={rowRef}>
        <KnobRow label={label}>
          <div className={cn(FIELD, "gap-2 px-1.5")}>
            <button
              type="button"
              aria-label={`${label} ${t("editPanel.colorPicker.editColor")}`}
              disabled={disabled || !renderColorPicker}
              onClick={() => setPickerAnchor(rowRef.current)}
              className="size-4 shrink-0 rounded-[3px] border border-border/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
              style={swatchStyle(hex)}
            />
            <ColorValueField
              css={hex}
              ariaLabel={`${label} hex`}
              disabled={disabled}
              className="flex-1"
              onCommit={(css) => write(css, "commit")}
            />
          </div>
        </KnobRow>
      </div>
      {pickerAnchor
        ? renderColorPicker?.({
            anchor: pickerAnchor,
            css: hex,
            onChange: (css) => write(css, "preview"),
            onCommit: (css) => write(css, "commit"),
            onClose: () => setPickerAnchor(null),
            opaqueSrgb: true,
          })
        : null}
    </>
  );
}

function SliderKnobRow({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  onChange: (value: number, phase: ScrubInputChangeMeta["phase"]) => void;
}) {
  const decimals = decimalsOf(step);
  return (
    <KnobRow label={label}>
      <div className="grid grid-cols-[minmax(0,1fr)_3.5rem] items-center gap-2">
        <Slider
          value={[value]}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          aria-label={label}
          onValueChange={([next]) => onChange(next ?? value, "preview")}
          onValueCommit={([next]) => onChange(next ?? value, "commit")}
        />
        <Input
          type="number"
          value={Number(value.toFixed(decimals))}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          aria-label={`${label} value`}
          className={cn(
            FIELD,
            "h-6 border-0 px-1.5 text-right !text-[11px] tabular-nums shadow-none focus-visible:ring-1 md:!text-[11px]",
          )}
          onChange={(event) => onChange(Number(event.target.value), "preview")}
          onBlur={(event) => onChange(Number(event.target.value), "commit")}
        />
      </div>
    </KnobRow>
  );
}

function ShaderKnobs({
  def,
  values,
  disabled,
  renderColorPicker,
  onValuesChange,
}: {
  def: GlslShaderDef;
  values: Record<string, GlslUniformValue>;
  disabled: boolean;
  renderColorPicker?: RenderNestedColorPicker;
  onValuesChange: (
    next: Record<string, GlslUniformValue>,
    changedName: string,
    phase: ScrubInputChangeMeta["phase"],
  ) => void;
}) {
  const t = useT();
  const entries = Object.entries(def.uniforms);
  if (entries.length === 0) {
    return (
      <p className="!text-[11px] text-muted-foreground">
        {t("editPanel.shaders.noUniforms")}
      </p>
    );
  }
  const emit = (
    name: string,
    value: GlslUniformValue,
    phase: ScrubInputChangeMeta["phase"],
  ) => onValuesChange({ ...values, [name]: value }, name, phase);

  return (
    <>
      {entries.map(([name, uniform]) => {
        const label = shaderUniformLabel(name, uniform);
        const current = values[name] ?? uniform.value;
        if (uniform.type === "color") {
          const css = typeof current === "string" ? current : "";
          // A color the shader holds that is not hex is shown as it is, never as a stand-in.
          return (
            <ColorKnobRow
              key={name}
              label={label}
              hex={css}
              disabled={disabled}
              renderColorPicker={renderColorPicker}
              onChange={(next, phase) => emit(name, next, phase)}
            />
          );
        }
        if (uniform.type === "vec2") {
          const pair = Array.isArray(current) ? current : [0, 0];
          return (
            <KnobRow key={name} label={label}>
              <div className="grid grid-cols-2 gap-2">
                {([0, 1] as const).map((axis) => (
                  <div key={axis} className={cn(FIELD, "gap-1 px-1.5")}>
                    <span className="!text-[11px] text-muted-foreground">
                      {axis === 0 ? "X" : "Y"}
                    </span>
                    <Input
                      type="number"
                      value={Number(pair[axis]) || 0}
                      disabled={disabled}
                      aria-label={`${label} ${axis === 0 ? "X" : "Y"}`}
                      step={0.01}
                      className="h-6 min-w-0 border-0 bg-transparent px-1 !text-[11px] shadow-none focus-visible:ring-0 md:!text-[11px]"
                      onChange={(event) => {
                        const next: [number, number] = [
                          pair[0] ?? 0,
                          pair[1] ?? 0,
                        ];
                        next[axis] = Number(event.target.value);
                        emit(name, next, "preview");
                      }}
                      onBlur={(event) => {
                        const next: [number, number] = [
                          pair[0] ?? 0,
                          pair[1] ?? 0,
                        ];
                        next[axis] = Number(event.target.value);
                        emit(name, next, "commit");
                      }}
                    />
                  </div>
                ))}
              </div>
            </KnobRow>
          );
        }
        const numeric =
          typeof current === "number" ? current : Number(current) || 0;
        return (
          <SliderKnobRow
            key={name}
            label={label}
            value={numeric}
            min={uniform.min ?? 0}
            max={uniform.max ?? Math.max(1, numeric * 2)}
            step={uniform.step ?? 0.01}
            disabled={disabled}
            onChange={(next, phase) => emit(name, next, phase)}
          />
        );
      })}
    </>
  );
}

/**
 * The Shader paint's pane. It sits under the paint row like every other
 * paint's pane, and shows one of three views (`data-shader-pane`):
 *
 * - `controls`: the element's fill already has a shader (a preset, or custom
 *   code from the agent). This is what the picker opens on for such an element.
 *   A preset select (the preset's name, or "Custom" for any other code), a `...`
 *   menu with Edit code and Remove shader, and one control per uniform the
 *   shader's own manifest declares: a color row (opening the second picker) for
 *   each color, a slider for each number, an X/Y pair for each vec2. Mesh
 *   Gradient has four colors, Drift and Blend; custom code has whatever its
 *   author declared.
 * - `browse`: the element has no shader. A search, "Created by you" (Create
 *   with AI, then the design's own shaders), and the presets. Picking one
 *   applies it and the pane becomes `controls`; "Browse shaders" in the select
 *   comes back here without removing anything.
 * - `missing`: the element points at a shader whose code is not in the design.
 *   It says so and offers to remove the reference.
 */
export function ShaderPane({
  context,
  disabled,
  controllerRef,
  renderColorPicker,
  onRemoved,
}: {
  context: GlslShaderPanelContext;
  disabled: boolean;
  controllerRef: MutableRefObject<ShaderPaneController | null>;
  renderColorPicker?: RenderNestedColorPicker;
  /** The shader came off the element: the fill is solid again. */
  onRemoved: () => void;
}) {
  const t = useT();
  const session = useGlslShaderSession({ mode: "fill", context });
  const sessionRef = useRef(session);
  sessionRef.current = session;
  useEffect(() => {
    controllerRef.current = {
      hasShader: () =>
        Boolean(sessionRef.current.nodeMount || sessionRef.current.activeDef),
      remove: () => sessionRef.current.removeFromNode(),
    };
    return () => {
      controllerRef.current = null;
    };
  }, [controllerRef]);

  const { activeDef, busy } = session;
  const inert = disabled || busy;

  if (session.missingShaderId) {
    return (
      <div
        data-shader-pane="missing"
        className="flex flex-col items-start gap-2 px-3 py-3"
      >
        <p className="!text-[11px] text-muted-foreground">
          {t("editPanel.shaders.missingCode")}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={inert}
          className="h-6 !text-[11px]"
          onClick={() => {
            void session.removeFromNode().then((removed) => {
              if (removed) onRemoved();
            });
          }}
        >
          {t("editPanel.shaders.removeShader")}
        </Button>
      </div>
    );
  }

  if (activeDef) {
    // A preset by name only while its code is the preset's own; edited code is
    // the user's, and reads as Custom like the agent's.
    const matchedPreset = isPresetStamp(activeDef)
      ? session.presets.find((preset) => preset.label === activeDef.name)
      : undefined;
    return (
      <div
        data-shader-pane="controls"
        className="flex flex-col gap-2 px-3 py-3"
      >
        <div className="flex items-center gap-2">
          <Select
            value={matchedPreset?.name ?? activeDef.id}
            disabled={inert}
            onValueChange={(next) => {
              if (next === BROWSE_VALUE) {
                session.browse();
                return;
              }
              const preset = session.presets.find((p) => p.name === next);
              if (preset) session.applyPreset(preset);
            }}
          >
            <SelectTrigger
              aria-label={t("editPanel.shaders.shader")}
              title={matchedPreset ? undefined : activeDef.name}
              className="h-6 min-w-0 flex-1 rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 !text-[11px] shadow-none focus:ring-1 focus:ring-[var(--design-editor-accent-color)]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {matchedPreset ? null : (
                <SelectItem value={activeDef.id} className="!text-[11px]">
                  {t("editPanel.shaders.custom")}
                </SelectItem>
              )}
              {session.presets.map((preset) => (
                <SelectItem
                  key={preset.name}
                  value={preset.name}
                  className="!text-[11px]"
                >
                  {preset.label}
                </SelectItem>
              ))}
              <SelectSeparator />
              <SelectItem value={BROWSE_VALUE} className="!text-[11px]">
                {t("editPanel.shaders.browse")}
              </SelectItem>
            </SelectContent>
          </Select>
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={inert}
                    aria-label={t("editPanel.shaders.more")}
                    className={ICON_BUTTON}
                  >
                    <IconDots className="size-4" />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>{t("editPanel.shaders.more")}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              {context.onEditCode ? (
                // Edit code is in beta, so the item is inert. A disabled item
                // takes no pointer events: its wrapper carries the tooltip.
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="block">
                      <DropdownMenuItem disabled className="!text-[11px]">
                        {t("editPanel.shaders.editCode")}
                      </DropdownMenuItem>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    {t("editPanel.shaders.inBeta")}
                  </TooltipContent>
                </Tooltip>
              ) : null}
              <DropdownMenuItem
                className="!text-[11px]"
                disabled={!session.nodeMount}
                onSelect={() => {
                  void session.removeFromNode().then((removed) => {
                    if (removed) onRemoved();
                  });
                }}
              >
                {t("editPanel.shaders.removeShader")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <ShaderKnobs
          def={activeDef}
          values={session.values}
          disabled={inert}
          renderColorPicker={renderColorPicker}
          onValuesChange={session.handleValuesChange}
        />
      </div>
    );
  }

  const searching = session.search.length > 0;
  return (
    <div data-shader-pane="browse" className="flex flex-col">
      <div className="px-3 pt-3">
        <div className={cn(FIELD, "gap-1.5 px-2")}>
          <IconSearch className="size-3.5 shrink-0 text-muted-foreground" />
          <Input
            value={session.search}
            disabled={disabled}
            placeholder={t("editPanel.shaders.searchShaders")}
            aria-label={t("editPanel.shaders.searchShaders")}
            className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 !text-[11px] shadow-none focus-visible:ring-0 md:!text-[11px]"
            onChange={(event) => session.setSearch(event.target.value)}
          />
          {searching && (
            <button
              type="button"
              aria-label={t("editPanel.shaders.clearSearch")}
              onClick={() => session.setSearch("")}
              className="flex size-4 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            >
              <IconX className="size-3" />
            </button>
          )}
        </div>
      </div>

      <div className="max-h-[328px] space-y-3 overflow-y-auto px-3 py-3">
        {(!searching || session.savedShaders.length > 0) && (
          <section>
            <p className="mb-2 !text-[11px] text-muted-foreground">
              {t("editPanel.shaders.createdByYou")}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {!searching && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={session.createWithAi}
                  className={cn(
                    "group flex flex-col gap-1 text-left focus-visible:outline-none",
                    disabled && "pointer-events-none opacity-40",
                  )}
                >
                  <div className="flex aspect-[4/3] w-full items-center justify-center rounded-md border border-border/60 bg-[var(--design-editor-control-bg)] text-muted-foreground transition-colors group-hover:border-foreground/40 group-hover:text-foreground group-focus-visible:ring-2 group-focus-visible:ring-ring">
                    <IconSparkles className="size-4" />
                  </div>
                  <span className="truncate !text-[11px] text-foreground">
                    {t("editPanel.shaders.createWithAi")}
                  </span>
                </button>
              )}
              {session.savedShaders.map((shader) => (
                <Tooltip key={shader.id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      disabled={inert}
                      aria-label={shader.name}
                      onClick={() => session.applySaved(shader)}
                      className={cn(
                        "group flex flex-col gap-1 text-left focus-visible:outline-none",
                        inert && "pointer-events-none opacity-40",
                      )}
                    >
                      <div className="flex aspect-[4/3] w-full items-center justify-center rounded-md border border-border/60 bg-[var(--design-editor-control-bg)] transition-colors group-hover:border-foreground/40">
                        <IconWaveSine className="size-4 text-muted-foreground" />
                      </div>
                      <span className="truncate !text-[11px] text-foreground">
                        {shader.name}
                      </span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {t("editPanel.shaders.savedInThisDesign")}
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          </section>
        )}

        <section>
          <p className="mb-2 !text-[11px] text-muted-foreground">
            {t("editPanel.shaders.presets")}
          </p>
          {session.presets.length === 0 ? (
            <p className="py-4 text-center !text-[11px] text-muted-foreground">
              {t("editPanel.shaders.noMatches")}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {session.presets.map((preset) => (
                <PresetThumb
                  key={preset.name}
                  preset={preset}
                  disabled={inert}
                  labelClassName="!text-[11px] text-foreground"
                  onPick={session.applyPreset}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
