import {
  appBasePath,
  insertAgentComposerReference,
  useActionMutation,
  useActionQuery,
  useT,
} from "@agent-native/core/client";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@agent-native/toolkit/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@agent-native/toolkit/ui/alert-dialog";
import { Badge } from "@agent-native/toolkit/ui/badge";
import { Button } from "@agent-native/toolkit/ui/button";
import { Checkbox } from "@agent-native/toolkit/ui/checkbox";
import { Input } from "@agent-native/toolkit/ui/input";
import { Label } from "@agent-native/toolkit/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/toolkit/ui/select";
import { Separator } from "@agent-native/toolkit/ui/separator";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import {
  IconArrowLeft,
  IconCheck,
  IconChevronDown,
  IconDeviceFloppy,
  IconLock,
  IconPhotoPlus,
  IconPlus,
  IconSearch,
  IconTrash,
  IconUpload,
  IconUserPlus,
  IconX,
} from "@tabler/icons-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { messagesByLocale } from "@/i18n-data";
import { assetMediaUrl } from "@/lib/asset-urls";
import type { AssetUploadResult } from "@/lib/upload-results";
import { cn } from "@/lib/utils";

import { normalizePresetReferences } from "../../server/lib/preset-references";
import {
  ASPECT_RATIOS,
  GENERATION_PRESET_REFERENCE_POLICIES,
  IMAGE_CATEGORIES,
  IMAGE_MODELS,
  IMAGE_SIZES,
  PRESET_REFERENCE_ROLES,
  supportedAspectRatiosForModel,
  type AspectRatio,
  type GenerationPresetReferencePolicy,
  type ImageCategory,
  type ImageModel,
  type ImageSize,
  type PresetReference,
  type PresetReferenceRole,
  type PresetSkeletonSpec,
} from "../../shared/api";

type SkeletonContentMode = PresetSkeletonSpec["contentMode"];
type SkeletonLogoPlacement =
  | "upper-right"
  | "upper-left"
  | "lower-right"
  | "lower-left";
type SkeletonForegroundLayer = NonNullable<
  PresetSkeletonSpec["foreground"]
>[number];

type PresetFormState = {
  title: string;
  description: string;
  category: ImageCategory;
  model: ImageModel;
  aspectRatio: AspectRatio;
  imageSize: ImageSize;
  referencePolicy: GenerationPresetReferencePolicy;
  collectionId: string | null;
  promptTemplate: string;
  textPolicy: string;
  includeLogo: boolean;
  sortOrder: string;
  skeletonEnabled: boolean;
  skeletonContentMode: SkeletonContentMode;
  skeletonBackgroundAssetId: string;
  skeletonBackgroundPreviewUrl: string;
  skeletonMaskAssetId: string;
  skeletonMaskPreviewUrl: string;
  skeletonDropShadow: boolean;
  skeletonLogo: boolean;
  skeletonLogoPlacement: SkeletonLogoPlacement;
  presetReferences: PresetReference[];
};

const NO_COLLECTION = "__none__";
const NO_SKELETON_BACKGROUND = "__none__";
const NO_SKELETON_MASK = "__none__";
type ReferenceMode = "fixed" | "swappable" | "required";

function usesSkeletonInpaintMode(
  form: Pick<PresetFormState, "model" | "skeletonContentMode">,
) {
  return form.skeletonContentMode === "cutout" && form.model === "gpt-image-2";
}

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.generationPreset }];
}

function skeletonFromPreset(preset: any): PresetSkeletonSpec | null {
  const spec = preset?.settings?.skeletonSpec;
  return spec && typeof spec === "object" ? (spec as PresetSkeletonSpec) : null;
}

function presetReferencesFromPreset(preset: any): PresetReference[] {
  return normalizePresetReferences(preset?.settings?.presetReferences);
}

function logoPlacementFromLayer(
  layer: SkeletonForegroundLayer,
): SkeletonLogoPlacement {
  if (layer.y > 0.5) return layer.x > 0.5 ? "lower-right" : "lower-left";
  return layer.x > 0.5 ? "upper-right" : "upper-left";
}

function logoLayerFromPlacement(
  placement: SkeletonLogoPlacement,
): SkeletonForegroundLayer {
  switch (placement) {
    case "upper-left":
      return { source: "canonicalLogo", x: 0.06, y: 0.06, w: 0.16 };
    case "lower-left":
      return { source: "canonicalLogo", x: 0.06, y: 0.82, w: 0.16 };
    case "lower-right":
      return { source: "canonicalLogo", x: 0.78, y: 0.82, w: 0.16 };
    default:
      return { source: "canonicalLogo", x: 0.78, y: 0.06, w: 0.16 };
  }
}

function buildSkeletonSpec(
  form: PresetFormState,
  previous: PresetSkeletonSpec | null = null,
): PresetSkeletonSpec | null {
  if (!form.skeletonEnabled || !form.skeletonBackgroundAssetId) return null;
  const foreground = [
    ...(previous?.foreground ?? []).filter(
      (layer) => layer.source !== "canonicalLogo",
    ),
    ...(form.skeletonLogo && !usesSkeletonInpaintMode(form)
      ? [logoLayerFromPlacement(form.skeletonLogoPlacement)]
      : []),
  ];
  return {
    background: {
      type: "asset",
      assetId: form.skeletonBackgroundAssetId,
    },
    ...(form.skeletonMaskAssetId
      ? { mask: { type: "asset" as const, assetId: form.skeletonMaskAssetId } }
      : {}),
    contentMode: form.skeletonContentMode,
    dropShadow:
      form.skeletonContentMode === "cutout"
        ? form.skeletonDropShadow
        : undefined,
    ...(previous?.contentRegion
      ? { contentRegion: previous.contentRegion }
      : {}),
    ...(foreground.length ? { foreground } : {}),
  };
}

function normalizeReferenceEntries(entries: PresetReference[]) {
  return normalizePresetReferences(
    entries.map((entry) => ({
      ...entry,
      id: entry.id.trim(),
      // A cleared label must not delete the entry (normalize drops
      // label-less entries); fall back to the durable id as the label.
      label: entry.label.trim() || entry.id.trim(),
      description: entry.description?.trim() || undefined,
      assetIds: entry.assetIds.filter(Boolean).slice(0, 4),
      variable: Boolean(entry.variable),
      required: Boolean(entry.variable && entry.required),
    })),
  );
}

function kebabIdFromLabel(label: string, existingIds: string[] = []): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/g, "") || "reference";
  const existing = new Set(existingIds);
  if (!existing.has(base)) return base;
  for (let index = 2; index < 100; index += 1) {
    const suffix = `-${index}`;
    const candidate = `${base.slice(0, 40 - suffix.length).replace(/-+$/g, "")}${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }
  return base;
}

function formFromPreset(
  preset: any,
  assets: Array<Record<string, any>> = [],
): PresetFormState {
  const skeleton = skeletonFromPreset(preset);
  const skeletonLogoLayer = skeleton?.foreground?.find(
    (layer) => layer.source === "canonicalLogo",
  );
  const skeletonContentMode = skeleton?.contentMode ?? "fill";
  const presetModel = (preset?.model ?? "gemini-3.1-flash-image") as ImageModel;
  const backgroundAssetId =
    skeleton?.background?.type === "asset" ? skeleton.background.assetId : "";
  const backgroundAsset = assets.find(
    (asset) => asset.id === backgroundAssetId,
  );
  const maskAssetId =
    skeleton?.mask?.type === "asset" ? skeleton.mask.assetId : "";
  const maskAsset = assets.find((asset) => asset.id === maskAssetId);
  return {
    title: preset?.title ?? "",
    description: preset?.description ?? "",
    category: preset?.category ?? "social",
    model:
      skeleton &&
      skeletonContentMode === "cutout" &&
      presetModel !== "gpt-image-2"
        ? "gpt-image-1"
        : presetModel,
    aspectRatio: preset?.aspectRatio ?? "1:1",
    imageSize: preset?.imageSize ?? "2K",
    referencePolicy: preset?.referencePolicy ?? "auto",
    collectionId: preset?.collectionId ?? null,
    promptTemplate: preset?.promptTemplate ?? "",
    textPolicy: preset?.textPolicy ?? "",
    includeLogo: preset?.includeLogo === true,
    sortOrder: String(preset?.sortOrder ?? 0),
    skeletonEnabled: Boolean(skeleton && backgroundAssetId),
    skeletonContentMode,
    skeletonBackgroundAssetId: backgroundAssetId,
    skeletonBackgroundPreviewUrl: previewUrlForAsset(backgroundAsset),
    skeletonMaskAssetId: maskAssetId,
    skeletonMaskPreviewUrl: previewUrlForAsset(maskAsset),
    skeletonDropShadow: skeleton?.dropShadow === true,
    skeletonLogo: Boolean(skeletonLogoLayer),
    skeletonLogoPlacement: skeletonLogoLayer
      ? logoPlacementFromLayer(skeletonLogoLayer)
      : "upper-right",
    presetReferences: presetReferencesFromPreset(preset),
  };
}

function normalizedForm(form: PresetFormState) {
  return {
    ...form,
    title: form.title.trim(),
    description: form.description.trim(),
    promptTemplate: form.promptTemplate.trim(),
    textPolicy: form.textPolicy.trim(),
    sortOrder: Number.isFinite(Number(form.sortOrder))
      ? String(Number(form.sortOrder))
      : "0",
    skeletonBackgroundPreviewUrl: "",
    skeletonMaskPreviewUrl: "",
    presetReferences: normalizeReferenceEntries(form.presetReferences),
  };
}

function previewUrlForAsset(asset: any): string {
  return (
    assetMediaUrl(
      asset?.thumbnailUrl ?? asset?.previewUrl ?? asset?.downloadUrl,
    ) ?? ""
  );
}

function referenceMode(entry: PresetReference): ReferenceMode {
  if (!entry.variable) return "fixed";
  return entry.required ? "required" : "swappable";
}

function referenceModePatch(mode: ReferenceMode): Partial<PresetReference> {
  switch (mode) {
    case "required":
      return { variable: true, required: true };
    case "swappable":
      return { variable: true, required: false };
    default:
      return { variable: false, required: false };
  }
}

function assetDisplayTitle(asset: any): string {
  return asset?.title || asset?.metadata?.originalName || asset?.id || "Asset";
}

function truncateReferenceLabel(label: string): string {
  return label.trim().slice(0, 60);
}

function isImageAsset(asset: any): boolean {
  return (
    asset?.mediaType === "image" ||
    (typeof asset?.mimeType === "string" && asset.mimeType.startsWith("image/"))
  );
}

function uploadedSkeletonAssetId(
  result: AssetUploadResult | null | undefined,
): string | null {
  return (
    result?.assets?.find((asset) => asset.id)?.id ??
    result?.skippedDuplicates?.find((asset) => asset.assetId)?.assetId ??
    null
  );
}

function isEditableRole(role: unknown): boolean {
  return role === "owner" || role === "admin" || role === "editor";
}

function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <Label
      htmlFor={htmlFor}
      className="text-xs font-medium text-muted-foreground"
    >
      {children}
    </Label>
  );
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia(query);
    setMatches(mediaQuery.matches);
    const listener = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };
    mediaQuery.addEventListener("change", listener);
    return () => mediaQuery.removeEventListener("change", listener);
  }, [query]);

  return matches;
}

function SkeletonPreview({ form }: { form: PresetFormState }) {
  const logoLayer = logoLayerFromPlacement(form.skeletonLogoPlacement);
  return (
    <div className="relative mt-3 aspect-video overflow-hidden rounded-md border border-border bg-muted">
      {form.skeletonBackgroundPreviewUrl ? (
        <img
          src={form.skeletonBackgroundPreviewUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
      <div
        className={cn(
          "absolute bg-background/85 shadow-sm",
          form.skeletonContentMode === "cutout"
            ? "inset-x-[26%] top-[14%] h-[62%] rounded-full"
            : "inset-[12%] rounded-sm",
        )}
      />
      {form.skeletonContentMode === "cutout" && form.skeletonDropShadow ? (
        <div className="absolute bottom-[18%] left-1/2 h-3 w-28 -translate-x-1/2 rounded-full bg-foreground/20 blur-sm" />
      ) : null}
      {form.skeletonLogo ? (
        <div
          className="absolute h-3 rounded-sm bg-foreground/80"
          style={{
            left: `${logoLayer.x * 100}%`,
            top: `${logoLayer.y * 100}%`,
            width: `${logoLayer.w * 100}%`,
          }}
        />
      ) : null}
    </div>
  );
}

export default function GenerationPresetEditorRoute() {
  const t = useT();
  const navigate = useNavigate();
  const { id, presetId } = useParams();
  const libraryId = id ?? "";
  const { data: libraryData, isLoading: libraryLoading } = useActionQuery(
    "get-library",
    { id: libraryId },
  ) as any;
  const { data: presetData, isLoading: presetsLoading } = useActionQuery(
    "list-generation-presets",
    { libraryId },
  ) as any;
  const updatePreset = useActionMutation("update-generation-preset");
  const deletePreset = useActionMutation("delete-generation-preset");
  const [form, setForm] = useState<PresetFormState | null>(null);
  const [initialForm, setInitialForm] = useState<PresetFormState | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [skeletonUploadPending, setSkeletonUploadPending] = useState(false);
  const [skeletonMaskUploadPending, setSkeletonMaskUploadPending] =
    useState(false);
  const [referenceUploadPending, setReferenceUploadPending] = useState<
    string | null
  >(null);
  const [referencePreviewUrls, setReferencePreviewUrls] = useState<
    Record<string, string>
  >({});
  const [activeReferenceIndex, setActiveReferenceIndex] = useState<
    number | null
  >(null);
  const [pickerReferenceIndex, setPickerReferenceIndex] = useState<
    number | null
  >(null);
  const [referenceAssetSearch, setReferenceAssetSearch] = useState("");
  const [autofocusReferenceIndex, setAutofocusReferenceIndex] = useState<
    number | null
  >(null);
  const skeletonFileInputRef = useRef<HTMLInputElement | null>(null);
  const skeletonMaskFileInputRef = useRef<HTMLInputElement | null>(null);
  const referenceUploadInputRef = useRef<HTMLInputElement | null>(null);
  const isSmallEditorViewport = useMediaQuery("(max-width: 640px)");

  const library = libraryData?.library;
  const assets = useMemo(
    () => (Array.isArray(libraryData?.assets) ? libraryData.assets : []),
    [libraryData?.assets],
  );
  const collections = Array.isArray(libraryData?.collections)
    ? libraryData.collections
    : [];
  const skeletonBackgroundAssets = useMemo(
    () => assets.filter(isImageAsset),
    [assets],
  );
  const presets = Array.isArray(presetData?.presets) ? presetData.presets : [];
  const preset = presets.find((item: any) => item.id === presetId);
  // Saved entry ids are durable keys referenced by presetReferenceFills and
  // past runs' boardAssignments; renaming a label must never change them.
  const persistedReferenceIds = useMemo(
    () => new Set(presetReferencesFromPreset(preset).map((entry) => entry.id)),
    [preset],
  );
  const loading = libraryLoading || presetsLoading;
  const accessRole = library?.accessRole;
  const readOnly = Boolean(accessRole && !isEditableRole(accessRole));

  useEffect(() => {
    if (!preset) return;
    const next = formFromPreset(preset, assets);
    setForm(next);
    setInitialForm(next);
  }, [preset?.id, preset?.updatedAt]);

  useEffect(() => {
    function hydratePreview(
      current: PresetFormState | null,
    ): PresetFormState | null {
      if (!current) {
        return current;
      }
      const backgroundAsset = assets.find(
        (item: any) => item.id === current.skeletonBackgroundAssetId,
      );
      const maskAsset = assets.find(
        (item: any) => item.id === current.skeletonMaskAssetId,
      );
      const backgroundPreviewUrl =
        current.skeletonBackgroundPreviewUrl ||
        previewUrlForAsset(backgroundAsset);
      const maskPreviewUrl =
        current.skeletonMaskPreviewUrl || previewUrlForAsset(maskAsset);
      if (
        backgroundPreviewUrl === current.skeletonBackgroundPreviewUrl &&
        maskPreviewUrl === current.skeletonMaskPreviewUrl
      ) {
        return current;
      }
      return {
        ...current,
        skeletonBackgroundPreviewUrl: backgroundPreviewUrl,
        skeletonMaskPreviewUrl: maskPreviewUrl,
      };
    }
    setForm(hydratePreview);
    setInitialForm(hydratePreview);
  }, [assets]);

  useEffect(() => {
    if (!library?.id || !library?.title || !preset?.id || !preset?.title) {
      return;
    }
    const encodedLibraryId = encodeURIComponent(library.id);
    insertAgentComposerReference({
      label: preset.title,
      icon: "document",
      source: "presets",
      refType: "preset",
      refId: preset.id,
      refPath: `/library/${encodedLibraryId}`,
      slotKey: "preset",
      slotLabel: "Preset",
      metadata: {
        libraryId: library.id,
        libraryTitle: library.title,
        requiredSlotKey: "brand-kit",
        requiredRefId: library.id,
        mediaType: preset.mediaType,
      },
      relatedReferences: [
        {
          label: library.title,
          icon: "folder",
          source: "brandKits",
          refType: "brand-kit",
          refId: library.id,
          refPath: `/library/${encodedLibraryId}`,
          slotKey: "brand-kit",
          slotLabel: "Brand kit",
          clearsSlots: ["preset"],
          metadata: {
            libraryId: library.id,
          },
        },
      ],
    });
  }, [
    library?.id,
    library?.title,
    preset?.id,
    preset?.mediaType,
    preset?.title,
  ]);

  const supportedRatios = useMemo(
    () =>
      form?.skeletonEnabled
        ? ASPECT_RATIOS
        : form
          ? supportedAspectRatiosForModel(form.model)
          : ASPECT_RATIOS,
    [form?.model, form?.skeletonEnabled],
  );
  const modelOptions = useMemo(
    () =>
      form?.skeletonEnabled && form.skeletonContentMode === "cutout"
        ? IMAGE_MODELS.filter(
            (model) => model === "gpt-image-1" || model === "gpt-image-2",
          )
        : IMAGE_MODELS,
    [form?.skeletonContentMode, form?.skeletonEnabled],
  );
  const dirty = Boolean(
    form &&
    initialForm &&
    JSON.stringify(normalizedForm(form)) !==
      JSON.stringify(normalizedForm(initialForm)),
  );
  const referenceImageCounts = useMemo(() => {
    const entries = form?.presetReferences ?? [];
    return {
      total: entries.reduce((sum, entry) => sum + entry.assetIds.length, 0),
      subject: entries
        .filter((entry) => entry.role === "subject")
        .reduce((sum, entry) => sum + entry.assetIds.length, 0),
    };
  }, [form?.presetReferences]);
  const activeReferenceEntry =
    activeReferenceIndex == null
      ? null
      : (form?.presetReferences[activeReferenceIndex] ?? null);
  const pickerReferenceEntry =
    pickerReferenceIndex == null
      ? null
      : (form?.presetReferences[pickerReferenceIndex] ?? null);
  const filteredReferenceAssets = useMemo(() => {
    const query = referenceAssetSearch.trim().toLowerCase();
    if (!query) return skeletonBackgroundAssets;
    return skeletonBackgroundAssets.filter((asset: any) =>
      [assetDisplayTitle(asset), asset.id, asset.description]
        .filter((value): value is string => typeof value === "string")
        .join("\n")
        .toLowerCase()
        .includes(query),
    );
  }, [referenceAssetSearch, skeletonBackgroundAssets]);
  const settingsHref = libraryId
    ? `/library/${encodeURIComponent(libraryId)}?tab=settings`
    : "/library";

  function updateForm(patch: Partial<PresetFormState>) {
    setForm((current) => (current ? { ...current, ...patch } : current));
  }

  function updateModel(model: ImageModel) {
    setForm((current) => {
      if (!current) return current;
      if (current.skeletonEnabled && current.skeletonContentMode === "cutout") {
        return {
          ...current,
          model:
            model === "gpt-image-1" || model === "gpt-image-2"
              ? model
              : "gpt-image-1",
        };
      }
      const ratios = supportedAspectRatiosForModel(model);
      return {
        ...current,
        model,
        aspectRatio: ratios.includes(current.aspectRatio)
          ? current.aspectRatio
          : ratios[0],
      };
    });
  }

  function updateSkeletonEnabled(enabled: boolean) {
    setForm((current) => {
      if (!current) return current;
      return {
        ...current,
        skeletonEnabled: enabled,
        model:
          enabled &&
          current.skeletonContentMode === "cutout" &&
          current.model !== "gpt-image-1" &&
          current.model !== "gpt-image-2"
            ? "gpt-image-1"
            : current.model,
      };
    });
  }

  function updateSkeletonContentMode(contentMode: SkeletonContentMode) {
    setForm((current) =>
      current
        ? {
            ...current,
            skeletonContentMode: contentMode,
            model:
              contentMode === "cutout" &&
              current.model !== "gpt-image-1" &&
              current.model !== "gpt-image-2"
                ? "gpt-image-1"
                : current.model,
            skeletonDropShadow:
              contentMode === "cutout" ? current.skeletonDropShadow : false,
          }
        : current,
    );
  }

  function updateSkeletonBackgroundAsset(assetId: string) {
    if (assetId === NO_SKELETON_BACKGROUND) {
      updateForm({
        skeletonBackgroundAssetId: "",
        skeletonBackgroundPreviewUrl: "",
      });
      return;
    }
    const asset = skeletonBackgroundAssets.find(
      (item: any) => item.id === assetId,
    );
    updateForm({
      skeletonBackgroundAssetId: assetId,
      skeletonBackgroundPreviewUrl: previewUrlForAsset(asset),
    });
  }

  function updateSkeletonMaskAsset(assetId: string) {
    if (assetId === NO_SKELETON_MASK) {
      updateForm({
        skeletonMaskAssetId: "",
        skeletonMaskPreviewUrl: "",
      });
      return;
    }
    const asset = skeletonBackgroundAssets.find(
      (item: any) => item.id === assetId,
    );
    updateForm({
      skeletonMaskAssetId: assetId,
      skeletonMaskPreviewUrl: previewUrlForAsset(asset),
    });
  }

  function addPresetReference() {
    if (!form || form.presetReferences.length >= 6 || readOnly) return;
    const label = t("brandKitDetail.referenceDefaultLabel");
    const id = kebabIdFromLabel(
      label,
      form.presetReferences.map((entry) => entry.id),
    );
    const nextIndex = form.presetReferences.length;
    setForm({
      ...form,
      presetReferences: [
        ...form.presetReferences,
        {
          id,
          label,
          role: "subject",
          assetIds: [],
          variable: true,
          required: false,
        },
      ],
    });
    setActiveReferenceIndex(nextIndex);
    setPickerReferenceIndex(nextIndex);
    setReferenceAssetSearch("");
    setAutofocusReferenceIndex(nextIndex);
  }

  function updatePresetReference(
    index: number,
    patch: Partial<PresetReference>,
  ) {
    setForm((current) => {
      if (!current) return current;
      const entries = current.presetReferences.map((entry, entryIndex) => {
        if (entryIndex !== index) return entry;
        const next = { ...entry, ...patch };
        if (patch.label !== undefined && !persistedReferenceIds.has(entry.id)) {
          next.id = kebabIdFromLabel(
            patch.label,
            current.presetReferences
              .filter((_, otherIndex) => otherIndex !== index)
              .map((item) => item.id),
          );
        }
        if (!next.variable) {
          next.required = false;
        }
        return next;
      });
      return { ...current, presetReferences: entries };
    });
  }

  function removePresetReference(index: number) {
    setActiveReferenceIndex(null);
    setPickerReferenceIndex(null);
    setForm((current) =>
      current
        ? {
            ...current,
            presetReferences: current.presetReferences.filter(
              (_, entryIndex) => entryIndex !== index,
            ),
          }
        : current,
    );
  }

  function addReferenceAsset(index: number, assetId: string, title?: string) {
    const entry = form?.presetReferences[index];
    const asset = skeletonBackgroundAssets.find(
      (item: any) => item.id === assetId,
    );
    if (!entry || entry.assetIds.includes(assetId)) return;
    if (entry.assetIds.length >= 4) return;
    if (referenceImageCounts.total >= 8) {
      toast.error(t("brandKitDetail.referenceBoardTotalLimitError"));
      return;
    }
    if (entry.role === "subject" && referenceImageCounts.subject >= 4) {
      toast.error(t("brandKitDetail.referenceBoardSubjectLimitError"));
      return;
    }
    setForm((current) => {
      if (!current) return current;
      const entries = current.presetReferences.map((entry, entryIndex) => {
        if (
          entryIndex !== index ||
          entry.assetIds.includes(assetId) ||
          entry.assetIds.length >= 4
        ) {
          return entry;
        }
        const defaultLabel = t("brandKitDetail.referenceDefaultLabel");
        const shouldPrefillLabel =
          entry.assetIds.length === 0 && entry.label.trim() === defaultLabel;
        const nextLabel = shouldPrefillLabel
          ? truncateReferenceLabel(title || assetDisplayTitle(asset)) ||
            entry.label
          : entry.label;
        return {
          ...entry,
          id: shouldPrefillLabel
            ? kebabIdFromLabel(
                nextLabel,
                current.presetReferences
                  .filter((_, otherIndex) => otherIndex !== index)
                  .map((item) => item.id),
              )
            : entry.id,
          label: nextLabel,
          assetIds: [...entry.assetIds, assetId],
        };
      });
      return { ...current, presetReferences: entries };
    });
    setPickerReferenceIndex(null);
  }

  function removeReferenceAsset(index: number, assetId: string) {
    setForm((current) =>
      current
        ? {
            ...current,
            presetReferences: current.presetReferences.map(
              (entry, entryIndex) =>
                entryIndex === index
                  ? {
                      ...entry,
                      assetIds: entry.assetIds.filter((id) => id !== assetId),
                    }
                  : entry,
            ),
          }
        : current,
    );
  }

  async function uploadReferenceImage(files: FileList | null, index: number) {
    if (!files?.length || !libraryId || readOnly || referenceUploadPending) {
      return;
    }
    const entry = form?.presetReferences[index];
    if (!entry || entry.assetIds.length >= 4) return;
    if (referenceImageCounts.total >= 8) {
      toast.error(t("brandKitDetail.referenceBoardTotalLimitError"));
      return;
    }
    if (entry.role === "subject" && referenceImageCounts.subject >= 4) {
      toast.error(t("brandKitDetail.referenceBoardSubjectLimitError"));
      return;
    }
    const file = files[0];
    const localPreviewUrl = URL.createObjectURL(file);
    const body = new FormData();
    body.append("libraryId", libraryId);
    body.append(
      "category",
      entry.role === "product"
        ? "product"
        : entry.role === "subject"
          ? "other"
          : "style-only",
    );
    if (entry.role === "subject") {
      body.append("intent", "subject");
    }
    body.append("files", file);
    setReferenceUploadPending(entry.id);
    try {
      const response = await fetch(`${appBasePath()}/api/assets/upload`, {
        method: "POST",
        body,
      });
      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(
          errorBody?.error || `Upload failed (${response.status})`,
        );
      }
      const result = (await response
        .json()
        .catch(() => null)) as AssetUploadResult | null;
      const assetId = uploadedSkeletonAssetId(result);
      if (!assetId) {
        throw new Error(
          result?.errors?.[0]?.message ??
            t("brandKitDetail.couldNotUploadReferenceImage"),
        );
      }
      addReferenceAsset(index, assetId, file.name);
      setReferencePreviewUrls((current) => ({
        ...current,
        [assetId]: localPreviewUrl,
      }));
      toast.success(t("brandKitDetail.referenceImageUploaded"));
    } catch (error) {
      URL.revokeObjectURL(localPreviewUrl);
      toast.error(
        error instanceof Error
          ? error.message
          : t("brandKitDetail.couldNotUploadReferenceImage"),
      );
    } finally {
      setReferenceUploadPending(null);
    }
  }

  async function uploadSkeletonImage(
    files: FileList | null,
    target: "background" | "mask" = "background",
  ) {
    const pending =
      target === "mask" ? skeletonMaskUploadPending : skeletonUploadPending;
    if (!files?.length || !libraryId || readOnly || pending) return;
    const file = files[0];
    const localPreviewUrl = URL.createObjectURL(file);
    const body = new FormData();
    body.append("libraryId", libraryId);
    body.append("category", "skeleton");
    body.append("files", file);
    if (target === "mask") {
      setSkeletonMaskUploadPending(true);
    } else {
      setSkeletonUploadPending(true);
    }
    try {
      const response = await fetch(`${appBasePath()}/api/assets/upload`, {
        method: "POST",
        body,
      });
      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(
          errorBody?.error || `Upload failed (${response.status})`,
        );
      }
      const result = (await response
        .json()
        .catch(() => null)) as AssetUploadResult | null;
      const assetId = uploadedSkeletonAssetId(result);
      if (!assetId) {
        throw new Error(
          result?.errors?.[0]?.message ??
            (target === "mask"
              ? t("brandKitDetail.couldNotUploadSkeletonMask")
              : t("brandKitDetail.couldNotUploadSkeletonImage")),
        );
      }
      updateForm(
        target === "mask"
          ? {
              skeletonMaskAssetId: assetId,
              skeletonMaskPreviewUrl: localPreviewUrl,
            }
          : {
              skeletonBackgroundAssetId: assetId,
              skeletonBackgroundPreviewUrl: localPreviewUrl,
            },
      );
      toast.success(
        target === "mask"
          ? t("brandKitDetail.skeletonMaskUploaded")
          : t("brandKitDetail.skeletonImageUploaded"),
      );
    } catch (error) {
      URL.revokeObjectURL(localPreviewUrl);
      toast.error(
        error instanceof Error
          ? error.message
          : target === "mask"
            ? t("brandKitDetail.couldNotUploadSkeletonMask")
            : t("brandKitDetail.couldNotUploadSkeletonImage"),
      );
    } finally {
      if (target === "mask") {
        setSkeletonMaskUploadPending(false);
        if (skeletonMaskFileInputRef.current) {
          skeletonMaskFileInputRef.current.value = "";
        }
      } else {
        setSkeletonUploadPending(false);
        if (skeletonFileInputRef.current) {
          skeletonFileInputRef.current.value = "";
        }
      }
    }
  }

  async function save() {
    if (!preset || !form || readOnly || updatePreset.isPending) return;
    const normalized = normalizedForm(form);
    if (!normalized.title) return;
    if (normalized.skeletonEnabled && !normalized.skeletonBackgroundAssetId) {
      toast.error(t("brandKitDetail.skeletonImageRequired"));
      return;
    }
    if (referenceImageCounts.total > 8) {
      toast.error(t("brandKitDetail.referenceBoardTotalLimitError"));
      return;
    }
    if (referenceImageCounts.subject > 4) {
      toast.error(t("brandKitDetail.referenceBoardSubjectLimitError"));
      return;
    }
    try {
      const saved = await updatePreset.mutateAsync({
        id: preset.id,
        title: normalized.title,
        description: normalized.description || null,
        category: normalized.category,
        promptTemplate: normalized.promptTemplate || null,
        aspectRatio: normalized.aspectRatio,
        imageSize: normalized.imageSize,
        model: normalized.model,
        textPolicy: normalized.textPolicy,
        referencePolicy: normalized.referencePolicy,
        includeLogo: normalized.includeLogo,
        settings: {
          skeletonSpec: buildSkeletonSpec(
            normalized,
            skeletonFromPreset(preset),
          ),
          presetReferences: normalized.presetReferences.length
            ? normalized.presetReferences
            : null,
        },
        collectionId: normalized.collectionId,
        sortOrder: Number(normalized.sortOrder),
      });
      const next = formFromPreset(saved, assets);
      if (
        normalized.skeletonBackgroundAssetId &&
        !next.skeletonBackgroundPreviewUrl
      ) {
        next.skeletonBackgroundPreviewUrl = form.skeletonBackgroundPreviewUrl;
      }
      if (normalized.skeletonMaskAssetId && !next.skeletonMaskPreviewUrl) {
        next.skeletonMaskPreviewUrl = form.skeletonMaskPreviewUrl;
      }
      setForm(next);
      setInitialForm(next);
      toast.success(t("brandKitDetail.generationPresetSaved"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("brandKitDetail.couldNotSavePreset"),
      );
    }
  }

  async function deleteCurrentPreset() {
    if (!preset || readOnly || deletePreset.isPending) return;
    try {
      await deletePreset.mutateAsync({ id: preset.id });
      toast.success(t("brandKitDetail.generationPresetDeleted"));
      navigate(settingsHref);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("brandKitDetail.couldNotDeletePreset"),
      );
    }
  }

  const referenceUploadTargetIndex =
    pickerReferenceIndex ?? activeReferenceIndex;
  const referenceUploadTarget =
    referenceUploadTargetIndex == null
      ? null
      : (form?.presetReferences[referenceUploadTargetIndex] ?? null);
  const referenceUploadDisabled =
    readOnly ||
    referenceUploadTargetIndex == null ||
    !referenceUploadTarget ||
    referenceUploadTarget.assetIds.length >= 4 ||
    Boolean(referenceUploadPending);

  function openReferencePicker(index: number) {
    setPickerReferenceIndex(index);
    setReferenceAssetSearch("");
  }

  function renderReferenceEditor(entry: PresetReference, index: number) {
    const uploadPending = referenceUploadPending === entry.id;
    const mode = referenceMode(entry);
    return (
      <div className="grid gap-4">
        <div className="grid gap-2">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <div className="text-xs font-medium text-muted-foreground">
              {t("brandKitDetail.referenceImageCount", {
                count: entry.assetIds.length,
                max: 4,
              })}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-2"
                disabled={readOnly || entry.assetIds.length >= 4}
                onClick={() => openReferencePicker(index)}
              >
                <IconPhotoPlus className="h-4 w-4" />
                {t("brandKitDetail.chooseReferenceImage")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-2"
                disabled={
                  readOnly || uploadPending || entry.assetIds.length >= 4
                }
                onClick={() => referenceUploadInputRef.current?.click()}
              >
                {uploadPending ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <IconUpload className="h-4 w-4" />
                )}
                {uploadPending
                  ? t("brandKitDetail.uploadingReferenceImage")
                  : t("brandKitDetail.uploadReferenceImage")}
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {entry.assetIds.map((assetId) => {
              const asset = assets.find((item: any) => item.id === assetId);
              const src =
                referencePreviewUrls[assetId] || previewUrlForAsset(asset);
              return (
                <div
                  key={assetId}
                  className="group relative aspect-square overflow-hidden rounded-md border border-border bg-muted"
                >
                  {src ? (
                    <img
                      src={src}
                      alt={assetDisplayTitle(asset)}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center px-2 text-center text-[11px] text-muted-foreground">
                      {t("brandKitDetail.previewUnavailable")}
                    </div>
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="absolute right-1 top-1 h-6 w-6 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                    disabled={readOnly}
                    onClick={() => removeReferenceAsset(index, assetId)}
                    aria-label={t("brandKitDetail.removeReferenceImage")}
                  >
                    <IconX className="h-3.5 w-3.5" />
                  </Button>
                </div>
              );
            })}
            {entry.assetIds.length === 0 ? (
              <button
                type="button"
                className="col-span-4 flex aspect-[4/1] items-center justify-center rounded-md border border-dashed border-border bg-muted/40 px-3 text-center text-xs text-muted-foreground transition hover:border-foreground/30 hover:text-foreground"
                disabled={readOnly}
                onClick={() => openReferencePicker(index)}
              >
                {entry.variable
                  ? t("brandKitDetail.filledPerGeneration")
                  : t("brandKitDetail.noReferenceImages")}
              </button>
            ) : null}
          </div>
        </div>

        <div className="grid gap-2">
          <FieldLabel htmlFor={`reference-label-${entry.id}`}>
            {t("brandKitDetail.referenceLabel")}
          </FieldLabel>
          <Input
            id={`reference-label-${entry.id}`}
            value={entry.label}
            maxLength={60}
            disabled={readOnly}
            autoFocus={autofocusReferenceIndex === index}
            onFocus={() => setAutofocusReferenceIndex(null)}
            onChange={(event) =>
              updatePresetReference(index, {
                label: event.target.value,
              })
            }
          />
        </div>

        <div className="grid gap-2">
          <FieldLabel>{t("brandKitDetail.referenceRoleLabel")}</FieldLabel>
          <Select
            value={entry.role}
            disabled={readOnly}
            onValueChange={(value) =>
              updatePresetReference(index, {
                role: value as PresetReferenceRole,
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRESET_REFERENCE_ROLES.map((role) => (
                <SelectItem key={role} value={role}>
                  {t(`brandKitDetail.referenceRole_${role}` as any)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-2">
          <FieldLabel htmlFor={`reference-description-${entry.id}`}>
            {t("brandKitDetail.referenceDescription")}
          </FieldLabel>
          <Textarea
            id={`reference-description-${entry.id}`}
            value={entry.description ?? ""}
            maxLength={400}
            disabled={readOnly}
            placeholder={t("brandKitDetail.referenceDescriptionPlaceholder")}
            onChange={(event) =>
              updatePresetReference(index, {
                description: event.target.value,
              })
            }
          />
        </div>

        <div className="grid gap-2">
          <FieldLabel>{t("brandKitDetail.referenceMode")}</FieldLabel>
          <div
            className="grid grid-cols-3 rounded-md border border-border bg-muted/30 p-1"
            role="radiogroup"
          >
            {(["fixed", "swappable", "required"] as const).map((item) => {
              const selected = mode === item;
              const label =
                item === "fixed"
                  ? t("brandKitDetail.fixedReference")
                  : item === "swappable"
                    ? t("brandKitDetail.swappableReference")
                    : t("brandKitDetail.requiredPerRun");
              return (
                <button
                  key={item}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={readOnly}
                  className={cn(
                    "h-8 rounded-sm px-2 text-xs font-medium text-muted-foreground transition",
                    selected
                      ? "bg-background text-foreground shadow-sm"
                      : "hover:text-foreground",
                  )}
                  onClick={() =>
                    updatePresetReference(index, referenceModePatch(item))
                  }
                >
                  <span className="block truncate">{label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t pt-3">
          <Button
            type="button"
            variant="ghost"
            className="h-8 px-0 text-destructive hover:text-destructive"
            disabled={readOnly}
            onClick={() => removePresetReference(index)}
          >
            {t("brandKitDetail.removeReference")}
          </Button>
        </div>
      </div>
    );
  }

  function renderReferenceTile(entry: PresetReference, index: number) {
    const firstAssetId = entry.assetIds[0];
    const firstAsset = firstAssetId
      ? assets.find((item: any) => item.id === firstAssetId)
      : null;
    const src =
      (firstAssetId && referencePreviewUrls[firstAssetId]) ||
      previewUrlForAsset(firstAsset);
    const variableEmpty = entry.variable && entry.assetIds.length === 0;
    const tileButton = (
      <button
        type="button"
        className={cn(
          "group block min-w-0 text-left outline-none",
          readOnly && "cursor-default",
        )}
        disabled={readOnly}
        onClick={() => setActiveReferenceIndex(index)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setActiveReferenceIndex(index);
          }
        }}
      >
        <div
          className={cn(
            "relative aspect-square overflow-hidden rounded-md border border-border bg-muted transition group-hover:border-foreground/30 group-focus-visible:ring-2 group-focus-visible:ring-ring",
            entry.variable && "border-dashed",
            variableEmpty && "bg-muted/30",
          )}
        >
          {src && !variableEmpty ? (
            <img
              src={src}
              alt={entry.label}
              className="h-full w-full object-cover transition group-hover:scale-[1.02]"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-3 text-center text-muted-foreground">
              <IconUserPlus className="h-8 w-8" />
              <span className="text-xs font-medium">
                {variableEmpty
                  ? t("brandKitDetail.filledPerGeneration")
                  : t("brandKitDetail.noReferenceImages")}
              </span>
            </div>
          )}
          {entry.assetIds.length > 1 ? (
            <Badge className="absolute right-2 top-2 h-6 px-2 shadow-sm">
              {t("brandKitDetail.moreImagesCount", {
                count: entry.assetIds.length - 1,
              })}
            </Badge>
          ) : null}
          {entry.required ? (
            <Badge
              variant="secondary"
              className="absolute left-2 top-2 h-6 px-2 shadow-sm"
            >
              {t("brandKitDetail.required")}
            </Badge>
          ) : null}
          <Badge className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)] truncate px-2 shadow-sm">
            {t(`brandKitDetail.referenceRole_${entry.role}` as any)}
          </Badge>
        </div>
        <div className="mt-2 min-w-0">
          <div className="truncate text-sm font-medium">
            {entry.label || t("brandKitDetail.referenceDefaultLabel")}
          </div>
          {variableEmpty ? (
            <div className="truncate text-xs text-muted-foreground">
              {t("brandKitDetail.filledPerGeneration")}
            </div>
          ) : null}
        </div>
      </button>
    );

    if (isSmallEditorViewport) return tileButton;

    return (
      <Popover
        open={activeReferenceIndex === index}
        onOpenChange={(open) => {
          setActiveReferenceIndex(open ? index : null);
          if (!open) setAutofocusReferenceIndex(null);
        }}
      >
        <PopoverTrigger asChild>{tileButton}</PopoverTrigger>
        <PopoverContent align="start" className="w-[420px] max-w-[90vw] p-4">
          {renderReferenceEditor(entry, index)}
        </PopoverContent>
      </Popover>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-6">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!library || !preset) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-10">
        <Button variant="ghost" className="w-fit gap-2" asChild>
          <Link to="/library">
            <IconArrowLeft className="h-4 w-4" />
            {t("brandKitDetail.backToLibrary")}
          </Link>
        </Button>
        <Alert>
          <AlertTitle>{t("brandKitDetail.presetUnavailableTitle")}</AlertTitle>
          <AlertDescription>
            {t("brandKitDetail.presetUnavailableDescription")}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!form) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-6">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-6">
      <div className="flex flex-col gap-4 border-b border-border pb-5 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <Button variant="ghost" className="-ms-3 mb-3 gap-2" asChild>
            <Link to={settingsHref}>
              <IconArrowLeft className="h-4 w-4" />
              {t("brandKitDetail.backToSettings")}
            </Link>
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              {form.title || t("brandKitDetail.editGenerationPreset")}
            </h1>
            <Badge variant="outline">{library.title}</Badge>
            {readOnly ? (
              <Badge variant="secondary" className="gap-1">
                <IconLock className="h-3.5 w-3.5" />
                {t("brandKitDetail.readOnly")}
              </Badge>
            ) : null}
          </div>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            {t("brandKitDetail.editGenerationPresetDescription")}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            variant="outline"
            className="gap-2 text-destructive hover:text-destructive"
            disabled={readOnly || deletePreset.isPending}
            onClick={() => setDeleteOpen(true)}
          >
            <IconTrash className="h-4 w-4" />
            {t("brandKitDetail.delete")}
          </Button>
          <Button
            className="gap-2"
            disabled={
              readOnly ||
              updatePreset.isPending ||
              !dirty ||
              !form.title.trim() ||
              (form.skeletonEnabled && !form.skeletonBackgroundAssetId)
            }
            onClick={save}
          >
            {updatePreset.isPending ? (
              <Spinner className="h-4 w-4" />
            ) : (
              <IconDeviceFloppy className="h-4 w-4" />
            )}
            {updatePreset.isPending
              ? t("brandKitDetail.saving")
              : t("brandKitDetail.saveChanges")}
          </Button>
        </div>
      </div>

      {readOnly ? (
        <Alert>
          <IconLock className="h-4 w-4" />
          <AlertTitle>{t("brandKitDetail.viewerModeTitle")}</AlertTitle>
          <AlertDescription>
            {t("brandKitDetail.viewerModeDescription")}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section className="grid gap-5">
          <div className="grid gap-2">
            <FieldLabel htmlFor="preset-title">
              {t("brandKitDetail.name")}
            </FieldLabel>
            <Input
              id="preset-title"
              value={form.title}
              disabled={readOnly}
              onChange={(event) => updateForm({ title: event.target.value })}
              placeholder={t("brandKitDetail.campaignLaunch")}
            />
          </div>
          <div className="grid gap-2">
            <FieldLabel htmlFor="preset-description">
              {t("brandKitDetail.description")}
            </FieldLabel>
            <Textarea
              id="preset-description"
              value={form.description}
              disabled={readOnly}
              onChange={(event) =>
                updateForm({ description: event.target.value })
              }
              placeholder={t("brandKitDetail.presetDescriptionPlaceholder")}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <FieldLabel>{t("brandKitDetail.category")}</FieldLabel>
              <Select
                value={form.category}
                disabled={readOnly}
                onValueChange={(value) =>
                  updateForm({ category: value as ImageCategory })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IMAGE_CATEGORIES.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <FieldLabel>{t("brandKitDetail.aspectRatio")}</FieldLabel>
              <Select
                value={form.aspectRatio}
                disabled={readOnly}
                onValueChange={(value) =>
                  updateForm({ aspectRatio: value as AspectRatio })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {supportedRatios.map((ratio) => (
                    <SelectItem key={ratio} value={ratio}>
                      {ratio}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid min-w-0 gap-4 rounded-md border border-border p-4">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  {t("brandKitDetail.referenceBoard")}
                </div>
                {form.presetReferences.length ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge variant="outline">
                      {t("brandKitDetail.referenceImageCount", {
                        count: referenceImageCounts.total,
                        max: 8,
                      })}
                    </Badge>
                    <Badge variant="outline">
                      {t("brandKitDetail.referenceSubjectImageCount", {
                        count: referenceImageCounts.subject,
                        max: 4,
                      })}
                    </Badge>
                  </div>
                ) : (
                  <div className="mt-2 max-w-xl text-sm text-muted-foreground">
                    {t("brandKitDetail.referenceBoardEmptyDescription")}
                  </div>
                )}
              </div>
              <div className="grid w-full min-w-0 gap-2 md:w-60">
                <FieldLabel>{t("brandKitDetail.referencePolicy")}</FieldLabel>
                <Select
                  value={form.referencePolicy}
                  disabled={readOnly}
                  onValueChange={(value) =>
                    updateForm({
                      referencePolicy: value as GenerationPresetReferencePolicy,
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GENERATION_PRESET_REFERENCE_POLICIES.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {form.presetReferences.length === 0 ? (
              <Button
                type="button"
                variant="outline"
                className="w-fit gap-2"
                disabled={readOnly}
                onClick={addPresetReference}
              >
                <IconPlus className="h-4 w-4" />
                {t("brandKitDetail.addReference")}
              </Button>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {form.presetReferences.map((entry, index) => (
                  <div key={entry.id} className="min-w-0">
                    {renderReferenceTile(entry, index)}
                  </div>
                ))}
                {form.presetReferences.length < 6 ? (
                  <button
                    type="button"
                    className="group block min-w-0 text-left outline-none"
                    disabled={readOnly}
                    onClick={addPresetReference}
                  >
                    <div className="flex aspect-square items-center justify-center rounded-md border border-dashed border-border bg-muted/30 text-muted-foreground transition group-hover:border-foreground/30 group-hover:text-foreground group-focus-visible:ring-2 group-focus-visible:ring-ring">
                      <IconPlus className="h-8 w-8" />
                    </div>
                    <div className="mt-2 truncate text-sm font-medium">
                      {t("brandKitDetail.addReference")}
                    </div>
                  </button>
                ) : null}
              </div>
            )}
          </div>
          <div className="grid gap-2">
            <FieldLabel htmlFor="preset-template">
              {t("brandKitDetail.promptTemplate")}
            </FieldLabel>
            <Textarea
              id="preset-template"
              className="min-h-36"
              value={form.promptTemplate}
              disabled={readOnly}
              onChange={(event) =>
                updateForm({ promptTemplate: event.target.value })
              }
              placeholder={t("library.promptTemplatePlaceholder")}
            />
          </div>
          <div className="grid gap-2">
            <FieldLabel htmlFor="preset-text-policy">
              {t("brandKitDetail.textPolicy")}
            </FieldLabel>
            <Textarea
              id="preset-text-policy"
              value={form.textPolicy}
              disabled={readOnly}
              onChange={(event) =>
                updateForm({ textPolicy: event.target.value })
              }
              placeholder={t("brandKitDetail.defaultTextPolicy")}
            />
          </div>
          <label
            htmlFor="preset-include-logo"
            className={cn(
              "flex items-start gap-3 rounded-md border border-border p-3",
              readOnly && "opacity-70",
            )}
          >
            <Checkbox
              id="preset-include-logo"
              checked={form.includeLogo}
              disabled={readOnly}
              onCheckedChange={(checked) =>
                updateForm({ includeLogo: checked === true })
              }
              className="mt-0.5"
            />
            <span className="grid gap-1">
              <span className="text-sm font-medium leading-none">
                {t("brandKitDetail.compositeCanonicalLogo")}
              </span>
              <span className="text-xs text-muted-foreground">
                {t("brandKitDetail.compositeCanonicalLogoHint")}
              </span>
            </span>
          </label>
          <div className="grid min-w-0 gap-4 rounded-md border border-border p-4">
            <label
              htmlFor="preset-skeleton-enabled"
              className={cn("flex items-start gap-3", readOnly && "opacity-70")}
            >
              <Checkbox
                id="preset-skeleton-enabled"
                checked={form.skeletonEnabled}
                disabled={readOnly}
                onCheckedChange={(checked) =>
                  updateSkeletonEnabled(checked === true)
                }
                className="mt-0.5"
              />
              <span className="grid gap-1">
                <span className="text-sm font-medium leading-none">
                  {t("brandKitDetail.presetSkeleton")}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("brandKitDetail.presetSkeletonHint")}
                </span>
              </span>
            </label>
            {form.skeletonEnabled ? (
              <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <FieldLabel>{t("brandKitDetail.contentMode")}</FieldLabel>
                  <Select
                    value={form.skeletonContentMode}
                    disabled={readOnly}
                    onValueChange={(value) =>
                      updateSkeletonContentMode(value as SkeletonContentMode)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fill">
                        {t("brandKitDetail.contentModeFill")}
                      </SelectItem>
                      <SelectItem value="cutout">
                        {t("brandKitDetail.contentModeCutout")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid min-w-0 gap-3 sm:col-span-2">
                  <FieldLabel>{t("brandKitDetail.skeletonImage")}</FieldLabel>
                  <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(12rem,1fr)_minmax(12rem,16rem)]">
                    <button
                      type="button"
                      className={cn(
                        "relative aspect-video overflow-hidden rounded-md border border-dashed border-border bg-muted text-left transition-colors hover:border-foreground/40 disabled:cursor-not-allowed disabled:opacity-70",
                        form.skeletonBackgroundPreviewUrl && "border-solid",
                      )}
                      disabled={readOnly || skeletonUploadPending}
                      onClick={() => skeletonFileInputRef.current?.click()}
                    >
                      {form.skeletonBackgroundPreviewUrl ? (
                        <img
                          src={form.skeletonBackgroundPreviewUrl}
                          alt=""
                          className="absolute inset-0 h-full w-full object-cover"
                        />
                      ) : (
                        <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
                          <IconPhotoPlus className="h-7 w-7" />
                          <span>{t("brandKitDetail.uploadSkeletonImage")}</span>
                        </span>
                      )}
                    </button>
                    <div className="grid min-w-0 content-start gap-2">
                      <input
                        ref={skeletonFileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={readOnly || skeletonUploadPending}
                        onChange={(event) =>
                          void uploadSkeletonImage(event.target.files)
                        }
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full min-w-0 gap-2"
                        disabled={readOnly || skeletonUploadPending}
                        onClick={() => skeletonFileInputRef.current?.click()}
                      >
                        {skeletonUploadPending ? (
                          <Spinner className="h-4 w-4" />
                        ) : (
                          <IconUpload className="h-4 w-4" />
                        )}
                        <span className="min-w-0 truncate">
                          {skeletonUploadPending
                            ? t("brandKitDetail.uploadingSkeletonImage")
                            : t("brandKitDetail.uploadSkeletonImage")}
                        </span>
                      </Button>
                      <Select
                        value={
                          form.skeletonBackgroundAssetId ||
                          NO_SKELETON_BACKGROUND
                        }
                        disabled={readOnly || !skeletonBackgroundAssets.length}
                        onValueChange={updateSkeletonBackgroundAsset}
                      >
                        <SelectTrigger className="min-w-0">
                          <SelectValue
                            placeholder={t(
                              "brandKitDetail.chooseSkeletonImage",
                            )}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_SKELETON_BACKGROUND}>
                            {t("brandKitDetail.noSkeletonImage")}
                          </SelectItem>
                          {skeletonBackgroundAssets.map((asset: any) => (
                            <SelectItem key={asset.id} value={asset.id}>
                              {asset.title || asset.id}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        {t("brandKitDetail.skeletonImageHint")}
                      </p>
                    </div>
                  </div>
                </div>
                {form.skeletonContentMode === "cutout" &&
                form.model === "gpt-image-2" ? (
                  <div className="grid min-w-0 gap-3 sm:col-span-2">
                    <FieldLabel>{t("brandKitDetail.skeletonMask")}</FieldLabel>
                    <div className="grid min-w-0 gap-3 md:grid-cols-[minmax(12rem,1fr)_minmax(12rem,16rem)]">
                      <button
                        type="button"
                        className={cn(
                          "relative aspect-video overflow-hidden rounded-md border border-dashed border-border bg-muted text-left transition-colors hover:border-foreground/40 disabled:cursor-not-allowed disabled:opacity-70",
                          form.skeletonMaskPreviewUrl && "border-solid",
                        )}
                        disabled={readOnly || skeletonMaskUploadPending}
                        onClick={() =>
                          skeletonMaskFileInputRef.current?.click()
                        }
                      >
                        {form.skeletonMaskPreviewUrl ? (
                          <img
                            src={form.skeletonMaskPreviewUrl}
                            alt=""
                            className="absolute inset-0 h-full w-full object-cover"
                          />
                        ) : (
                          <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
                            <IconPhotoPlus className="h-7 w-7" />
                            <span>
                              {t("brandKitDetail.uploadSkeletonMask")}
                            </span>
                          </span>
                        )}
                      </button>
                      <div className="grid min-w-0 content-start gap-2">
                        <input
                          ref={skeletonMaskFileInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={readOnly || skeletonMaskUploadPending}
                          onChange={(event) =>
                            void uploadSkeletonImage(event.target.files, "mask")
                          }
                        />
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full min-w-0 gap-2"
                          disabled={readOnly || skeletonMaskUploadPending}
                          onClick={() =>
                            skeletonMaskFileInputRef.current?.click()
                          }
                        >
                          {skeletonMaskUploadPending ? (
                            <Spinner className="h-4 w-4" />
                          ) : (
                            <IconUpload className="h-4 w-4" />
                          )}
                          <span className="min-w-0 truncate">
                            {skeletonMaskUploadPending
                              ? t("brandKitDetail.uploadingSkeletonMask")
                              : t("brandKitDetail.uploadSkeletonMask")}
                          </span>
                        </Button>
                        <Select
                          value={form.skeletonMaskAssetId || NO_SKELETON_MASK}
                          disabled={
                            readOnly || !skeletonBackgroundAssets.length
                          }
                          onValueChange={updateSkeletonMaskAsset}
                        >
                          <SelectTrigger className="min-w-0">
                            <SelectValue
                              placeholder={t(
                                "brandKitDetail.chooseSkeletonMask",
                              )}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NO_SKELETON_MASK}>
                              {t("brandKitDetail.noSkeletonMask")}
                            </SelectItem>
                            {skeletonBackgroundAssets.map((asset: any) => (
                              <SelectItem key={asset.id} value={asset.id}>
                                {asset.title || asset.id}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          {t("brandKitDetail.skeletonMaskHint")}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null}
                {form.skeletonContentMode === "cutout" ? (
                  <label
                    htmlFor="preset-skeleton-shadow"
                    className={cn(
                      "flex items-start gap-3 rounded-md border border-border p-3 sm:col-span-2",
                      readOnly && "opacity-70",
                    )}
                  >
                    <Checkbox
                      id="preset-skeleton-shadow"
                      checked={form.skeletonDropShadow}
                      disabled={readOnly}
                      onCheckedChange={(checked) =>
                        updateForm({ skeletonDropShadow: checked === true })
                      }
                      className="mt-0.5"
                    />
                    <span className="grid gap-1">
                      <span className="text-sm font-medium leading-none">
                        {t("brandKitDetail.contactShadow")}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t("brandKitDetail.contactShadowHint")}
                      </span>
                    </span>
                  </label>
                ) : null}
                {!usesSkeletonInpaintMode(form) ? (
                  <>
                    <label
                      htmlFor="preset-skeleton-logo"
                      className={cn(
                        "flex items-start gap-3 rounded-md border border-border p-3",
                        readOnly && "opacity-70",
                      )}
                    >
                      <Checkbox
                        id="preset-skeleton-logo"
                        checked={form.skeletonLogo}
                        disabled={readOnly || !library?.canonicalLogoAssetId}
                        onCheckedChange={(checked) =>
                          updateForm({ skeletonLogo: checked === true })
                        }
                        className="mt-0.5"
                      />
                      <span className="grid gap-1">
                        <span className="text-sm font-medium leading-none">
                          {t("brandKitDetail.placeLogoInSkeleton")}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {t("brandKitDetail.placeLogoInSkeletonHint")}
                        </span>
                      </span>
                    </label>
                    <div className="grid gap-2">
                      <FieldLabel>
                        {t("brandKitDetail.logoPlacement")}
                      </FieldLabel>
                      <Select
                        value={form.skeletonLogoPlacement}
                        disabled={readOnly || !form.skeletonLogo}
                        onValueChange={(value) =>
                          updateForm({
                            skeletonLogoPlacement:
                              value as SkeletonLogoPlacement,
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="upper-right">
                            {t("brandKitDetail.upperRight")}
                          </SelectItem>
                          <SelectItem value="upper-left">
                            {t("brandKitDetail.upperLeft")}
                          </SelectItem>
                          <SelectItem value="lower-right">
                            {t("brandKitDetail.lowerRight")}
                          </SelectItem>
                          <SelectItem value="lower-left">
                            {t("brandKitDetail.lowerLeft")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>

          <Separator />

          <div className="grid gap-4">
            <Button
              type="button"
              variant="ghost"
              className="w-fit gap-2 px-0"
              onClick={() => setAdvancedOpen((current) => !current)}
            >
              <IconChevronDown
                className={cn(
                  "h-4 w-4 transition-transform",
                  advancedOpen && "rotate-180",
                )}
              />
              {advancedOpen
                ? t("brandKitDetail.hideAdvancedOptions")
                : t("brandKitDetail.showAdvancedOptions")}
            </Button>
            {advancedOpen ? (
              <div className="grid gap-4 rounded-md border border-border p-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <FieldLabel>{t("brandKitDetail.model")}</FieldLabel>
                  <Select
                    value={form.model}
                    disabled={readOnly}
                    onValueChange={(value) => updateModel(value as ImageModel)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {modelOptions.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {form.presetReferences.some(
                    (entry) => entry.role === "subject",
                  ) ? (
                    <p className="text-xs text-muted-foreground">
                      {t("brandKitDetail.subjectReferenceModelTip")}
                    </p>
                  ) : null}
                </div>
                <div className="grid gap-2">
                  <FieldLabel>{t("brandKitDetail.imageSize")}</FieldLabel>
                  <Select
                    value={form.imageSize}
                    disabled={readOnly}
                    onValueChange={(value) =>
                      updateForm({ imageSize: value as ImageSize })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {IMAGE_SIZES.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <FieldLabel>{t("brandKitDetail.collection")}</FieldLabel>
                  <Select
                    value={form.collectionId ?? NO_COLLECTION}
                    disabled={readOnly}
                    onValueChange={(value) =>
                      updateForm({
                        collectionId: value === NO_COLLECTION ? null : value,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_COLLECTION}>
                        {t("brandKitDetail.noCollection")}
                      </SelectItem>
                      {collections.map((collection: any) => (
                        <SelectItem key={collection.id} value={collection.id}>
                          {collection.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <FieldLabel htmlFor="preset-sort-order">
                    {t("brandKitDetail.sortOrder")}
                  </FieldLabel>
                  <Input
                    id="preset-sort-order"
                    type="number"
                    value={form.sortOrder}
                    disabled={readOnly}
                    onChange={(event) =>
                      updateForm({ sortOrder: event.target.value })
                    }
                  />
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="h-fit rounded-md border border-border p-4">
          <div className="text-sm font-medium">
            {t("brandKitDetail.presetSummary")}
          </div>
          <dl className="mt-3 grid gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("brandKitDetail.model")}
              </dt>
              <dd className="mt-1 break-words">{form.model}</dd>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <dt className="text-xs text-muted-foreground">
                  {t("brandKitDetail.aspectRatio")}
                </dt>
                <dd className="mt-1">{form.aspectRatio}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  {t("brandKitDetail.imageSize")}
                </dt>
                <dd className="mt-1">{form.imageSize}</dd>
              </div>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("brandKitDetail.referencePolicy")}
              </dt>
              <dd className="mt-1">{form.referencePolicy}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("brandKitDetail.presetSkeleton")}
              </dt>
              <dd className="mt-1">
                {form.skeletonEnabled
                  ? t("brandKitDetail.skeletonEnabled")
                  : t("brandKitDetail.skeletonOff")}
              </dd>
              {form.skeletonEnabled ? <SkeletonPreview form={form} /> : null}
            </div>
          </dl>
        </aside>
      </div>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("brandKitDetail.deleteGenerationPreset")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("brandKitDetail.deleteGenerationPresetDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("brandKitDetail.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deletePreset.isPending}
              onClick={(event) => {
                event.preventDefault();
                void deleteCurrentPreset();
              }}
            >
              {deletePreset.isPending
                ? t("brandKitDetail.deleting")
                : t("brandKitDetail.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <input
        ref={referenceUploadInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        disabled={referenceUploadDisabled}
        onChange={(event) => {
          if (referenceUploadTargetIndex != null) {
            void uploadReferenceImage(
              event.currentTarget.files,
              referenceUploadTargetIndex,
            );
          }
          event.currentTarget.value = "";
        }}
      />

      <Sheet
        open={isSmallEditorViewport && activeReferenceEntry != null}
        onOpenChange={(open) => {
          if (!open) {
            setActiveReferenceIndex(null);
            setAutofocusReferenceIndex(null);
          }
        }}
      >
        <SheetContent side="bottom" className="max-h-[90vh] overflow-auto">
          <SheetHeader>
            <SheetTitle>
              {activeReferenceEntry?.label ||
                t("brandKitDetail.referenceDefaultLabel")}
            </SheetTitle>
            <SheetDescription>
              {t("brandKitDetail.editReference")}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4">
            {activeReferenceEntry && activeReferenceIndex != null
              ? renderReferenceEditor(
                  activeReferenceEntry,
                  activeReferenceIndex,
                )
              : null}
          </div>
        </SheetContent>
      </Sheet>

      <Dialog
        open={pickerReferenceEntry != null}
        onOpenChange={(open) => {
          if (!open) {
            setPickerReferenceIndex(null);
            setReferenceAssetSearch("");
          }
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {t("brandKitDetail.chooseReferenceImage")}
            </DialogTitle>
            <DialogDescription>
              {t("brandKitDetail.searchLibraryImages")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="relative">
              <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={referenceAssetSearch}
                onChange={(event) =>
                  setReferenceAssetSearch(event.target.value)
                }
                placeholder={t("brandKitDetail.searchLibraryImages")}
                className="pl-9"
              />
            </div>
            <div className="max-h-[54vh] overflow-auto rounded-md border border-border p-3">
              {filteredReferenceAssets.length ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                  {filteredReferenceAssets.map((asset: any) => {
                    const alreadyAdded = Boolean(
                      pickerReferenceEntry?.assetIds.includes(asset.id),
                    );
                    const src = previewUrlForAsset(asset);
                    return (
                      <button
                        key={asset.id}
                        type="button"
                        disabled={alreadyAdded || readOnly}
                        title={`${assetDisplayTitle(asset)} · ${asset.id}`}
                        className={cn(
                          "group min-w-0 rounded-md border border-border bg-background p-1 text-left outline-none transition hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring",
                          alreadyAdded && "cursor-default opacity-65",
                        )}
                        onClick={() => {
                          if (pickerReferenceIndex == null) return;
                          addReferenceAsset(pickerReferenceIndex, asset.id);
                        }}
                      >
                        <div className="relative aspect-square overflow-hidden rounded-sm bg-muted">
                          {src ? (
                            <img
                              src={src}
                              alt={assetDisplayTitle(asset)}
                              className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center px-2 text-center text-xs text-muted-foreground">
                              {t("brandKitDetail.previewUnavailable")}
                            </div>
                          )}
                          {alreadyAdded ? (
                            <div className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-background/95 shadow-sm">
                              <IconCheck className="h-4 w-4" />
                            </div>
                          ) : null}
                        </div>
                        <div className="mt-1 truncate px-0.5 text-xs font-medium">
                          {assetDisplayTitle(asset)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="flex min-h-32 items-center justify-center text-center text-sm text-muted-foreground">
                  {t("brandKitDetail.noReferenceImages")}
                </div>
              )}
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                disabled={referenceUploadDisabled}
                onClick={() => referenceUploadInputRef.current?.click()}
              >
                {referenceUploadPending ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <IconUpload className="h-4 w-4" />
                )}
                {referenceUploadPending
                  ? t("brandKitDetail.uploadingReferenceImage")
                  : t("brandKitDetail.uploadReferenceImage")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
