import type {
  MotionTextAnimation,
  MotionTextDirection,
  MotionTextProperty,
  MotionTextUnit,
} from "@shared/motion-text-code";
import { IconX } from "@tabler/icons-react";
import { useId, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const TEXT_UNITS: MotionTextUnit[] = ["character", "word", "line", "paragraph"];

const TEXT_DIRECTIONS: MotionTextDirection[] = ["forward", "reverse"];

const TEXT_PROPERTIES: MotionTextProperty[] = [
  "opacity",
  "translate",
  "scale",
  "rotate",
];

const FIELD_CLASS =
  "h-6 w-full min-w-0 rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 !text-[11px] shadow-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]";

export interface MotionTextAnimationEditorProps {
  animation: MotionTextAnimation;
  onChange: (animation: MotionTextAnimation) => void;
  onRemove: () => void;
  disabled?: boolean;
  t: (key: string) => string;
}

export function MotionTextAnimationEditor({
  animation,
  onChange,
  onRemove,
  disabled = false,
  t,
}: MotionTextAnimationEditorProps) {
  const id = useId();

  function updateKeyframe(
    index: number,
    update: Partial<MotionTextAnimation["keyframes"][number]>,
  ) {
    onChange({
      ...animation,
      keyframes: animation.keyframes.map((keyframe, keyframeIndex) =>
        keyframeIndex === index ? { ...keyframe, ...update } : keyframe,
      ),
    });
  }

  function updateNumber(field: "staggerMs" | "durationMs", rawValue: string) {
    if (rawValue.trim() === "") return;
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) return;

    const value =
      field === "staggerMs"
        ? Math.min(5_000, Math.max(0, parsed))
        : Math.min(120_000, Math.max(1, parsed));
    onChange({ ...animation, [field]: value });
  }

  return (
    <section className="space-y-2 rounded-md border border-border px-2.5 py-2">
      <header className="flex min-w-0 items-center justify-between gap-2">
        <h3 className="min-w-0 truncate !text-[11px] font-medium">
          {t("designEditor.motion.textAnimation.title")}
        </h3>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("designEditor.motion.textAnimation.remove")}
          disabled={disabled}
          onClick={onRemove}
        >
          <IconX aria-hidden="true" className="size-3.5" />
        </Button>
      </header>

      <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
        <Field
          id={`${id}-unit`}
          label={t("designEditor.motion.textAnimation.unit")}
        >
          <Select
            value={animation.unit}
            disabled={disabled}
            onValueChange={(unit) =>
              onChange({ ...animation, unit: unit as MotionTextUnit })
            }
          >
            <SelectTrigger
              id={`${id}-unit`}
              aria-label={t("designEditor.motion.textAnimation.unit")}
              className={FIELD_CLASS}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TEXT_UNITS.map((unit) => (
                <SelectItem key={unit} value={unit}>
                  {t(`designEditor.motion.textAnimation.units.${unit}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          id={`${id}-direction`}
          label={t("designEditor.motion.textAnimation.direction")}
        >
          <Select
            value={animation.direction}
            disabled={disabled}
            onValueChange={(direction) =>
              onChange({
                ...animation,
                direction: direction as MotionTextDirection,
              })
            }
          >
            <SelectTrigger
              id={`${id}-direction`}
              aria-label={t("designEditor.motion.textAnimation.direction")}
              className={FIELD_CLASS}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TEXT_DIRECTIONS.map((direction) => (
                <SelectItem key={direction} value={direction}>
                  {t(
                    `designEditor.motion.textAnimation.directions.${direction}`,
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          id={`${id}-property`}
          label={t("designEditor.motion.textAnimation.property")}
        >
          <Select
            value={animation.property}
            disabled={disabled}
            onValueChange={(property) =>
              onChange({
                ...animation,
                property: property as MotionTextProperty,
              })
            }
          >
            <SelectTrigger
              id={`${id}-property`}
              aria-label={t("designEditor.motion.textAnimation.property")}
              className={FIELD_CLASS}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TEXT_PROPERTIES.map((property) => (
                <SelectItem key={property} value={property}>
                  {t(
                    `designEditor.motion.textAnimation.properties.${property}`,
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <NumberField
          id={`${id}-stagger`}
          label={t("designEditor.motion.textAnimation.stagger")}
          value={animation.staggerMs}
          min={0}
          max={5_000}
          disabled={disabled}
          onChange={(value) => updateNumber("staggerMs", value)}
        />

        <NumberField
          id={`${id}-duration`}
          label={t("designEditor.motion.textAnimation.duration")}
          value={animation.durationMs}
          min={1}
          max={120_000}
          disabled={disabled}
          onChange={(value) => updateNumber("durationMs", value)}
        />
      </div>

      <div className="space-y-1.5">
        {animation.keyframes.map((keyframe, index) => (
          <div
            key={`${keyframe.t}-${index}`}
            className="grid grid-cols-[2.25rem_minmax(0,1fr)_minmax(0,0.8fr)] items-center gap-1"
          >
            <span className="text-right !text-[10px] tabular-nums text-muted-foreground">
              {Math.round(keyframe.t * 100)}%
            </span>
            <Input
              type="text"
              aria-label={`${t("designEditor.motion.textAnimation.keyframeValue")} ${index + 1}`}
              value={keyframe.value}
              disabled={disabled}
              className={FIELD_CLASS}
              onChange={(event) =>
                updateKeyframe(index, { value: event.currentTarget.value })
              }
            />
            <Input
              type="text"
              aria-label={`${t("designEditor.motion.textAnimation.keyframeEase")} ${index + 1}`}
              placeholder={t(
                "designEditor.motion.textAnimation.easePlaceholder",
              )}
              value={keyframe.ease ?? ""}
              disabled={disabled}
              className={FIELD_CLASS}
              onChange={(event) =>
                updateKeyframe(index, {
                  ease: event.currentTarget.value || undefined,
                })
              }
            />
          </div>
        ))}
      </div>
    </section>
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
    <div className="min-w-0 space-y-0.5">
      <Label htmlFor={id} className="!text-[10px] text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

function NumberField({
  id,
  label,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Field id={id} label={label}>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        className={FIELD_CLASS}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </Field>
  );
}
