import {
  ShareButton,
  useActionMutation,
  useActionQuery,
  useT,
} from "@agent-native/core/client";
import type { PromptComposerSubmitOptions } from "@agent-native/core/client";
import {
  useSetHeaderActions,
  useSetPageTitle,
} from "@agent-native/toolkit/app-shell";
import { derivePromptTitle } from "@shared/prompt-title";
import {
  IconDots,
  IconLock,
  IconSearch,
  IconTemplate,
  IconTrash,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

import PromptPopover from "@/components/editor/PromptDialog";
import type { UploadedFile } from "@/components/editor/PromptDialog";
import { QueryErrorState } from "@/components/QueryErrorState";
import { TemplatePreview } from "@/components/templates/TemplatePreview";
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
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { writePendingGeneration } from "@/lib/pending-generation";

type TemplateCategory =
  | "ad"
  | "one-pager"
  | "landing-page"
  | "social"
  | "presentation"
  | "other";

interface DesignTemplateSummary {
  id: string;
  title: string;
  description?: string | null;
  category: TemplateCategory;
  width?: number | null;
  height?: number | null;
  lockedLayerCount: number;
  visibility: "private" | "org" | "public";
  isOwner: boolean;
  source: "starter" | "saved";
  previewHtml?: string | null;
}

interface TemplatesResult {
  count: number;
  starterCount: number;
  savedCount: number;
  templates: DesignTemplateSummary[];
}

export default function Templates() {
  const t = useT();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<DesignTemplateSummary | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleteTemplate, setDeleteTemplate] =
    useState<DesignTemplateSummary | null>(null);
  const anchorElRef = useRef<HTMLElement | null>(null);
  const handledTemplateIdRef = useRef<string | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  anchorRef.current = anchorElRef.current;

  const { data, isLoading, isError, isFetching, refetch } =
    useActionQuery<TemplatesResult>("list-design-templates", {
      includePreview: "true",
    });
  const createMutation = useActionMutation("create-design-from-template");
  const deleteMutation = useActionMutation("delete-design-template");

  const templates = data?.templates ?? [];
  const linkedTemplateId = searchParams.get("templateId");
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query
      ? templates.filter(
          (template) =>
            template.title.toLowerCase().includes(query) ||
            template.description?.toLowerCase().includes(query) ||
            template.category.includes(query),
        )
      : templates;
  }, [search, templates]);
  const starters = filtered.filter((template) => template.source === "starter");
  const saved = filtered.filter((template) => template.source === "saved");

  useEffect(() => {
    if (
      !linkedTemplateId ||
      handledTemplateIdRef.current === linkedTemplateId
    ) {
      return;
    }
    const template = templates.find(
      (candidate) => candidate.id === linkedTemplateId,
    );
    if (!template) return;

    const card = document.getElementById(`design-template-${linkedTemplateId}`);
    const useButton = card?.querySelector<HTMLElement>(
      "[data-template-use-button]",
    );
    anchorElRef.current = useButton ?? card;
    handledTemplateIdRef.current = linkedTemplateId;
    setSearch("");
    setSelected(template);
    setPromptOpen(true);
    card?.scrollIntoView({ block: "center", behavior: "smooth" });
    useButton?.focus();
  }, [linkedTemplateId, templates]);

  const openTemplatePrompt = (
    template: DesignTemplateSummary,
    element: HTMLElement,
  ) => {
    anchorElRef.current = element;
    setSelected(template);
    setPromptOpen(true);
  };

  const createFromTemplate = async (
    template: DesignTemplateSummary,
    prompt?: string,
    options: PromptComposerSubmitOptions = {},
  ) => {
    setCreating(true);
    try {
      const title = prompt?.trim() ? derivePromptTitle(prompt) : template.title;
      const result = (await createMutation.mutateAsync({
        templateId: template.id,
        title,
        ...(prompt?.trim() ? { prompt: prompt.trim() } : {}),
      })) as {
        id?: string;
        title?: string;
        templateBaselineFiles?: Array<{ id: string; contentHash: string }>;
      };
      if (!result.id)
        throw new Error("Template copy did not return a design ID");
      if (prompt?.trim()) {
        writePendingGeneration(result.id, {
          prompt: prompt.trim(),
          title: result.title ?? title,
          source: template.title,
          templateId: template.id,
          templateBaselineFiles: result.templateBaselineFiles,
          skipQuestions: true,
          ...options,
        });
      }
      await queryClient.invalidateQueries({
        queryKey: ["action", "list-designs"],
      });
      navigate(`/design/${result.id}`);
    } catch (error) {
      setCreating(false);
      toast.error(
        error instanceof Error
          ? error.message
          : t("templatesPage.createFailed"),
      );
    }
  };

  const handleSubmit = (
    prompt: string,
    _files: UploadedFile[],
    options: PromptComposerSubmitOptions,
  ) => {
    if (!selected) return;
    void createFromTemplate(selected, prompt, options);
  };

  const handleDelete = async () => {
    if (!deleteTemplate) return;
    const id = deleteTemplate.id;
    setDeleteTemplate(null);
    try {
      await deleteMutation.mutateAsync({ id });
      await queryClient.invalidateQueries({
        queryKey: ["action", "list-design-templates"],
      });
      toast.success(t("templatesPage.deleted"));
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("templatesPage.deleteFailed"),
      );
    }
  };

  useSetPageTitle(t("templatesPage.title"));
  useSetHeaderActions(
    <div className="relative">
      <IconSearch className="absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={t("templatesPage.searchPlaceholder")}
        className="h-8 w-48 bg-accent/50 ps-8 text-sm"
      />
    </div>,
  );

  return (
    <>
      {creating ? (
        <div className="fixed inset-0 z-[180] flex items-center justify-center bg-background/70 backdrop-blur-sm">
          <div className="flex items-center gap-2 rounded-lg border bg-popover px-3 py-2 text-sm font-medium shadow-lg">
            <Spinner className="size-4 text-muted-foreground" />
            {t("templatesPage.opening")}
          </div>
        </div>
      ) : null}
      <main className="mx-auto w-full max-w-[1480px] px-4 py-6 sm:px-6 sm:py-10">
        <div className="mb-8 max-w-2xl">
          <h1 className="text-lg font-semibold text-foreground">
            {t("templatesPage.title")}
          </h1>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {t("templatesPage.description")}
          </p>
        </div>

        {isLoading ? (
          <TemplateGridSkeleton />
        ) : isError ? (
          <QueryErrorState
            onRetry={() => void refetch()}
            retrying={isFetching}
          />
        ) : (
          <div className="flex flex-col gap-10">
            <TemplateSection
              title={t("templatesPage.starterTemplates")}
              templates={starters}
              linkedTemplateId={linkedTemplateId}
              onUse={openTemplatePrompt}
            />
            <TemplateSection
              title={t("templatesPage.savedTemplates")}
              description={t("templatesPage.savedTemplatesDescription")}
              templates={saved}
              linkedTemplateId={linkedTemplateId}
              empty={t("templatesPage.savedEmpty")}
              onUse={openTemplatePrompt}
              onDelete={setDeleteTemplate}
            />
          </div>
        )}
      </main>

      <PromptPopover
        open={promptOpen}
        onOpenChange={(open) => {
          setPromptOpen(open);
          if (!open) setSelected(null);
        }}
        title={selected?.title ?? t("templatesPage.useTemplate")}
        placeholder={t("templatesPage.promptPlaceholder")}
        onSkip={() => {
          if (selected) void createFromTemplate(selected);
        }}
        skipLabel={t("templatesPage.useAsIs")}
        onSubmit={handleSubmit}
        anchorRef={anchorRef}
        loading={creating}
      />

      <AlertDialog
        open={Boolean(deleteTemplate)}
        onOpenChange={(open) => !open && setDeleteTemplate(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("templatesPage.deleteTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("templatesPage.deleteDescription", {
                title: deleteTemplate?.title ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("home.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("home.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function TemplateSection({
  title,
  description,
  templates,
  linkedTemplateId,
  empty,
  onUse,
  onDelete,
}: {
  title: string;
  description?: string;
  templates: DesignTemplateSummary[];
  linkedTemplateId?: string | null;
  empty?: string;
  onUse: (template: DesignTemplateSummary, element: HTMLElement) => void;
  onDelete?: (template: DesignTemplateSummary) => void;
}) {
  if (templates.length === 0 && !empty) return null;
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {description ? (
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {templates.length === 0 ? (
        <div className="flex min-h-32 items-center justify-center rounded-xl border border-dashed bg-muted/20 px-6 text-center text-sm text-muted-foreground">
          {empty}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {templates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              linked={template.id === linkedTemplateId}
              onUse={onUse}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function TemplateCard({
  template,
  linked,
  onUse,
  onDelete,
}: {
  template: DesignTemplateSummary;
  linked?: boolean;
  onUse: (template: DesignTemplateSummary, element: HTMLElement) => void;
  onDelete?: (template: DesignTemplateSummary) => void;
}) {
  const t = useT();
  return (
    <article
      id={`design-template-${template.id}`}
      aria-current={linked ? "true" : undefined}
      className={`group overflow-hidden rounded-xl border bg-card ${
        linked
          ? "ring-2 ring-[var(--design-editor-accent-color)] ring-offset-2 ring-offset-background"
          : ""
      }`}
    >
      <TemplatePreview
        html={template.previewHtml}
        title={template.title}
        width={template.width}
        height={template.height}
      />
      <div className="flex min-h-40 flex-col p-4">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-medium text-foreground/90">
              {template.title}
            </h3>
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {template.description}
            </p>
          </div>
          {template.source === "saved" ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="-me-2 -mt-2 size-8"
                >
                  <IconDots className="size-4" />
                  <span className="sr-only">
                    {t("templatesPage.templateActions")}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {template.isOwner ? (
                  <div className="p-1">
                    <ShareButton
                      resourceType="design-template"
                      resourceId={template.id}
                      resourceTitle={template.title}
                      trigger="label"
                      triggerClassName="w-full justify-start"
                    />
                  </div>
                ) : null}
                {template.isOwner && onDelete ? (
                  <DropdownMenuItem
                    onClick={() => onDelete(template)}
                    className="text-destructive focus:text-destructive"
                  >
                    <IconTrash className="size-4" />
                    {t("home.delete")}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="rounded-full bg-muted px-2 py-1">
            {t(`templatesPage.categories.${template.category}`)}
          </span>
          {template.width && template.height ? (
            <span className="rounded-full bg-muted px-2 py-1">
              {template.width} × {template.height}
            </span>
          ) : null}
          {template.lockedLayerCount > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1">
              <IconLock className="size-3" />
              {t("templatesPage.lockedCount", {
                count: template.lockedLayerCount,
              })}
            </span>
          ) : null}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={(event) => onUse(template, event.currentTarget)}
          data-template-use-button
          className="mt-auto w-full"
        >
          <IconTemplate className="size-4" />
          {t("templatesPage.useTemplate")}
        </Button>
      </div>
    </article>
  );
}

function TemplateGridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="overflow-hidden rounded-xl border bg-card">
          <div className="aspect-video animate-pulse bg-muted/60" />
          <div className="flex flex-col gap-2 p-4">
            <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-full animate-pulse rounded bg-muted" />
            <div className="h-8 w-full animate-pulse rounded bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}
