import { callAction } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { resolveCodeLayerTarget } from "@shared/code-layer";
import { nativeEffectAnimationCapability } from "@shared/native-effect-animation-capability";
import type { NativeEffectEdit } from "@shared/native-effect-edits";
import {
  NATIVE_EFFECT_LATEST_DEFINITIONS,
  NATIVE_EFFECT_PRESETS,
} from "@shared/native-effect-presets";
import {
  parseEffectsFromHtml,
  type EffectColor,
  type EffectDefinition,
  type EffectInstance,
  type EffectPreset,
  type EffectValue,
} from "@shared/native-effects";
import { IconMinus, IconSearch } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverAnchor,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import {
  broadcastShaderMessage,
  withShaderWriteLock,
  type GlslShaderPanelContext,
} from "./GlslShaderPanel";
import { InspectorControlPopoverContent } from "./InspectorControlPopover";
import {
  nativeCatalogDefinitionKey,
  nativeCatalogOptionKey,
  nativeCatalogPresetKey,
  nativeCatalogPropertyKey,
} from "./native-catalog-display";

type Placement = EffectInstance["placement"];
type SourceFile = { content?: string; versionHash?: string };
type EditResult = {
  content: string;
  updatedAt?: string;
  instanceIds: string[];
};

export async function persistNativeShaderEdit(
  context: GlslShaderPanelContext,
  operation: NativeEffectEdit,
): Promise<EditResult> {
  if (!context.designId || !context.fileId || context.editSource)
    throw new Error("native-screen-file-required");
  const { designId, fileId } = context;
  return withShaderWriteLock(fileId, async () => {
    const source = await callAction<SourceFile>(
      "read-source-file",
      { designId, fileId },
      { method: "GET" },
    );
    if (typeof source.content !== "string" || !source.versionHash)
      throw new Error("native-screen-source-unavailable");
    const written = await callAction<EditResult>("edit-native-shader", {
      designId,
      fileId,
      expectedVersionHash: source.versionHash,
      operation,
    });
    context.onApplied?.(
      fileId,
      written.content,
      written.updatedAt,
      source.content,
    );
    broadcastShaderMessage({ type: "glsl-shader-rescan" });
    return written;
  });
}

export function selectedNativeInstances(
  content: string | undefined,
  nodeId: string | undefined,
  placement: Placement,
  selector?: string,
): {
  instances: EffectInstance[];
  definitions: EffectDefinition[];
  errors: string[];
} {
  if (!content || (!nodeId && !selector))
    return { instances: [], definitions: [], errors: [] };
  const parsed = parseEffectsFromHtml(content);
  const resolved = selector
    ? resolveCodeLayerTarget(content, { selector }).resolution
    : null;
  const authoredId =
    resolved?.status === "resolved" && resolved.node
      ? resolved.node.dataAttributes["data-agent-native-node-id"]
      : undefined;
  return {
    instances: (parsed.document?.instances ?? []).filter(
      (instance) =>
        (instance.nodeId === nodeId || instance.nodeId === authoredId) &&
        instance.placement === placement,
    ),
    definitions: parsed.document?.definitions ?? [],
    errors: parsed.errors,
  };
}

export function hasSelectedNativeEffects(
  content: string | undefined,
  nodeId: string | undefined,
  selector?: string,
): boolean {
  return (["layer", "backdrop"] as const).some(
    (placement) =>
      selectedNativeInstances(content, nodeId, placement, selector).instances
        .length > 0,
  );
}

function colorHex(color: EffectColor): string {
  return `#${color.components
    .map((component) =>
      Math.round(Math.max(0, Math.min(1, component)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function colorWithHex(color: EffectColor, hex: string): EffectColor {
  return {
    ...color,
    components: [1, 3, 5].map(
      (index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255,
    ) as [number, number, number],
  };
}

function NumericField({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onCommit,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled: boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const parsed = Number(draft);
    if (
      draft.trim() &&
      Number.isFinite(parsed) &&
      (min === undefined || parsed >= min) &&
      (max === undefined || parsed <= max) &&
      parsed !== value
    )
      onCommit(parsed);
    setDraft(null);
  };
  return (
    <Input
      aria-label={label}
      type="number"
      value={draft ?? String(value)}
      min={min}
      max={max}
      step={step ?? "any"}
      disabled={disabled}
      className="h-7 w-24 text-xs"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") setDraft(null);
      }}
    />
  );
}

function PropertyControls({
  definition,
  instance,
  disabled,
  onChange,
}: {
  definition: EffectDefinition;
  instance: EffectInstance;
  disabled: boolean;
  onChange: (name: string, value: EffectValue) => void;
}) {
  const t = useT();
  return (
    <div className="grid gap-2">
      {Object.entries(definition.properties).map(([name, property]) => {
        const propertyKey = nativeCatalogPropertyKey(
          definition,
          property.label,
        );
        const label = propertyKey ? t(propertyKey) : property.label;
        const value = instance.params[name] ?? property.default;
        if (
          property.visibleWhen &&
          (instance.params[property.visibleWhen.property] ??
            definition.properties[property.visibleWhen.property]?.default) !==
            property.visibleWhen.equals
        )
          return null;
        let control: React.ReactNode;
        if (
          (property.type === "float" || property.type === "int") &&
          typeof value === "number"
        ) {
          control = (
            <NumericField
              label={label}
              value={value}
              min={property.min}
              max={property.max}
              step={property.step ?? (property.type === "int" ? 1 : 0.01)}
              disabled={disabled}
              onCommit={(next) => onChange(name, next)}
            />
          );
        } else if (property.type === "bool" && typeof value === "boolean") {
          control = (
            <Switch
              aria-label={label}
              checked={value}
              disabled={disabled}
              onCheckedChange={(next) => onChange(name, next)}
            />
          );
        } else if (property.type === "enum" && typeof value === "string") {
          control = (
            <Select
              value={value}
              disabled={disabled}
              onValueChange={(next) => onChange(name, next)}
            >
              <SelectTrigger aria-label={label} className="h-7 min-w-0 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {property.options.map((option) => (
                  <SelectItem key={option} value={option}>
                    {nativeCatalogOptionKey(definition, option)
                      ? t(nativeCatalogOptionKey(definition, option)!)
                      : option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        } else if (
          property.type === "color" &&
          value &&
          typeof value === "object" &&
          "components" in value
        ) {
          const color = value as EffectColor;
          control = (
            <div className="flex items-center gap-2">
              <input
                aria-label={label}
                type="color"
                value={colorHex(color)}
                disabled={disabled}
                onChange={(event) =>
                  onChange(name, colorWithHex(color, event.target.value))
                }
                className="h-7 w-10"
              />
              <NumericField
                label={`${label} ${t("editPanel.labels.opacity")}`}
                value={color.alpha}
                min={0}
                max={1}
                step={0.01}
                disabled={disabled}
                onCommit={(alpha) => onChange(name, { ...color, alpha })}
              />
            </div>
          );
        } else if (
          property.type === "vec2" &&
          Array.isArray(value) &&
          value.length === 2
        ) {
          control = (
            <div className="flex gap-1">
              <NumericField
                label={`${label} X`}
                value={Number(value[0])}
                min={property.min}
                max={property.max}
                step={property.step}
                disabled={disabled}
                onCommit={(next) => onChange(name, [next, Number(value[1])])}
              />
              <NumericField
                label={`${label} Y`}
                value={Number(value[1])}
                min={property.min}
                max={property.max}
                step={property.step}
                disabled={disabled}
                onCommit={(next) => onChange(name, [Number(value[0]), next])}
              />
            </div>
          );
        } else if (property.type === "color-array" && Array.isArray(value)) {
          const colors = value as EffectColor[];
          control = (
            <div className="flex flex-wrap gap-1">
              {colors.map((color, index) => (
                <input
                  key={index}
                  aria-label={`${label} ${index + 1}`}
                  type="color"
                  value={colorHex(color)}
                  disabled={disabled}
                  onChange={(event) =>
                    onChange(
                      name,
                      colors.map((entry, entryIndex) =>
                        entryIndex === index
                          ? colorWithHex(entry, event.target.value)
                          : entry,
                      ),
                    )
                  }
                  className="h-7 w-8"
                />
              ))}
            </div>
          );
        } else {
          return null;
        }
        return (
          <label
            key={name}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-xs"
          >
            <span className="truncate text-muted-foreground">{label}</span>
            {control}
          </label>
        );
      })}
    </div>
  );
}

export function NativeShaderEffectSection({
  context,
  pickerOpen,
  onPickerOpenChange,
}: {
  context: GlslShaderPanelContext;
  pickerOpen: boolean;
  onPickerOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const [controlsOpen, setControlsOpen] = useState(false);
  const current = useMemo(
    () =>
      selectedNativeInstances(
        context.content,
        context.nodeId,
        "layer",
        context.selector,
      ).instances,
    [context.content, context.nodeId, context.selector],
  );
  const backdrops = useMemo(
    () =>
      selectedNativeInstances(
        context.content,
        context.nodeId,
        "backdrop",
        context.selector,
      ).instances,
    [context.content, context.nodeId, context.selector],
  );
  if (current.length === 0 && backdrops.length === 0 && !pickerOpen)
    return null;
  return (
    <>
      {current.length > 0 || backdrops.length > 0 ? (
        <Popover open={controlsOpen} onOpenChange={setControlsOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 w-full justify-start text-xs"
            >
              {t("editPanel.shaders.effectsTitle")}
            </Button>
          </PopoverTrigger>
          <InspectorControlPopoverContent
            title={t("editPanel.shaders.effectsTitle")}
            onClose={() => setControlsOpen(false)}
            bodyClassName="max-h-[70vh] overflow-y-auto p-0"
          >
            <NativeShaderPanel context={context} placement="layer" />
            <NativeShaderPanel context={context} placement="backdrop" />
          </InspectorControlPopoverContent>
        </Popover>
      ) : null}
      {pickerOpen ? (
        <Popover open onOpenChange={onPickerOpenChange}>
          <PopoverAnchor asChild>
            <span className="block h-0 w-full" />
          </PopoverAnchor>
          <InspectorControlPopoverContent
            title={t("editPanel.shaders.effectsTitle")}
            onClose={() => onPickerOpenChange(false)}
            bodyClassName="max-h-[70vh] overflow-y-auto p-0"
          >
            <NativeShaderPanel context={context} placement="layer" />
            <NativeShaderPanel context={context} placement="backdrop" />
          </InspectorControlPopoverContent>
        </Popover>
      ) : null}
    </>
  );
}

export function NativeShaderPanel({
  context,
  placement,
  onChanged,
}: {
  context: GlslShaderPanelContext;
  placement: Placement;
  onChanged?: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const { instances, definitions, errors } = useMemo(
    () =>
      selectedNativeInstances(
        context.content,
        context.nodeId,
        placement,
        context.selector,
      ),
    [context.content, context.nodeId, context.selector, placement],
  );
  const enabledLayerInstances = useMemo(
    () =>
      selectedNativeInstances(
        context.content,
        context.nodeId,
        "layer",
        context.selector,
      ).instances.filter((instance) => instance.enabled),
    [context.content, context.nodeId, context.selector],
  );
  const available = useMemo(() => {
    const query = search.toLocaleLowerCase().replace(/\s+/g, "");
    return NATIVE_EFFECT_LATEST_DEFINITIONS.filter((definition) => {
      if (
        !definition.placements.includes(placement) ||
        (placement === "layer" && instances.length > 0)
      )
        return false;
      if (!query) return true;
      const definitionKey = nativeCatalogDefinitionKey(definition);
      if (
        [definition.name, definitionKey ? t(definitionKey) : ""].some((label) =>
          label.toLocaleLowerCase().replace(/\s+/g, "").includes(query),
        )
      )
        return true;
      return NATIVE_EFFECT_PRESETS.some((preset) => {
        if (
          preset.definitionId !== definition.id ||
          preset.definitionVersion !== definition.version ||
          preset.placement !== placement
        )
          return false;
        const presetKey = nativeCatalogPresetKey(preset);
        return [preset.name, presetKey ? t(presetKey) : ""].some((label) =>
          label.toLocaleLowerCase().replace(/\s+/g, "").includes(query),
        );
      });
    });
  }, [placement, search, instances.length, t]);
  const apply = async (operation: NativeEffectEdit) => {
    if (!context.designId || !context.fileId || context.editSource) return;
    setBusy(true);
    try {
      await persistNativeShaderEdit(context, operation);
      onChanged?.();
    } catch (error) {
      toast.error(
        error instanceof Error &&
          error.message === "native-screen-file-required"
          ? t("editPanel.shaders.selectCanvasElementFirst")
          : error instanceof Error &&
              error.message !== "native-screen-source-unavailable"
            ? error.message
            : t("editPanel.shaders.saveFailed"),
      );
    } finally {
      setBusy(false);
    }
  };
  const applyPreset = (preset: EffectPreset) => {
    if (!context.nodeId) return;
    void apply({
      kind: "apply-preset",
      nodeId: context.nodeId,
      targetSelector: context.selector,
      presetId: preset.id,
    });
  };
  return (
    <div className="grid gap-3 p-3" data-native-shader-panel={placement}>
      {errors.length ? (
        <p role="alert" className="text-xs text-destructive">
          {errors[0]}
        </p>
      ) : null}
      {instances.map((instance) => {
        const definition = definitions.find(
          (item) =>
            item.id === instance.definitionId &&
            item.version === instance.definitionVersion,
        );
        const animated =
          definition &&
          nativeEffectAnimationCapability(definition) === "animated";
        const effectPlacements = definition?.placements.filter(
          (candidate) => candidate === "layer" || candidate === "backdrop",
        );
        return (
          <section
            key={instance.id}
            className="grid gap-2 border-b border-border pb-3 last:border-0 last:pb-0"
          >
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs font-medium">
                {definition
                  ? nativeCatalogDefinitionKey(definition)
                    ? t(nativeCatalogDefinitionKey(definition)!)
                    : definition.name
                  : instance.definitionId}
              </span>
              <Switch
                aria-label={t("editPanel.shaders.enabled")}
                checked={instance.enabled}
                disabled={busy}
                onCheckedChange={(enabled) =>
                  void apply({
                    kind: "set-instance",
                    instanceId: instance.id,
                    enabled,
                  })
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={t("editPanel.shaders.removeShaderEffect")}
                disabled={busy}
                onClick={() =>
                  void apply({ kind: "remove", instanceId: instance.id })
                }
              >
                <IconMinus className="size-4" />
              </Button>
            </div>
            <div className="grid gap-2">
              <label className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-xs">
                <span className="truncate text-muted-foreground">
                  {t("editPanel.labels.opacity")}
                </span>
                <NumericField
                  label={t("editPanel.labels.opacity")}
                  value={instance.opacity}
                  min={0}
                  max={1}
                  step={0.01}
                  disabled={busy || !instance.enabled}
                  onCommit={(opacity) =>
                    void apply({
                      kind: "set-instance",
                      instanceId: instance.id,
                      opacity,
                    })
                  }
                />
              </label>
              {animated ? (
                <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 text-xs">
                  <span className="truncate text-muted-foreground">
                    {t("editPanel.shaders.speed")}
                  </span>
                  <NumericField
                    label={t("editPanel.shaders.speed")}
                    value={instance.timing.speed}
                    min={0}
                    step={0.1}
                    disabled={busy || !instance.enabled}
                    onCommit={(speed) =>
                      void apply({
                        kind: "playback",
                        instanceId: instance.id,
                        speed,
                      })
                    }
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={busy || !instance.enabled}
                    onClick={() =>
                      void apply({
                        kind: "playback",
                        instanceId: instance.id,
                        paused: !instance.timing.paused,
                      })
                    }
                  >
                    {instance.timing.paused
                      ? t("editPanel.shaders.play")
                      : t("editPanel.shaders.pause")}
                  </Button>
                </div>
              ) : null}
              {placement !== "fill" && effectPlacements?.length === 2 ? (
                <label className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-xs">
                  <span className="truncate text-muted-foreground">
                    {t("editPanel.shaders.placement")}
                  </span>
                  <Select
                    value={instance.placement}
                    disabled={busy}
                    onValueChange={(next) =>
                      void apply({
                        kind: "set-instance",
                        instanceId: instance.id,
                        placement: next as "layer" | "backdrop",
                      })
                    }
                  >
                    <SelectTrigger
                      aria-label={t("editPanel.shaders.placement")}
                      className="h-7 w-28 text-xs"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem
                        value="layer"
                        disabled={enabledLayerInstances.some(
                          (layer) => layer.id !== instance.id,
                        )}
                      >
                        {t("editPanel.shaders.layerPlacement")}
                      </SelectItem>
                      <SelectItem value="backdrop">
                        {t("editPanel.shaders.backdropPlacement")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </label>
              ) : null}
            </div>
            {definition ? (
              <PropertyControls
                definition={definition}
                instance={instance}
                disabled={busy || !instance.enabled}
                onChange={(name, value) =>
                  void apply({
                    kind: "set-instance",
                    instanceId: instance.id,
                    params: { [name]: value },
                  })
                }
              />
            ) : null}
          </section>
        );
      })}
      <div className="relative">
        <IconSearch className="pointer-events-none absolute left-2 top-2 size-3.5 text-muted-foreground" />
        <Input
          aria-label={t("editPanel.shaders.searchShaders")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("editPanel.shaders.searchShaders")}
          className="h-7 pl-7 text-xs"
        />
      </div>
      <div className="grid max-h-56 gap-1 overflow-y-auto">
        {available.map((definition) => {
          const presets = NATIVE_EFFECT_PRESETS.filter(
            (preset) =>
              preset.definitionId === definition.id &&
              preset.definitionVersion === definition.version &&
              preset.placement === placement,
          );
          return (
            <div
              key={`${definition.id}@${definition.version}`}
              className="grid gap-1 border-b border-border py-1 last:border-0"
            >
              <span className="text-xs font-medium">
                {nativeCatalogDefinitionKey(definition)
                  ? t(nativeCatalogDefinitionKey(definition)!)
                  : definition.name}
              </span>
              <div className="flex flex-wrap gap-1">
                {presets.map((preset) => (
                  <Button
                    key={preset.id}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={
                      busy || !context.nodeId || Boolean(context.editSource)
                    }
                    onClick={() => applyPreset(preset)}
                  >
                    {nativeCatalogPresetKey(preset)
                      ? t(nativeCatalogPresetKey(preset)!)
                      : preset.name}
                  </Button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
