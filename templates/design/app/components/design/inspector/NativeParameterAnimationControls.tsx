import { useT } from "@agent-native/core/client/i18n";
import type {
  EffectColor,
  EffectDefinition,
  EffectProperty,
  EffectValue,
} from "@shared/native-effects";
import {
  nativeParameterCanAnimate,
  type NativeParameterAnimation,
  type NativeParameterEasing,
} from "@shared/native-parameter-animation";
import { IconChevronDown, IconPlus, IconTrash } from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { nativeCatalogPropertyKey } from "./native-catalog-display";
import { NativeEffectColorControl } from "./NativeEffectColorControl";
import { NativeNumericScrub } from "./NativeNumericScrub";

const EASINGS: NativeParameterEasing[] = [
  "linear",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "step",
];

function alternateValue(
  property: EffectProperty,
  current: EffectValue,
): EffectValue {
  if (property.type === "bool") return !current;
  if (property.type === "enum") {
    const index = property.options.indexOf(current as string);
    return property.options[(index + 1) % property.options.length];
  }
  if (property.type === "color") {
    const color = current as EffectColor;
    return {
      ...color,
      components: color.components.map((value) => 1 - value) as [
        number,
        number,
        number,
      ],
    };
  }
  if (property.type === "vec2") {
    const pair = current as [number, number];
    const step = property.step ?? 0.1;
    return [
      Math.min(property.max ?? 1, Math.max(property.min ?? 0, pair[0] + step)),
      Math.min(property.max ?? 1, Math.max(property.min ?? 0, pair[1] + step)),
    ];
  }
  if (property.type === "float" || property.type === "int") {
    const value = current as number;
    const min = property.min ?? 0;
    const max = property.max ?? Math.max(1, value + 1);
    const target = value < (min + max) / 2 ? max : min;
    return property.type === "int" ? Math.round(target) : target;
  }
  return current;
}

export function NativeParameterAnimationControls({
  definition,
  params,
  animation,
  disabled,
  previewTime,
  onChange,
  onPreview,
}: {
  definition: EffectDefinition;
  params: Record<string, EffectValue>;
  animation?: NativeParameterAnimation;
  disabled: boolean;
  previewTime: number;
  onChange: (animation: NativeParameterAnimation | null) => void;
  onPreview: (time: number) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string>("");
  const available = Object.entries(definition.properties).filter(([name]) =>
    nativeParameterCanAnimate(definition, name),
  );
  if (!available.length) return null;
  const selectedName =
    selected || Object.keys(animation?.tracks ?? {})[0] || available[0][0];
  const property = definition.properties[selectedName];
  const track = animation?.tracks[selectedName];
  const duration = animation?.duration ?? 2;
  const label = (name: string) => {
    const source = definition.properties[name]?.label ?? name;
    const key = nativeCatalogPropertyKey(definition, source);
    return key ? t(key) : source;
  };
  const write = (next: NativeParameterAnimation | null) => onChange(next);
  const setEndpoint = (index: number, value: EffectValue) => {
    if (!animation || !track) return;
    const keys = [...track.keys];
    const at = index === 0 ? 0 : keys.length - 1;
    keys[at] = { ...keys[at], value };
    write({
      ...animation,
      tracks: { ...animation.tracks, [selectedName]: { keys } },
    });
  };
  const addTrack = () => {
    if (!property || track) return;
    const start = params[selectedName] ?? property.default;
    const next = animation ?? { duration: 2, loop: true, tracks: {} };
    write({
      ...next,
      tracks: {
        ...next.tracks,
        [selectedName]: {
          keys: [
            {
              time: 0,
              value: start,
              easing:
                property.type === "bool" || property.type === "enum"
                  ? "step"
                  : "linear",
            },
            { time: next.duration, value: alternateValue(property, start) },
          ],
        },
      },
    });
  };
  const removeTrack = () => {
    if (!animation || !track) return;
    const tracks = { ...animation.tracks };
    delete tracks[selectedName];
    write(Object.keys(tracks).length ? { ...animation, tracks } : null);
  };
  const changeDuration = (duration: number) => {
    if (
      !animation ||
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > 60
    )
      return;
    const tracks = Object.fromEntries(
      Object.entries(animation.tracks).map(([name, current]) => [
        name,
        {
          keys: current.keys.map((key, index) => ({
            ...key,
            time:
              index === current.keys.length - 1
                ? duration
                : (key.time * duration) / animation.duration,
          })),
        },
      ]),
    );
    write({ ...animation, duration, tracks });
  };
  const endpoint = (index: number) => {
    if (!property || !track) return null;
    const key = track.keys[index === 0 ? 0 : track.keys.length - 1];
    const name = t(
      index === 0
        ? "editPanel.shaders.nativeAnimationStart"
        : "editPanel.shaders.nativeAnimationEnd",
    );
    const value = key.value;
    if (property.type === "float" || property.type === "int")
      return (
        <NativeNumericScrub
          label={name}
          value={value as number}
          min={property.min}
          max={property.max}
          step={property.step ?? (property.type === "int" ? 1 : 0.01)}
          disabled={disabled}
          onChange={(next, meta) => {
            if (meta.phase === "commit")
              setEndpoint(
                index,
                property.type === "int" ? Math.round(next) : next,
              );
          }}
          labelClassName="w-20"
          inputClassName="h-6"
        />
      );
    if (property.type === "vec2")
      return (
        <div className="grid gap-1">
          {([0, 1] as const).map((axis) => (
            <NativeNumericScrub
              key={axis}
              label={`${name} ${axis === 0 ? "X" : "Y"}`}
              value={(value as [number, number])[axis]}
              min={property.min}
              max={property.max}
              step={property.step ?? 0.01}
              disabled={disabled}
              onChange={(next, meta) => {
                if (meta.phase === "commit") {
                  const pair = [...(value as [number, number])] as [
                    number,
                    number,
                  ];
                  pair[axis] = next;
                  setEndpoint(index, pair);
                }
              }}
              labelClassName="w-20"
              inputClassName="h-6"
            />
          ))}
        </div>
      );
    if (property.type === "color")
      return (
        <NativeEffectColorControl
          label={name}
          value={value as EffectColor}
          disabled={disabled}
          onChange={(next, phase) => {
            if (phase === "commit") setEndpoint(index, next);
          }}
        />
      );
    if (property.type === "bool")
      return (
        <label className="flex h-7 items-center justify-between gap-2 text-xs">
          <span>{name}</span>
          <Switch
            checked={value as boolean}
            disabled={disabled}
            onCheckedChange={(next) => setEndpoint(index, next)}
          />
        </label>
      );
    if (property.type === "enum")
      return (
        <label className="flex h-7 items-center justify-between gap-2 text-xs">
          <span>{name}</span>
          <Select
            value={value as string}
            disabled={disabled}
            onValueChange={(next) => setEndpoint(index, next)}
          >
            <SelectTrigger className="h-6 w-28 !text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {property.options.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      );
    return null;
  };
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 text-xs text-muted-foreground"
        >
          <span>{t("editPanel.shaders.nativeAnimation")}</span>
          <IconChevronDown className={cn("size-3.5", open && "rotate-180")} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="grid gap-2 pt-2">
        <div className="flex items-center gap-1">
          <Select value={selectedName} onValueChange={setSelected}>
            <SelectTrigger className="h-7 min-w-0 flex-1 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {available.map(([name]) => (
                <SelectItem key={name} value={name}>
                  {label(name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {track ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              disabled={disabled}
              aria-label={t("editPanel.shaders.nativeAnimationRemove")}
              onClick={removeTrack}
            >
              <IconTrash className="size-3.5" />
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={
                disabled || Object.keys(animation?.tracks ?? {}).length >= 16
              }
              onClick={addTrack}
            >
              <IconPlus className="mr-1 size-3.5" />
              {t("editPanel.shaders.nativeAnimateProperty")}
            </Button>
          )}
        </div>
        {track && animation && (
          <>
            <NativeNumericScrub
              label={t("designEditor.motion.duration")}
              value={animation.duration}
              min={0.01}
              max={60}
              step={0.01}
              disabled={disabled}
              onChange={(next, meta) => {
                if (meta.phase === "commit") changeDuration(next);
              }}
              labelClassName="w-20"
              inputClassName="h-6"
            />
            <label className="flex h-7 items-center justify-between gap-2 text-xs">
              <span>{t("designEditor.motion.loop")}</span>
              <Switch
                checked={animation.loop}
                disabled={disabled}
                onCheckedChange={(loop) => write({ ...animation, loop })}
              />
            </label>
            {endpoint(0)}
            {endpoint(1)}
            {property.type !== "bool" && property.type !== "enum" && (
              <label className="flex h-7 items-center justify-between gap-2 text-xs">
                <span>{t("editPanel.shaders.nativeAnimationEasing")}</span>
                <Select
                  value={track.keys[0].easing ?? "linear"}
                  disabled={disabled}
                  onValueChange={(easing) => {
                    const keys = [...track.keys];
                    keys[0] = {
                      ...keys[0],
                      easing: easing as NativeParameterEasing,
                    };
                    write({
                      ...animation,
                      tracks: { ...animation.tracks, [selectedName]: { keys } },
                    });
                  }}
                >
                  <SelectTrigger className="h-6 w-28 !text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EASINGS.map((easing) => (
                      <SelectItem key={easing} value={easing}>
                        {t(
                          `editPanel.shaders.nativeAnimation${easing === "linear" ? "Linear" : easing === "ease-in" ? "EaseIn" : easing === "ease-out" ? "EaseOut" : easing === "ease-in-out" ? "EaseInOut" : "Step"}` as "editPanel.shaders.nativeAnimationLinear",
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            )}
            <div className="grid gap-1">
              <span className="text-xs text-muted-foreground">
                {t("editPanel.shaders.nativeAnimationPreview")}
              </span>
              <Slider
                value={[Math.min(previewTime, animation.duration)]}
                min={0}
                max={animation.duration}
                step={0.01}
                disabled={disabled}
                onValueCommit={([time]) => onPreview(time ?? 0)}
              />
            </div>
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
