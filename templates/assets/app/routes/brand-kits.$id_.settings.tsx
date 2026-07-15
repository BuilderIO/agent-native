import {
  sendToAgentChat,
  useActionMutation,
  useActionQuery,
  useT,
} from "@agent-native/core/client";
import {
  useSetHeaderActions,
  useSetPageTitle,
} from "@agent-native/toolkit/app-shell";
import {
  IconArrowLeft,
  IconBulb,
  IconChevronDown,
  IconChevronRight,
  IconListCheck,
  IconPhoto,
  IconTextCaption,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useBeforeUnload,
  useBlocker,
  useNavigate,
  useParams,
} from "react-router";
import { toast } from "sonner";

import { GenerationPresetsPanel } from "@/components/library/GenerationPresetsPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getLibraryCustomInstructions } from "@/lib/libraries";

function paletteDraftFromColors(colors: unknown): string {
  return Array.isArray(colors)
    ? colors
        .filter((color) => typeof color === "string")
        .map((color) => color.toLowerCase())
        .join(", ")
    : "";
}

function parsePaletteDraft(value: string): string[] {
  const seen = new Set<string>();
  const colors: string[] = [];
  for (const raw of value.split(/[\s,]+/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const color = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
    if (!/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)) continue;
    const normalized = color.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    colors.push(normalized);
  }
  return colors;
}

export default function BrandKitSettingsRoute() {
  const t = useT();
  const navigate = useNavigate();
  const { id } = useParams();
  const libraryId = id ?? "";
  const { data } = useActionQuery("get-library", { id: libraryId }) as any;
  const { data: presetData } = useActionQuery("list-generation-presets", {
    libraryId,
  }) as any;
  const updateLibrary = useActionMutation("update-library");

  const library = data?.library;
  const assets = (data?.assets ?? []) as any[];
  const generationPresets = ((presetData as any)?.presets ?? []) as any[];

  const [titleDraft, setTitleDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [styleDescriptionDraft, setStyleDescriptionDraft] = useState("");
  const [customInstructionsDraft, setCustomInstructionsDraft] = useState("");
  const [paletteDraft, setPaletteDraft] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [initializedLibraryId, setInitializedLibraryId] = useState<
    string | null
  >(null);

  const isDirty = useMemo(() => {
    if (!library) return false;
    if (titleDraft.trim() !== (library.title ?? "")) return true;
    if (descriptionDraft.trim() !== (library.description ?? "")) return true;
    if (styleDescriptionDraft !== (library.styleBrief?.description ?? ""))
      return true;
    if (
      customInstructionsDraft.trim() !==
      (getLibraryCustomInstructions(library) ?? "")
    )
      return true;
    if (
      parsePaletteDraft(paletteDraft).join(", ") !==
      paletteDraftFromColors(library.styleBrief?.palette)
    )
      return true;
    return false;
  }, [
    library,
    titleDraft,
    descriptionDraft,
    styleDescriptionDraft,
    customInstructionsDraft,
    paletteDraft,
  ]);

  useEffect(() => {
    if (!library) return;
    if (initializedLibraryId === library.id && isDirty) return;
    setTitleDraft(library.title ?? "");
    setDescriptionDraft(library.description ?? "");
    setStyleDescriptionDraft(library.styleBrief?.description ?? "");
    setCustomInstructionsDraft(getLibraryCustomInstructions(library) ?? "");
    setPaletteDraft(paletteDraftFromColors(library.styleBrief?.palette));
    if (initializedLibraryId !== library.id) {
      const isNewLibrary =
        !library.description &&
        !getLibraryCustomInstructions(library) &&
        !library.styleBrief?.description &&
        !(library.styleBrief?.palette ?? []).length;
      setDetailsOpen(isNewLibrary);
      setInitializedLibraryId(library.id);
    }
  }, [library, initializedLibraryId, isDirty]);

  const isTitleValid = titleDraft.trim().length > 0;

  function saveAll() {
    if (!library || !isDirty || !isTitleValid) return;
    const trimmedTitle = titleDraft.trim();
    const palette = parsePaletteDraft(paletteDraft);
    updateLibrary.mutate(
      {
        id: library.id,
        title: trimmedTitle,
        description: descriptionDraft.trim() || null,
        customInstructions: customInstructionsDraft.trim(),
        styleBrief: {
          ...library.styleBrief,
          description: styleDescriptionDraft,
          palette,
        },
      },
      {
        onSuccess: () => {
          setPaletteDraft(palette.join(", "));
          toast.success(t("brandKits.updated"));
        },
        onError: (error: Error) =>
          toast.error(error.message || t("brandKits.updateFailed")),
      },
    );
  }

  const navigationBlocker = useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }) =>
        isDirty && currentLocation.pathname !== nextLocation.pathname,
      [isDirty],
    ),
  );

  useBeforeUnload(
    useCallback(
      (event: BeforeUnloadEvent) => {
        if (!isDirty) return;
        event.preventDefault();
        event.returnValue = "";
      },
      [isDirty],
    ),
  );

  function handleBack() {
    navigate(`/library/${libraryId}`);
  }

  function keepEditing() {
    if (navigationBlocker.state === "blocked") navigationBlocker.reset();
  }

  function discardAndLeave() {
    if (navigationBlocker.state === "blocked") navigationBlocker.proceed();
  }

  function analyzeBrand() {
    if (!library) return;
    const referenceCount = assets.filter(
      (asset) => asset.status === "reference",
    ).length;
    sendToAgentChat({
      message: [
        "Analyze this Assets library brand.",
        `Call analyze-collection-style with libraryId: ${library.id}.`,
        "Update the reusable style brief with palette and visual traits, then summarize what changed.",
      ].join("\n"),
      context: [
        "## Assets library context",
        `Library: ${library.title} (${library.id})`,
        `Description: ${library.description || ""}`,
        `Reference assets: ${referenceCount}`,
        `Current style brief: ${JSON.stringify(library.styleBrief ?? {})}`,
        getLibraryCustomInstructions(library)
          ? `Custom instructions: ${getLibraryCustomInstructions(library)}`
          : "Custom instructions: none",
      ].join("\n"),
      submit: true,
      newTab: true,
    });
  }

  useSetPageTitle(
    <div className="flex min-w-0 items-center gap-2">
      <Button
        variant="ghost"
        size="icon"
        className="-ms-2 h-7 w-7 shrink-0"
        onClick={handleBack}
        aria-label={t("brandKitDetail.backToLibrary")}
      >
        <IconArrowLeft className="h-4 w-4" />
      </Button>
      <h1 className="truncate text-lg font-semibold tracking-tight">
        {t("brandKitDetail.settingsTitle")}
      </h1>
      {library ? <Badge variant="outline">{library.title}</Badge> : null}
    </div>,
  );

  useSetHeaderActions(
    library ? (
      <Button
        size="sm"
        onClick={saveAll}
        disabled={!isDirty || !isTitleValid || updateLibrary.isPending}
      >
        {updateLibrary.isPending
          ? t("brandKitDetail.saving")
          : t("brandKitDetail.save")}
      </Button>
    ) : null,
  );

  if (!library) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        {t("library.loadingBrandKit")}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-6">
      <div className="flex flex-col gap-4">
        <div className="space-y-4 rounded-lg border border-border p-4">
          <Label htmlFor="brand-kit-title">{t("brandKitDetail.name")}</Label>
          <Input
            id="brand-kit-title"
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            placeholder={t("brandKits.namePlaceholder")}
          />
          <Label htmlFor="brand-kit-description">
            {t("assetDetail.description")}
          </Label>
          <Textarea
            id="brand-kit-description"
            value={descriptionDraft}
            onChange={(event) => setDescriptionDraft(event.target.value)}
            placeholder={t("brandKits.editDescriptionPlaceholder")}
          />
          <div>
            <h3 className="text-sm font-semibold">
              {t("brandKitDetail.agentUsage")}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("brandKitDetail.agentUsageDescription")}
            </p>
            <code className="mt-3 block rounded-md bg-muted p-3 text-xs">
              {library.id}
            </code>
          </div>
        </div>

        <div className="rounded-lg border border-border p-4">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 text-left"
            onClick={() => setDetailsOpen((open) => !open)}
            aria-expanded={detailsOpen}
          >
            <div>
              <h3 className="text-sm font-semibold">
                {t("brandKitDetail.setupGuide")}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("brandKitDetail.setupGuideDescription")}
              </p>
            </div>
            {detailsOpen ? (
              <IconChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <IconChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
          </button>
          {detailsOpen ? (
            <ul className="mt-4 space-y-3">
              <li className="flex gap-3">
                <IconPhoto className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div>
                  <div className="text-sm font-medium">
                    {t("brandKitDetail.setupGuideReferences")}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t("brandKitDetail.setupGuideReferencesHint")}
                  </p>
                </div>
              </li>
              <li className="flex gap-3">
                <IconTextCaption className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div>
                  <div className="text-sm font-medium">
                    {t("brandKitDetail.setupGuideStyleDescription")}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t("brandKitDetail.setupGuideStyleDescriptionHint")}
                  </p>
                </div>
              </li>
              <li className="flex gap-3">
                <IconListCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div>
                  <div className="text-sm font-medium">
                    {t("brandKitDetail.setupGuideInstructions")}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t("brandKitDetail.setupGuideInstructionsHint")}
                  </p>
                </div>
              </li>
              <li className="flex gap-3">
                <IconBulb className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div>
                  <div className="text-sm font-medium">
                    {t("brandKitDetail.setupGuidePresets")}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t("brandKitDetail.setupGuidePresetsHint")}
                  </p>
                </div>
              </li>
            </ul>
          ) : null}
        </div>
      </div>

      <div className="space-y-4 rounded-lg border border-border p-4">
        <Label>{t("brandKitDetail.styleDescription")}</Label>
        <Textarea
          value={styleDescriptionDraft}
          onChange={(event) => setStyleDescriptionDraft(event.target.value)}
          className="min-h-40"
        />
        <Label>{t("brandKitDetail.customInstructions")}</Label>
        <Textarea
          value={customInstructionsDraft}
          onChange={(event) => setCustomInstructionsDraft(event.target.value)}
          placeholder={t("brandKitDetail.customInstructionsPlaceholder")}
          className="min-h-28"
        />
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">
              {t("brandKitDetail.palette")}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {(library.styleBrief?.palette ?? []).map((color: string) => (
                <span
                  key={color}
                  className="h-7 w-7 rounded-md border border-border"
                  style={{ backgroundColor: color }}
                  title={color}
                />
              ))}
            </div>
            <Input
              value={paletteDraft}
              onChange={(event) => setPaletteDraft(event.target.value)}
              placeholder={"#111827, #f8fafc, #2563eb"}
              className="mt-3 h-9 max-w-md text-xs"
            />
          </div>
          <Button variant="outline" onClick={analyzeBrand}>
            {library.settings?.brandAnalysis?.analyzedAt
              ? t("brandKitDetail.refreshBrand")
              : t("brandKitDetail.analyzeBrand")}
          </Button>
        </div>
      </div>

      <GenerationPresetsPanel
        libraryId={libraryId}
        presets={generationPresets}
      />

      <Dialog
        open={navigationBlocker.state === "blocked"}
        onOpenChange={(open) => {
          if (!open) keepEditing();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("brandKitDetail.unsavedChangesTitle")}</DialogTitle>
            <DialogDescription>
              {t("brandKitDetail.unsavedChangesDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={keepEditing}>
              {t("brandKitDetail.keepEditing")}
            </Button>
            <Button variant="destructive" onClick={discardAndLeave}>
              {t("brandKitDetail.discardChanges")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
