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
  getNativeEffectRecordFieldPresentation,
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
  resolvedEffectPropertyValue,
  type EffectColor,
  type EffectColorStop,
  type EffectDefinition,
  type EffectInstance,
  type EffectParameterConstraint,
  type EffectPaint,
  type EffectRecordField,
  type EffectProperty,
  type EffectRecordValue,
  type EffectValue,
} from "@shared/native-effects";
import {
  IconChevronDown,
  IconEye,
  IconEyeOff,
  IconMinus,
  IconPlus,
  IconSearch,
  IconSparkles,
  IconWaveSine,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import {
  broadcastShaderMessage,
  withShaderWriteLock,
  type ShaderEditorContext,
} from "../shader-source-coordination";
import type { RenderNestedColorPicker } from "./color-picker-nested";
import { InspectorControlPopoverContent } from "./InspectorControlPopover";
import {
  nativeCatalogDefinitionKey,
  nativeCatalogGroupKey,
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
const PULSING_BORDER_PROPERTY_GROUPS = [
  {
    id: "smoke",
    labelKey: "editPanel.shaders.nativeCatalog.properties.smoke",
    properties: ["smoke", "smokeSize"],
  },
  {
    id: "margin",
    labelKey: "editPanel.shaders.nativeCatalog.properties.margin",
    properties: [
      "margin",
      "marginLeft",
      "marginRight",
      "marginTop",
      "marginBottom",
    ],
  },
  {
    id: "offset",
    labelKey: "editPanel.shaders.nativeCatalog.groups.offset",
    properties: ["offsetX", "offsetY", "originX", "originY"],
  },
  {
    id: "layout",
    labelKey: "editPanel.sections.layout",
    properties: [
      "aspectRatio",
      "fit",
      "scale",
      "rotation",
      "worldWidth",
      "worldHeight",
    ],
  },
] as const;
type SourceFile = { content?: string; versionHash?: string };
type EditResult = {
  content: string;
  updatedAt?: string;
  instanceIds: string[];
};

function RecordArrayPropertyControl({
  label,
  property,
  value,
  disabled,
  addLabel,
  rowLabel,
  removeLabel,
  onPreview,
  onCommit,
  renderField,
}: {
  label: string;
  property: Extract<EffectProperty, { type: "record-array" }>;
  value: EffectRecordValue[];
  disabled: boolean;
  addLabel: string;
  rowLabel: (index: number) => string;
  removeLabel: (index: number) => string;
  onPreview: (value: EffectValue) => void;
  onCommit: (value: EffectValue) => Promise<boolean>;
  renderField: (
    name: string,
    field: EffectRecordField,
    value: EffectValue,
    row: EffectRecordValue,
    rowIndex: number,
    callbacks: {
      onPreview: (value: EffectValue) => void;
      onCommit: (value: EffectValue) => Promise<boolean>;
    },
  ) => React.ReactNode;
}) {
  const [rows, setRows] = useState(value);
  const draftRef = useRef(value);
  const authoritativeRef = useRef(value);
  const displayBaselineRef = useRef(value);
  const observedValue = useRef(JSON.stringify(value));
  const generation = useRef(0);
  const commitRevision = useRef(0);
  const latestIntentRevision = useRef(0);
  const latestSavedRevision = useRef(0);
  const knownSnapshots = useRef(new Map<number, string>());
  const pendingCommits = useRef(new Set<number>());

  useEffect(() => {
    const incoming = JSON.stringify(value);
    if (incoming === observedValue.current) return;
    observedValue.current = incoming;
    const acknowledged = [...knownSnapshots.current.entries()]
      .reverse()
      .find(([, snapshot]) => snapshot === incoming);
    if (acknowledged) {
      if (acknowledged[0] >= latestSavedRevision.current) {
        latestSavedRevision.current = acknowledged[0];
        authoritativeRef.current = value;
      }
      if (!pendingCommits.current.has(acknowledged[0]))
        knownSnapshots.current.delete(acknowledged[0]);
      return;
    }
    if (incoming === JSON.stringify(authoritativeRef.current)) return;
    generation.current += 1;
    knownSnapshots.current.clear();
    pendingCommits.current.clear();
    commitRevision.current += 1;
    latestIntentRevision.current = commitRevision.current;
    latestSavedRevision.current = commitRevision.current;
    authoritativeRef.current = value;
    displayBaselineRef.current = value;
    draftRef.current = value;
    setRows(value);
  }, [value]);

  const updateDraft = (next: EffectRecordValue[]) => {
    draftRef.current = next;
    setRows(next);
    onPreview(next);
  };
  const commitRows = async (next: EffectRecordValue[]) => {
    updateDraft(next);
    const revision = ++commitRevision.current;
    latestIntentRevision.current = revision;
    displayBaselineRef.current = next;
    const currentGeneration = generation.current;
    const serialized = JSON.stringify(next);
    knownSnapshots.current.set(revision, serialized);
    pendingCommits.current.add(revision);
    let saved = false;
    try {
      saved = await onCommit(next);
    } catch {
      saved = false;
    }
    pendingCommits.current.delete(revision);
    if (currentGeneration !== generation.current) return saved;
    if (saved) {
      if (revision >= latestSavedRevision.current) {
        latestSavedRevision.current = revision;
        authoritativeRef.current = next;
      }
      if (revision >= latestSavedRevision.current)
        knownSnapshots.current.set(revision, serialized);
      for (const [snapshotRevision] of knownSnapshots.current) {
        if (
          snapshotRevision < latestSavedRevision.current &&
          !pendingCommits.current.has(snapshotRevision)
        )
          knownSnapshots.current.delete(snapshotRevision);
      }
      if (revision === latestIntentRevision.current)
        displayBaselineRef.current = next;
      return true;
    }
    knownSnapshots.current.delete(revision);
    if (
      currentGeneration === generation.current &&
      revision === latestIntentRevision.current &&
      revision === commitRevision.current &&
      revision > latestSavedRevision.current
    ) {
      const rollback = authoritativeRef.current;
      draftRef.current = rollback;
      displayBaselineRef.current = rollback;
      setRows(rollback);
      onPreview(rollback);
    }
    return false;
  };
  const makeDefaultRow = (): EffectRecordValue =>
    Object.fromEntries(
      Object.entries(property.fields).map(([name, field]) => [
        name,
        field.default,
      ]),
    );

  return (
    <div className="grid min-w-0 gap-1 text-xs">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="truncate text-muted-foreground">{label}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 shrink-0"
          disabled={disabled || rows.length >= property.maxCount}
          onClick={() =>
            void commitRows([...draftRef.current, makeDefaultRow()])
          }
        >
          <IconPlus aria-hidden="true" className="mr-1 size-3" />
          {addLabel}
        </Button>
      </div>
      {rows.map((row, rowIndex) => {
        const rowName = rowLabel(rowIndex + 1);
        const authoritativeRow = displayBaselineRef.current[rowIndex] ?? row;
        return (
          <div
            key={`${rowIndex}:${Object.keys(row).join(",")}:${rows.length}`}
            className="rounded-md border border-border/60 px-2"
          >
            <Collapsible defaultOpen={rowIndex === 0}>
              <div className="flex items-center gap-1">
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="group min-w-0 flex-1 justify-between"
                  >
                    <span className="truncate">{rowName}</span>
                    <IconChevronDown
                      aria-hidden="true"
                      className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180"
                    />
                  </Button>
                </CollapsibleTrigger>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0"
                  aria-label={removeLabel(rowIndex + 1)}
                  disabled={disabled || rows.length <= (property.minCount ?? 0)}
                  onClick={() =>
                    void commitRows(
                      draftRef.current.filter((_, index) => index !== rowIndex),
                    )
                  }
                >
                  <IconMinus aria-hidden="true" className="size-3" />
                </Button>
              </div>
              <CollapsibleContent>
                <div className="grid gap-2 pb-2">
                  {Object.entries(property.fields).map(([fieldName, field]) =>
                    renderField(
                      fieldName,
                      field,
                      authoritativeRow[fieldName] as EffectValue,
                      row,
                      rowIndex,
                      {
                        onPreview: (nextValue) => {
                          const next = draftRef.current.map((current, index) =>
                            index === rowIndex
                              ? {
                                  ...current,
                                  [fieldName]:
                                    nextValue as EffectRecordValue[string],
                                }
                              : current,
                          );
                          updateDraft(next);
                        },
                        onCommit: (nextValue) => {
                          const next = draftRef.current.map((current, index) =>
                            index === rowIndex
                              ? {
                                  ...current,
                                  [fieldName]:
                                    nextValue as EffectRecordValue[string],
                                }
                              : current,
                          );
                          return commitRows(next);
                        },
                      },
                    ),
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        );
      })}
    </div>
  );
}

function recordFieldMinimum(
  fieldName: string,
  row: EffectRecordValue,
  constraints: EffectParameterConstraint[],
  baseMinimum?: number,
): number | undefined {
  return constraints.reduce((minimum, constraint) => {
    if (constraint.kind !== "ordered-floats") return minimum;
    if (constraint.greater === fieldName) {
      const lesser = row[constraint.lesser];
      if (typeof lesser === "number")
        return Math.max(minimum ?? -Infinity, lesser + constraint.minGap);
    }
    return minimum;
  }, baseMinimum);
}

function recordFieldMaximum(
  fieldName: string,
  row: EffectRecordValue,
  constraints: EffectParameterConstraint[],
  baseMaximum?: number,
): number | undefined {
  return constraints.reduce((maximum, constraint) => {
    if (constraint.kind !== "ordered-floats") return maximum;
    if (constraint.lesser === fieldName) {
      const greater = row[constraint.greater];
      if (typeof greater === "number")
        return Math.min(maximum ?? Infinity, greater - constraint.minGap);
    }
    return maximum;
  }, baseMaximum);
}

export async function persistNativeShaderEdit(
  context: ShaderEditorContext,
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
  const entries = Object.entries(definition.properties) as [
    string,
    EffectProperty,
  ][];
  const previewProperty = (name: string, value: EffectValue) =>
    broadcastShaderMessage({
      type: "native-effect-set-param",
      instanceId: instance.id,
      name,
      value,
    });
  const renderProperty = (
    [name, property]: [string, EffectProperty],
    override?: {
      value: EffectValue;
      key: string;
      onPreview: (value: EffectValue) => void;
      onCommit: (value: EffectValue) => Promise<boolean>;
      row?: EffectRecordValue;
      constraints?: EffectParameterConstraint[];
    },
  ): React.ReactNode => {
    const propertyKey = nativeCatalogPropertyKey(definition, property.label);
    const label = propertyKey ? t(propertyKey) : property.label;
    const value =
      override?.value ??
      resolvedEffectPropertyValue(definition, instance.params, name);
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
          min={
            override?.row && override.constraints
              ? recordFieldMinimum(
                  name,
                  override.row,
                  override.constraints,
                  property.min,
                )
              : property.min
          }
          max={
            override?.row && override.constraints
              ? recordFieldMaximum(
                  name,
                  override.row,
                  override.constraints,
                  property.max,
                )
              : property.max
          }
          step={property.step ?? (property.type === "int" ? 1 : 0.01)}
          presentation={
            (override
              ? getNativeEffectRecordFieldPresentation(property)
              : getNativeEffectPropertyPresentation(definition, name)) ??
            undefined
          }
          disabled={disabled}
          onPreview={(next) =>
            (override?.onPreview ?? ((value) => previewProperty(name, value)))(
              next,
            )
          }
          onCommit={(next) =>
            (override?.onCommit ?? ((value) => onChange(name, value)))(next)
          }
        />
      );
    } else if (property.type === "bool" && typeof value === "boolean") {
      control = (
        <Switch
          aria-label={label}
          checked={value}
          disabled={disabled}
          onCheckedChange={(next) =>
            (override?.onCommit ?? ((value) => onChange(name, value)))(next)
          }
        />
      );
    } else if (property.type === "enum" && typeof value === "string") {
      control = (
        <Select
          value={value}
          disabled={disabled}
          onValueChange={(next) =>
            (override?.onCommit ?? ((value) => onChange(name, value)))(next)
          }
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
          key={override?.key ?? `${instance.id}:${name}`}
          label={label}
          property={property}
          value={color}
          onPreview={(next) =>
            (override?.onPreview ?? ((value) => previewProperty(name, value)))(
              next,
            )
          }
          disabled={disabled}
          onCommit={(next) =>
            (override?.onCommit ?? ((value) => onChange(name, value)))(next)
          }
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
          key={override?.key ?? `${instance.id}:${name}`}
          label={label}
          value={value as EffectPaint}
          maxStops={property.maxCount}
          allowedKinds={property.allowedKinds}
          onPreview={(next) =>
            (override?.onPreview ?? ((value) => previewProperty(name, value)))(
              next,
            )
          }
          disabled={disabled}
          onCommit={(next) =>
            (override?.onCommit ?? ((value) => onChange(name, value)))(next)
          }
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
              override
                ? (getNativeEffectRecordFieldPresentation(property) ??
                  undefined)
                : (getNativeEffectPropertyPresentation(definition, name) ??
                  undefined)
            }
            disabled={disabled}
            onPreview={(next) =>
              (
                override?.onPreview ??
                ((nextValue) => previewProperty(name, nextValue))
              )([next, Number(value[1])])
            }
            onCommit={(next) =>
              (
                override?.onCommit ?? ((nextValue) => onChange(name, nextValue))
              )([next, Number(value[1])])
            }
          />
          <NumericField
            label={`${label} Y`}
            value={Number(value[1])}
            min={property.min}
            max={property.max}
            step={property.step}
            presentation={
              override
                ? (getNativeEffectRecordFieldPresentation(property) ??
                  undefined)
                : (getNativeEffectPropertyPresentation(definition, name) ??
                  undefined)
            }
            disabled={disabled}
            onPreview={(next) =>
              (
                override?.onPreview ??
                ((nextValue) => previewProperty(name, nextValue))
              )([Number(value[0]), next])
            }
            onCommit={(next) =>
              (
                override?.onCommit ?? ((nextValue) => onChange(name, nextValue))
              )([Number(value[0]), next])
            }
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
          key={override?.key ?? `${instance.id}:${name}`}
          label={label}
          property={property}
          value={colors}
          disabled={disabled}
          onCommit={(next) =>
            (override?.onCommit ?? ((value) => onChange(name, value)))(next)
          }
          renderColorPicker={renderColorPicker}
        />
      );
    } else if (property.type === "record-array" && Array.isArray(value)) {
      const rawItemLabel = property.itemLabel ?? label;
      const itemLabelKey = nativeCatalogPropertyKey(definition, rawItemLabel);
      const itemLabel = itemLabelKey ? t(itemLabelKey) : rawItemLabel;
      control = (
        <RecordArrayPropertyControl
          key={override?.key ?? `${instance.id}:${name}`}
          label={label}
          property={property}
          value={value as EffectRecordValue[]}
          disabled={disabled}
          addLabel={t("editPanel.shaders.addRecordRow", {
            item: itemLabel,
          })}
          rowLabel={(index) =>
            t("editPanel.shaders.recordRowLabel", {
              item: itemLabel,
              index,
            })
          }
          removeLabel={(index) =>
            t("editPanel.shaders.removeRecordRow", {
              item: itemLabel,
              index,
            })
          }
          onPreview={(next) => previewProperty(name, next)}
          onCommit={(next) => onChange(name, next)}
          renderField={(
            fieldName,
            field,
            fieldValue,
            row,
            rowIndex,
            callbacks,
          ) =>
            renderProperty([fieldName, field], {
              value: fieldValue,
              key: `${instance.id}:${name}:${rowIndex}:${fieldName}`,
              row,
              constraints: property.parameterConstraints,
              onPreview: callbacks.onPreview,
              onCommit: callbacks.onCommit,
            })
          }
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
    if (property.type === "record-array")
      return <div key={override?.key ?? name}>{control}</div>;
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
  };
  const pulsingGroups =
    definition.id === "an-native-pulsing-border" && definition.version >= 3
      ? PULSING_BORDER_PROPERTY_GROUPS
      : [];
  const pulsingGroupedNames = new Set<string>(
    pulsingGroups.flatMap((group) => [...group.properties]),
  );
  const genericEntries = entries.filter(
    ([name]) => !pulsingGroupedNames.has(name),
  );
  const availableGroups = [
    ...new Set(
      genericEntries.flatMap(([, property]) =>
        property.group ? [property.group] : [],
      ),
    ),
  ];
  const groupOrder = ["Shape", "Transform", "Surface", "Color", "Motion"];
  const orderedGroups = [
    ...groupOrder.filter((group) => availableGroups.includes(group)),
    ...availableGroups.filter((group) => !groupOrder.includes(group)),
  ];
  const ungrouped = genericEntries.filter(([, property]) => !property.group);
  return (
    <div className="grid gap-2">
      {ungrouped.map((entry) => renderProperty(entry))}
      {orderedGroups.map((group) => {
        const groupKey = nativeCatalogGroupKey(definition, group);
        return (
          <Collapsible
            key={group}
            defaultOpen={group === "Shape"}
            className="border-t border-border/60 pt-1"
          >
            <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 py-2 text-left text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
              {groupKey ? t(groupKey) : group}
              <IconChevronDown
                aria-hidden="true"
                className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180"
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="grid gap-2 pb-2">
              {genericEntries
                .filter(([, property]) => property.group === group)
                .map((entry) => renderProperty(entry))}
            </CollapsibleContent>
          </Collapsible>
        );
      })}
      {pulsingGroups.map((group) => {
        const groupedEntries = entries.filter(([name]) =>
          group.properties.some((property) => property === name),
        );
        if (!groupedEntries.length) return null;
        return (
          <Collapsible key={group.id} className="min-w-0">
            <CollapsibleTrigger className="group flex w-full items-center justify-between gap-2 rounded-sm py-1 text-start text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t(group.labelKey)}
              <IconChevronDown className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent className="grid gap-2 ps-2 pt-2">
              {groupedEntries.map((entry) => renderProperty(entry))}
            </CollapsibleContent>
          </Collapsible>
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
  context: ShaderEditorContext;
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
  context: ShaderEditorContext;
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
