import { useMemo } from "react";
import { useActionQuery } from "@agent-native/core/client";
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
  VIDEO_ASPECT_RATIOS,
  VIDEO_DURATIONS,
  VIDEO_MODELS,
  VIDEO_RESOLUTIONS,
  type GenerationPresetSummary,
  type ImageLibrarySummary,
  type VideoDuration,
  type VideoResolution,
} from "../../../shared/api";
import {
  normalizeGenerationContext,
  type GenerationContext,
} from "@/lib/generation-context";
import {
  useGenerationContext,
  useGenerationContextWriter,
} from "@/hooks/use-generation-context";

const NO_LIBRARY_VALUE = "__none__";
const NO_PRESET_VALUE = "__none__";
const MODEL_LABELS: Record<string, string> = {
  "gemini-3-pro-image": "Gemini 3 Pro",
  "gemini-3.1-flash-image": "Gemini 3.1 Flash",
  "gemini-3.1-flash-image-preview": "Gemini 3.1 Flash Preview",
  "gemini-3-pro-image-preview": "Gemini 3 Pro Preview",
  "gemini-2.5-flash-image": "Gemini 2.5 Flash",
  "veo-3.1-generate-preview": "Veo 3.1",
  "veo-3.1-fast-generate-preview": "Veo 3.1 Fast",
};

type LibraryListResult = {
  libraries?: ImageLibrarySummary[];
};

type PresetListResult = {
  presets?: GenerationPresetSummary[];
};

function isImageModel(model: string): model is (typeof IMAGE_MODELS)[number] {
  return (IMAGE_MODELS as readonly string[]).includes(model);
}

function isVideoModel(model: string): model is (typeof VIDEO_MODELS)[number] {
  return (VIDEO_MODELS as readonly string[]).includes(model);
}

function isImageAspectRatio(
  value: string,
): value is (typeof ASPECT_RATIOS)[number] {
  return (ASPECT_RATIOS as readonly string[]).includes(value);
}

function isVideoAspectRatio(
  value: string,
): value is (typeof VIDEO_ASPECT_RATIOS)[number] {
  return (VIDEO_ASPECT_RATIOS as readonly string[]).includes(value);
}

function isImageSize(value: string): value is (typeof IMAGE_SIZES)[number] {
  return (IMAGE_SIZES as readonly string[]).includes(value);
}

function presetDurationSeconds(preset: GenerationPresetSummary): VideoDuration {
  const raw = preset.settings?.durationSeconds ?? preset.settings?.duration;
  const numeric = typeof raw === "number" ? raw : Number(raw);
  return (VIDEO_DURATIONS as readonly number[]).includes(numeric)
    ? (numeric as VideoDuration)
    : 8;
}

function presetResolution(preset: GenerationPresetSummary): VideoResolution {
  const raw = preset.settings?.resolution ?? preset.imageSize;
  return typeof raw === "string" &&
    (VIDEO_RESOLUTIONS as readonly string[]).includes(raw)
    ? (raw as VideoResolution)
    : "720p";
}

function presetModel(preset: GenerationPresetSummary) {
  if (preset.mediaType === "video") {
    return isVideoModel(preset.model) ? preset.model : VIDEO_MODELS[0];
  }
  return isImageModel(preset.model) ? preset.model : IMAGE_MODELS[0];
}

function presetAspectRatio(preset: GenerationPresetSummary) {
  if (preset.mediaType === "video") {
    return isVideoAspectRatio(preset.aspectRatio)
      ? preset.aspectRatio
      : VIDEO_ASPECT_RATIOS[0];
  }
  return isImageAspectRatio(preset.aspectRatio)
    ? preset.aspectRatio
    : ASPECT_RATIOS[0];
}

export function GenerationContextBar() {
  const { data: librariesData } = useActionQuery("list-libraries", {
    compact: true,
  } as any) as { data?: LibraryListResult };
  const libraries = librariesData?.libraries ?? [];
  const contextQuery = useGenerationContext();
  const context = contextQuery.data ?? normalizeGenerationContext(null);
  const writeContext = useGenerationContextWriter(context);
  const selectedLibrary = libraries.find(
    (library) => library.id === context.libraryId,
  );
  const { data: presetData } = useActionQuery(
    "list-generation-presets",
    { libraryId: context.libraryId } as any,
    { enabled: Boolean(context.libraryId) } as any,
  ) as { data?: PresetListResult };
  const presets = useMemo(
    () => presetData?.presets ?? [],
    [presetData?.presets],
  );
  const selectedPreset =
    presets.find((preset) => preset.id === context.presetId) ?? null;

  const formatLabel =
    context.mediaType === "video"
      ? `Video / ${context.aspectRatio} / ${context.videoDurationSeconds}s / ${context.videoResolution}`
      : `Image / ${context.aspectRatio} / ${context.imageSize} / ${context.count} candidate${context.count === 1 ? "" : "s"}`;
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
                    mediaType: preset.mediaType,
                    model: presetModel(preset),
                    aspectRatio: presetAspectRatio(preset),
                    imageSize: isImageSize(preset.imageSize)
                      ? preset.imageSize
                      : context.imageSize,
                    videoDurationSeconds: presetDurationSeconds(preset),
                    videoResolution: presetResolution(preset),
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
              label="Type"
              value={context.mediaType}
              values={["image", "video"] as const}
              labelFor={(value) => (value === "video" ? "Video" : "Image")}
              onChange={(mediaType) => {
                if (mediaType === "video") {
                  void writeContext({
                    mediaType: "video",
                    model: isVideoModel(context.model)
                      ? context.model
                      : VIDEO_MODELS[0],
                    aspectRatio: isVideoAspectRatio(context.aspectRatio)
                      ? context.aspectRatio
                      : VIDEO_ASPECT_RATIOS[0],
                  });
                  return;
                }
                void writeContext({
                  mediaType: "image",
                  model: isImageModel(context.model)
                    ? context.model
                    : IMAGE_MODELS[0],
                  aspectRatio: isImageAspectRatio(context.aspectRatio)
                    ? context.aspectRatio
                    : ASPECT_RATIOS[0],
                });
              }}
            />
            {context.mediaType === "video" ? (
              <>
                <FormatSelect
                  label="Model"
                  value={
                    isVideoModel(context.model)
                      ? context.model
                      : VIDEO_MODELS[0]
                  }
                  values={VIDEO_MODELS}
                  labelFor={(value) => MODEL_LABELS[value] ?? value}
                  onChange={(model) =>
                    void writeContext({
                      model: model as GenerationContext["model"],
                      mediaType: "video",
                    })
                  }
                />
                <FormatSelect
                  label="Aspect"
                  value={
                    isVideoAspectRatio(context.aspectRatio)
                      ? context.aspectRatio
                      : VIDEO_ASPECT_RATIOS[0]
                  }
                  values={VIDEO_ASPECT_RATIOS}
                  onChange={(aspectRatio) =>
                    void writeContext({
                      aspectRatio:
                        aspectRatio as GenerationContext["aspectRatio"],
                      mediaType: "video",
                    })
                  }
                />
                <FormatSelect
                  label="Duration"
                  value={String(context.videoDurationSeconds)}
                  values={VIDEO_DURATIONS.map(String)}
                  onChange={(value) =>
                    void writeContext({
                      videoDurationSeconds: Number(
                        value,
                      ) as GenerationContext["videoDurationSeconds"],
                      mediaType: "video",
                    })
                  }
                />
                <FormatSelect
                  label="Resolution"
                  value={context.videoResolution}
                  values={VIDEO_RESOLUTIONS}
                  onChange={(videoResolution) =>
                    void writeContext({
                      videoResolution:
                        videoResolution as GenerationContext["videoResolution"],
                      mediaType: "video",
                    })
                  }
                />
              </>
            ) : (
              <>
                <FormatSelect
                  label="Model"
                  value={
                    isImageModel(context.model)
                      ? context.model
                      : IMAGE_MODELS[0]
                  }
                  values={IMAGE_MODELS}
                  labelFor={(value) => MODEL_LABELS[value] ?? value}
                  onChange={(model) =>
                    void writeContext({
                      model: model as GenerationContext["model"],
                      mediaType: "image",
                    })
                  }
                />
                <FormatSelect
                  label="Aspect"
                  value={
                    isImageAspectRatio(context.aspectRatio)
                      ? context.aspectRatio
                      : ASPECT_RATIOS[0]
                  }
                  values={ASPECT_RATIOS}
                  onChange={(aspectRatio) =>
                    void writeContext({
                      aspectRatio:
                        aspectRatio as GenerationContext["aspectRatio"],
                      mediaType: "image",
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
                      mediaType: "image",
                    })
                  }
                />
                <FormatSelect
                  label="Count"
                  value={String(context.count)}
                  values={["1", "2", "3", "4", "6"] as const}
                  onChange={(value) =>
                    void writeContext({
                      count: Number(value),
                      mediaType: "image",
                    })
                  }
                />
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
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
