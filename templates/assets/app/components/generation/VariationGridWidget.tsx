import { setAgentChatContextItem } from "@agent-native/core/client/agent-chat";
import type { ToolRendererProps } from "@agent-native/core/client/agentkit-chat";
import { ActionCard } from "@agent-native/core/client/chat";
import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  projectAssetVariationResult,
  type AssetVariationCardImage,
} from "@shared/action-ui";
import { IconPhoto } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { assetPreviewSources } from "@/lib/asset-preview-sources";

export function VariationGridWidget({ context }: ToolRendererProps) {
  const t = useT();
  const result = projectAssetVariationResult(context.args, context.resultJson);
  const images = result?.images ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    images.find((image) => image.id === selectedId) ?? images[0] ?? null;
  const assetQuery = useActionQuery(
    "get-asset",
    { id: selected?.id ?? "" } as any,
    { enabled: Boolean(selected?.id) },
  ) as {
    data?: { status?: string; role?: string };
    isError?: boolean;
    isPending?: boolean;
  };
  const saveAsset = useActionMutation("save-generated-image");
  const updateAsset = useActionMutation("update-asset");
  const canApprove =
    !selected?.draftPendingApproval &&
    !assetQuery.isError &&
    !assetQuery.isPending;
  const status = selected?.draftPendingApproval
    ? t("library.draftsOnly")
    : assetQuery.data?.status === "reference"
      ? t("library.reference")
      : assetQuery.data?.status === "saved"
        ? t("library.saved")
        : t("library.readyCount", { count: images.length });

  if (!selected && context.isRunning) {
    return (
      <div
        aria-label={t("library.generatingCandidates")}
        className="h-32 animate-pulse rounded-md bg-muted/30"
      />
    );
  }
  if (!selected) return null;

  const variantNumber =
    images.findIndex((image) => image.id === selected.id) + 1;
  const selectedLabel = t("library.variantWithNumber", {
    number: variantNumber,
  });
  const currentStatus =
    assetQuery.data?.status ?? selected.status ?? "candidate";
  const isReference = currentStatus === "reference";
  const isSaved = currentStatus === "saved" || isReference;
  const isVideo =
    selected.mediaType === "video" || selected.mimeType?.startsWith("video/");

  function saveSelected() {
    if (!canApprove || isSaved) return;
    saveAsset.mutate(
      { assetId: selected.id },
      {
        onSuccess: () => toast.success(t("library.savedToLibrary")),
        onError: (error) =>
          toast.error(
            actionErrorMessage(error) ?? t("library.couldNotSaveCandidate"),
          ),
      },
    );
  }

  function addSelectedToReferences() {
    if (!canApprove || isReference) return;
    updateAsset.mutate(
      {
        id: selected.id,
        status: "reference",
        role: isVideo ? "video_reference" : "style_reference",
      } as any,
      {
        onSuccess: () => toast.success(t("library.addedToReferences")),
        onError: (error) =>
          toast.error(
            actionErrorMessage(error) ?? t("library.couldNotAddToReferences"),
          ),
      },
    );
  }

  function refineSelected() {
    setAgentChatContextItem({
      key: `refine-asset:${selected.id}`,
      title: `${t("library.refine")}: ${selectedLabel}`,
      context: [
        "## Assets candidate",
        `Asset ID: ${selected.id}`,
        `Brand kit ID: ${selected.libraryId}`,
        selected.prompt ? `Prompt: ${selected.prompt}` : "",
        "Use refine-image with this assetId after the user describes the change.",
      ]
        .filter(Boolean)
        .join("\n"),
      openSidebar: true,
    });
  }

  return (
    <div className="space-y-3">
      <ActionCard
        icon={<IconPhoto className="size-4" />}
        title={t("library.generatedCandidatesTitle")}
        detail={selected.prompt}
        status={status}
        className="rounded-none border-0 bg-transparent p-0 shadow-none"
      />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {images.map((image, index) => (
          <VariationThumbnail
            key={image.id}
            image={image}
            label={t("library.variantWithNumber", { number: index + 1 })}
            selected={image.id === selected.id}
            onSelect={() => setSelectedId(image.id)}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border/80 pt-3">
        {canApprove && !isSaved ? (
          <Button
            size="sm"
            className="transition-none active:scale-100"
            disabled={saveAsset.isPending || updateAsset.isPending}
            onClick={saveSelected}
          >
            {saveAsset.isPending ? <Spinner className="size-4" /> : null}
            {t("library.save")}
          </Button>
        ) : null}
        {canApprove && !isReference ? (
          <Button
            size="sm"
            variant="outline"
            className="transition-none active:scale-100"
            disabled={saveAsset.isPending || updateAsset.isPending}
            onClick={addSelectedToReferences}
          >
            {updateAsset.isPending ? <Spinner className="size-4" /> : null}
            {t("library.addToReferences")}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          className="transition-none active:scale-100"
          onClick={refineSelected}
        >
          {t("library.refine")}
        </Button>
      </div>
    </div>
  );
}

function VariationThumbnail({
  image,
  label,
  selected,
  onSelect,
}: {
  image: AssetVariationCardImage;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const t = useT();
  const src = assetPreviewSources(image, "thumbnail")[0];
  return (
    <button
      type="button"
      aria-label={t("library.selectAsset", { title: label })}
      aria-pressed={selected}
      onClick={onSelect}
      className={`group relative aspect-square overflow-hidden rounded-md border bg-muted/30 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected ? "border-primary ring-1 ring-primary" : "border-border/80 hover:border-foreground/30"}`}
    >
      {src ? (
        <img
          src={src}
          alt={image.prompt || label}
          loading="lazy"
          className="size-full object-cover"
        />
      ) : (
        <span className="sr-only">{label}</span>
      )}
      <span className="absolute inset-x-0 bottom-0 truncate bg-background/85 px-2 py-1 text-xs font-medium text-foreground">
        {label}
      </span>
    </button>
  );
}
