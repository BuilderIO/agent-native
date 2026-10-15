import type {
  MotionAnimationStyleCategory,
  MotionAnimationStyleDefinition,
  MotionAnimationStyleMetadata,
  MotionAnimationStyleTrackDefinition,
} from "@shared/motion-animation-styles";
import {
  MOTION_BUILT_IN_RECIPES,
  type MotionBuiltInRecipe,
  type MotionBuiltInRecipeProperty,
  type MotionBuiltInRecipeTempo,
} from "@shared/motion-built-in-recipes";
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

const RECIPE_TEMPO_KEYS: Record<MotionBuiltInRecipeTempo, string> = {
  fast: "designEditor.motion.animationStyles.tempo.fast",
  medium: "designEditor.motion.animationStyles.tempo.medium",
  slow: "designEditor.motion.animationStyles.tempo.slow",
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
  onApplyRecipe: (recipe: MotionBuiltInRecipe) => void;
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
  onApplyRecipe,
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
        return [style.name, style.description ?? ""].some((value) =>
          value.toLocaleLowerCase().includes(query),
        );
      }),
    [categoryFilter, query, styles],
  );
  const filteredRecipes = useMemo(
    () =>
      MOTION_BUILT_IN_RECIPES.filter((recipe) => {
        if (categoryFilter !== "all" && categoryFilter !== recipe.category) {
          return false;
        }
        if (!query) return true;
        return t(recipe.nameKey).toLocaleLowerCase().includes(query);
      }),
    [categoryFilter, query, t],
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
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-border bg-background"
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
            autoFocus
            aria-label={t("designEditor.motion.animationStyles.search")}
            placeholder={t(
              "designEditor.motion.animationStyles.searchPlaceholder",
            )}
            className="h-8 ps-7 text-xs"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
          />
        </div>
        <Select
          value={categoryFilter}
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
          const categoryRecipes = filteredRecipes.filter(
            (recipe) => recipe.category === category,
          );
          const includeBasicPresets = category === "basic";
          const hasRows =
            (includeBasicPresets && filteredBasicStyles.length > 0) ||
            categoryStyles.length > 0 ||
            categoryRecipes.length > 0;
          if (!hasRows) return null;
          return (
            <section key={category} className="pb-1">
              <h3 className="px-1.5 py-1 text-[11px] font-medium text-muted-foreground">
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
                </ul>
              ) : null}
              {categoryRecipes.length > 0 ? (
                <ul className="space-y-0.5">
                  {categoryRecipes.map((recipe) => (
                    <li key={`recipe:${recipe.id}`}>
                      <button
                        data-motion-recipe-id={recipe.id}
                        data-motion-recipe-tempo={recipe.tempo}
                        type="button"
                        disabled={disabled}
                        className="flex w-full min-w-0 items-center gap-2 rounded-sm px-1.5 py-1.5 text-start text-xs outline-none transition-colors hover:bg-accent/60 focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                        onClick={() => onApplyRecipe(recipe)}
                      >
                        <RecipePreviewGlyph recipe={recipe} />
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {t(recipe.nameKey)}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {t(RECIPE_TEMPO_KEYS[recipe.tempo])}
                        </span>
                      </button>
                    </li>
                  ))}
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
        {filteredBasicStyles.length === 0 &&
        filteredStyles.length === 0 &&
        filteredRecipes.length === 0 ? (
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

function RecipePreviewGlyph({ recipe }: { recipe: MotionBuiltInRecipe }) {
  const track = recipe.tracks[0];
  if (!track)
    throw new Error(`Motion recipe has no preview track: ${recipe.id}`);

  const from = previewState(
    track.property,
    track.keyframes[0].value,
    recipe.id,
  );
  const to = previewState(track.property, track.keyframes[1].value, recipe.id);

  return (
    <svg
      aria-hidden="true"
      className="size-5 shrink-0 text-foreground"
      data-motion-recipe-glyph={recipe.id}
      data-motion-recipe-property={track.property}
      viewBox="0 0 20 20"
    >
      {track.property === "translate" ? (
        <line
          x1="10"
          y1="10"
          x2={to.x}
          y2={to.y}
          stroke="currentColor"
          strokeDasharray="1.5 1.5"
          strokeWidth="1.25"
          opacity="0.75"
        />
      ) : null}
      <rect
        x="5"
        y="5"
        width="10"
        height="10"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity={Math.max(0.4, from.opacity) * 0.8}
        transform={from.transform}
      />
      <rect
        x="5"
        y="5"
        width="10"
        height="10"
        rx="1.5"
        fill="currentColor"
        opacity={Math.max(0.65, to.opacity)}
        transform={to.transform}
      />
    </svg>
  );
}

function previewState(
  property: MotionBuiltInRecipeProperty,
  value: string,
  recipeId: string,
) {
  const invalid = () =>
    new Error(
      `Invalid ${property} preview value in motion recipe: ${recipeId}`,
    );

  switch (property) {
    case "translate": {
      const match = /^(-?[\d.]+)px\s+(-?[\d.]+)px$/.exec(value);
      if (!match) throw invalid();
      const x = Number(match[1]);
      const y = Number(match[2]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw invalid();
      const dx = Math.max(-4, Math.min(4, x / 30));
      const dy = Math.max(-4, Math.min(4, y / 30));
      return {
        transform: `translate(${dx} ${dy})`,
        opacity: 1,
        x: 10 + dx,
        y: 10 + dy,
      };
    }
    case "scale": {
      const match = /^(-?[\d.]+)\s+(-?[\d.]+)$/.exec(value);
      if (!match) throw invalid();
      const x = Number(match[1]);
      const y = Number(match[2]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw invalid();
      const scaleX = Math.max(0.1, Math.min(2, x));
      const scaleY = Math.max(0.1, Math.min(2, y));
      return {
        transform: `translate(10 10) scale(${scaleX} ${scaleY}) translate(-10 -10)`,
        opacity: 1,
        x: 10,
        y: 10,
      };
    }
    case "rotate": {
      const match = /^(-?[\d.]+)deg$/.exec(value);
      if (!match) throw invalid();
      const degrees = Number(match[1]);
      if (!Number.isFinite(degrees)) throw invalid();
      const visibleDegrees = Math.max(-45, Math.min(45, degrees));
      return {
        transform: `rotate(${visibleDegrees} 10 10)`,
        opacity: 1,
        x: 10,
        y: 10,
      };
    }
    case "opacity": {
      const opacity = Number(value);
      if (!Number.isFinite(opacity)) throw invalid();
      return {
        transform: "",
        opacity: Math.max(0, Math.min(1, opacity)),
        x: 10,
        y: 10,
      };
    }
  }
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
