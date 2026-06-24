import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getBrowserTabId,
  readClientAppState,
  setAgentChatContextItem,
  useActionQuery,
  writeClientAppState,
} from "@agent-native/core/client";
import {
  IconAdjustmentsHorizontal,
  IconBriefcase,
  IconChevronDown,
  IconLayout,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ASPECT_RATIOS,
  IMAGE_MODELS,
  IMAGE_SIZES,
  type GenerationPresetSummary,
  type ImageLibrarySummary,
} from "../../../shared/api";
import {
  GENERATION_CONTEXT_STATE_KEY,
  LEGACY_IMAGE_MODEL_STATE_KEY,
  generationContextPromptBlock,
  normalizeGenerationContext,
  type GenerationContext,
} from "@/lib/generation-context";

const NO_LIBRARY_VALUE = "__none__";
const NO_PRESET_VALUE = "__none__";
const MODEL_LABELS: Record<string, string> = {
  "gemini-3-pro-image": "Gemini 3 Pro",
  "gemini-3.1-flash-image": "Gemini 3.1 Flash",
  "gemini-3.1-flash-image-preview": "Gemini 3.1 Flash Preview",
  "gemini-3-pro-image-preview": "Gemini 3 Pro Preview",
  "gemini-2.5-flash-image": "Gemini 2.5 Flash",
};

type LibraryListResult = {
  libraries?: ImageLibrarySummary[];
};

type PresetListResult = {
  presets?: GenerationPresetSummary[];
};

export function GenerationContextBar({
  activeLibraryId,
}: {
  activeLibraryId?: string | null;
  compact?: boolean;
}) {
  const queryClient = useQueryClient();
  const { data: librariesData } = useActionQuery("list-libraries", {
    compact: true,
  } as any) as { data?: LibraryListResult };
  const libraries = librariesData?.libraries ?? [];
  const contextQuery = useGenerationContext();
  const context = contextQuery.data ?? normalizeGenerationContext(null);
  const selectedLibrary = libraries.find(
    (library) => library.id === context.libraryId,
  );
  const { data: presetData } = useActionQuery(
    "list-generation-presets",
    { libraryId: context.libraryId } as any,
    { enabled: Boolean(context.libraryId) } as any,
  ) as { data?: PresetListResult };
  const presets = useMemo(
    () =>
      (presetData?.presets ?? []).filter(
        (preset) => preset.mediaType !== "video",
      ),
    [presetData?.presets],
  );
  const selectedPreset =
    presets.find((preset) => preset.id === context.presetId) ?? null;

  const writeContext = useCallback(
    async (patch: Partial<GenerationContext>) => {
      const next = normalizeGenerationContext({ ...context, ...patch });
      queryClient.setQueryData(
        ["app-state", GENERATION_CONTEXT_STATE_KEY],
        next,
      );
      await writeClientAppState(GENERATION_CONTEXT_STATE_KEY, next, {
        requestSource: getBrowserTabId(),
      });
      void queryClient.invalidateQueries({ queryKey: ["app-state"] });
    },
    [context, queryClient],
  );

  useEffect(() => {
    if (!activeLibraryId) return;
    if (context.libraryId === activeLibraryId) return;
    void writeContext({ libraryId: activeLibraryId, presetId: null });
  }, [activeLibraryId, context.libraryId, writeContext]);

  useEffect(() => {
    if (!context.presetId) return;
    if (!context.libraryId) {
      void writeContext({ presetId: null });
      return;
    }
    if (!presetData?.presets) return;
    const presetBelongsToLibrary = presetData.presets.some(
      (preset) => preset.id === context.presetId,
    );
    if (!presetBelongsToLibrary) {
      void writeContext({ presetId: null });
    }
  }, [context.libraryId, context.presetId, presetData?.presets, writeContext]);

  useEffect(() => {
    setAgentChatContextItem({
      key: "assets-generation-context",
      title: "Assets Generation Context",
      context: generationContextPromptBlock({
        context,
        libraryTitle: selectedLibrary?.title,
        presetTitle: selectedPreset?.title,
      }),
      openSidebar: false,
    });
  }, [context, selectedLibrary?.title, selectedPreset?.title]);

  const formatLabel = `${context.aspectRatio} / ${context.imageSize} / ${context.count} candidate${context.count === 1 ? "" : "s"}`;
  const barClassName =
    "flex min-w-0 max-w-full items-center gap-1 overflow-hidden px-1 py-1";
  const chipClassName =
    "h-7 min-w-0 justify-start gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground hover:text-foreground";

  return (
    <div className={barClassName}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={`${chipClassName} max-w-[9rem] shrink`}
          >
            <IconBriefcase className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 truncate">
              {selectedLibrary?.title || "Choose kit"}
            </span>
            <IconChevronDown className="h-3 w-3 shrink-0 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-3">
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">
              Generating in
            </div>
            <Select
              value={context.libraryId ?? NO_LIBRARY_VALUE}
              onValueChange={(value) => {
                void writeContext({
                  libraryId: value === NO_LIBRARY_VALUE ? null : value,
                  presetId: null,
                });
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={NO_LIBRARY_VALUE}>
                    Choose a brand kit
                  </SelectItem>
                  {libraries.map((library) => (
                    <SelectItem key={library.id} value={library.id}>
                      {library.title}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </PopoverContent>
      </Popover>

      {context.libraryId && (presets.length > 0 || context.presetId) ? (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={`${chipClassName} max-w-[8rem] shrink`}
            >
              <IconLayout className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 truncate">
                {selectedPreset
                  ? `${selectedPreset.title} / ${selectedPreset.aspectRatio}`
                  : "No preset"}
              </span>
              <IconChevronDown className="h-3 w-3 shrink-0 opacity-60" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-3">
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">
                Preset
              </div>
              <Select
                value={context.presetId ?? NO_PRESET_VALUE}
                onValueChange={(value) => {
                  const preset = presets.find((item) => item.id === value);
                  if (!preset) {
                    void writeContext({ presetId: null });
                    return;
                  }
                  void writeContext({
                    presetId: preset.id,
                    model: preset.model,
                    aspectRatio: preset.aspectRatio,
                    imageSize: preset.imageSize,
                    mediaType: preset.mediaType,
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value={NO_PRESET_VALUE}>No preset</SelectItem>
                    {presets.map((preset) => (
                      <SelectItem key={preset.id} value={preset.id}>
                        {preset.title}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {selectedPreset?.textPolicy ? (
                <p className="rounded-md bg-muted px-2.5 py-2 text-xs text-muted-foreground">
                  {selectedPreset.textPolicy}
                </p>
              ) : null}
            </div>
          </PopoverContent>
        </Popover>
      ) : null}

      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={`${chipClassName} max-w-[12rem] shrink-0`}
          >
            <IconAdjustmentsHorizontal className="h-3.5 w-3.5 shrink-0" />
            <span className="shrink-0 text-foreground">Format</span>
            <span className="min-w-0 truncate">{formatLabel}</span>
            <IconChevronDown className="h-3 w-3 shrink-0 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-3">
          <div className="grid grid-cols-2 gap-3">
            <FormatSelect
              label="Model"
              value={context.model}
              values={IMAGE_MODELS}
              labelFor={(value) => MODEL_LABELS[value] ?? value}
              onChange={(model) =>
                void writeContext({
                  model: model as GenerationContext["model"],
                })
              }
            />
            <FormatSelect
              label="Aspect"
              value={context.aspectRatio}
              values={ASPECT_RATIOS}
              onChange={(aspectRatio) =>
                void writeContext({
                  aspectRatio: aspectRatio as GenerationContext["aspectRatio"],
                })
              }
            />
            <FormatSelect
              label="Size"
              value={context.imageSize}
              values={IMAGE_SIZES}
              onChange={(imageSize) =>
                void writeContext({
                  imageSize: imageSize as GenerationContext["imageSize"],
                })
              }
            />
            <FormatSelect
              label="Count"
              value={String(context.count)}
              values={["1", "2", "3", "4", "6"] as const}
              onChange={(value) => void writeContext({ count: Number(value) })}
            />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function useGenerationContext() {
  return useQuery({
    queryKey: ["app-state", GENERATION_CONTEXT_STATE_KEY],
    queryFn: async ({ signal }) => {
      const [context, legacy] = await Promise.all([
        readClientAppState(GENERATION_CONTEXT_STATE_KEY, { signal }),
        readClientAppState(LEGACY_IMAGE_MODEL_STATE_KEY, { signal }).catch(
          () => null,
        ),
      ]);
      return normalizeGenerationContext(context, legacy);
    },
    staleTime: 2_000,
  });
}

function FormatSelect({
  label,
  value,
  values,
  onChange,
  labelFor = (item) => item,
}: {
  label: string;
  value: string;
  values: readonly string[];
  onChange: (value: string) => void;
  labelFor?: (value: string) => string;
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {values.map((item) => (
              <SelectItem key={item} value={item}>
                {labelFor(item)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </label>
  );
}
