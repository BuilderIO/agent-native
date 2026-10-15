import type {
  MotionAnimationStyleCategory,
  MotionAnimationStyleDefinition,
  MotionAnimationStyleMetadata,
  MotionAnimationStyleTrackDefinition,
} from "@shared/motion-animation-styles";
import {
  IconEye,
  IconEyeOff,
  IconMinus,
  IconPlus,
  IconSearch,
  IconTimelineEvent,
  IconX,
} from "@tabler/icons-react";
import { useMemo, useState, type FormEvent } from "react";

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
import type { MotionAnimationStyle } from "@/pages/design-editor/motion-animation-style";

const STYLE_CATEGORIES: MotionAnimationStyleCategory[] = [
  "basic",
  "enter",
  "cycle",
  "exit",
];

const CATEGORY_KEYS: Record<MotionAnimationStyleCategory, string> = {
  basic: "designEditor.motion.animationStyles.basic",
  enter: "designEditor.motion.animationStyles.enter",
  cycle: "designEditor.motion.animationStyles.cycle",
  exit: "designEditor.motion.animationStyles.exit",
};

const ANIMATION_TYPES = [
  { id: "text", key: "text", properties: [] as string[] },
  { id: "position", key: "position", properties: ["translate"] },
  { id: "scale", key: "scale", properties: ["scale"] },
  { id: "rotation", key: "rotation", properties: ["rotate"] },
  { id: "size", key: "size", properties: ["width", "height"] },
  { id: "opacity", key: "opacity", properties: ["opacity"] },
  { id: "path", key: "path", properties: ["translate"] },
] as const;

export interface AnimationStyleBrowserProps {
  styles: MotionAnimationStyleDefinition[];
  basicStyles: MotionAnimationStyle[];
  selectedTargetTracks: MotionAnimationStyleTrackDefinition[];
  disabled?: boolean;
  onApply: (style: MotionAnimationStyleDefinition) => void;
  onApplyPreset: (style: MotionAnimationStyle) => void;
  onSaveStyle: (
    metadata: MotionAnimationStyleMetadata,
    tracks: MotionAnimationStyleTrackDefinition[],
  ) => void;
  onClose: () => void;
  t: (key: string) => string;
}

export function AnimationStyleBrowser({
  styles,
  basicStyles,
  selectedTargetTracks,
  disabled = false,
  onApply,
  onApplyPreset,
  onSaveStyle,
  onClose,
  t,
}: AnimationStyleBrowserProps) {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<
    MotionAnimationStyleCategory | "all"
  >("all");
  const [createOpen, setCreateOpen] = useState(false);

  const query = search.trim().toLocaleLowerCase();
  const filteredBasicStyles = useMemo(
    () =>
      basicStyles.filter((style) => {
        if (categoryFilter !== "all" && categoryFilter !== "basic") {
          return false;
        }
        return !query || style.label.toLocaleLowerCase().includes(query);
      }),
    [basicStyles, categoryFilter, query],
  );
  const filteredStyles = useMemo(
    () =>
      styles.filter((style) => {
        if (categoryFilter !== "all" && style.category !== categoryFilter) {
          return false;
        }
        if (!query) return true;
        return [
          style.name,
          style.description ?? "",
          style.category,
          ...style.tracks.map((track) => track.property),
        ].some((value) => value.toLocaleLowerCase().includes(query));
      }),
    [categoryFilter, query, styles],
  );
  const visibleCategories =
    categoryFilter === "all" ? STYLE_CATEGORIES : [categoryFilter];
  const availableTrackTypes = useMemo(
    () =>
      ANIMATION_TYPES.map((type) => ({
        ...type,
        available:
          type.id === "path"
            ? selectedTargetTracks.some((track) =>
                track.keyframes.some((keyframe) => keyframe.motionPath),
              )
            : type.properties.length > 0 &&
              selectedTargetTracks.some((track) =>
                (type.properties as readonly string[]).includes(track.property),
              ),
      })),
    [selectedTargetTracks],
  );

  function closeCreate(nextOpen: boolean) {
    setCreateOpen(nextOpen);
  }

  function saveStyle(
    metadata: MotionAnimationStyleMetadata,
    tracks: MotionAnimationStyleTrackDefinition[],
  ) {
    onSaveStyle(metadata, tracks);
    setCreateOpen(false);
  }

  return (
    <section
      aria-label={t("designEditor.motion.animationStyles.title")}
      className="flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-background"
    >
      <header className="flex items-center justify-between gap-2 border-b border-border px-2.5 py-2">
        <h2 className="min-w-0 truncate text-xs font-medium">
          {t("designEditor.motion.animationStyles.title")}
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          <Popover open={createOpen} onOpenChange={closeCreate}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t("designEditor.motion.animationStyles.create")}
                disabled={disabled || selectedTargetTracks.length === 0}
              >
                <IconPlus aria-hidden="true" className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" side="left" className="w-[300px] p-0">
              <CreateStyleForm
                disabled={disabled}
                selectedTargetTracks={selectedTargetTracks}
                availableTrackTypes={availableTrackTypes}
                onSaveStyle={saveStyle}
                t={t}
              />
            </PopoverContent>
          </Popover>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("designEditor.motion.animationStyles.close")}
            onClick={onClose}
          >
            <IconX aria-hidden="true" className="size-4" />
          </Button>
        </div>
      </header>

      <div className="space-y-2 border-b border-border px-2.5 py-2">
        <div className="relative">
          <IconSearch
            aria-hidden="true"
            className="pointer-events-none absolute start-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label={t("designEditor.motion.animationStyles.search")}
            placeholder={t(
              "designEditor.motion.animationStyles.searchPlaceholder",
            )}
            className="h-8 ps-7 text-xs"
            disabled={disabled}
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
        </div>
        <Select
          value={categoryFilter}
          disabled={disabled}
          onValueChange={(value) =>
            setCategoryFilter(value as MotionAnimationStyleCategory | "all")
          }
        >
          <SelectTrigger
            aria-label={t("designEditor.motion.animationStyles.filter")}
            className="h-7 w-full text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {t("designEditor.motion.animationStyles.all")}
            </SelectItem>
            {STYLE_CATEGORIES.map((category) => (
              <SelectItem key={category} value={category}>
                {t(CATEGORY_KEYS[category])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div
        aria-label={t("designEditor.motion.animationStyles.list")}
        className="min-h-0 flex-1 overflow-y-auto px-2 py-1"
        role="group"
      >
        {visibleCategories.map((category) => {
          const categoryStyles = filteredStyles.filter(
            (style) => style.category === category,
          );
          const includeBasicPresets = category === "basic";
          const hasRows =
            (includeBasicPresets && filteredBasicStyles.length > 0) ||
            categoryStyles.length > 0;
          if (!hasRows) return null;
          return (
            <section key={category} className="pb-1">
              <h3 className="px-1.5 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {t(CATEGORY_KEYS[category])}
              </h3>
              {includeBasicPresets ? (
                <ul className="space-y-0.5">
                  {filteredBasicStyles.map((style) => (
                    <li key={`preset:${style.preset.property}`}>
                      <button
                        type="button"
                        disabled={disabled}
                        className="flex w-full min-w-0 items-center gap-2 rounded-sm px-1.5 py-1.5 text-start text-xs outline-none transition-colors hover:bg-accent/60 focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                        onClick={() => onApplyPreset(style)}
                      >
                        <IconTimelineEvent
                          aria-hidden="true"
                          className="size-3.5 shrink-0 text-muted-foreground"
                        />
                        <span className="truncate">{style.label}</span>
                      </button>
                    </li>
                  ))}
                  <li>
                    <button
                      type="button"
                      disabled
                      className="flex w-full min-w-0 items-center gap-2 rounded-sm px-1.5 py-1.5 text-start text-xs text-muted-foreground opacity-50"
                    >
                      <IconTimelineEvent
                        aria-hidden="true"
                        className="size-3.5 shrink-0"
                      />
                      <span>
                        {t("designEditor.motion.animationStyles.path")}
                      </span>
                    </button>
                  </li>
                </ul>
              ) : null}
              {categoryStyles.length > 0 ? (
                <ul className="space-y-0.5">
                  {categoryStyles.map((style) => (
                    <li key={style.id}>
                      <button
                        id={style.id}
                        type="button"
                        disabled={disabled}
                        className="flex w-full min-w-0 items-start gap-2 rounded-sm px-1.5 py-1.5 text-start text-xs outline-none transition-colors hover:bg-accent/60 focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                        onClick={() => onApply(style)}
                      >
                        <IconTimelineEvent
                          aria-hidden="true"
                          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">
                            {style.name}
                          </span>
                          {style.description ? (
                            <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                              {style.description}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          );
        })}
        {filteredBasicStyles.length === 0 && filteredStyles.length === 0 ? (
          <p className="px-1 py-4 text-center text-xs text-muted-foreground">
            {query
              ? t("designEditor.motion.animationStyles.noResults")
              : t("designEditor.motion.animationStyles.empty")}
          </p>
        ) : null}
      </div>
    </section>
  );
}

interface CreateStyleFormProps {
  disabled: boolean;
  selectedTargetTracks: MotionAnimationStyleTrackDefinition[];
  availableTrackTypes: Array<{
    id: (typeof ANIMATION_TYPES)[number]["id"];
    key: string;
    properties: readonly string[];
    available: boolean;
  }>;
  onSaveStyle: (
    metadata: MotionAnimationStyleMetadata,
    tracks: MotionAnimationStyleTrackDefinition[],
  ) => void;
  t: (key: string) => string;
}

function CreateStyleForm({
  disabled,
  selectedTargetTracks,
  availableTrackTypes,
  onSaveStyle,
  t,
}: CreateStyleFormProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tracks, setTracks] = useState<MotionAnimationStyleTrackDefinition[]>(
    [],
  );
  const [addAnimationOpen, setAddAnimationOpen] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedName = name.trim();
    if (!normalizedName || tracks.length === 0 || disabled) return;
    onSaveStyle(
      {
        name: normalizedName,
        category: "basic",
        ...(description.trim() ? { description: description.trim() } : {}),
      },
      tracks,
    );
  }

  function addAnimation(typeId: string) {
    const type = availableTrackTypes.find(
      (candidate) => candidate.id === typeId,
    );
    if (!type?.available) return;
    const matchingTracks = selectedTargetTracks.filter((track) =>
      type.id === "path"
        ? track.keyframes.some((keyframe) => keyframe.motionPath)
        : (type.properties as readonly string[]).includes(track.property),
    );
    setTracks((current) => {
      const existingProperties = new Set(
        current.map((track) => track.property),
      );
      return [
        ...current,
        ...matchingTracks
          .filter((track) => !existingProperties.has(track.property))
          .map(cloneStyleTrack),
      ];
    });
    setAddAnimationOpen(false);
  }

  return (
    <form className="space-y-3 p-3" onSubmit={handleSubmit}>
      <h2 className="text-xs font-medium">
        {t("designEditor.motion.animationStyles.createTitle")}
      </h2>
      <div className="space-y-1.5">
        <Label htmlFor="motion-style-name">
          {t("designEditor.motion.animationStyles.name")}
        </Label>
        <Input
          id="motion-style-name"
          autoFocus
          maxLength={120}
          required
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="motion-style-description">
          {t("designEditor.motion.animationStyles.description")}
        </Label>
        <Input
          id="motion-style-description"
          maxLength={500}
          value={description}
          onChange={(event) => setDescription(event.currentTarget.value)}
        />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium">
            {t("designEditor.motion.animationStyles.animation")}
          </h3>
          <Popover open={addAnimationOpen} onOpenChange={setAddAnimationOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t(
                  "designEditor.motion.animationStyles.addAnimation",
                )}
                disabled={disabled}
              >
                <IconPlus aria-hidden="true" className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" side="bottom" className="w-44 p-1">
              <div className="flex flex-col" role="menu">
                {availableTrackTypes.map((type) => (
                  <button
                    key={type.id}
                    type="button"
                    role="menuitem"
                    disabled={disabled || !type.available}
                    className="rounded-sm px-2 py-1.5 text-left text-xs outline-none hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
                    onClick={() => addAnimation(type.id)}
                  >
                    {t(`designEditor.motion.animationStyles.${type.key}`)}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
        {tracks.length === 0 ? (
          <p className="rounded-sm border border-dashed border-border px-2 py-3 text-center text-xs text-muted-foreground">
            {t("designEditor.motion.animationStyles.noAnimations")}
          </p>
        ) : (
          <ul className="space-y-1">
            {tracks.map((track, index) => {
              const hidden = track.enabled === false;
              return (
                <li
                  key={`${track.property}:${index}`}
                  className="flex items-center gap-1 rounded-sm border border-border px-2 py-1"
                >
                  <span className="min-w-0 flex-1 truncate text-xs">
                    {animationLabel(track.property, t)}
                  </span>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`${t(hidden ? "designEditor.motion.animationStyles.show" : "designEditor.motion.animationStyles.hide")} ${animationLabel(track.property, t)}`}
                    onClick={() =>
                      setTracks((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, enabled: hidden }
                            : item,
                        ),
                      )
                    }
                  >
                    {hidden ? (
                      <IconEyeOff aria-hidden="true" className="size-3.5" />
                    ) : (
                      <IconEye aria-hidden="true" className="size-3.5" />
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`${t("designEditor.motion.animationStyles.removeAnimation")} ${animationLabel(track.property, t)}`}
                    onClick={() =>
                      setTracks((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                  >
                    <IconMinus aria-hidden="true" className="size-3.5" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="flex justify-end pt-1">
        <Button
          type="submit"
          size="sm"
          disabled={disabled || !name.trim() || tracks.length === 0}
        >
          {t("designEditor.motion.animationStyles.save")}
        </Button>
      </div>
    </form>
  );
}

function cloneStyleTrack(
  track: MotionAnimationStyleTrackDefinition,
): MotionAnimationStyleTrackDefinition {
  return {
    ...track,
    keyframes: track.keyframes.map((keyframe) => ({
      ...keyframe,
      ...(keyframe.motionPath
        ? {
            motionPath: {
              ...keyframe.motionPath,
              control1: { ...keyframe.motionPath.control1 },
              control2: { ...keyframe.motionPath.control2 },
            },
          }
        : {}),
    })),
  };
}

function animationLabel(property: string, t: (key: string) => string): string {
  const type = ANIMATION_TYPES.find((candidate) =>
    (candidate.properties as readonly string[]).includes(property),
  );
  return type ? t(`designEditor.motion.animationStyles.${type.key}`) : property;
}
