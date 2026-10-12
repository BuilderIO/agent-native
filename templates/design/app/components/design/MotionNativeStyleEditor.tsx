import {
  createMotionEaseVariableId,
  isValidMotionEase,
  motionEaseVariableId,
  motionEaseVariableToken,
  MOTION_CURVE_PRESETS,
  MOTION_EASING_VARIABLE_MAX_COUNT,
  MOTION_SPRING_PRESETS,
  MOTION_SPRING_DEFAULT_BOUNCE,
  parseSpringToken,
  sampleSpring,
  springToken,
  type MotionEasingVariable,
} from "@shared/motion-easing";
import type {
  MotionNativeStyleInstance,
  MotionNativeStyleJsonValue,
  MotionNativeStyleKey,
} from "@shared/motion-native-style";
import { switchMotionNativeStyleKey } from "@shared/motion-native-style-runtime";
import {
  IconChartLine,
  IconChevronDown,
  IconCheck,
  IconClock,
  IconFlipHorizontal,
  IconEye,
  IconEyeOff,
  IconMinus,
  IconPlus,
  IconX,
} from "@tabler/icons-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const STYLE_LABEL_KEYS: Record<MotionNativeStyleKey, string> = {
  TextStagger: "text",
  Position: "position",
  Scale: "scale",
  Rotation: "rotation",
  Size: "size",
  Opacity: "opacity",
  Path: "path",
};

const DEFAULT_TYPES: Partial<Record<MotionNativeStyleKey, string>> = {
  Position: "slide_in",
  Scale: "scaleIn",
  Rotation: "rotateIn",
  Size: "resize_in",
  Opacity: "fadeIn",
};

const MOTION_STYLE_OPTIONS = [
  { value: "TextStagger", labelKey: "text" },
  { value: "Position", labelKey: "position" },
  { value: "Scale", labelKey: "scale" },
  { value: "Rotation", labelKey: "rotation" },
  { value: "Size", labelKey: "size" },
  { value: "Opacity", labelKey: "opacity" },
  { value: "Path", labelKey: "path" },
] satisfies { value: MotionNativeStyleKey; labelKey: string }[];

const TYPE_OPTIONS: Partial<
  Record<MotionNativeStyleKey, { value: string; labelKey: string }[]>
> = {
  Position: [
    { value: "slide_in", labelKey: "slideIn" },
    { value: "slide_out", labelKey: "slideOut" },
    { value: "custom", labelKey: "custom" },
  ],
  Scale: [
    { value: "scaleIn", labelKey: "scaleIn" },
    { value: "scaleOut", labelKey: "scaleOut" },
    { value: "custom", labelKey: "custom" },
  ],
  Rotation: [
    { value: "rotateIn", labelKey: "rotateIn" },
    { value: "rotateOut", labelKey: "rotateOut" },
    { value: "custom", labelKey: "custom" },
  ],
  Size: [
    { value: "resize_in", labelKey: "resizeIn" },
    { value: "resize_out", labelKey: "resizeOut" },
    { value: "custom", labelKey: "custom" },
  ],
  Opacity: [
    { value: "fadeIn", labelKey: "fadeIn" },
    { value: "fadeOut", labelKey: "fadeOut" },
    { value: "custom", labelKey: "custom" },
  ],
};

const DIRECTION_OPTIONS: Partial<
  Record<MotionNativeStyleKey, { value: string; labelKey: string }[]>
> = {
  Position: [
    { value: "left", labelKey: "toLeft" },
    { value: "right", labelKey: "toRight" },
    { value: "top", labelKey: "toTop" },
    { value: "bottom", labelKey: "toBottom" },
    { value: "top_left", labelKey: "toTopLeft" },
    { value: "top_right", labelKey: "toTopRight" },
    { value: "bottom_left", labelKey: "toBottomLeft" },
    { value: "bottom_right", labelKey: "toBottomRight" },
  ],
  Rotation: [
    { value: "clockwise", labelKey: "clockwise" },
    { value: "counterclockwise", labelKey: "counterclockwise" },
  ],
};

const TEXT_STAGGER_GROUPING_OPTIONS = [
  { value: "CHARACTER", labelKey: "character" },
  { value: "WORD", labelKey: "word" },
  { value: "LINE", labelKey: "line" },
  { value: "PARAGRAPH", labelKey: "paragraph" },
];

const TEXT_STAGGER_ORDER_OPTIONS = [
  { value: "LEFT_RIGHT", labelKey: "forward" },
  { value: "RIGHT_LEFT", labelKey: "reverse" },
  { value: "TOP_BOTTOM", labelKey: "forward" },
  { value: "BOTTOM_TOP", labelKey: "reverse" },
];

const TEXT_STAGGER_ANIMATION_DIRECTION_OPTIONS = [
  { value: "in", labelKey: "enter" },
  { value: "out", labelKey: "exit" },
];

const TEXT_STAGGER_EFFECTS = [
  {
    enabledKey: "positionEnabled",
    labelKey: "position",
    amountKey: "distance",
    amountLabelKey: "distance",
    unit: "px",
    min: 0,
    max: 100_000,
    amountDefault: 40,
    enabledByDefault: true,
  },
  {
    enabledKey: "rotationEnabled",
    labelKey: "rotation",
    amountKey: "rotationAmount",
    amountLabelKey: "amount",
    unit: "°",
    min: 0,
    max: 360,
    amountDefault: 180,
    enabledByDefault: false,
  },
  {
    enabledKey: "scaleEnabled",
    labelKey: "scale",
    amountKey: "scaleAmount",
    amountLabelKey: "amount",
    unit: "%",
    min: 0,
    max: 1000,
    amountDefault: 120,
    enabledByDefault: false,
  },
  {
    enabledKey: "opacityEnabled",
    labelKey: "opacity",
    amountKey: "opacityAmount",
    amountLabelKey: "amount",
    unit: "%",
    min: 0,
    max: 100,
    amountDefault: 0,
    enabledByDefault: false,
  },
  {
    enabledKey: "blurEnabled",
    labelKey: "blur",
    amountKey: "blurAmount",
    amountLabelKey: "amount",
    unit: "px",
    min: 0,
    max: 1000,
    amountDefault: 20,
    enabledByDefault: false,
  },
] as const;

const EASING_LABEL_KEYS: Record<string, string> = {
  Hold: "hold",
  Linear: "linear",
  "Ease in": "easeIn",
  "Ease out": "easeOut",
  "Ease in and out": "easeInOut",
  "Ease in back": "easeInBack",
  "Ease out back": "easeOutBack",
  "Ease in and out back": "easeInOutBack",
  Gentle: "gentle",
  Quick: "quick",
  Bouncy: "bouncy",
  Slow: "slow",
};

const FIGMA_EASING_ORDER = [
  "Hold",
  "Linear",
  "Ease in",
  "Ease out",
  "Ease in and out",
  "Ease in back",
  "Ease out back",
  "Ease in and out back",
] as const;

const EASING_OPTIONS = [
  ...FIGMA_EASING_ORDER.flatMap((label) => {
    const preset = MOTION_CURVE_PRESETS.find(
      (candidate) => candidate.label === label,
    );
    return preset
      ? [
          {
            value: preset.value,
            labelKey: EASING_LABEL_KEYS[preset.label],
          },
        ]
      : [];
  }),
  { value: "custom-bezier", labelKey: "customBezier" },
  ...MOTION_SPRING_PRESETS.map((preset) => ({
    value: preset.value,
    labelKey: EASING_LABEL_KEYS[preset.label],
  })),
  { value: "custom-spring", labelKey: "customSpring" },
];

const CUSTOM_BEZIER_DEFAULT = "cubic-bezier(0.25, 0.1, 0.25, 1)";
const DEFAULT_EASING = "cubic-bezier(0, 0, 0.58, 1)";

const AMOUNT_FIELDS: Partial<
  Record<MotionNativeStyleKey, { key: "distance" | "amount"; unit: string }>
> = {
  Position: { key: "distance", unit: "" },
  Scale: { key: "amount", unit: "%" },
  Rotation: { key: "amount", unit: "°" },
  Size: { key: "amount", unit: "px" },
  Opacity: { key: "amount", unit: "%" },
};

const CONTROL_CLASS =
  "h-6 w-full min-w-0 rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 !text-[11px] shadow-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]";

type BezierViewBox = [number, number, number, number];

interface BezierHandleDrag {
  handleIndex: 0 | 1;
  pointerId: number;
  points: [number, number, number, number];
  rect: { left: number; top: number; width: number; height: number };
  inverseScreenMatrix: {
    a: number;
    b: number;
    c: number;
    d: number;
    e: number;
    f: number;
  } | null;
  viewBox: BezierViewBox;
}

export interface MotionNativeStyleIdentity {
  key: string;
  styleKey: MotionNativeStyleKey;
  targetNodeId: string;
  index: number;
  sourceInstanceId?: string;
}

export interface MotionNativeStyleEditorProps {
  styles: MotionNativeStyleInstance[];
  targetNodeId: string;
  disabled?: boolean;
  easingVariables?: MotionEasingVariable[];
  onEasingVariablesChange?: (variables: MotionEasingVariable[]) => void;
  onChange: (
    instance: MotionNativeStyleInstance,
    identity: MotionNativeStyleIdentity,
  ) => void;
  onRemove: (identity: MotionNativeStyleIdentity) => void;
  t: (key: string) => string;
}

export function MotionNativeStyleEditor({
  styles,
  targetNodeId,
  disabled = false,
  easingVariables = [],
  onEasingVariablesChange,
  onChange,
  onRemove,
  t,
}: MotionNativeStyleEditorProps) {
  const id = useId();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const targetStyles = styles
    .map((instance, index) => ({
      instance,
      identity: createIdentity(instance, index),
    }))
    .filter(({ instance }) => instance.targetNodeId === targetNodeId);
  const selected =
    targetStyles.find(({ identity }) => identity.key === selectedKey) ??
    targetStyles[0];

  function changeInstance(
    instance: MotionNativeStyleInstance,
    identity: MotionNativeStyleIdentity,
  ) {
    onChange(instance, identity);
  }

  function updateTopLevel(
    instance: MotionNativeStyleInstance,
    identity: MotionNativeStyleIdentity,
    update: Partial<MotionNativeStyleInstance>,
  ) {
    changeInstance({ ...instance, ...update }, identity);
  }

  function updateProp(
    instance: MotionNativeStyleInstance,
    identity: MotionNativeStyleIdentity,
    key: string,
    value: MotionNativeStyleJsonValue,
  ) {
    changeInstance(
      {
        ...instance,
        props: { ...instance.props, [key]: value },
      },
      identity,
    );
  }

  function changeStyleKey(
    instance: MotionNativeStyleInstance,
    identity: MotionNativeStyleIdentity,
    styleKey: MotionNativeStyleKey,
  ) {
    if (styleKey === instance.styleKey) return;
    const existing = targetStyles.find(
      ({ instance: candidate, identity: candidateIdentity }) =>
        candidateIdentity.key !== identity.key &&
        candidate.styleKey === styleKey,
    );
    if (existing) {
      setSelectedKey(existing.identity.key);
      setOpenKey(existing.identity.key);
      return;
    }

    const next = switchMotionNativeStyleKey(instance, styleKey);
    const nextIdentity = createIdentity(next, identity.index);
    changeInstance(next, identity);
    setSelectedKey(nextIdentity.key);
    setOpenKey(nextIdentity.key);
  }

  function styleLabel(instance: MotionNativeStyleInstance): string {
    const named = t(instance.nameKey);
    if (named && named !== instance.nameKey) return named;
    return t(
      `designEditor.motion.animationStyles.${STYLE_LABEL_KEYS[instance.styleKey]}`,
    );
  }

  return (
    <div
      aria-label={t("designEditor.motion.animationStyles.title")}
      className="space-y-0.5"
      data-design-inspector-section
    >
      {targetStyles.length > 0 ? (
        <ul className="space-y-0.5">
          {targetStyles.map(({ instance, identity }) => {
            const selectedRow = selected?.identity.key === identity.key;
            const enabled = instance.enabled !== false;
            const label = styleLabel(instance);
            const styleOptions =
              instance.styleKey === "Path"
                ? MOTION_STYLE_OPTIONS
                : MOTION_STYLE_OPTIONS.filter(
                    (option) => option.value !== "Path",
                  );

            return (
              <Popover
                key={identity.key}
                open={openKey === identity.key}
                onOpenChange={(open) => {
                  setOpenKey(open ? identity.key : null);
                  if (open) setSelectedKey(identity.key);
                }}
              >
                <li className="flex min-w-0 items-center gap-0.5 rounded-sm">
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      aria-pressed={selectedRow}
                      disabled={disabled}
                      className={`flex h-6 min-w-0 flex-1 items-center rounded-sm px-2 text-start text-[11px] outline-none transition-colors hover:bg-accent/60 focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 ${selectedRow ? "bg-accent/50" : ""}`}
                    >
                      <span className="truncate">{label}</span>
                    </button>
                  </PopoverTrigger>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${t(enabled ? "designEditor.motion.animationStyles.hide" : "designEditor.motion.animationStyles.show")} ${label}`}
                    disabled={disabled}
                    onClick={() =>
                      updateTopLevel(instance, identity, { enabled: !enabled })
                    }
                  >
                    {enabled ? (
                      <IconEye
                        aria-hidden="true"
                        className="size-3.5 text-muted-foreground"
                      />
                    ) : (
                      <IconEyeOff
                        aria-hidden="true"
                        className="size-3.5 text-muted-foreground"
                      />
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${t("designEditor.motion.animationStyles.removeAnimation")} ${label}`}
                    disabled={disabled}
                    onClick={() => onRemove(identity)}
                  >
                    <IconMinus
                      aria-hidden="true"
                      className="size-3.5 text-muted-foreground"
                    />
                  </Button>
                  {isRunnableStyle(instance.styleKey) ? (
                    <PopoverContent
                      align="start"
                      side="left"
                      className="w-60 p-0"
                    >
                      <div>
                        <div className="flex h-8 items-center justify-between border-b border-border px-2">
                          <div className="min-w-0 flex-1">
                            <SelectControl
                              id={`${id}-style-name`}
                              label={t(
                                `designEditor.motion.animationStyles.${STYLE_LABEL_KEYS[instance.styleKey]}`,
                              )}
                              value={instance.styleKey}
                              disabled={disabled}
                              options={styleOptions}
                              onChange={(value) =>
                                changeStyleKey(
                                  instance,
                                  identity,
                                  value as MotionNativeStyleKey,
                                )
                              }
                              t={t}
                            />
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t(
                              "designEditor.motion.animationStyles.close",
                            )}
                            onClick={() => setOpenKey(null)}
                          >
                            <IconX aria-hidden="true" className="size-3.5" />
                          </Button>
                        </div>
                        <NativeStyleDetails
                          id={`${id}-details`}
                          instance={instance}
                          identity={identity}
                          disabled={disabled}
                          easingVariables={easingVariables}
                          onEasingVariablesChange={onEasingVariablesChange}
                          onChange={changeInstance}
                          onUpdateTopLevel={updateTopLevel}
                          onUpdateProp={updateProp}
                          t={t}
                        />
                      </div>
                    </PopoverContent>
                  ) : null}
                </li>
              </Popover>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function NativeStyleDetails({
  id,
  instance,
  identity,
  disabled,
  easingVariables,
  onEasingVariablesChange,
  onChange,
  onUpdateTopLevel,
  onUpdateProp,
  t,
}: {
  id: string;
  instance: MotionNativeStyleInstance;
  identity: MotionNativeStyleIdentity;
  disabled: boolean;
  easingVariables: MotionEasingVariable[];
  onEasingVariablesChange?: (variables: MotionEasingVariable[]) => void;
  onChange: (
    instance: MotionNativeStyleInstance,
    identity: MotionNativeStyleIdentity,
  ) => void;
  onUpdateTopLevel: (
    instance: MotionNativeStyleInstance,
    identity: MotionNativeStyleIdentity,
    update: Partial<MotionNativeStyleInstance>,
  ) => void;
  onUpdateProp: (
    instance: MotionNativeStyleInstance,
    identity: MotionNativeStyleIdentity,
    key: string,
    value: MotionNativeStyleJsonValue,
  ) => void;
  t: (key: string) => string;
}) {
  const directionId = `${id}-direction`;
  const typeId = `${id}-type`;
  const amountId = `${id}-amount`;
  const delayId = `${id}-delay`;
  const durationId = `${id}-duration`;
  const easingId = `${id}-easing`;
  const curveEditorId = `${id}-curve-editor`;
  const [curveEditorOpen, setCurveEditorOpen] = useState(false);
  const type = stringValue(
    instance.props.type,
    DEFAULT_TYPES[instance.styleKey] ?? "",
  );
  const customType = type === "custom";
  const typeOptions = TYPE_OPTIONS[instance.styleKey] ?? [];
  const amountField = AMOUNT_FIELDS[instance.styleKey];
  const directionOptions = DIRECTION_OPTIONS[instance.styleKey] ?? [];
  const direction = stringValue(
    instance.props.direction,
    directionOptions[0]?.value,
  );
  const amountKey = amountField?.key;
  const amountDefault = defaultAmount(instance.styleKey);
  const amountValue = amountKey
    ? numberValue(instance.props[amountKey], amountDefault)
    : undefined;
  const delayMs = Math.round(numberValue(instance.props.delay, 0) * 1000);
  const easingValue = easingToken(instance.props.easing);
  const easingVariableId = motionEaseVariableId(easingValue);
  const easingVariable = easingVariables.find(
    (candidate) => candidate.id === easingVariableId,
  );

  function updateEasing(value: string) {
    if (easingVariable && onEasingVariablesChange) {
      onEasingVariablesChange(
        easingVariables.map((candidate) =>
          candidate.id === easingVariable.id
            ? { ...candidate, value }
            : candidate,
        ),
      );
      return;
    }
    if (easingVariableId) return;
    onUpdateProp(instance, identity, "easing", value);
  }

  function updateNumberProp(key: string, rawValue: string, factor = 1) {
    if (!rawValue.trim()) return;
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) return;
    onUpdateProp(instance, identity, key, parsed / factor);
  }

  if (instance.styleKey === "TextStagger") {
    return (
      <NativeTextStaggerDetails
        id={id}
        instance={instance}
        identity={identity}
        disabled={disabled}
        easingVariables={easingVariables}
        onEasingVariablesChange={onEasingVariablesChange}
        onUpdateTopLevel={onUpdateTopLevel}
        onUpdateProp={onUpdateProp}
        t={t}
      />
    );
  }

  if (instance.styleKey === "Path") {
    return (
      <NativePathTrimDetails
        id={id}
        instance={instance}
        identity={identity}
        disabled={disabled}
        easingVariables={easingVariables}
        onEasingVariablesChange={onEasingVariablesChange}
        onUpdateTopLevel={onUpdateTopLevel}
        onUpdateProp={onUpdateProp}
        t={t}
      />
    );
  }

  return (
    <div className="flex flex-col gap-1 px-2.5 py-2" id={id}>
      <Field id={typeId} label={t("designEditor.motion.type")}>
        <SelectControl
          id={typeId}
          label={t("designEditor.motion.type")}
          value={type}
          disabled={disabled}
          options={typeOptions}
          t={t}
          onChange={(value) => onUpdateProp(instance, identity, "type", value)}
        />
      </Field>
      {directionOptions.length > 0 && !customType ? (
        <Field
          id={directionId}
          label={t("designEditor.motion.textAnimation.direction")}
        >
          <SelectControl
            id={directionId}
            label={t("designEditor.motion.textAnimation.direction")}
            value={direction}
            disabled={disabled}
            options={directionOptions}
            t={t}
            onChange={(value) =>
              onUpdateProp(instance, identity, "direction", value)
            }
          />
        </Field>
      ) : null}

      {amountField && !customType && amountValue !== undefined ? (
        <Field
          id={amountId}
          label={t(
            `designEditor.motion.animationStyles.${amountField.key === "distance" ? "distance" : "amount"}`,
          )}
        >
          <div className="flex min-w-0 items-center gap-1">
            <Input
              id={amountId}
              type="number"
              aria-label={t(
                `designEditor.motion.animationStyles.${amountField.key === "distance" ? "distance" : "amount"}`,
              )}
              value={amountValue}
              disabled={disabled}
              className={CONTROL_CLASS}
              onChange={(event) =>
                updateNumberProp(amountField.key, event.currentTarget.value)
              }
            />
            <span
              aria-hidden="true"
              className="shrink-0 text-[10px] text-muted-foreground"
            >
              {amountField.unit}
            </span>
          </div>
        </Field>
      ) : null}

      <NumberField
        id={delayId}
        label={t("designEditor.motion.animationStyles.delay")}
        value={delayMs}
        min={0}
        max={120_000}
        disabled={disabled}
        showClock
        unit="ms"
        onChange={(rawValue) => updateNumberProp("delay", rawValue, 1000)}
      />

      <NumberField
        id={durationId}
        label={t("designEditor.motion.duration")}
        value={Math.round(instance.duration * 1000)}
        min={1}
        max={120_000}
        disabled={disabled}
        showClock
        unit="ms"
        onChange={(rawValue) => {
          if (!rawValue.trim()) return;
          const parsed = Number(rawValue);
          if (!Number.isFinite(parsed)) return;
          onUpdateTopLevel(instance, identity, {
            duration: Math.min(120_000, Math.max(1, parsed)) / 1000,
          });
        }}
      />

      <Field
        id={easingId}
        label={t("designEditor.motion.animationStyles.easing")}
      >
        <div className="flex min-w-0 items-center gap-1">
          <MotionEasingPicker
            value={easingValue}
            easingVariables={easingVariables}
            onEasingVariablesChange={onEasingVariablesChange}
            onChange={(value) =>
              onUpdateProp(instance, identity, "easing", value)
            }
            disabled={disabled}
            t={t}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t(
              "designEditor.motion.animationStyles.showEasingCurveEditor",
            )}
            aria-expanded={curveEditorOpen}
            aria-controls={curveEditorId}
            title={t(
              "designEditor.motion.animationStyles.showEasingCurveEditor",
            )}
            disabled={disabled}
            onClick={() => setCurveEditorOpen((open) => !open)}
          >
            <IconChartLine aria-hidden="true" className="size-3.5" />
          </Button>
        </div>
      </Field>
      <div
        id={curveEditorId}
        hidden={!curveEditorOpen}
        className="rounded-md border border-border p-2"
      >
        <NativeEasingCurveEditor
          value={easingVariable?.value ?? easingValue}
          disabled={disabled}
          onChange={updateEasing}
          t={t}
        />
      </div>
    </div>
  );
}

function NativePathTrimDetails({
  id,
  instance,
  identity,
  disabled,
  easingVariables,
  onEasingVariablesChange,
  onUpdateTopLevel,
  onUpdateProp,
  t,
}: {
  id: string;
  instance: MotionNativeStyleInstance;
  identity: MotionNativeStyleIdentity;
  disabled: boolean;
  easingVariables: MotionEasingVariable[];
  onEasingVariablesChange?: (variables: MotionEasingVariable[]) => void;
  onUpdateTopLevel: (
    instance: MotionNativeStyleInstance,
    identity: MotionNativeStyleIdentity,
    update: Partial<MotionNativeStyleInstance>,
  ) => void;
  onUpdateProp: (
    instance: MotionNativeStyleInstance,
    identity: MotionNativeStyleIdentity,
    key: string,
    value: MotionNativeStyleJsonValue,
  ) => void;
  t: (key: string) => string;
}) {
  const delayId = `${id}-delay`;
  const durationId = `${id}-duration`;
  const easingId = `${id}-easing`;
  const easingValue = easingToken(instance.props.easing);
  const easingVariableId = motionEaseVariableId(easingValue);
  const easingVariable = easingVariables.find(
    (candidate) => candidate.id === easingVariableId,
  );
  const updatePercent = (key: string, rawValue: string) => {
    if (!rawValue.trim()) return;
    const parsed = Number(rawValue);
    if (Number.isFinite(parsed)) {
      onUpdateProp(instance, identity, key, Math.min(100, Math.max(0, parsed)));
    }
  };
  const updateEasing = (value: string) => {
    if (easingVariable && onEasingVariablesChange) {
      onEasingVariablesChange(
        easingVariables.map((candidate) =>
          candidate.id === easingVariable.id
            ? { ...candidate, value }
            : candidate,
        ),
      );
      return;
    }
    if (!easingVariableId) onUpdateProp(instance, identity, "easing", value);
  };

  return (
    <div className="flex flex-col gap-1 px-2.5 py-2" id={id}>
      <NumberField
        id={`${id}-start-from`}
        label={t("designEditor.motion.nativePathTrim.startAtBeginning")}
        value={numberValue(instance.props.pathStartStartFrame, 100)}
        min={0}
        max={100}
        disabled={disabled}
        unit="%"
        onChange={(value) => updatePercent("pathStartStartFrame", value)}
      />
      <NumberField
        id={`${id}-end-from`}
        label={t("designEditor.motion.nativePathTrim.endAtBeginning")}
        value={numberValue(instance.props.pathEndStartWithoutDivider, 20)}
        min={0}
        max={100}
        disabled={disabled}
        unit="%"
        onChange={(value) => updatePercent("pathEndStartWithoutDivider", value)}
      />
      <NumberField
        id={`${id}-start-to`}
        label={t("designEditor.motion.nativePathTrim.startAtEnd")}
        value={numberValue(instance.props.pathStartEndWithoutDivider, 0)}
        min={0}
        max={100}
        disabled={disabled}
        unit="%"
        onChange={(value) => updatePercent("pathStartEndWithoutDivider", value)}
      />
      <NumberField
        id={`${id}-end-to`}
        label={t("designEditor.motion.nativePathTrim.endAtEnd")}
        value={numberValue(instance.props.pathEndEndFrame, 100)}
        min={0}
        max={100}
        disabled={disabled}
        unit="%"
        onChange={(value) => updatePercent("pathEndEndFrame", value)}
      />
      <NumberField
        id={delayId}
        label={t("designEditor.motion.animationStyles.delay")}
        value={Math.round(numberValue(instance.props.delay, 0) * 1000)}
        min={0}
        max={120_000}
        disabled={disabled}
        unit="ms"
        onChange={(value) => {
          if (!value.trim()) return;
          const parsed = Number(value);
          if (Number.isFinite(parsed)) {
            onUpdateProp(instance, identity, "delay", parsed / 1000);
          }
        }}
      />
      <NumberField
        id={durationId}
        label={t("designEditor.motion.duration")}
        value={Math.round(instance.duration * 1000)}
        min={1}
        max={120_000}
        disabled={disabled}
        unit="ms"
        onChange={(value) => {
          if (!value.trim()) return;
          const parsed = Number(value);
          if (Number.isFinite(parsed)) {
            onUpdateTopLevel(instance, identity, {
              duration: Math.min(120_000, Math.max(1, parsed)) / 1000,
            });
          }
        }}
      />
      <Field
        id={easingId}
        label={t("designEditor.motion.animationStyles.easing")}
      >
        <MotionEasingPicker
          value={easingVariable?.value ?? easingValue}
          easingVariables={easingVariables}
          onEasingVariablesChange={onEasingVariablesChange}
          onChange={updateEasing}
          disabled={disabled}
          t={t}
        />
      </Field>
    </div>
  );
}

function NativeTextStaggerDetails({
  id,
  instance,
  identity,
  disabled,
  easingVariables,
  onEasingVariablesChange,
  onUpdateTopLevel,
  onUpdateProp,
  t,
}: {
  id: string;
  instance: MotionNativeStyleInstance;
  identity: MotionNativeStyleIdentity;
  disabled: boolean;
  easingVariables: MotionEasingVariable[];
  onEasingVariablesChange?: (variables: MotionEasingVariable[]) => void;
  onUpdateTopLevel: (
    instance: MotionNativeStyleInstance,
    identity: MotionNativeStyleIdentity,
    update: Partial<MotionNativeStyleInstance>,
  ) => void;
  onUpdateProp: (
    instance: MotionNativeStyleInstance,
    identity: MotionNativeStyleIdentity,
    key: string,
    value: MotionNativeStyleJsonValue,
  ) => void;
  t: (key: string) => string;
}) {
  const grouping = stringValue(instance.props.textDelayGrouping, "CHARACTER");
  const groupOptions = TEXT_STAGGER_GROUPING_OPTIONS.map((option) => ({
    value: option.value,
    labelKey: option.labelKey,
  }));
  const orderOptions = TEXT_STAGGER_ORDER_OPTIONS.filter((option) =>
    grouping === "LINE" || grouping === "PARAGRAPH"
      ? option.value === "TOP_BOTTOM" || option.value === "BOTTOM_TOP"
      : option.value === "LEFT_RIGHT" || option.value === "RIGHT_LEFT",
  );
  const order = stringValue(
    instance.props.textDelayOrder,
    orderOptions[0]?.value ?? "LEFT_RIGHT",
  );
  const animationDirection = stringValue(
    instance.props.animationDirection,
    "in",
  );
  const delayId = `${id}-delay`;
  const durationId = `${id}-duration`;
  const directionId = `${id}-animation-direction`;
  const groupingId = `${id}-grouping`;
  const orderId = `${id}-order`;
  const easingId = `${id}-easing`;
  const easingValue = easingToken(instance.props.easing);

  function updateNumberProp(key: string, value: string, factor = 1) {
    if (!value.trim()) return;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return;
    onUpdateProp(instance, identity, key, parsed / factor);
  }

  return (
    <div className="flex flex-col gap-1 px-2.5 py-2" id={id}>
      <Field
        id={directionId}
        label={t("designEditor.motion.nativeTextStagger.animationDirection")}
      >
        <SelectControl
          id={directionId}
          label={t("designEditor.motion.nativeTextStagger.animationDirection")}
          value={animationDirection}
          disabled={disabled}
          options={TEXT_STAGGER_ANIMATION_DIRECTION_OPTIONS}
          labelBase="designEditor.motion.nativeTextStagger"
          t={t}
          onChange={(value) =>
            onUpdateProp(instance, identity, "animationDirection", value)
          }
        />
      </Field>

      <Field
        id={groupingId}
        label={t("designEditor.motion.nativeTextStagger.grouping")}
      >
        <SelectControl
          id={groupingId}
          label={t("designEditor.motion.nativeTextStagger.grouping")}
          value={grouping}
          disabled={disabled}
          options={groupOptions}
          labelBase="designEditor.motion.textAnimation.units"
          t={t}
          onChange={(value) => {
            const nextGrouping = value;
            const nextOrders = TEXT_STAGGER_ORDER_OPTIONS.filter((option) =>
              nextGrouping === "LINE" || nextGrouping === "PARAGRAPH"
                ? option.value === "TOP_BOTTOM" || option.value === "BOTTOM_TOP"
                : option.value === "LEFT_RIGHT" ||
                  option.value === "RIGHT_LEFT",
            );
            const currentOrderIsValid = nextOrders.some(
              (option) => option.value === order,
            );
            onUpdateProp(instance, identity, "textDelayGrouping", value);
            if (!currentOrderIsValid && nextOrders[0]) {
              onUpdateProp(
                instance,
                identity,
                "textDelayOrder",
                nextOrders[0].value,
              );
            }
          }}
        />
      </Field>

      <Field
        id={orderId}
        label={t("designEditor.motion.nativeTextStagger.order")}
      >
        <SelectControl
          id={orderId}
          label={t("designEditor.motion.nativeTextStagger.order")}
          value={order}
          disabled={disabled}
          options={orderOptions}
          labelBase="designEditor.motion.nativeTextStagger.orderOptions"
          t={t}
          onChange={(value) =>
            onUpdateProp(instance, identity, "textDelayOrder", value)
          }
        />
      </Field>

      <NumberField
        id={`${id}-overlap`}
        label={t("designEditor.motion.nativeTextStagger.overlap")}
        value={numberValue(instance.props.presetStaggerOverlap, 50)}
        min={0}
        max={100}
        disabled={disabled}
        unit="%"
        onChange={(value) => updateNumberProp("presetStaggerOverlap", value)}
      />

      <div className="space-y-1 border-t border-border pt-1">
        {TEXT_STAGGER_EFFECTS.map((effect) => {
          const enabled = booleanValue(
            instance.props[effect.enabledKey],
            effect.enabledByDefault,
          );
          const effectId = `${id}-${effect.enabledKey}`;
          const amountId = `${id}-${effect.amountKey}`;
          const amount = numberValue(
            instance.props[effect.amountKey],
            effect.amountDefault,
          );

          return (
            <div key={effect.enabledKey} className="space-y-0.5">
              <div className="flex min-h-6 items-center justify-between gap-2">
                <Label
                  htmlFor={effectId}
                  className="!text-[10px] text-muted-foreground"
                >
                  {t(
                    `designEditor.motion.nativeTextStagger.effects.${effect.labelKey}`,
                  )}
                </Label>
                <Switch
                  id={effectId}
                  aria-label={t(
                    `designEditor.motion.nativeTextStagger.effects.${effect.labelKey}`,
                  )}
                  checked={enabled}
                  disabled={disabled}
                  onCheckedChange={(checked) =>
                    onUpdateProp(instance, identity, effect.enabledKey, checked)
                  }
                />
              </div>
              {enabled ? (
                <div className="grid grid-cols-[58px_minmax(0,1fr)] items-center gap-2">
                  {effect.enabledKey === "positionEnabled" ? (
                    <>
                      <Label
                        htmlFor={`${id}-position-direction`}
                        className="!text-[10px] text-muted-foreground"
                      >
                        {t(
                          "designEditor.motion.nativeTextStagger.positionDirection",
                        )}
                      </Label>
                      <SelectControl
                        id={`${id}-position-direction`}
                        label={t(
                          "designEditor.motion.nativeTextStagger.positionDirection",
                        )}
                        value={stringValue(instance.props.direction, "top")}
                        disabled={disabled}
                        options={DIRECTION_OPTIONS.Position ?? []}
                        t={t}
                        onChange={(value) =>
                          onUpdateProp(instance, identity, "direction", value)
                        }
                      />
                    </>
                  ) : effect.enabledKey === "rotationEnabled" ? (
                    <>
                      <Label
                        htmlFor={`${id}-rotation-direction`}
                        className="!text-[10px] text-muted-foreground"
                      >
                        {t(
                          "designEditor.motion.nativeTextStagger.rotationDirection",
                        )}
                      </Label>
                      <SelectControl
                        id={`${id}-rotation-direction`}
                        label={t(
                          "designEditor.motion.nativeTextStagger.rotationDirection",
                        )}
                        value={stringValue(
                          instance.props.rotationDirection,
                          "clockwise",
                        )}
                        disabled={disabled}
                        options={DIRECTION_OPTIONS.Rotation ?? []}
                        t={t}
                        onChange={(value) =>
                          onUpdateProp(
                            instance,
                            identity,
                            "rotationDirection",
                            value,
                          )
                        }
                      />
                    </>
                  ) : null}
                  <Label
                    htmlFor={amountId}
                    className="!text-[10px] text-muted-foreground"
                  >
                    {t(
                      `designEditor.motion.nativeTextStagger.effects.${effect.amountLabelKey}`,
                    )}
                  </Label>
                  <div className="flex min-w-0 items-center gap-1">
                    <Input
                      id={amountId}
                      type="number"
                      min={effect.min}
                      max={effect.max}
                      value={amount}
                      disabled={disabled}
                      className={CONTROL_CLASS}
                      onChange={(event) =>
                        updateNumberProp(
                          effect.amountKey,
                          event.currentTarget.value,
                        )
                      }
                    />
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {effect.unit}
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <NumberField
        id={delayId}
        label={t("designEditor.motion.animationStyles.delay")}
        value={Math.round(numberValue(instance.props.delay, 0) * 1000)}
        min={0}
        max={120_000}
        disabled={disabled}
        showClock
        unit="ms"
        onChange={(value) => updateNumberProp("delay", value, 1000)}
      />

      <NumberField
        id={durationId}
        label={t("designEditor.motion.duration")}
        value={Math.round(instance.duration * 1000)}
        min={1}
        max={120_000}
        disabled={disabled}
        showClock
        unit="ms"
        onChange={(value) => {
          const parsed = Number(value);
          if (!value.trim() || !Number.isFinite(parsed)) return;
          onUpdateTopLevel(instance, identity, {
            duration: Math.min(120_000, Math.max(1, parsed)) / 1000,
          });
        }}
      />

      <Field
        id={easingId}
        label={t("designEditor.motion.animationStyles.easing")}
      >
        <MotionEasingPicker
          value={easingValue}
          easingVariables={easingVariables}
          onEasingVariablesChange={onEasingVariablesChange}
          onChange={(value) =>
            onUpdateProp(instance, identity, "easing", value)
          }
          disabled={disabled}
          t={t}
        />
      </Field>
    </div>
  );
}

export interface MotionEasingPickerProps {
  value: string;
  easingVariables: MotionEasingVariable[];
  onChange: (value: string) => void;
  onEasingVariablesChange?: (variables: MotionEasingVariable[]) => void;
  disabled: boolean;
  t: (key: string) => string;
}

export function MotionEasingPicker({
  value,
  easingVariables,
  onChange,
  onEasingVariablesChange,
  disabled,
  t,
}: MotionEasingPickerProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"presets" | "libraries">("presets");
  const [view, setView] = useState<"picker" | "new-variable">("picker");
  const [search, setSearch] = useState("");
  const [collectionFilter, setCollectionFilter] = useState("all");
  const variableId = motionEaseVariableId(value);
  const selectedVariable = easingVariables.find(
    (variable) => variable.id === variableId,
  );
  const selectedPreset = EASING_OPTIONS.find((option) => {
    if (option.value === "custom-bezier") return isCustomBezier(value);
    if (option.value === "custom-spring")
      return parseSpringToken(value) !== null;
    return option.value === value;
  });
  const triggerLabel =
    selectedVariable?.name ??
    (selectedPreset ? optionLabel(selectedPreset, t) : value);
  const pickerKeys = "designEditor.motion.animationStyles.easingPicker";
  const createAvailable =
    Boolean(onEasingVariablesChange) &&
    easingVariables.length < MOTION_EASING_VARIABLE_MAX_COUNT;

  function closePicker() {
    setOpen(false);
    setView("picker");
  }

  function selectPreset(option: (typeof EASING_OPTIONS)[number]) {
    const next =
      option.value === "custom-bezier"
        ? isCustomBezier(value)
          ? value
          : CUSTOM_BEZIER_DEFAULT
        : option.value === "custom-spring"
          ? parseSpringToken(value)
            ? value
            : springToken({
                bounce: MOTION_SPRING_DEFAULT_BOUNCE,
                settle: 1,
              })
          : option.value;
    onChange(next);
    closePicker();
  }

  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredPresets = EASING_OPTIONS.filter((option) => {
    const label = optionLabel(option, t).toLocaleLowerCase();
    return !normalizedSearch || label.includes(normalizedSearch);
  });
  const collections = Array.from(
    new Set(
      easingVariables.map((variable) => variable.collection?.trim() ?? ""),
    ),
  );
  const filteredVariables = easingVariables.filter((variable) => {
    const collection = variable.collection?.trim() ?? "";
    const collectionMatches =
      collectionFilter === "all" ||
      collectionFilter === `collection:${collection}`;
    const searchMatches =
      !normalizedSearch ||
      variable.name.toLocaleLowerCase().includes(normalizedSearch) ||
      collection.toLocaleLowerCase().includes(normalizedSearch) ||
      variable.value.toLocaleLowerCase().includes(normalizedSearch);
    return collectionMatches && searchMatches;
  });

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setView("picker");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-label={triggerLabel}
          className={`${CONTROL_CLASS} justify-between gap-1 text-start font-normal`}
          disabled={disabled}
        >
          <span className="truncate">{triggerLabel}</span>
          <IconChevronDown
            aria-hidden="true"
            className="size-3.5 shrink-0 text-muted-foreground"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side="left" className="w-64 p-2">
        {view === "new-variable" ? (
          <NewEasingVariableForm
            easingVariables={easingVariables}
            initialValue={concreteEasingValue(value, easingVariables)}
            disabled={disabled}
            t={t}
            onCancel={() => setView("picker")}
            onCreate={(variable) => {
              onEasingVariablesChange?.([...easingVariables, variable]);
              onChange(motionEaseVariableToken(variable.id));
              closePicker();
            }}
          />
        ) : (
          <Tabs
            value={tab}
            onValueChange={(next) => {
              if (next === "presets" || next === "libraries") setTab(next);
            }}
            className="space-y-2"
          >
            <TabsList className="grid h-7 w-full grid-cols-2 p-0.5">
              <TabsTrigger
                value="presets"
                disabled={disabled}
                className="h-6 px-2 text-[11px]"
              >
                {t(`${pickerKeys}.presets`)}
              </TabsTrigger>
              <TabsTrigger
                value="libraries"
                disabled={disabled}
                className="h-6 px-2 text-[11px]"
              >
                {t(`${pickerKeys}.libraries`)}
              </TabsTrigger>
            </TabsList>

            <div className="relative">
              <Input
                type="search"
                aria-label={t(`${pickerKeys}.searchPlaceholder`)}
                placeholder={t(`${pickerKeys}.searchPlaceholder`)}
                value={search}
                disabled={disabled}
                className={`${CONTROL_CLASS} pl-2`}
                onChange={(event) => setSearch(event.currentTarget.value)}
              />
            </div>

            <TabsContent value="presets" className="mt-0 space-y-1">
              <div className="max-h-52 overflow-y-auto">
                {filteredPresets.length > 0 ? (
                  filteredPresets.map((option) => {
                    const selected =
                      option.value === "custom-bezier"
                        ? isCustomBezier(value)
                        : option.value === "custom-spring"
                          ? parseSpringToken(value) !== null
                          : option.value === value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={selected}
                        disabled={disabled}
                        className="flex h-7 w-full items-center gap-1 rounded px-2 text-left text-[11px] leading-none hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
                        onClick={() => selectPreset(option)}
                      >
                        <span
                          aria-hidden="true"
                          className={`flex size-3 shrink-0 items-center justify-center text-primary ${selected ? "opacity-100" : "opacity-0"}`}
                        >
                          <IconCheck className="size-3" />
                        </span>
                        <span className="truncate">
                          {optionLabel(option, t)}
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <p
                    role="status"
                    className="px-2 py-2 text-[11px] text-muted-foreground"
                  >
                    {t(`${pickerKeys}.noResults`)}
                  </p>
                )}
              </div>
            </TabsContent>

            <TabsContent value="libraries" className="mt-0 space-y-1">
              <Select
                value={collectionFilter}
                disabled={disabled}
                onValueChange={setCollectionFilter}
              >
                <SelectTrigger
                  aria-label={t(`${pickerKeys}.variableSet`)}
                  className={CONTROL_CLASS}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t(`${pickerKeys}.allLibraries`)}
                  </SelectItem>
                  {collections.map((collection) => (
                    <SelectItem
                      key={collection || "__default__"}
                      value={`collection:${collection}`}
                    >
                      {collection || t(`${pickerKeys}.variableSet`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="max-h-40 overflow-y-auto">
                {filteredVariables.length > 0 ? (
                  filteredVariables.map((variable) => (
                    <button
                      key={variable.id}
                      type="button"
                      aria-pressed={variable.id === variableId}
                      aria-label={`${variable.name}, ${variable.collection || t(`${pickerKeys}.variableSet`)}`}
                      disabled={disabled}
                      className="flex min-h-8 w-full items-center gap-1 rounded px-2 text-left text-[11px] hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
                      onClick={() => {
                        onChange(motionEaseVariableToken(variable.id));
                        closePicker();
                      }}
                    >
                      <span
                        aria-hidden="true"
                        className={`flex size-3 shrink-0 items-center justify-center text-primary ${variable.id === variableId ? "opacity-100" : "opacity-0"}`}
                      >
                        <IconCheck className="size-3" />
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {variable.name}
                      </span>
                      <span className="max-w-20 truncate text-[10px] text-muted-foreground">
                        {variable.collection || t(`${pickerKeys}.variableSet`)}
                      </span>
                    </button>
                  ))
                ) : (
                  <p
                    role="status"
                    className="px-2 py-2 text-[11px] text-muted-foreground"
                  >
                    {easingVariables.length === 0
                      ? t(`${pickerKeys}.noVariables`)
                      : t(`${pickerKeys}.noResults`)}
                  </p>
                )}
              </div>
            </TabsContent>

            {createAvailable ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-full justify-start gap-1 px-2 text-[11px]"
                disabled={disabled}
                onClick={() => setView("new-variable")}
              >
                <IconPlus aria-hidden="true" className="size-3.5" />
                {t(`${pickerKeys}.newVariable`)}
              </Button>
            ) : null}
          </Tabs>
        )}
      </PopoverContent>
    </Popover>
  );
}

function NewEasingVariableForm({
  easingVariables,
  initialValue,
  disabled,
  t,
  onCancel,
  onCreate,
}: {
  easingVariables: MotionEasingVariable[];
  initialValue: string;
  disabled: boolean;
  t: (key: string) => string;
  onCancel: () => void;
  onCreate: (variable: MotionEasingVariable) => void;
}) {
  const id = useId();
  const [collection, setCollection] = useState("");
  const [name, setName] = useState("");
  const [value, setValue] = useState(initialValue);
  const key = "designEditor.motion.animationStyles.easingVariable";
  const normalizedName = name.trim().toLocaleLowerCase();
  const normalizedCollection = collection.trim().toLocaleLowerCase();
  const duplicateName =
    normalizedName.length > 0 &&
    easingVariables.some(
      (variable) =>
        variable.name.trim().toLocaleLowerCase() === normalizedName &&
        (variable.collection?.trim().toLocaleLowerCase() ?? "") ===
          normalizedCollection,
    );
  const canCreate = name.trim().length > 0 && !duplicateName && !disabled;
  const collectionId = `${id}-collection`;
  const nameId = `${id}-name`;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-1">
        <h3 className="text-[11px] font-medium">{t(`${key}.title`)}</h3>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t(`${key}.cancel`)}
          disabled={disabled}
          onClick={onCancel}
        >
          <IconX aria-hidden="true" className="size-3.5" />
        </Button>
      </div>
      <Field id={collectionId} label={t(`${key}.collection`)}>
        <Input
          id={collectionId}
          aria-label={t(`${key}.collection`)}
          maxLength={128}
          value={collection}
          disabled={disabled}
          className={CONTROL_CLASS}
          onChange={(event) => setCollection(event.currentTarget.value)}
        />
      </Field>
      <Field id={nameId} label={t(`${key}.name`)}>
        <Input
          id={nameId}
          aria-label={t(`${key}.name`)}
          maxLength={128}
          value={name}
          disabled={disabled}
          className={CONTROL_CLASS}
          onChange={(event) => setName(event.currentTarget.value)}
        />
      </Field>
      {duplicateName ? (
        <p role="alert" className="text-[10px] text-destructive">
          {t(`${key}.duplicateName`)}
        </p>
      ) : null}
      <div className="space-y-1">
        <p
          id="motion-easing-variable-value-label"
          className="text-[10px] leading-none text-muted-foreground"
        >
          {t(`${key}.value`)}
        </p>
        <div
          role="group"
          aria-labelledby="motion-easing-variable-value-label"
          className="min-w-0"
        >
          <NativeEasingCurveEditor
            value={value}
            disabled={disabled}
            onChange={setValue}
            t={t}
          />
        </div>
      </div>
      <div className="flex justify-end gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11px]"
          disabled={disabled}
          onClick={onCancel}
        >
          {t(`${key}.cancel`)}
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-7 px-2 text-[11px]"
          disabled={!canCreate}
          onClick={() => {
            const trimmedName = name.trim();
            const trimmedCollection = collection.trim();
            const id = createMotionEaseVariableId(
              trimmedName,
              easingVariables.map((variable) => variable.id),
            );
            onCreate({
              id,
              name: trimmedName,
              value,
              ...(trimmedCollection ? { collection: trimmedCollection } : {}),
            });
          }}
        >
          {t(`${key}.create`)}
        </Button>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[58px_minmax(0,1fr)] items-center gap-2">
      <Label
        htmlFor={id}
        className="!text-[10px] leading-none text-muted-foreground"
      >
        {label}
      </Label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function SelectControl({
  id,
  label,
  value,
  disabled,
  options,
  labelBase = "designEditor.motion.animationStyles",
  t,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  disabled: boolean;
  options: { value: string; labelKey: string }[];
  labelBase?: string;
  t: (key: string) => string;
  onChange: (value: string) => void;
}) {
  const selectedOption = options.find((option) => option.value === value);
  return (
    <Select value={value} disabled={disabled} onValueChange={onChange}>
      <SelectTrigger id={id} aria-label={label} className={CONTROL_CLASS}>
        {selectedOption ? (
          <span className="truncate">
            {t(`${labelBase}.${selectedOption.labelKey}`)}
          </span>
        ) : (
          <span className="truncate">{value}</span>
        )}
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {t(`${labelBase}.${option.labelKey}`)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function NumberField({
  id,
  label,
  value,
  min,
  max,
  disabled,
  showClock = false,
  unit,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  showClock?: boolean;
  unit?: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field id={id} label={label}>
      <div className="flex min-w-0 items-center gap-1">
        {showClock ? (
          <IconClock
            aria-hidden="true"
            className="size-3.5 shrink-0 text-muted-foreground"
          />
        ) : null}
        <Input
          id={id}
          type="number"
          min={min}
          max={max}
          step={1}
          value={value}
          disabled={disabled}
          className={CONTROL_CLASS}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
        {unit ? (
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {unit}
          </span>
        ) : null}
      </div>
    </Field>
  );
}

function NativeEasingCurveEditor({
  value,
  disabled,
  onChange,
  t,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  t: (key: string) => string;
}) {
  const spring = parseSpringToken(value);
  const [tab, setTab] = useState<"curve" | "spring">(
    spring ? "spring" : "curve",
  );

  return (
    <Tabs
      value={tab}
      onValueChange={(next) => {
        if (next !== "curve" && next !== "spring") return;
        setTab(next);
        if (next === "spring" && !parseSpringToken(value)) {
          onChange(
            springToken({
              bounce: MOTION_SPRING_DEFAULT_BOUNCE,
              settle: 1,
            }),
          );
        } else if (next === "curve" && parseSpringToken(value)) {
          onChange(DEFAULT_EASING);
        }
      }}
      className="space-y-2"
    >
      <TabsList
        aria-label={t("designEditor.motion.animationStyles.easing")}
        className="h-7 w-full p-0.5"
      >
        <TabsTrigger
          value="curve"
          disabled={disabled}
          className="h-6 flex-1 px-2 text-[11px]"
        >
          {t("designEditor.motion.curveTab")}
        </TabsTrigger>
        <TabsTrigger
          value="spring"
          disabled={disabled}
          className="h-6 flex-1 px-2 text-[11px]"
        >
          {t("designEditor.motion.springTab")}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="curve" className="mt-0 space-y-2">
        <NativeBezierCurveEditor
          value={value}
          disabled={disabled}
          onChange={onChange}
          t={t}
        />
      </TabsContent>

      <TabsContent value="spring" className="mt-0">
        <NativeSpringEditor
          value={value}
          disabled={disabled}
          onChange={onChange}
          t={t}
        />
      </TabsContent>
    </Tabs>
  );
}

function NativeBezierCurveEditor({
  value,
  disabled,
  onChange,
  t,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  t: (key: string) => string;
}) {
  const id = useId();
  const parsedPoints = parseBezier(value);
  const isLinear = value === "linear";
  const isHold = value === "step-start";
  const points =
    parsedPoints ??
    (isLinear ? ([0, 0, 1, 1] as [number, number, number, number]) : null);
  const dragRef = useRef<BezierHandleDrag | null>(null);
  const [dragViewBox, setDragViewBox] = useState<BezierViewBox | null>(null);
  const [bezierValue, setBezierValue] = useState(() =>
    isLinear ? "0, 0, 1, 1" : formatBezierCoordinates(parsedPoints, value),
  );

  useEffect(() => {
    const current = parseBezier(value);
    setBezierValue(
      value === "linear"
        ? "0, 0, 1, 1"
        : formatBezierCoordinates(current, value),
    );
  }, [value]);

  if (!points) {
    if (!isHold) return null;
    return (
      <svg
        viewBox="-6 -6 112 112"
        role="group"
        aria-label={t("designEditor.motion.animationStyles.curvePreview")}
        data-easing-curve={value}
        className="h-52 w-full rounded border border-border bg-muted/30"
      >
        <path
          d="M 0 100 L 100 0"
          className="stroke-border"
          strokeDasharray="2 3"
        />
        <path
          d="M 0 100 L 0 0 L 100 0"
          data-curve-path
          fill="none"
          className="stroke-primary"
          strokeWidth="3"
        />
      </svg>
    );
  }

  const curvePoints =
    points ?? ([0, 0, 1, 1] as [number, number, number, number]);
  const path = `M 0 100 C ${formatEasingNumber(curvePoints[0] * 100)} ${formatEasingNumber(100 - curvePoints[1] * 100)}, ${formatEasingNumber(curvePoints[2] * 100)} ${formatEasingNumber(100 - curvePoints[3] * 100)}, 100 0`;

  const minProgress = Math.min(0, curvePoints[1], curvePoints[3]);
  const maxProgress = Math.max(1, curvePoints[1], curvePoints[3]);
  const minY = 100 - maxProgress * 100;
  const maxY = 100 - minProgress * 100;
  const computedViewBox: BezierViewBox = [
    -42,
    minY - 42,
    184,
    maxY - minY + 84,
  ];
  const renderedViewBox = dragViewBox ?? computedViewBox;

  function beginHandleDrag(
    event: ReactPointerEvent<SVGCircleElement>,
    handleIndex: 0 | 1,
  ) {
    if (disabled) return;
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const matrix =
      typeof svg.getScreenCTM === "function" ? svg.getScreenCTM() : null;
    const determinant = matrix ? matrix.a * matrix.d - matrix.b * matrix.c : 0;
    const inverseScreenMatrix =
      matrix && Number.isFinite(determinant) && Math.abs(determinant) > 1e-12
        ? {
            a: matrix.d / determinant,
            b: -matrix.b / determinant,
            c: -matrix.c / determinant,
            d: matrix.a / determinant,
            e: (matrix.c * matrix.f - matrix.d * matrix.e) / determinant,
            f: (matrix.b * matrix.e - matrix.a * matrix.f) / determinant,
          }
        : null;

    event.preventDefault();
    dragRef.current = {
      handleIndex,
      pointerId: event.pointerId,
      points: curvePoints,
      rect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      },
      inverseScreenMatrix,
      viewBox: computedViewBox.map((coordinate) =>
        Number(formatEasingNumber(coordinate)),
      ) as BezierViewBox,
    };
    setDragViewBox(dragRef.current.viewBox);
    const captureTarget = event.currentTarget as SVGCircleElement & {
      setPointerCapture?: (pointerId: number) => void;
    };
    captureTarget.setPointerCapture?.(event.pointerId);
  }

  function moveHandle(
    event: ReactPointerEvent<SVGCircleElement>,
    handleIndex: 0 | 1,
  ) {
    const drag = dragRef.current;
    if (
      !drag ||
      drag.pointerId !== event.pointerId ||
      drag.handleIndex !== handleIndex
    ) {
      return;
    }

    event.preventDefault();
    let pointX: number;
    let pointY: number;
    if (drag.inverseScreenMatrix) {
      const matrix = drag.inverseScreenMatrix;
      pointX = matrix.a * event.clientX + matrix.c * event.clientY + matrix.e;
      pointY = matrix.b * event.clientX + matrix.d * event.clientY + matrix.f;
    } else {
      const [viewX, viewY, viewWidth, viewHeight] = drag.viewBox;
      const progressX = clampUnit(
        (event.clientX - drag.rect.left) / drag.rect.width,
      );
      const progressY = clampUnit(
        (event.clientY - drag.rect.top) / drag.rect.height,
      );
      pointX = viewX + progressX * viewWidth;
      pointY = viewY + progressY * viewHeight;
    }
    pointX = Math.max(0, Math.min(100, pointX));
    const nextPoints = [...drag.points] as [number, number, number, number];
    nextPoints[handleIndex * 2] = pointX / 100;
    nextPoints[handleIndex * 2 + 1] = (100 - pointY) / 100;
    drag.points = nextPoints;
    onChange(formatBezierToken(nextPoints));
  }

  function endHandleDrag(event: ReactPointerEvent<SVGCircleElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const captureTarget = event.currentTarget as SVGCircleElement & {
      hasPointerCapture?: (pointerId: number) => boolean;
      releasePointerCapture?: (pointerId: number) => void;
    };
    if (captureTarget.hasPointerCapture?.(event.pointerId)) {
      captureTarget.releasePointerCapture?.(event.pointerId);
    }
    dragRef.current = null;
    setDragViewBox(null);
  }

  function moveHandleByKeyboard(
    event: ReactKeyboardEvent<SVGCircleElement>,
    handleIndex: 0 | 1,
  ) {
    const direction = {
      ArrowDown: [0, -1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, 1],
    }[event.key];
    if (disabled || !direction) return;

    event.preventDefault();
    const step = event.shiftKey ? 0.1 : 0.01;
    const nextPoints = [...curvePoints] as [number, number, number, number];
    const xIndex = handleIndex * 2;
    const yIndex = xIndex + 1;
    nextPoints[xIndex] = Math.max(
      0,
      Math.min(1, nextPoints[xIndex] + direction[0] * step),
    );
    nextPoints[yIndex] += direction[1] * step;
    onChange(formatBezierToken(nextPoints));
  }

  function flipCurve() {
    onChange(formatBezierToken(flipBezierPoints(curvePoints)));
  }

  return (
    <div className="space-y-2">
      <svg
        viewBox={renderedViewBox.map(formatEasingNumber).join(" ")}
        role="group"
        aria-label={t("designEditor.motion.animationStyles.curvePreview")}
        data-easing-curve={value}
        className="h-52 w-full rounded border border-border bg-muted/30"
      >
        <path
          d="M 0 0 H 100 M 0 100 H 100"
          className="stroke-border"
          strokeWidth="0.75"
        />
        <path
          d={`M 0 100 L ${formatEasingNumber(curvePoints[0] * 100)} ${formatEasingNumber(100 - curvePoints[1] * 100)} M 100 0 L ${formatEasingNumber(curvePoints[2] * 100)} ${formatEasingNumber(100 - curvePoints[3] * 100)}`}
          className="stroke-border"
          strokeWidth="0.75"
        />
        <path
          d="M 0 100 L 100 0"
          className="stroke-border"
          strokeDasharray="2 3"
        />
        <path
          d={path}
          data-curve-path
          fill="none"
          className="stroke-primary"
          strokeWidth="3"
        />
        <circle
          cx="0"
          cy="100"
          r="3"
          aria-hidden="true"
          className="fill-background stroke-muted-foreground"
          strokeWidth="1.5"
        />
        <circle
          cx="100"
          cy="0"
          r="3"
          aria-hidden="true"
          className="fill-background stroke-muted-foreground"
          strokeWidth="1.5"
        />
        {([0, 1] as const).map((handleIndex) => {
          const xIndex = handleIndex * 2;
          const labelSuffix = handleIndex + 1;
          return (
            <circle
              key={handleIndex}
              cx={curvePoints[xIndex] * 100}
              cy={100 - curvePoints[xIndex + 1] * 100}
              r="5"
              role="button"
              aria-label={`${t("designEditor.motion.customBezier")} ${labelSuffix}`}
              aria-disabled={disabled}
              aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
              tabIndex={disabled ? -1 : 0}
              data-curve-handle={handleIndex}
              className="cursor-move fill-primary stroke-background stroke-2 outline-none focus-visible:stroke-ring"
              onPointerDown={(event) => beginHandleDrag(event, handleIndex)}
              onPointerMove={(event) => moveHandle(event, handleIndex)}
              onPointerUp={endHandleDrag}
              onPointerCancel={endHandleDrag}
              onKeyDown={(event) => moveHandleByKeyboard(event, handleIndex)}
            />
          );
        })}
      </svg>
      <div className="flex min-w-0 items-center gap-1">
        <IconChartLine
          aria-hidden="true"
          className="size-3.5 shrink-0 text-muted-foreground"
        />
        <Input
          id={`${id}-bezier`}
          type="text"
          aria-label={t("designEditor.motion.animationStyles.bezier")}
          value={bezierValue}
          disabled={disabled || isHold}
          className={CONTROL_CLASS}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setBezierValue(next);
            if (next === "linear") {
              onChange(next);
              return;
            }
            const nextPoints = parseBezierCoordinates(next);
            if (!nextPoints) return;
            const token = formatBezierToken(nextPoints);
            if (isValidMotionEase(token)) onChange(token);
          }}
          onBlur={() => {
            const current = parseBezier(value);
            setBezierValue(
              value === "linear"
                ? "0, 0, 1, 1"
                : formatBezierCoordinates(current, value),
            );
          }}
        />
        {!isHold ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("designEditor.motion.animationStyles.flipCurve")}
            title={t("designEditor.motion.animationStyles.flipCurve")}
            disabled={disabled}
            onClick={flipCurve}
          >
            <IconFlipHorizontal aria-hidden="true" className="size-3.5" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function NativeSpringEditor({
  value,
  disabled,
  onChange,
  t,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  t: (key: string) => string;
}) {
  const spring = parseSpringToken(value);
  const springGeometry = spring ? createSpringCurveGeometry(spring) : null;

  return (
    <div className="space-y-2">
      {spring && springGeometry ? (
        <>
          <svg
            viewBox="0 0 216 132"
            role="img"
            aria-label={t("designEditor.motion.springCurvePreview")}
            data-easing-curve={value}
            className="h-20 w-full rounded border border-border bg-muted/30"
          >
            <path
              d={`M 10 ${formatEasingNumber(springGeometry.baselineY)} L 206 ${formatEasingNumber(springGeometry.baselineY)}`}
              className="stroke-border"
              strokeDasharray="2 3"
            />
            <path
              d={springGeometry.path}
              data-curve-path
              fill="none"
              className="stroke-primary"
              strokeWidth="3"
            />
          </svg>
          <CurveNumberField
            label={t("designEditor.motion.bounce")}
            value={spring.bounce}
            min={0}
            max={1}
            disabled={disabled}
            onChange={(bounce) =>
              onChange(springToken({ bounce, settle: spring.settle }))
            }
          />
        </>
      ) : null}
    </div>
  );
}

function createSpringCurveGeometry(spring: {
  bounce: number;
  settle: number;
}): { path: string; baselineY: number } {
  const sampleCount = 48;
  const samples = Array.from({ length: sampleCount + 1 }, (_, index) =>
    sampleSpring(spring, index / sampleCount),
  );
  const minProgress = Math.min(0, ...samples);
  const maxProgress = Math.max(1, ...samples);
  const yForProgress = (progress: number) =>
    122 - ((progress - minProgress) / (maxProgress - minProgress)) * 112;
  const path = Array.from({ length: sampleCount + 1 }, (_, index) => {
    const progress = index / sampleCount;
    const x = 10 + progress * 196;
    const y = yForProgress(samples[index]);
    return `${index === 0 ? "M" : "L"} ${formatEasingNumber(x)} ${formatEasingNumber(y)}`;
  }).join(" ");
  return { path, baselineY: yForProgress(1) };
}

function CurveNumberField({
  label,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
      <span className="shrink-0">{label}</span>
      <Input
        type="number"
        min={min}
        max={max}
        step={0.01}
        value={formatEasingNumber(value)}
        disabled={disabled}
        className={CONTROL_CLASS}
        onChange={(event) => {
          const next = Number(event.currentTarget.value);
          if (Number.isFinite(next)) onChange(next);
        }}
      />
    </label>
  );
}

function isRunnableStyle(styleKey: MotionNativeStyleKey): boolean {
  return (
    styleKey === "Position" ||
    styleKey === "Scale" ||
    styleKey === "Rotation" ||
    styleKey === "Size" ||
    styleKey === "Opacity" ||
    styleKey === "TextStagger" ||
    styleKey === "Path"
  );
}

function createIdentity(
  instance: MotionNativeStyleInstance,
  index: number,
): MotionNativeStyleIdentity {
  return {
    key: JSON.stringify([instance.styleKey, instance.targetNodeId, index]),
    styleKey: instance.styleKey,
    targetNodeId: instance.targetNodeId,
    index,
    ...(instance.sourceInstanceId
      ? { sourceInstanceId: instance.sourceInstanceId }
      : {}),
  };
}

function stringValue(
  value: MotionNativeStyleJsonValue | undefined,
  fallback = "",
) {
  if (typeof value === "string") return value;
  if (value === undefined) return fallback;
  return JSON.stringify(value);
}

function numberValue(
  value: MotionNativeStyleJsonValue | undefined,
  fallback: number,
) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function defaultAmount(styleKey: MotionNativeStyleKey): number {
  switch (styleKey) {
    case "Position":
      return 200;
    case "Scale":
      return 120;
    case "Rotation":
      return 180;
    case "Size":
      return 50;
    case "Opacity":
      return 0;
    case "TextStagger":
    case "Path":
      return 0;
  }
}

function easingToken(value: MotionNativeStyleJsonValue | undefined): string {
  if (value === undefined) return DEFAULT_EASING;
  if (typeof value === "string") {
    return easingPresetToken(value) ?? value;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const type = typeof value.type === "string" ? value.type.toUpperCase() : "";
    const preset = easingPresetToken(type);
    if (preset) return preset;
    if (type === "CUSTOM") {
      const coordinates = [value.x1, value.y1, value.x2, value.y2];
      if (coordinates.every((coordinate) => typeof coordinate === "number")) {
        return `cubic-bezier(${coordinates.map(formatBezierNumber).join(", ")})`;
      }
    }
    if (type === "SPRING") {
      const bounce = numberValue(value.bounce, MOTION_SPRING_DEFAULT_BOUNCE);
      const settle = numberValue(value.settle, 1);
      return springToken({ bounce, settle });
    }
  }
  return JSON.stringify(value);
}

function concreteEasingValue(
  value: string,
  variables: readonly MotionEasingVariable[],
): string {
  const variableId = motionEaseVariableId(value);
  const concreteValue = variableId
    ? variables.find((variable) => variable.id === variableId)?.value
    : value;
  if (!concreteValue) return DEFAULT_EASING;
  if (
    MOTION_CURVE_PRESETS.some((preset) => preset.value === concreteValue) ||
    MOTION_SPRING_PRESETS.some((preset) => preset.value === concreteValue) ||
    isCustomBezier(concreteValue) ||
    parseSpringToken(concreteValue)
  ) {
    return concreteValue;
  }
  return DEFAULT_EASING;
}

function easingPresetToken(type: string): string | undefined {
  const normalized = type.toUpperCase().replace(/-/g, "_");
  const curveLabels: Record<string, string> = {
    HOLD: "Hold",
    LINEAR: "Linear",
    EASE_IN: "Ease in",
    EASE_OUT: "Ease out",
    EASE_IN_OUT: "Ease in and out",
    EASE_IN_AND_OUT: "Ease in and out",
    EASE_IN_BACK: "Ease in back",
    EASE_OUT_BACK: "Ease out back",
    EASE_IN_OUT_BACK: "Ease in and out back",
    EASE_IN_AND_OUT_BACK: "Ease in and out back",
  };
  const curveLabel = curveLabels[normalized];
  const curvePreset = MOTION_CURVE_PRESETS.find(
    (preset) => preset.label === curveLabel,
  );
  if (curvePreset) return curvePreset.value;

  const springLabel = (
    {
      GENTLE: "Gentle",
      QUICK: "Quick",
      BOUNCY: "Bouncy",
      SLOW: "Slow",
    } as Record<string, string>
  )[normalized];
  const springPreset = MOTION_SPRING_PRESETS.find(
    (preset) => preset.label === springLabel,
  );
  return springPreset?.value;
}

function optionLabel(
  option: (typeof EASING_OPTIONS)[number],
  t: (key: string) => string,
): string {
  if (option.labelKey === "customBezier") {
    return t("designEditor.motion.customBezier");
  }
  if (option.labelKey === "customSpring") {
    return t("designEditor.motion.customSpring");
  }
  return t(
    `designEditor.motion.animationStyles.easingPresets.${option.labelKey}`,
  );
}

function formatBezierToken(points: [number, number, number, number]): string {
  const token = `cubic-bezier(${points.map(formatBezierNumber).join(", ")})`;
  return (
    MOTION_CURVE_PRESETS.find((preset) => preset.value === token)?.value ??
    token
  );
}

function formatBezierNumber(value: number): string {
  return String(Number(value.toPrecision(15)));
}

function flipBezierPoints(
  points: [number, number, number, number],
): [number, number, number, number] {
  return [1 - points[2], 1 - points[3], 1 - points[0], 1 - points[1]];
}

function isCustomBezier(value: string): boolean {
  return (
    parseBezier(value) !== null &&
    !MOTION_CURVE_PRESETS.some((preset) => preset.value === value)
  );
}

function parseBezier(value: string): [number, number, number, number] | null {
  const match =
    /^cubic-bezier\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^\)]+)\)$/i.exec(
      value,
    );
  if (!match) return null;
  const points = match.slice(1).map(Number);
  return points.length === 4 && points.every(Number.isFinite)
    ? (points as [number, number, number, number])
    : null;
}

function parseBezierCoordinates(
  value: string,
): [number, number, number, number] | null {
  const cssValue = parseBezier(value.trim());
  if (cssValue) return cssValue;

  const coordinateTokens = value
    .split(",")
    .map((coordinate) => coordinate.trim());
  if (coordinateTokens.length !== 4 || coordinateTokens.some((part) => !part)) {
    return null;
  }
  const coordinates = coordinateTokens.map(Number);
  return coordinates.length === 4 && coordinates.every(Number.isFinite)
    ? (coordinates as [number, number, number, number])
    : null;
}

function formatBezierCoordinates(
  points: [number, number, number, number] | null,
  fallback: string,
): string {
  return points ? points.map(formatBezierNumber).join(", ") : fallback;
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function formatEasingNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}
