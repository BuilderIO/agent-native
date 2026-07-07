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
  IconChevronDown,
  IconDeviceFloppy,
  IconLock,
  IconPhotoPlus,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

import { Textarea } from "@/components/ui/textarea";
import { messagesByLocale } from "@/i18n-data";
import { assetMediaUrl } from "@/lib/asset-urls";
import type { AssetUploadResult } from "@/lib/upload-results";
import { cn } from "@/lib/utils";

import {
  ASPECT_RATIOS,
  GENERATION_PRESET_REFERENCE_POLICIES,
  IMAGE_CATEGORIES,
  IMAGE_MODELS,
  IMAGE_SIZES,
  supportedAspectRatiosForModel,
  type AspectRatio,
  type GenerationPresetReferencePolicy,
  type ImageCategory,
  type ImageModel,
  type ImageSize,
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
};

const NO_COLLECTION = "__none__";
const NO_SKELETON_BACKGROUND = "__none__";
const NO_SKELETON_MASK = "__none__";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.generationPreset }];
}

function skeletonFromPreset(preset: any): PresetSkeletonSpec | null {
  const spec = preset?.settings?.skeletonSpec;
  return spec && typeof spec === "object" ? (spec as PresetSkeletonSpec) : null;
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
    ...(form.skeletonLogo
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
  };
}

function previewUrlForAsset(asset: any): string {
  return (
    assetMediaUrl(
      asset?.thumbnailUrl ?? asset?.previewUrl ?? asset?.downloadUrl,
    ) ?? ""
  );
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
  const skeletonFileInputRef = useRef<HTMLInputElement | null>(null);
  const skeletonMaskFileInputRef = useRef<HTMLInputElement | null>(null);

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
          <div className="grid gap-4 rounded-md border border-border p-4">
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
              <div className="grid gap-4 sm:grid-cols-2">
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
                <div className="grid gap-3 sm:col-span-2">
                  <FieldLabel>{t("brandKitDetail.skeletonImage")}</FieldLabel>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_16rem]">
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
                    <div className="grid content-start gap-2">
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
                        className="gap-2"
                        disabled={readOnly || skeletonUploadPending}
                        onClick={() => skeletonFileInputRef.current?.click()}
                      >
                        {skeletonUploadPending ? (
                          <Spinner className="h-4 w-4" />
                        ) : (
                          <IconUpload className="h-4 w-4" />
                        )}
                        {skeletonUploadPending
                          ? t("brandKitDetail.uploadingSkeletonImage")
                          : t("brandKitDetail.uploadSkeletonImage")}
                      </Button>
                      <Select
                        value={
                          form.skeletonBackgroundAssetId ||
                          NO_SKELETON_BACKGROUND
                        }
                        disabled={readOnly || !skeletonBackgroundAssets.length}
                        onValueChange={updateSkeletonBackgroundAsset}
                      >
                        <SelectTrigger>
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
                  <div className="grid gap-3 sm:col-span-2">
                    <FieldLabel>{t("brandKitDetail.skeletonMask")}</FieldLabel>
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_16rem]">
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
                      <div className="grid content-start gap-2">
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
                          className="gap-2"
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
                          {skeletonMaskUploadPending
                            ? t("brandKitDetail.uploadingSkeletonMask")
                            : t("brandKitDetail.uploadSkeletonMask")}
                        </Button>
                        <Select
                          value={form.skeletonMaskAssetId || NO_SKELETON_MASK}
                          disabled={
                            readOnly || !skeletonBackgroundAssets.length
                          }
                          onValueChange={updateSkeletonMaskAsset}
                        >
                          <SelectTrigger>
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
                  <FieldLabel>{t("brandKitDetail.logoPlacement")}</FieldLabel>
                  <Select
                    value={form.skeletonLogoPlacement}
                    disabled={readOnly || !form.skeletonLogo}
                    onValueChange={(value) =>
                      updateForm({
                        skeletonLogoPlacement: value as SkeletonLogoPlacement,
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
                  <FieldLabel>{t("brandKitDetail.referencePolicy")}</FieldLabel>
                  <Select
                    value={form.referencePolicy}
                    disabled={readOnly}
                    onValueChange={(value) =>
                      updateForm({
                        referencePolicy:
                          value as GenerationPresetReferencePolicy,
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
    </div>
  );
}
