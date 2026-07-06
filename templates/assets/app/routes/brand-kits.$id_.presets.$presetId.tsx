import {
  insertAgentComposerReference,
  useActionMutation,
  useActionQuery,
  useT,
} from "@agent-native/core/client";
import {
  IconArrowLeft,
  IconChevronDown,
  IconDeviceFloppy,
  IconLock,
  IconTrash,
} from "@tabler/icons-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { messagesByLocale } from "@/i18n-data";
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
} from "../../shared/api";

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
};

const NO_COLLECTION = "__none__";

export function meta() {
  return [{ title: messagesByLocale["en-US"].routeTitles.generationPreset }];
}

function formFromPreset(preset: any): PresetFormState {
  return {
    title: preset?.title ?? "",
    description: preset?.description ?? "",
    category: preset?.category ?? "social",
    model: preset?.model ?? "gemini-3.1-flash-image",
    aspectRatio: preset?.aspectRatio ?? "1:1",
    imageSize: preset?.imageSize ?? "2K",
    referencePolicy: preset?.referencePolicy ?? "auto",
    collectionId: preset?.collectionId ?? null,
    promptTemplate: preset?.promptTemplate ?? "",
    textPolicy: preset?.textPolicy ?? "",
    includeLogo: preset?.includeLogo === true,
    sortOrder: String(preset?.sortOrder ?? 0),
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
  };
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

  const library = libraryData?.library;
  const collections = Array.isArray(libraryData?.collections)
    ? libraryData.collections
    : [];
  const presets = Array.isArray(presetData?.presets) ? presetData.presets : [];
  const preset = presets.find((item: any) => item.id === presetId);
  const loading = libraryLoading || presetsLoading;
  const accessRole = library?.accessRole;
  const readOnly = Boolean(accessRole && !isEditableRole(accessRole));

  useEffect(() => {
    if (!preset) return;
    const next = formFromPreset(preset);
    setForm(next);
    setInitialForm(next);
  }, [preset?.id, preset?.updatedAt]);

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
    () => (form ? supportedAspectRatiosForModel(form.model) : ASPECT_RATIOS),
    [form?.model],
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

  async function save() {
    if (!preset || !form || readOnly || updatePreset.isPending) return;
    const normalized = normalizedForm(form);
    if (!normalized.title) return;
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
        collectionId: normalized.collectionId,
        sortOrder: Number(normalized.sortOrder),
      });
      const next = formFromPreset(saved);
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
              readOnly || updatePreset.isPending || !dirty || !form.title.trim()
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
                      {IMAGE_MODELS.map((item) => (
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
