import { useT } from "@agent-native/core/client/i18n";
import type { useT as useTranslator } from "@agent-native/core/client/i18n";
import {
  IconArrowDown,
  IconArrowUp,
  IconPlayerPlay,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

import type {
  SlideTransition,
  SlideTransitionPhase,
} from "../../../shared/slides-2-transition";
import {
  canSetPageTransition,
  effectiveSourceTransition,
  getBuildSelectionAction,
  getSourceBuildDuration,
  getSourceMorphId,
  isSourceMorphIdUnique,
  moveSourceBuildStep,
  readSourceTransition,
  removeSourcePageTransition,
  setSourceBuildDuration,
  setSourceBuildStep,
  setSourceMorphId,
  setSourceTransition,
  transitionForPreset,
  type MotionPreset,
  type SourceSelection,
  type TransitionScope,
} from "./motion-source";

type Translate = ReturnType<typeof useTranslator>;

type Props = {
  sourceTsx: string;
  transition?: SlideTransition;
  selection: SourceSelection | null;
  disabled: boolean;
  t?: Translate;
  onCommit: (
    sourceTsx: string,
    selection?: SourceSelection,
  ) => Promise<boolean>;
};

const EASINGS = ["linear", "ease", "ease-in", "ease-out", "ease-in-out"];
const DEFAULT_EASING = "__default__";

function transitionPreset(
  transition: SlideTransition | undefined,
): MotionPreset | null {
  if (!transition || transition.duration === 0) return "none";
  const keyframes = JSON.stringify([
    transition.enter?.keyframes,
    transition.exit?.keyframes,
  ]);
  if (keyframes.includes("translateX")) return "slide";
  if (keyframes.includes("opacity")) return "fade";
  return null;
}

function boundedDuration(value: number) {
  return Math.max(0, Math.min(10_000, Math.round(value)));
}

function NumberSetting({
  label,
  value,
  disabled,
  min = 0,
  max = 10_000,
  onCommit,
}: {
  label: string;
  value: number;
  disabled: boolean;
  min?: number;
  max?: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const next = Math.max(min, Math.min(max, Math.round(parsed)));
    setDraft(String(next));
    onCommit(next);
  };

  return (
    <label className="flex min-w-0 items-center justify-between gap-3 text-xs text-muted-foreground">
      <span>{label}</span>
      <Input
        aria-label={label}
        className="h-8 w-24 text-end tabular-nums"
        type="number"
        min={min}
        max={max}
        step={10}
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

function EasingSetting({
  label,
  value,
  disabled,
  defaultLabel,
  t,
  onCommit,
}: {
  label: string;
  value: string | undefined;
  disabled: boolean;
  defaultLabel: string;
  t: Translate;
  onCommit: (value: string | undefined) => void;
}) {
  const selected = value ?? DEFAULT_EASING;
  const options = [...EASINGS];
  if (selected && !options.includes(selected)) options.push(selected);
  return (
    <label className="flex min-w-0 items-center justify-between gap-3 text-xs text-muted-foreground">
      <span>{label}</span>
      <Select
        value={selected}
        disabled={disabled}
        onValueChange={(next) =>
          onCommit(next === DEFAULT_EASING ? undefined : next)
        }
      >
        <SelectTrigger className="h-8 w-36 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT_EASING}>{defaultLabel}</SelectItem>
          {options.map((easing) => (
            <SelectItem key={easing} value={easing}>
              {easing}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

export function Slides2MotionPanel({
  sourceTsx,
  transition: runtimeTransition,
  selection,
  disabled,
  t: suppliedT,
  onCommit,
}: Props) {
  const defaultT = useT();
  const t = suppliedT ?? defaultT;
  const moduleTransition = readSourceTransition(sourceTsx, "module");
  const pageTransition = readSourceTransition(sourceTsx, "page");
  const effectiveTransition =
    pageTransition ??
    moduleTransition ??
    effectiveSourceTransition(sourceTsx) ??
    runtimeTransition;
  const [scope, setScope] = useState<TransitionScope>(
    pageTransition ? "page" : "module",
  );
  const [duration, setDuration] = useState(() =>
    effectiveTransition ? boundedDuration(effectiveTransition.duration) : 500,
  );
  const [morphIdDraft, setMorphIdDraft] = useState("");
  const scopedTransition =
    scope === "page"
      ? (pageTransition ?? moduleTransition ?? effectiveTransition)
      : moduleTransition;
  const activeTransition = scopedTransition;
  const preset = transitionPreset(activeTransition);
  const buildAction = getBuildSelectionAction(sourceTsx, selection);
  const canPageOverride = canSetPageTransition(sourceTsx);
  const selectedMorphId = getSourceMorphId(sourceTsx, selection);
  const currentBuildDuration = getSourceBuildDuration(sourceTsx, selection);

  useEffect(() => {
    if (activeTransition) {
      setDuration(boundedDuration(activeTransition.duration));
    }
  }, [sourceTsx, activeTransition?.duration, scope]);

  useEffect(
    () => setMorphIdDraft(selectedMorphId),
    [selectedMorphId, selection],
  );

  const saveSource = async (
    nextSource: string | null,
    nextSelection: SourceSelection | undefined = selection ?? undefined,
  ) => {
    if (nextSource && nextSource !== sourceTsx) {
      await onCommit(nextSource, nextSelection);
    }
  };

  const saveTransition = async (
    nextTransition: SlideTransition,
    targetScope = scope,
  ) => {
    await saveSource(
      setSourceTransition(sourceTsx, nextTransition, targetScope),
    );
  };

  const transitionBase = () =>
    activeTransition ?? transitionForPreset("fade", duration);

  const updateTransition = async (
    update: (current: SlideTransition) => SlideTransition,
  ) => {
    await saveTransition(update(transitionBase()));
  };

  const changePreset = async (nextPreset: MotionPreset) => {
    const nextDuration = duration || 500;
    setDuration(nextDuration);
    const next = transitionForPreset(nextPreset, nextDuration);
    await saveTransition(next);
  };

  const updatePhase = async (
    phaseName: "enter" | "exit",
    update: (phase: SlideTransitionPhase) => SlideTransitionPhase,
  ) => {
    const current = transitionBase();
    const defaults = transitionForPreset(
      preset === "slide" ? "slide" : "fade",
      current.duration,
    );
    const fallback = defaults[phaseName];
    const phase = current[phaseName] ?? fallback;
    if (!phase) return;
    await updateTransition((transition) => ({
      ...transition,
      [phaseName]: update(phase),
    }));
  };

  const setBuild = async () => {
    if (!selection || buildAction === "unsupported") return;
    const result = setSourceBuildStep(
      sourceTsx,
      selection,
      buildAction !== "remove",
    );
    if (result) await saveSource(result.sourceTsx, result.selection);
  };

  const setBuildDuration = (nextDuration: number) => {
    if (!selection) return;
    void saveSource(setSourceBuildDuration(sourceTsx, selection, nextDuration));
  };

  const moveBuild = (direction: "earlier" | "later") => {
    if (!selection) return;
    const result = moveSourceBuildStep(sourceTsx, selection, direction);
    if (result) void saveSource(result.sourceTsx, result.selection);
  };

  const setMorphId = (id: string | null) => {
    if (!selection) return;
    const result = setSourceMorphId(sourceTsx, selection, id);
    if (result) void saveSource(result.sourceTsx, result.selection);
  };

  const morph = activeTransition?.morph;
  const morphSettings = morph && typeof morph === "object" ? morph : undefined;
  const morphEnabled = Boolean(morph);
  const motionEnabled =
    Boolean(activeTransition) && activeTransition?.duration !== 0;

  return (
    <div className="flex h-full flex-col gap-5 overflow-auto p-4">
      <section className="space-y-3">
        <h3 className="text-sm font-medium">{t("editorToolbar.transition")}</h3>
        <label className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>{t("slides2Editor.motionScope")}</span>
          <Select
            value={scope}
            onValueChange={(next) => setScope(next as TransitionScope)}
          >
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="module">
                {t("slides2Editor.moduleDefault")}
              </SelectItem>
              <SelectItem value="page" disabled={!canPageOverride}>
                {t("slides2Editor.pageOverride")}
              </SelectItem>
            </SelectContent>
          </Select>
        </label>
        {scope === "page" && pageTransition ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() =>
              void saveSource(removeSourcePageTransition(sourceTsx))
            }
          >
            {t("slides2Editor.useModuleDefault")}
          </Button>
        ) : null}
        <div
          role="group"
          aria-label={t("editorToolbar.transition")}
          className="grid grid-cols-3 gap-2"
        >
          {(["none", "fade", "slide"] as const).map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={preset === value ? "secondary" : "outline"}
              aria-pressed={preset === value}
              disabled={disabled || (scope === "page" && !canPageOverride)}
              onClick={() => void changePreset(value)}
            >
              {t(
                value === "slide"
                  ? "editorToolbar.transition_slide_from_right"
                  : "editorToolbar.transition_" + value,
              )}
            </Button>
          ))}
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{t("slides2Editor.transitionDuration")}</span>
            <span className="tabular-nums">
              {t("editorToolbar.transition_seconds", {
                seconds: (duration / 1000).toFixed(2),
              })}
            </span>
          </div>
          <Slider
            value={[duration]}
            min={0}
            max={10_000}
            step={50}
            disabled={disabled || preset === "none"}
            thumbAriaLabel={t("slides2Editor.transitionDuration")}
            aria-label={t("slides2Editor.transitionDuration")}
            onValueChange={(value) => {
              if (typeof value[0] === "number") setDuration(value[0]);
            }}
            onValueCommit={(value) => {
              const nextDuration = value[0];
              if (typeof nextDuration === "number" && motionEnabled) {
                void updateTransition((current) => ({
                  ...current,
                  duration: boundedDuration(nextDuration),
                  ...(current.enter
                    ? {
                        enter: {
                          ...current.enter,
                          duration:
                            current.enter.duration === current.duration
                              ? boundedDuration(nextDuration)
                              : current.enter.duration,
                        },
                      }
                    : {}),
                  ...(current.exit
                    ? {
                        exit: {
                          ...current.exit,
                          duration:
                            current.exit.duration === current.duration
                              ? boundedDuration(nextDuration)
                              : current.exit.duration,
                        },
                      }
                    : {}),
                }));
              }
            }}
          />
        </div>
        {motionEnabled && activeTransition ? (
          <>
            <EasingSetting
              label={t("slides2Editor.transitionEasing")}
              value={activeTransition.easing}
              defaultLabel={t("slides2Editor.defaultEasing")}
              disabled={disabled}
              t={t}
              onCommit={(value) =>
                void updateTransition((current) => ({
                  ...current,
                  ...(value ? { easing: value } : { easing: undefined }),
                }))
              }
            />
            {(["enter", "exit"] as const).map((phaseName) => {
              const phase = activeTransition[phaseName];
              const fallback = transitionForPreset(
                preset === "slide" ? "slide" : "fade",
                activeTransition.duration,
              )[phaseName];
              const phaseValue = phase ?? fallback;
              if (!phaseValue) return null;
              const phaseLabel = t(
                phaseName === "enter"
                  ? "slides2Editor.transitionEnter"
                  : "slides2Editor.transitionExit",
              );
              return (
                <div
                  key={phaseName}
                  className="space-y-2 rounded-md border p-3"
                >
                  <h4 className="text-xs font-medium text-foreground">
                    {phaseLabel}
                  </h4>
                  <NumberSetting
                    label={t("slides2Editor.transitionDuration")}
                    value={phaseValue.duration ?? activeTransition.duration}
                    disabled={disabled}
                    onCommit={(value) =>
                      void updatePhase(phaseName, (current) => ({
                        ...current,
                        duration: value,
                      }))
                    }
                  />
                  <NumberSetting
                    label={t("slides2Editor.transitionDelay")}
                    value={phaseValue.delay ?? 0}
                    min={-10_000}
                    max={10_000}
                    disabled={disabled}
                    onCommit={(value) =>
                      void updatePhase(phaseName, (current) => ({
                        ...current,
                        delay: value,
                      }))
                    }
                  />
                  <EasingSetting
                    label={t("slides2Editor.transitionEasing")}
                    value={phaseValue.easing}
                    defaultLabel={t("slides2Editor.defaultEasing")}
                    disabled={disabled}
                    t={t}
                    onCommit={(value) =>
                      void updatePhase(phaseName, (current) => ({
                        ...current,
                        ...(value ? { easing: value } : { easing: undefined }),
                      }))
                    }
                  />
                </div>
              );
            })}
            <div className="flex items-center justify-between gap-3 rounded-md border p-3 text-xs">
              <span>{t("slides2Editor.throughBackground")}</span>
              <Switch
                aria-label={t("slides2Editor.throughBackground")}
                checked={Boolean(activeTransition.throughBackground)}
                disabled={disabled}
                onCheckedChange={(checked) =>
                  void updateTransition((current) => ({
                    ...current,
                    throughBackground: checked,
                  }))
                }
              />
            </div>
            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span>{t("slides2Editor.morph")}</span>
                <Switch
                  aria-label={t("slides2Editor.morph")}
                  checked={morphEnabled}
                  disabled={disabled}
                  onCheckedChange={(checked) =>
                    void updateTransition((current) => ({
                      ...current,
                      morph: checked
                        ? {
                            duration: current.duration,
                            ...(current.easing
                              ? { easing: current.easing }
                              : {}),
                          }
                        : false,
                    }))
                  }
                />
              </div>
              {morphEnabled ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    {t("slides2Editor.morphDescription")}
                  </p>
                  <NumberSetting
                    label={t("slides2Editor.morphDuration")}
                    value={morphSettings?.duration ?? activeTransition.duration}
                    disabled={disabled}
                    onCommit={(value) =>
                      void updateTransition((current) => ({
                        ...current,
                        morph: {
                          duration: value,
                          ...(morphSettings?.easing
                            ? { easing: morphSettings.easing }
                            : {}),
                          ...(morphSettings?.delay !== undefined
                            ? { delay: morphSettings.delay }
                            : {}),
                        },
                      }))
                    }
                  />
                  <NumberSetting
                    label={t("slides2Editor.morphDelay")}
                    value={morphSettings?.delay ?? 0}
                    min={-10_000}
                    max={10_000}
                    disabled={disabled}
                    onCommit={(value) =>
                      void updateTransition((current) => ({
                        ...current,
                        morph: {
                          duration: morphSettings?.duration ?? current.duration,
                          ...(morphSettings?.easing
                            ? { easing: morphSettings.easing }
                            : {}),
                          delay: value,
                        },
                      }))
                    }
                  />
                  <EasingSetting
                    label={t("slides2Editor.morphEasing")}
                    value={morphSettings?.easing}
                    defaultLabel={t("slides2Editor.defaultEasing")}
                    disabled={disabled}
                    t={t}
                    onCommit={(value) =>
                      void updateTransition((current) => ({
                        ...current,
                        morph: {
                          duration: morphSettings?.duration ?? current.duration,
                          ...(value ? { easing: value } : {}),
                          ...(morphSettings?.delay !== undefined
                            ? { delay: morphSettings.delay }
                            : {}),
                        },
                      }))
                    }
                  />
                </>
              ) : null}
            </div>
          </>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {t("slides2Editor.respectReducedMotion")}
        </p>
      </section>

      <section className="space-y-3 border-t pt-4">
        <h3 className="text-sm font-medium">{t("slides2Editor.builds")}</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full justify-start"
          disabled={disabled || buildAction === "unsupported"}
          onClick={() => void setBuild()}
        >
          {buildAction === "remove" ? (
            <IconTrash className="me-2 size-4" aria-hidden="true" />
          ) : (
            <IconPlus className="me-2 size-4" aria-hidden="true" />
          )}
          {t(
            buildAction === "remove"
              ? "slides2Editor.removeBuild"
              : "slides2Editor.addBuild",
          )}
        </Button>
        {buildAction === "remove" ? (
          <>
            <NumberSetting
              label={t("slides2Editor.buildDuration")}
              value={currentBuildDuration}
              disabled={disabled}
              onCommit={setBuildDuration}
            />
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => moveBuild("earlier")}
              >
                <IconArrowUp className="me-2 size-4" aria-hidden="true" />
                {t("slides2Editor.moveBuildEarlier")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => moveBuild("later")}
              >
                <IconArrowDown className="me-2 size-4" aria-hidden="true" />
                {t("slides2Editor.moveBuildLater")}
              </Button>
            </div>
          </>
        ) : null}
        <div className="space-y-2 border-t pt-4">
          <h4 className="text-sm font-medium">{t("slides2Editor.morph")}</h4>
          <label className="flex flex-col gap-2 text-xs text-muted-foreground">
            <span>{t("slides2Editor.morphId")}</span>
            <Input
              value={morphIdDraft}
              disabled={disabled || !selection}
              placeholder={t("slides2Editor.morphIdPlaceholder")}
              onChange={(event) => setMorphIdDraft(event.currentTarget.value)}
            />
          </label>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={
                disabled ||
                !selection ||
                !/^[A-Za-z0-9._:-]{1,100}$/.test(morphIdDraft.trim()) ||
                !isSourceMorphIdUnique(
                  sourceTsx,
                  selection,
                  morphIdDraft.trim(),
                )
              }
              onClick={() => setMorphId(morphIdDraft)}
            >
              {t("slides2Editor.setMorphId")}
            </Button>
            {selectedMorphId ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => setMorphId(null)}
              >
                {t("slides2Editor.removeMorph")}
              </Button>
            ) : null}
          </div>
        </div>
        {selection ? null : (
          <p className="text-xs text-muted-foreground">
            <IconPlayerPlay
              className="me-1 inline size-3.5"
              aria-hidden="true"
            />
            {t("slides2Editor.selectElement")}
          </p>
        )}
      </section>
    </div>
  );
}
