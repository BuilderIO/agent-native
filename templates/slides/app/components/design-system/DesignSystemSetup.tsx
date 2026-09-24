import { BuilderDsiGate } from "@agent-native/core/client/agent-chat";
import {
  useActionQuery,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { withBuilderUtmTrackingParams } from "@agent-native/core/shared";
import type { StartDesignSystemAuthoringInput } from "@agent-native/core/shared/design-system-authoring";
import {
  DesignSystemCreationView,
  useDesignSystemCreation,
  designSystemCreationLabels,
  type DesignSystemCreationOptions,
} from "@agent-native/toolkit/design-system-creation";
import {
  IconComponents,
  IconLoader2,
  IconBrandGithub,
  IconBrandFigma,
  IconFolder,
  IconExternalLink,
  IconRefresh,
} from "@tabler/icons-react";
import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import {
  creationComponents,
  useDesignSystemCreationActions,
} from "./design-system-creation";
import { uploadDesignSystemSourceFile } from "./design-system-source-upload";

export interface DesignSystemSetupProps {
  inline?: boolean;
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
  /** @deprecated Workspace opening belongs to onCreated. */
  onStartChat?: () => void;
  editingId?: string;
  preserveWorkspaceDefaults?: boolean;
  onCreate?: DesignSystemCreationOptions["onCreate"];
  onCreated?: DesignSystemCreationOptions["onCreated"];
  onAddSources?: DesignSystemCreationOptions["onAddSources"];
  onSourcesAdded?: DesignSystemCreationOptions["onSourcesAdded"];
  addingToSystemId?: string;
  initialDraft?: DesignSystemCreationOptions["initialDraft"];
  onDraftChange?: DesignSystemCreationOptions["onDraftChange"];
  originDraft?: StartDesignSystemAuthoringInput["originDraft"];
}

type BuilderSourceKind = "figma" | "code" | "github" | "mixed";

interface BuilderSourceDetails {
  builderDesignSystemId: string;
  builderJobId: string;
  builderUrl?: string;
  builderStatus?: string;
  sourceKind?: BuilderSourceKind;
  docs?: Array<unknown>;
  tokenValues?: Record<string, string>;
  docCount?: number;
  warning?: string;
  githubSources?: Array<{
    repoUrl: string;
    ref?: string;
    include?: string[];
    exclude?: string[];
  }>;
  syncedAt?: string;
}

interface ExistingDesignSystem {
  title?: string;
  description?: string;
  data?: string | null;
  customInstructions?: string;
  builder?: BuilderSourceDetails | null;
}

export function DesignSystemSetup(props: DesignSystemSetupProps) {
  return props.editingId && !props.addingToSystemId ? (
    <EditDesignSystemSetup {...props} />
  ) : (
    <CreateDesignSystemSetup {...props} />
  );
}

function CreateDesignSystemSetup(props: DesignSystemSetupProps) {
  const t = useT();
  const labels = designSystemCreationLabels(t);
  const actions = useDesignSystemCreationActions(props.originDraft);
  const controller = useDesignSystemCreation({
    ...props,
    labels,
    onCancel: props.onClose,
    onCreate: props.onCreate ?? actions.onCreate,
    onAddSources: props.onAddSources ?? actions.onAddSources,
    onCreated: props.onCreated ?? (() => props.onComplete()),
    onSourcesAdded: props.onSourcesAdded ?? (() => props.onComplete()),
    uploadFile: (file, options) =>
      uploadDesignSystemSourceFile(file, {
        ...options,
        failureMessage: labels.uploadFailed,
      }),
  });
  const content = (
    <BuilderDsiGate>
      <DesignSystemCreationView
        controller={controller}
        components={creationComponents}
      />
    </BuilderDsiGate>
  );
  if (props.inline) return content;
  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="flex flex-col overflow-hidden sm:max-w-xl"
      >
        <DialogHeader>
          <DialogTitle>
            {controller.step === "sources"
              ? (labels.sourcesTitle ?? labels.references)
              : labels.title}
          </DialogTitle>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
}

function EditDesignSystemSetup({
  open,
  onClose,
  onComplete,
  editingId,
}: DesignSystemSetupProps) {
  const t = useT();
  const [companyName, setCompanyName] = useState("");
  const [brandNotes, setBrandNotes] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [generating, setGenerating] = useState(false);
  const updateSystemMutation = useActionMutation("update-design-system");
  const syncSystemMutation = useActionMutation(
    "sync-design-system-with-builder",
  );
  const {
    data: existingDs,
    isLoading: existingDsLoading,
    isError: existingDsError,
  } = useActionQuery<ExistingDesignSystem>(
    "get-design-system",
    editingId ? { id: editingId } : undefined,
    {
      enabled: !!editingId && open,
      refetchInterval: (query) =>
        query.state.data?.builder?.builderStatus === "in-progress"
          ? 5_000
          : false,
    },
  );

  useEffect(() => {
    if (existingDs && editingId) {
      const builder = existingDs.builder;
      setCompanyName(existingDs.title ?? "");
      const parsed = parseDesignSystemData(existingDs.data);
      const generatedDescription = builder
        ? `Builder indexed design system ${builder.builderDesignSystemId}`
        : null;
      setBrandNotes(
        builder
          ? existingDs.description !== generatedDescription
            ? (existingDs.description ?? "")
            : ""
          : parsed.ok && typeof parsed.value.notes === "string"
            ? parsed.value.notes
            : (existingDs.description ?? ""),
      );
      setCustomInstructions(
        builder &&
          isGeneratedBuilderInstructions(existingDs.customInstructions, builder)
          ? ""
          : (existingDs.customInstructions ?? ""),
      );
    }
  }, [existingDs, editingId]);
  useEffect(() => {
    if (!open) {
      setCompanyName("");
      setBrandNotes("");
      setCustomInstructions("");
    }
  }, [open]);
  const handleEditSave = useCallback(async () => {
    if (!editingId || !existingDs) return;
    setGenerating(true);
    try {
      await updateSystemMutation.mutateAsync({
        id: editingId,
        title: companyName || "My Brand",
        description: brandNotes,
        customInstructions,
      });
      onComplete();
      toast.success(t("designSystemSetup.updated"));
    } catch {
      toast.error(t("designSystemSetup.updateFailed"));
    } finally {
      setGenerating(false);
    }
  }, [
    editingId,
    existingDs,
    companyName,
    brandNotes,
    customInstructions,
    onComplete,
    t,
    updateSystemMutation,
  ]);

  const handleSync = useCallback(async () => {
    if (!editingId || !existingDs?.builder?.githubSources?.length) return;
    setGenerating(true);
    try {
      await syncSystemMutation.mutateAsync({ id: editingId });
      toast.success(t("designSystemSetup.syncStarted"));
    } catch (error) {
      toast.error(t("designSystemSetup.syncFailed"), {
        description:
          error instanceof Error
            ? error.message
            : t("designSystemSetup.syncFailed"),
      });
    } finally {
      setGenerating(false);
    }
  }, [editingId, existingDs, syncSystemMutation, t]);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="flex max-h-dvh flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("designSystemSetup.editTitle")}</DialogTitle>
          <DialogDescription>
            {t("designSystemSetup.editDescription")}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="min-h-0 flex-1">
          {existingDsLoading || (!existingDs && !existingDsError) ? (
            <DesignSystemEditSkeleton />
          ) : existingDsError ? (
            <DesignSystemEditError />
          ) : (
            <div className="space-y-5 py-4">
              <div className="space-y-2">
                <Label htmlFor="slides-system-edit-name">
                  {t("designSystemSetup.companyBrand")}
                </Label>
                <Input
                  id="slides-system-edit-name"
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                  placeholder={t("designSystemSetup.companyBrandPlaceholder")}
                />
              </div>
              {existingDs?.builder && (
                <BuilderSourceStatus
                  builder={existingDs.builder}
                  onSync={
                    existingDs.builder.githubSources?.length &&
                    existingDs.builder.sourceKind !== "mixed"
                      ? handleSync
                      : undefined
                  }
                  syncing={syncSystemMutation.isPending}
                />
              )}
              <div className="space-y-2 rounded-lg border border-border bg-card p-4">
                <Label>{t("designSystemSetup.brandNotes")}</Label>
                <Textarea
                  value={brandNotes}
                  onChange={(event) => setBrandNotes(event.target.value)}
                  placeholder={t("designSystemSetup.notesPlaceholder")}
                  rows={3}
                  className="resize-none"
                />
              </div>
              <div className="space-y-2 rounded-lg border border-border bg-card p-4">
                <Label>{t("designSystemSetup.customInstructions")}</Label>
                <Textarea
                  value={customInstructions}
                  onChange={(event) =>
                    setCustomInstructions(event.target.value)
                  }
                  placeholder={t(
                    "designSystemSetup.customInstructionsPlaceholder",
                  )}
                  rows={4}
                  className="resize-none"
                />
                <p className="text-xs text-muted-foreground">
                  {t("designSystemSetup.customInstructionsDescription")}
                </p>
              </div>
            </div>
          )}
        </ScrollArea>
        <div className="flex justify-end gap-3 border-t pt-4">
          <Button variant="ghost" onClick={onClose} disabled={generating}>
            {t("designSystemSetup.cancel")}
          </Button>
          <Button
            onClick={handleEditSave}
            disabled={generating || !existingDs || existingDsLoading}
            className="cursor-pointer"
          >
            {generating ? (
              <>
                <IconLoader2 className="w-4 h-4 animate-spin" />
                {t("designSystemSetup.saving")}
              </>
            ) : (
              t("designSystemSetup.saveChanges")
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function parseDesignSystemData(
  data?: string | null,
): { ok: true; value: Record<string, unknown> } | { ok: false } {
  if (!data) return { ok: false };
  try {
    const parsed: unknown = JSON.parse(data);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false };
  }
}

function isGeneratedBuilderInstructions(
  value: string | undefined,
  builder: BuilderSourceDetails,
): boolean {
  const instructions = value?.trim();
  if (!instructions) return false;
  return (
    instructions.startsWith(
      "This design system is indexed by Builder Design System Intelligence (DSI).",
    ) &&
    instructions.includes(
      `Builder design system id: ${builder.builderDesignSystemId}`,
    ) &&
    instructions.includes("Call get-design-system for this local id")
  );
}

function BuilderSourceStatus({
  builder,
  onSync,
  syncing = false,
}: {
  builder: BuilderSourceDetails;
  onSync?: () => void;
  syncing?: boolean;
}) {
  const t = useT();
  const docs = builder.docCount ?? builder.docs?.length ?? 0;
  const tokens = Object.keys(builder.tokenValues ?? {}).length;
  const normalizedStatus = builder.builderStatus?.toLowerCase();
  const hasIndexedResults = docs > 0 || tokens > 0;
  const isIndexed =
    hasIndexedResults ||
    normalizedStatus === "ready" ||
    normalizedStatus === "complete" ||
    normalizedStatus === "completed";
  const isIndexing = ["in-progress", "pending", "processing"].includes(
    normalizedStatus ?? "",
  );
  const state =
    isIndexing && !isIndexed
      ? "indexing"
      : builder.warning
        ? "unavailable"
        : isIndexed
          ? "indexed"
          : "indexing";
  const sourceKind = builder.sourceKind;
  const SourceIcon =
    sourceKind === "figma"
      ? IconBrandFigma
      : sourceKind === "github"
        ? IconBrandGithub
        : sourceKind === "code"
          ? IconFolder
          : IconComponents;
  const sourceTitle =
    sourceKind === "figma"
      ? t("designSystemSetup.sourceFigma")
      : sourceKind === "github"
        ? t("designSystemSetup.sourceGitHub")
        : sourceKind === "code"
          ? t("designSystemSetup.sourceCode")
          : sourceKind === "mixed"
            ? t("designSystemSetup.sourceMixed")
            : t("designSystemSetup.sourceBuilder");
  const statusDescription =
    state === "unavailable"
      ? t("designSystemSetup.sourceUnavailableDescription")
      : state === "indexing"
        ? t("designSystemSetup.sourceIndexingDescription")
        : docs > 0 && tokens > 0
          ? t("designSystemSetup.sourceIndexedDescription", { docs, tokens })
          : docs > 0
            ? t("designSystemSetup.sourceIndexedDocsOnly", { docs })
            : tokens > 0
              ? t("designSystemSetup.sourceIndexedTokensOnly", { tokens })
              : t("designSystemSetup.sourceIndexedDescription", {
                  docs,
                  tokens,
                });

  return (
    <section
      aria-label={t("designSystemSetup.sourceLabel")}
      className="rounded-lg border border-border bg-accent/30 px-4 py-3"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
          <SourceIcon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("designSystemSetup.sourceLabel")}
          </p>
          <p className="mt-0.5 truncate text-sm font-medium text-foreground">
            {sourceTitle}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {statusDescription}
          </p>
        </div>
      </div>
      {builder.builderUrl || onSync ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3">
          {builder.builderUrl ? (
            <a
              href={withBuilderUtmTrackingParams(builder.builderUrl, {
                campaign: "product",
                content: "design_system_intelligence",
              })}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground underline-offset-4 hover:underline"
            >
              {t("designSystemSetup.sourceOpenInBuilder")}
              <IconExternalLink className="size-3.5" />
            </a>
          ) : null}
          {onSync ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onSync}
              disabled={syncing}
            >
              <IconRefresh
                className={cn("size-3.5", syncing && "animate-spin")}
              />
              {syncing
                ? t("designSystemSetup.syncingSource")
                : t("designSystemSetup.syncSource")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function DesignSystemEditSkeleton() {
  const t = useT();
  return (
    <div
      aria-busy="true"
      aria-label={t("designSystemSetup.loading")}
      className="space-y-5 py-4"
    >
      <div className="space-y-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-10 w-full" />
      </div>
      <div className="space-y-3 rounded-lg border border-border bg-accent/30 px-4 py-3">
        <div className="flex items-center gap-3">
          <Skeleton className="size-9" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-32" />
          </div>
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-3 w-24" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-24 w-full" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-3 w-64" />
      </div>
    </div>
  );
}

function DesignSystemEditError() {
  const t = useT();
  return (
    <div
      role="alert"
      className="flex min-h-64 items-center justify-center py-8 text-center text-sm text-destructive"
    >
      {t("designSystemSetup.loadFailed")}
    </div>
  );
}
