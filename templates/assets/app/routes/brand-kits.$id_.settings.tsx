import {
  sendToAgentChat,
  useActionMutation,
  useActionQuery,
  useT,
} from "@agent-native/core/client";
import { IconArrowLeft } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";

import { GenerationPresetsPanel } from "@/components/library/GenerationPresetsPanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

function paletteDraftFromColors(colors: unknown): string {
  return Array.isArray(colors)
    ? colors.filter((color) => typeof color === "string").join(", ")
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

  useEffect(() => {
    if (!library) return;
    setTitleDraft(library.title ?? "");
    setDescriptionDraft(library.description ?? "");
    setStyleDescriptionDraft(library.styleBrief?.description ?? "");
    setCustomInstructionsDraft(library.customInstructions ?? "");
    setPaletteDraft(paletteDraftFromColors(library.styleBrief?.palette));
  }, [library]);

  function saveTitle() {
    const trimmed = titleDraft.trim();
    if (!library || !trimmed || trimmed === library.title) return;
    updateLibrary.mutate(
      { id: library.id, title: trimmed },
      {
        onSuccess: () => toast.success(t("brandKits.updated")),
        onError: (error: Error) =>
          toast.error(error.message || t("brandKits.updateFailed")),
      },
    );
  }

  function saveDescription() {
    if (!library || descriptionDraft.trim() === (library.description ?? ""))
      return;
    updateLibrary.mutate(
      { id: library.id, description: descriptionDraft.trim() || null },
      {
        onSuccess: () => toast.success(t("brandKits.updated")),
        onError: (error: Error) =>
          toast.error(error.message || t("brandKits.updateFailed")),
      },
    );
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
        library.customInstructions
          ? `Custom instructions: ${library.customInstructions}`
          : "Custom instructions: none",
      ].join("\n"),
      submit: true,
      newTab: true,
    });
  }

  if (!library) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        {t("library.loadingBrandKit")}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-6">
      <div className="border-b border-border pb-5">
        <Button variant="ghost" className="-ms-3 mb-3 gap-2" asChild>
          <Link to={`/library/${libraryId}`}>
            <IconArrowLeft className="h-4 w-4" />
            {t("brandKitDetail.backToLibrary")}
          </Link>
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="truncate text-2xl font-semibold tracking-tight">
            {t("library.settings")}
          </h1>
          <Badge variant="outline">{library.title}</Badge>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-4 rounded-lg border border-border p-4">
          <Label htmlFor="brand-kit-title">{t("brandKitDetail.name")}</Label>
          <Input
            id="brand-kit-title"
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={saveTitle}
            placeholder={t("brandKits.namePlaceholder")}
          />
          <Separator />
          <Label htmlFor="brand-kit-description">
            {t("assetDetail.description")}
          </Label>
          <Textarea
            id="brand-kit-description"
            value={descriptionDraft}
            onChange={(event) => setDescriptionDraft(event.target.value)}
            onBlur={saveDescription}
            placeholder={t("brandKits.editDescriptionPlaceholder")}
          />
        </div>

        <div className="rounded-lg border border-border p-4">
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

        <div className="space-y-4 rounded-lg border border-border p-4">
          <Label>{t("brandKitDetail.styleDescription")}</Label>
          <Textarea
            value={styleDescriptionDraft}
            onChange={(event) => setStyleDescriptionDraft(event.target.value)}
            onBlur={() =>
              updateLibrary.mutate({
                id: library.id,
                styleBrief: {
                  ...library.styleBrief,
                  description: styleDescriptionDraft,
                },
              })
            }
            className="min-h-40"
          />
          <Separator />
          <Label>{t("brandKitDetail.customInstructions")}</Label>
          <Textarea
            value={customInstructionsDraft}
            onChange={(event) =>
              setCustomInstructionsDraft(event.target.value)
            }
            onBlur={() =>
              updateLibrary.mutate({
                id: library.id,
                customInstructions: customInstructionsDraft,
              })
            }
            placeholder={t("brandKitDetail.customInstructionsPlaceholder")}
            className="min-h-28"
          />
          <Separator />
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
                onBlur={() => {
                  const palette = parsePaletteDraft(paletteDraft);
                  setPaletteDraft(palette.join(", "));
                  updateLibrary.mutate({
                    id: library.id,
                    styleBrief: {
                      ...library.styleBrief,
                      palette,
                    },
                  });
                }}
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
      </div>
    </div>
  );
}
