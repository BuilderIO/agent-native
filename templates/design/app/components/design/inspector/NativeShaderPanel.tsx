import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { resolveCodeLayerTarget } from "@shared/code-layer";
import { nativeEffectAnimationCapability } from "@shared/native-effect-animation-capability";
import {
  editNativeEffectHtml,
  type NativeEffectEdit,
} from "@shared/native-effect-edits";
import { NATIVE_EFFECT_LATEST_DEFINITIONS } from "@shared/native-effect-presets";
import {
  getNativeEffectPropertyPresentation,
  NATIVE_OPACITY_PRESENTATION,
  NATIVE_SPEED_PRESENTATION,
  nativeEffectValueFromDisplay,
  nativeEffectValueToDisplay,
  type NativeEffectPropertyPresentation,
} from "@shared/native-effect-property-presentation";
import { hashEffectDefinition } from "@shared/native-effect-trust";
import {
  parseEffectsFromHtml,
  type EffectColor,
  type EffectColorStop,
  type EffectDefinition,
  type EffectInstance,
  type EffectPaint,
  type EffectProperty,
  type EffectValue,
} from "@shared/native-effects";
import {
  IconEye,
  IconEyeOff,
  IconMinus,
  IconSearch,
  IconSparkles,
  IconWaveSine,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { sendToDesignAgentChat } from "@/lib/agent-chat";

import { SectionIconButton } from "../edit-panel/inspector-controls";
import {
  InspectorGridCell,
  InspectorPaintRow,
} from "../edit-panel/inspector-grid";
import type { RenderNestedColorPicker } from "./color-picker-nested";
import {
  broadcastShaderMessage,
  withShaderWriteLock,
  type GlslShaderPanelContext,
} from "./GlslShaderPanel";
import { InspectorControlPopoverContent } from "./InspectorControlPopover";
import {
  nativeCatalogDefinitionKey,
  nativeCatalogOptionKey,
  nativeCatalogPropertyKey,
} from "./native-catalog-display";
import { useNativeShaderPropertyDraft } from "./native-shader-property-draft";
import {
  NativeShaderCatalogPreview,
  NativeShaderCatalogPreviewProvider,
} from "./NativeShaderCatalogPreview";
import { NativeShaderColorControls } from "./NativeShaderColorControls";
import { NativeShaderPaintControls } from "./NativeShaderPaintControls";
import { ScrubInput } from "./ScrubInput";

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
  if (!context.designId || !context.fileId)
    throw new Error("native-screen-file-required");
  const { designId, fileId } = context;
  if (context.editSource) {
    let edited: ReturnType<typeof editNativeEffectHtml> | undefined;
    const result = context.editSource((html) => {
      edited = editNativeEffectHtml(html, operation);
      return { html: edited.html, errors: edited.errors };
    });
    if (result.status === "failed") throw new Error(result.error);
    if (!edited) throw new Error("native-source-edit-transform-not-run");
    if (result.status === "applied")
      broadcastShaderMessage({ type: "native-shader-rescan" });
    return { content: edited.html, instanceIds: edited.instanceIds };
  }

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

export function NumericField({
  label,
  value,
  min,
  max,
  step,
  presentation,
  disabled,
  onCommit,
  onPreview,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  presentation?: NativeEffectPropertyPresentation;
  disabled: boolean;
  onCommit: (value: number) => Promise<boolean>;
  onPreview?: (value: number) => void;
}) {
  const scale = presentation?.displayScale ?? 1;
  const unit = presentation?.unit ?? "";
  const displayStep = presentation?.step ?? (step ?? 0.01) * scale;
  const precision = Number.isInteger(displayStep) ? 0 : 2;
  const resolvedPresentation = presentation ?? {
    displayScale: scale,
    unit,
    step: displayStep,
  };
  const displayMin =
    min === undefined
      ? undefined
      : nativeEffectValueToDisplay(min, resolvedPresentation);
  const displayMax =
    max === undefined
      ? undefined
      : nativeEffectValueToDisplay(max, resolvedPresentation);
  const livePreview = useRef({
    value,
    onPreview,
    active: false,
    version: 0,
    mounted: true,
  });
  livePreview.current.value = value;
  livePreview.current.onPreview = onPreview;
  useEffect(() => {
    livePreview.current.mounted = true;
    return () => {
      livePreview.current.mounted = false;
      if (livePreview.current.active)
        livePreview.current.onPreview?.(livePreview.current.value);
    };
  }, []);
  const [preview, setPreview] = useState<number | null>(null);
  const [inputVersion, setInputVersion] = useState(0);
  const [pending, setPending] = useState<{
    value: number;
    baseline: number;
  } | null>(null);

  useEffect(() => {
    if (pending && (value === pending.value || value !== pending.baseline)) {
      setPending(null);
      setPreview(null);
    }
  }, [pending, value]);

  const toRaw = (display: number) =>
    Math.min(
      max ?? Infinity,
      Math.max(
        min ?? -Infinity,
        nativeEffectValueFromDisplay(display, resolvedPresentation),
      ),
    );
  const shownRaw = preview ?? pending?.value ?? value;
  const shown = Number(
    nativeEffectValueToDisplay(shownRaw, resolvedPresentation).toFixed(
      precision,
    ),
  );
  const previewValue = (display: number) => {
    if (!Number.isFinite(display)) return;
    const next = toRaw(display);
    livePreview.current.version += 1;
    livePreview.current.active = true;
    setPreview(next);
    livePreview.current.onPreview?.(next);
  };
  const cancelPreview = () => {
    livePreview.current.version += 1;
    setPreview(null);
    if (livePreview.current.active)
      livePreview.current.onPreview?.(
        pending?.value ?? livePreview.current.value,
      );
    livePreview.current.active = false;
  };
  const commit = (display: number) => {
    if (!Number.isFinite(display)) return;
    const next = toRaw(display);
    previewValue(display);
    const version = livePreview.current.version;
    livePreview.current.active = false;
    setPreview(null);
    if (next === (pending?.value ?? value)) return;
    setPending({ value: next, baseline: value });
    const rollback = () => {
      if (!livePreview.current.mounted) return;
      if (livePreview.current.version === version) {
        livePreview.current.onPreview?.(livePreview.current.value);
        livePreview.current.active = false;
      }
      setPending((current) => (current?.value === next ? null : current));
      setInputVersion((version) => version + 1);
    };
    void onCommit(next).then((saved) => {
      if (!saved) rollback();
    }, rollback);
  };

  return (
    <div className="flex w-44 min-w-0 items-center gap-2">
      {displayMin !== undefined && displayMax !== undefined ? (
        <Slider
          aria-label={label}
          value={[shown]}
          min={displayMin}
          max={displayMax}
          step={displayStep}
          disabled={disabled}
          onValueChange={([next]) => previewValue(next)}
          onValueCommit={([next]) => commit(next)}
          onPointerCancel={cancelPreview}
          onKeyDown={(event) => {
            if (event.key === "Escape") cancelPreview();
          }}
          className="min-w-0 flex-1"
        />
      ) : null}
      <ScrubInput
        key={inputVersion}
        label={label}
        ariaLabel={label}
        value={shown}
        min={displayMin}
        max={displayMax}
        step={displayStep}
        precision={precision}
        unit={unit}
        prefix="icon"
        disabled={disabled}
        blurOnEnter
        onChange={(next, meta) => {
          if (meta.phase === "preview") previewValue(next);
          else if (meta.phase === "commit") commit(next);
          else cancelPreview();
        }}
        className="w-24 shrink-0"
        inputClassName="h-7 rounded-md bg-[var(--design-editor-control-bg)] px-1.5"
      />
    </div>
  );
}

function ColorPropertyField({
  label,
  property,
  value,
  disabled,
  onCommit,
  onPreview,
  renderColorPicker,
}: {
  label: string;
  property: Extract<
    EffectProperty,
    { type: "color" | "color-array" | "color-ramp" }
  >;
  value: EffectColor | EffectColor[] | EffectColorStop[];
  disabled: boolean;
  onCommit: (
    value: EffectColor | EffectColor[] | EffectColorStop[],
  ) => Promise<boolean>;
  onPreview?: (value: EffectColor | EffectColor[] | EffectColorStop[]) => void;
  renderColorPicker?: RenderNestedColorPicker;
}) {
  const { draft, preview, commit, cancel } = useNativeShaderPropertyDraft(
    value,
    onCommit,
    onPreview,
  );
  return (
    <NativeShaderColorControls
      label={label}
      property={property}
      value={draft}
      disabled={disabled}
      onChange={preview}
      onCommit={commit}
      renderColorPicker={
        renderColorPicker
          ? (request) =>
              renderColorPicker({
                ...request,
                onClose: () => {
                  cancel();
                  request.onClose();
                },
              })
          : undefined
      }
    />
  );
}

function PropertyControls({
  definition,
  instance,
  disabled,
  onChange,
  renderColorPicker,
}: {
  definition: EffectDefinition;
  instance: EffectInstance;
  disabled: boolean;
  onChange: (name: string, value: EffectValue) => Promise<boolean>;
  renderColorPicker?: RenderNestedColorPicker;
}) {
  const t = useT();
  const previewProperty = (name: string, value: EffectValue) =>
    broadcastShaderMessage({
      type: "native-effect-set-param",
      instanceId: instance.id,
      name,
      value,
    });
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
              presentation={
                getNativeEffectPropertyPresentation(definition, name) ??
                undefined
              }
              disabled={disabled}
              onPreview={(next) => previewProperty(name, next)}
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
            <ColorPropertyField
              key={`${instance.id}:${name}`}
              label={label}
              property={property}
              value={color}
              onPreview={(next) => previewProperty(name, next)}
              disabled={disabled}
              onCommit={(next) => onChange(name, next)}
              renderColorPicker={renderColorPicker}
            />
          );
        } else if (
          property.type === "paint" &&
          value &&
          typeof value === "object" &&
          "kind" in value
        ) {
          control = (
            <NativeShaderPaintControls
              key={`${instance.id}:${name}`}
              label={label}
              value={value as EffectPaint}
              maxStops={property.maxCount}
              onPreview={(next) => previewProperty(name, next)}
              disabled={disabled}
              onCommit={(next) => onChange(name, next)}
              renderColorPicker={renderColorPicker}
            />
          );
        } else if (
          property.type === "vec2" &&
          Array.isArray(value) &&
          value.length === 2
        ) {
          control = (
            <div className="grid gap-1">
              <NumericField
                label={`${label} X`}
                value={Number(value[0])}
                min={property.min}
                max={property.max}
                step={property.step}
                presentation={
                  getNativeEffectPropertyPresentation(definition, name) ??
                  undefined
                }
                disabled={disabled}
                onPreview={(next) =>
                  previewProperty(name, [next, Number(value[1])])
                }
                onCommit={(next) => onChange(name, [next, Number(value[1])])}
              />
              <NumericField
                label={`${label} Y`}
                value={Number(value[1])}
                min={property.min}
                max={property.max}
                step={property.step}
                presentation={
                  getNativeEffectPropertyPresentation(definition, name) ??
                  undefined
                }
                disabled={disabled}
                onPreview={(next) =>
                  previewProperty(name, [Number(value[0]), next])
                }
                onCommit={(next) => onChange(name, [Number(value[0]), next])}
              />
            </div>
          );
        } else if (
          (property.type === "color-array" || property.type === "color-ramp") &&
          Array.isArray(value)
        ) {
          const colors = value as EffectColor[] | EffectColorStop[];
          control = (
            <ColorPropertyField
              key={`${instance.id}:${name}`}
              label={label}
              property={property}
              value={colors}
              disabled={disabled}
              onCommit={(next) => onChange(name, next)}
              renderColorPicker={renderColorPicker}
            />
          );
        } else {
          return null;
        }
        const row = (
          <>
            <span className="truncate text-muted-foreground">{label}</span>
            {control}
          </>
        );
        const className =
          property.type === "color-array" || property.type === "color-ramp"
            ? "grid min-w-0 gap-1 text-xs"
            : "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-xs";
        return property.type === "paint" ||
          property.type === "color" ||
          property.type === "color-array" ||
          property.type === "color-ramp" ||
          property.type === "float" ||
          property.type === "int" ||
          property.type === "vec2" ? (
          <div key={name} className={className}>
            {row}
          </div>
        ) : (
          <label key={name} className={className}>
            {row}
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
  renderColorPicker,
}: {
  context: GlslShaderPanelContext;
  pickerOpen: boolean;
  onPickerOpenChange: (open: boolean) => void;
  renderColorPicker?: RenderNestedColorPicker;
}) {
  const t = useT();
  const [controlsOpenId, setControlsOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const current = useMemo(
    () =>
      selectedNativeInstances(
        context.content,
        context.nodeId,
        "layer",
        context.selector,
      ),
    [context.content, context.nodeId, context.selector],
  );
  const backdrops = useMemo(
    () =>
      selectedNativeInstances(
        context.content,
        context.nodeId,
        "backdrop",
        context.selector,
      ),
    [context.content, context.nodeId, context.selector],
  );
  const instances = [...current.instances, ...backdrops.instances];
  const definitions = [...current.definitions, ...backdrops.definitions];
  if (instances.length === 0 && !pickerOpen) return null;
  const apply = async (instanceId: string, operation: NativeEffectEdit) => {
    setBusyId(instanceId);
    try {
      await persistNativeShaderEdit(context, operation);
      if (operation.kind === "remove") setControlsOpenId(null);
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
      setBusyId(null);
    }
  };
  return (
    <>
      {instances.map((instance) => {
        const definition = definitions.find(
          (item) =>
            item.id === instance.definitionId &&
            item.version === instance.definitionVersion,
        );
        const definitionKey =
          definition && nativeCatalogDefinitionKey(definition);
        const title = definition
          ? definitionKey
            ? t(definitionKey)
            : definition.name
          : instance.definitionId;
        const busy = busyId === instance.id;
        return (
          <Popover
            key={instance.id}
            open={controlsOpenId === instance.id}
            onOpenChange={(open) =>
              setControlsOpenId(open ? instance.id : null)
            }
          >
            <InspectorPaintRow>
              <InspectorGridCell span={20}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex h-6 w-full min-w-0 items-center gap-1.5 rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 text-left !text-[11px] hover:bg-[var(--design-editor-panel-raised-bg)]"
                  >
                    <IconWaveSine className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                      {title}
                    </span>
                  </button>
                </PopoverTrigger>
              </InspectorGridCell>
              <InspectorGridCell span={4} className="flex justify-center">
                <SectionIconButton
                  label={
                    instance.enabled
                      ? t("editPanel.labels.hideLayer")
                      : t("editPanel.labels.showLayer")
                  }
                  disabled={busy}
                  onClick={() =>
                    void apply(instance.id, {
                      kind: "set-instance",
                      instanceId: instance.id,
                      enabled: !instance.enabled,
                    })
                  }
                >
                  {instance.enabled ? (
                    <IconEye className="size-3.5" />
                  ) : (
                    <IconEyeOff className="size-3.5" />
                  )}
                </SectionIconButton>
              </InspectorGridCell>
              <InspectorGridCell span={4} className="flex justify-center">
                <SectionIconButton
                  label={t("editPanel.labels.removeLayer")}
                  disabled={busy}
                  onClick={() =>
                    void apply(instance.id, {
                      kind: "remove",
                      instanceId: instance.id,
                    })
                  }
                >
                  <IconMinus className="size-3.5" />
                </SectionIconButton>
              </InspectorGridCell>
            </InspectorPaintRow>
            <InspectorControlPopoverContent
              title={title}
              icon={<IconWaveSine className="size-4" />}
              onClose={() => setControlsOpenId(null)}
              className="w-[min(320px,calc(100vw-2rem))]"
              bodyClassName="max-h-[70vh] overflow-y-auto p-0"
            >
              <NativeShaderPanel
                context={context}
                placement={instance.placement}
                instanceId={instance.id}
                showCatalog={false}
                showRemoveButton={false}
                renderColorPicker={renderColorPicker}
              />
            </InspectorControlPopoverContent>
          </Popover>
        );
      })}
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
            <NativeShaderPanel
              context={context}
              placement="layer"
              effectCatalog
              catalogOnly
              renderColorPicker={renderColorPicker}
            />
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
  showCatalog = true,
  catalogOnly = false,
  effectCatalog = false,
  instanceId,
  showRemoveButton = true,
  renderColorPicker,
}: {
  context: GlslShaderPanelContext;
  placement: Placement;
  onChanged?: () => void;
  showCatalog?: boolean;
  catalogOnly?: boolean;
  effectCatalog?: boolean;
  instanceId?: string;
  showRemoveButton?: boolean;
  renderColorPicker?: RenderNestedColorPicker;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const {
    instances: allInstances,
    definitions,
    errors,
  } = useMemo(
    () =>
      selectedNativeInstances(
        context.content,
        context.nodeId,
        placement,
        context.selector,
      ),
    [context.content, context.nodeId, context.selector, placement],
  );
  const instances = catalogOnly
    ? []
    : instanceId
      ? allInstances.filter((instance) => instance.id === instanceId)
      : allInstances;
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
  const customDefinitions = useMemo(() => {
    const latest = new Map<string, EffectDefinition>();
    for (const definition of definitions) {
      if (
        NATIVE_EFFECT_LATEST_DEFINITIONS.some(
          (builtin) => builtin.id === definition.id,
        )
      )
        continue;
      const previous = latest.get(definition.id);
      if (!previous || definition.version > previous.version)
        latest.set(definition.id, definition);
    }
    return [...latest.values()];
  }, [definitions]);
  const approvalQuery = useActionQuery(
    "get-shader",
    {
      source: {
        kind: "design-file",
        designId: context.designId,
        fileId: context.fileId,
      },
    },
    {
      enabled:
        customDefinitions.length > 0 &&
        Boolean(context.designId && context.fileId),
    },
  );
  const [approvedCustomDefinitions, setApprovedCustomDefinitions] = useState<
    ReadonlySet<EffectDefinition>
  >(new Set());
  const [approvalHashError, setApprovalHashError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setApprovedCustomDefinitions(new Set());
    setApprovalHashError(false);
    if (!customDefinitions.length || !approvalQuery.data) return;
    const approvedHashes = approvalQuery.data.approvedDefinitionHashes;
    if (!Array.isArray(approvedHashes)) {
      setApprovalHashError(true);
      return;
    }
    void Promise.all(
      customDefinitions.map(async (definition) => ({
        definition,
        hash: await hashEffectDefinition(definition),
      })),
    )
      .then((entries) => {
        if (!cancelled)
          setApprovedCustomDefinitions(
            new Set(
              entries
                .filter(({ hash }) => approvedHashes.includes(hash))
                .map(({ definition }) => definition),
            ),
          );
      })
      .catch(() => {
        if (!cancelled) setApprovalHashError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [customDefinitions, approvalQuery.data]);
  const available = useMemo(() => {
    const query = search.toLocaleLowerCase().replace(/\s+/g, "");
    return [...NATIVE_EFFECT_LATEST_DEFINITIONS, ...customDefinitions].filter(
      (definition) => {
        if (
          !(effectCatalog
            ? definition.placements.some(
                (candidate) =>
                  candidate === "layer" || candidate === "backdrop",
              )
            : definition.placements.includes(placement)) ||
          (effectCatalog
            ? definition.placements.includes("layer") &&
              enabledLayerInstances.length > 0
            : placement === "layer" && instances.length > 0)
        )
          return false;
        if (!query) return true;
        const definitionKey = nativeCatalogDefinitionKey(definition);
        if (
          [definition.name, definitionKey ? t(definitionKey) : ""].some(
            (label) =>
              label.toLocaleLowerCase().replace(/\s+/g, "").includes(query),
          )
        )
          return true;
        return false;
      },
    );
  }, [
    placement,
    effectCatalog,
    customDefinitions,
    search,
    instances.length,
    enabledLayerInstances,
    t,
  ]);
  const catalogGroups = useMemo(
    () =>
      (["fill", "layer", "backdrop"] as const)
        .map((candidate) => ({
          placement: candidate,
          definitions: available.filter(
            (definition) =>
              (effectCatalog
                ? definition.placements.includes("layer")
                  ? "layer"
                  : "backdrop"
                : placement) === candidate,
          ),
        }))
        .filter((group) => group.definitions.length > 0),
    [available, effectCatalog, placement],
  );
  if (!showCatalog && instances.length === 0 && errors.length === 0)
    return null;
  const apply = async (operation: NativeEffectEdit) => {
    if (!context.designId || !context.fileId) return false;
    setBusy(true);
    try {
      await persistNativeShaderEdit(context, operation);
      onChanged?.();
      return true;
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
      return false;
    } finally {
      setBusy(false);
    }
  };
  const applyDefinition = (
    definition: EffectDefinition,
    targetPlacement: Placement,
  ) => {
    if (
      !context.nodeId ||
      (customDefinitions.includes(definition) &&
        !approvedCustomDefinitions.has(definition))
    )
      return;
    void apply({
      kind: "apply",
      nodeId: context.nodeId,
      targetSelector: context.selector,
      placement: targetPlacement,
      definitionId: definition.id,
      definitionVersion: definition.version,
    });
  };
  return (
    <div className="grid gap-3 p-3" data-native-shader-panel={placement}>
      {approvalQuery.error || approvalHashError ? (
        <p role="alert" className="text-xs text-destructive">
          {t("editPanel.shaders.saveFailed")}
        </p>
      ) : null}
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
              {showRemoveButton ? (
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
              ) : null}
            </div>
            <div className="grid gap-2">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-xs">
                <span className="truncate text-muted-foreground">
                  {t("editPanel.labels.opacity")}
                </span>
                <NumericField
                  label={t("editPanel.labels.opacity")}
                  value={instance.opacity}
                  min={0}
                  max={1}
                  step={0.01}
                  presentation={NATIVE_OPACITY_PRESENTATION}
                  disabled={busy}
                  onCommit={(opacity) =>
                    apply({
                      kind: "set-instance",
                      instanceId: instance.id,
                      opacity,
                    })
                  }
                />
              </div>
              {animated ? (
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-xs">
                  <span className="truncate text-muted-foreground">
                    {t("editPanel.shaders.speed")}
                  </span>
                  <NumericField
                    label={t("editPanel.shaders.speed")}
                    value={instance.timing.speed}
                    min={0}
                    step={0.1}
                    presentation={NATIVE_SPEED_PRESENTATION}
                    disabled={busy}
                    onCommit={(speed) =>
                      apply({
                        kind: "playback",
                        instanceId: instance.id,
                        speed,
                      })
                    }
                  />
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
                disabled={busy}
                renderColorPicker={renderColorPicker}
                onChange={(name, value) =>
                  apply({
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
      {showCatalog && instances.length === 0 ? (
        <>
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
          {!search && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="justify-start gap-2 text-xs"
              disabled={
                busy ||
                !context.designId ||
                !context.fileId ||
                (!context.nodeId && !context.selector)
              }
              onClick={() =>
                sendToDesignAgentChat({
                  message: t(
                    placement === "fill"
                      ? "editPanel.shaders.createNativeFillPrompt"
                      : "editPanel.shaders.createNativeEffectPrompt",
                  ),
                  context: JSON.stringify({
                    workflow: "native-effects",
                    language: "WGSL",
                    backend: "WebGPU",
                    designId: context.designId,
                    fileId: context.fileId,
                    nodeId: context.nodeId,
                    targetSelector: context.selector,
                    placement,
                    allowedPlacements: effectCatalog
                      ? ["layer", "backdrop"]
                      : [placement],
                  }),
                  submit: false,
                  openSidebar: true,
                })
              }
            >
              <IconSparkles className="size-3.5" />
              {t("editPanel.shaders.createWithAi")}
            </Button>
          )}
          <div className="grid max-h-[360px] grid-cols-2 gap-2 overflow-y-auto">
            {catalogGroups.map((group) => (
              <NativeShaderCatalogPreviewProvider
                key={group.placement}
                definitions={group.definitions}
                approvedDefinitionHashes={
                  approvalQuery.error || approvalHashError
                    ? null
                    : approvalQuery.data?.approvedDefinitionHashes
                }
                placement={group.placement}
              >
                {group.definitions.map((definition) => {
                  const definitionKey = nativeCatalogDefinitionKey(definition);
                  const label = definitionKey
                    ? t(definitionKey)
                    : definition.name;
                  return (
                    <button
                      key={`${definition.id}@${definition.version}`}
                      type="button"
                      className="group flex min-w-0 flex-col gap-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={label}
                      disabled={
                        busy ||
                        !context.nodeId ||
                        (customDefinitions.includes(definition) &&
                          !approvedCustomDefinitions.has(definition))
                      }
                      onClick={() =>
                        applyDefinition(definition, group.placement)
                      }
                    >
                      <NativeShaderCatalogPreview
                        definition={definition}
                        className="aspect-[4/3] w-full overflow-hidden rounded-md border border-border/60 group-hover:border-foreground/40"
                      />
                      <span className="w-full truncate text-[10px] text-muted-foreground group-hover:text-foreground">
                        {label}
                      </span>
                    </button>
                  );
                })}
              </NativeShaderCatalogPreviewProvider>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
