import type {
  MotionTextAnimation,
  MotionTextAnimationDirection,
  MotionTextOrder,
  MotionTextProperty,
  MotionTextUnit,
} from "@shared/motion-text-code";
import { IconPlus, IconX } from "@tabler/icons-react";
import { useId, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

const TEXT_ANIMATION_DIRECTIONS: MotionTextAnimationDirection[] = ["in", "out"];
const TEXT_ORDERS: MotionTextOrder[] = [
  "left-to-right",
  "right-to-left",
  "center-out",
  "random",
];
const TEXT_VERTICAL_ORDERS: MotionTextOrder[] = [
  "top-to-bottom",
  "bottom-to-top",
];
const TEXT_ORDER_TRANSLATION_KEYS: Record<MotionTextOrder, string> = {
  "left-to-right": "leftToRight",
  "right-to-left": "rightToLeft",
  "center-out": "centerOut",
  random: "random",
  "top-to-bottom": "topToBottom",
  "bottom-to-top": "bottomToTop",
};

const TEXT_PROPERTIES: MotionTextProperty[] = [
  "opacity",
  "translate",
  "scale",
  "rotate",
  "filter",
];

const FIELD_CLASS =
  "h-6 w-full min-w-0 rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 !text-[11px] shadow-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]";

export interface MotionTextAnimationEditorProps {
  animations: MotionTextAnimation[];
  onChange: (animations: MotionTextAnimation[]) => void;
  disabled?: boolean;
  t: (key: string) => string;
}

export function MotionTextAnimationEditor({
  animations,
  onChange,
  disabled = false,
  t,
}: MotionTextAnimationEditorProps) {
  const id = useId();
  const shared = animations[0];
  if (!shared) return null;
  const usedProperties = new Set(animations.map(({ property }) => property));
  const order =
    shared.order ??
    (shared.direction === "reverse" ? "right-to-left" : "left-to-right");
  const animationDirection = shared.animationDirection ?? "in";
  const overlapPercent =
    shared.overlapPercent ??
    Math.max(
      0,
      Math.min(
        100,
        Math.round(
          100 * (1 - shared.staggerMs / Math.max(1, shared.durationMs)),
        ),
      ),
    );
  const ignoreSpaces = shared.ignoreSpaces ?? true;
  const supportsVerticalOrder =
    shared.unit === "line" || shared.unit === "paragraph";
  const orderOptions = supportsVerticalOrder
    ? [...TEXT_ORDERS, ...TEXT_VERTICAL_ORDERS]
    : TEXT_ORDERS;
  const availableProperties = TEXT_PROPERTIES.filter(
    (property) => !usedProperties.has(property),
  );

  function updateShared(
    update: Partial<
      Pick<
        MotionTextAnimation,
        | "unit"
        | "direction"
        | "staggerMs"
        | "animationDirection"
        | "order"
        | "overlapPercent"
        | "ignoreSpaces"
      >
    >,
  ) {
    onChange(animations.map((animation) => ({ ...animation, ...update })));
  }

  function updateTrack(
    property: MotionTextProperty,
    update: Partial<MotionTextAnimation>,
  ) {
    onChange(
      animations.map((animation) =>
        animation.property === property
          ? { ...animation, ...update }
          : animation,
      ),
    );
  }

  function updateNumber(
    rawValue: string,
    onValue: (value: number) => void,
    min: number,
    max: number,
  ) {
    if (rawValue.trim() === "") return;
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) return;
    onValue(Math.min(max, Math.max(min, parsed)));
  }

  function addProperty(property: MotionTextProperty) {
    if (usedProperties.has(property)) return;
    const keyframes: MotionTextAnimation["keyframes"] =
      property === "opacity"
        ? [
            { t: 0, value: "0", ease: "ease-out" },
            { t: 1, value: "1" },
          ]
        : property === "translate"
          ? [
              { t: 0, value: "0px", ease: "ease-out" },
              { t: 1, value: "16px" },
            ]
          : property === "scale"
            ? [
                { t: 0, value: "0.8", ease: "ease-out" },
                { t: 1, value: "1" },
              ]
            : property === "rotate"
              ? [
                  { t: 0, value: "-8deg", ease: "ease-out" },
                  { t: 1, value: "0deg" },
                ]
              : [
                  { t: 0, value: "blur(12px)", ease: "ease-out" },
                  { t: 1, value: "blur(0px)" },
                ];
    onChange([
      ...animations,
      {
        ...shared,
        property,
        delayMs: shared.delayMs ?? 0,
        animationDirection,
        order,
        ignoreSpaces,
        durationMs: shared.durationMs,
        keyframes,
      },
    ]);
  }

  return (
    <section className="space-y-2 rounded-md border border-border px-2.5 py-2">
      <header className="flex min-w-0 items-center justify-between gap-2">
        <h3 className="min-w-0 truncate !text-[11px] font-medium">
          {t("designEditor.motion.textAnimation.title")}
        </h3>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="xs"
              aria-label={t(
                "designEditor.motion.textAnimation.addPropertyTrack",
              )}
              disabled={disabled || availableProperties.length === 0}
            >
              <IconPlus aria-hidden="true" className="size-3.5" />
              {t("designEditor.motion.textAnimation.addPropertyTrack")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {availableProperties.map((property) => (
              <DropdownMenuItem
                key={property}
                onSelect={() => addProperty(property)}
              >
                {t(`designEditor.motion.textAnimation.properties.${property}`)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
        <Field
          id={`${id}-unit`}
          label={t("designEditor.motion.textAnimation.unit")}
        >
          <Select
            value={shared.unit}
            disabled={disabled}
            onValueChange={(unit) => {
              const nextUnit = unit as MotionTextUnit;
              updateShared({
                unit: nextUnit,
                ...(order === "top-to-bottom" || order === "bottom-to-top"
                  ? nextUnit === "line" || nextUnit === "paragraph"
                    ? {}
                    : { order: "left-to-right", direction: "forward" }
                  : {}),
              });
            }}
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
          id={`${id}-animation-direction`}
          label={t("designEditor.motion.nativeTextStagger.animationDirection")}
        >
          <Select
            value={animationDirection}
            disabled={disabled}
            onValueChange={(value) =>
              updateShared({
                animationDirection: value as MotionTextAnimationDirection,
              })
            }
          >
            <SelectTrigger
              id={`${id}-animation-direction`}
              aria-label={t(
                "designEditor.motion.nativeTextStagger.animationDirection",
              )}
              className={FIELD_CLASS}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TEXT_ANIMATION_DIRECTIONS.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(
                    `designEditor.motion.nativeTextStagger.${value === "in" ? "enter" : "exit"}`,
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          id={`${id}-order`}
          label={t("designEditor.motion.nativeTextStagger.order")}
        >
          <Select
            value={order}
            disabled={disabled}
            onValueChange={(value) => {
              const nextOrder = value as MotionTextOrder;
              updateShared({
                order: nextOrder,
                direction:
                  nextOrder === "right-to-left" || nextOrder === "bottom-to-top"
                    ? "reverse"
                    : "forward",
              });
            }}
          >
            <SelectTrigger
              id={`${id}-order`}
              aria-label={t("designEditor.motion.nativeTextStagger.order")}
              className={FIELD_CLASS}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {orderOptions.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(
                    `designEditor.motion.nativeTextStagger.orderOptions.${TEXT_ORDER_TRANSLATION_KEYS[value]}`,
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <NumberField
          id={`${id}-overlap`}
          label={t("designEditor.motion.nativeTextStagger.overlap")}
          value={overlapPercent}
          min={0}
          max={100}
          unit="%"
          disabled={disabled}
          onChange={(value) =>
            updateNumber(
              value,
              (nextOverlap) =>
                updateShared({
                  overlapPercent: nextOverlap,
                  staggerMs: Math.round(
                    (shared.durationMs * (100 - nextOverlap)) / 100,
                  ),
                }),
              0,
              100,
            )
          }
        />

        <div className="col-span-2 flex min-h-6 items-center gap-2">
          <Checkbox
            id={`${id}-ignore-spaces`}
            aria-label={t("designEditor.motion.nativeTextStagger.ignoreSpaces")}
            checked={ignoreSpaces}
            disabled={disabled}
            onCheckedChange={(checked) =>
              updateShared({ ignoreSpaces: checked === true })
            }
          />
          <Label
            htmlFor={`${id}-ignore-spaces`}
            className="!text-[10px] text-muted-foreground"
          >
            {t("designEditor.motion.nativeTextStagger.ignoreSpaces")}
          </Label>
        </div>
      </div>

      <div className="space-y-1.5">
        {animations.map((animation, animationIndex) => {
          const propertyId = `${id}-${animation.property}-property`;
          const delayId = `${id}-${animation.property}-delay`;
          const durationId = `${id}-${animation.property}-duration`;
          return (
            <section
              key={animation.property}
              className="space-y-1.5 rounded-md border border-border/70 p-2"
            >
              <header className="flex min-w-0 items-center gap-2">
                <Field
                  id={propertyId}
                  label={t("designEditor.motion.textAnimation.property")}
                >
                  <Select
                    value={animation.property}
                    disabled={disabled}
                    onValueChange={(property) =>
                      updateTrack(animation.property, {
                        property: property as MotionTextProperty,
                      })
                    }
                  >
                    <SelectTrigger
                      id={propertyId}
                      aria-label={t(
                        "designEditor.motion.textAnimation.property",
                      )}
                      className={FIELD_CLASS}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TEXT_PROPERTIES.filter(
                        (property) =>
                          property === animation.property ||
                          !usedProperties.has(property),
                      ).map((property) => (
                        <SelectItem key={property} value={property}>
                          {t(
                            `designEditor.motion.textAnimation.properties.${property}`,
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="mt-3.5"
                  aria-label={`${t("designEditor.motion.textAnimation.removePropertyTrack")}: ${t(`designEditor.motion.textAnimation.properties.${animation.property}`)}`}
                  disabled={disabled}
                  onClick={() =>
                    onChange(
                      animations.filter(
                        (candidate) =>
                          candidate.property !== animation.property,
                      ),
                    )
                  }
                >
                  <IconX aria-hidden="true" className="size-3.5" />
                </Button>
              </header>

              <NumberField
                id={delayId}
                label={t("designEditor.motion.animationStyles.delay")}
                value={animation.delayMs ?? 0}
                min={0}
                max={120_000}
                unit="ms"
                disabled={disabled}
                onChange={(value) =>
                  updateNumber(
                    value,
                    (delayMs) => updateTrack(animation.property, { delayMs }),
                    0,
                    120_000,
                  )
                }
              />

              <NumberField
                id={durationId}
                label={t("designEditor.motion.textAnimation.duration")}
                value={animation.durationMs}
                min={1}
                max={120_000}
                disabled={disabled}
                onChange={(value) =>
                  updateNumber(
                    value,
                    (durationMs) =>
                      updateTrack(animation.property, { durationMs }),
                    1,
                    120_000,
                  )
                }
              />

              <div className="space-y-1.5">
                {animation.keyframes.map((keyframe, keyframeIndex) => (
                  <div
                    key={`${keyframe.t}-${keyframeIndex}`}
                    className="grid grid-cols-[2.25rem_minmax(0,1fr)_minmax(0,0.8fr)] items-center gap-1"
                  >
                    <span className="text-right !text-[10px] tabular-nums text-muted-foreground">
                      {Math.round(keyframe.t * 100)}%
                    </span>
                    <Input
                      type="text"
                      aria-label={`${t("designEditor.motion.textAnimation.keyframeValue")} ${animationIndex + 1}.${keyframeIndex + 1}`}
                      value={keyframe.value}
                      disabled={disabled}
                      className={FIELD_CLASS}
                      onChange={(event) =>
                        updateTrack(animation.property, {
                          keyframes: animation.keyframes.map(
                            (candidate, candidateIndex) =>
                              candidateIndex === keyframeIndex
                                ? {
                                    ...candidate,
                                    value: event.currentTarget.value,
                                  }
                                : candidate,
                          ),
                        })
                      }
                    />
                    <Input
                      type="text"
                      aria-label={`${t("designEditor.motion.textAnimation.keyframeEase")} ${animationIndex + 1}.${keyframeIndex + 1}`}
                      placeholder={t(
                        "designEditor.motion.textAnimation.easePlaceholder",
                      )}
                      value={keyframe.ease ?? ""}
                      disabled={disabled}
                      className={FIELD_CLASS}
                      onChange={(event) =>
                        updateTrack(animation.property, {
                          keyframes: animation.keyframes.map(
                            (candidate, candidateIndex) =>
                              candidateIndex === keyframeIndex
                                ? {
                                    ...candidate,
                                    ease:
                                      event.currentTarget.value || undefined,
                                  }
                                : candidate,
                          ),
                        })
                      }
                    />
                  </div>
                ))}
              </div>
            </section>
          );
        })}
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
    <div className="min-w-0 flex-1 space-y-0.5">
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
  unit,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <Field id={id} label={label}>
      <div className="flex min-w-0 items-center gap-1">
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
        {unit ? (
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {unit}
          </span>
        ) : null}
      </div>
    </Field>
  );
}
