import {
  ShareButton,
  useActionQuery,
  useActionMutation,
  useT,
} from "@agent-native/core/client";
import type { PromptComposerSubmitOptions } from "@agent-native/core/client";
import {
  useSetHeaderActions,
  useSetPageTitle,
} from "@agent-native/toolkit/app-shell";
import { FULL_APP_BUILDING_ENABLED } from "@shared/full-app";
import { derivePromptTitle } from "@shared/prompt-title";
import {
  STARTER_TEMPLATES,
  type StarterTemplate,
} from "@shared/starter-templates";
import {
  IconChecks,
  IconPlus,
  IconSearch,
  IconDots,
  IconTrash,
  IconCopy,
  IconX,
  IconPencil,
  IconTemplate,
  IconPalette,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { nanoid } from "nanoid";
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useNavigate, Link, useLocation } from "react-router";
import { toast } from "sonner";

import { DesignThumbnail } from "@/components/design/DesignThumbnail";
import PromptPopover from "@/components/editor/PromptDialog";
import type {
  PromptTemplateOption,
  UploadedFile,
} from "@/components/editor/PromptDialog";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useDesignSystems } from "@/hooks/use-design-systems";
import { sendToDesignAgentChat } from "@/lib/agent-chat";
import {
  clearPendingGeneration,
  writePendingGeneration,
} from "@/lib/pending-generation";

type ProjectType = "prototype" | "other";
interface Design {
  id: string;
  title: string;
  description?: string;
  projectType: ProjectType;
  designSystemId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  /** Preview HTML for the thumbnail. Only present when the list query asks
   *  for `includePreview: 'true'`. Truncated server-side. */
  previewHtml?: string | null;
}

interface TemplateDesign extends Design {
  screenCount: number;
  templateMeta?: string | null;
  isBuiltIn?: boolean;
}

type HomeTab = "designs" | "templates";

export default function Index({
  activeTab: activeTabProp,
}: {
  activeTab?: HomeTab;
} = {}) {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const activeTab =
    activeTabProp ??
    (location.pathname.startsWith("/templates") ? "templates" : "designs");
  const isTemplatesTab = activeTab === "templates";
  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [selectedDesignIds, setSelectedDesignIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [showNewPrompt, setShowNewPrompt] = useState(false);
  const [newDesignHandoffPending, setNewDesignHandoffPending] = useState(false);
  const [newDesignSystemId, setNewDesignSystemId] = useState<
    string | null | undefined
  >(undefined);
  const [newTemplateId, setNewTemplateId] = useState<string | null>(null);
  const [openTemplatePickerOnStart, setOpenTemplatePickerOnStart] =
    useState(false);
  // "Design" (default, inline prototype) vs "Full app" (Builder Fusion
  // cloud container). Only reachable behind FULL_APP_BUILDING_ENABLED — the
  // popover renders no mode control at all when the flag is off, so this
  // state is always "design" in that case.
  const [newDesignMode, setNewDesignMode] = useState<"design" | "app">(
    "design",
  );
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [shareTemplate, setShareTemplate] = useState<TemplateDesign | null>(
    null,
  );

  const anchorElRef = useRef<HTMLElement | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  // Keep anchorRef.current in sync so PromptPopover can read it
  anchorRef.current = anchorElRef.current;

  const { data: designsData, isLoading } = useActionQuery<{
    count: number;
    designs: Design[];
  }>("list-designs", { includePreview: "true" });
  const { data: templatesData, isLoading: templatesLoading } = useActionQuery<{
    count: number;
    templates: TemplateDesign[];
  }>("list-templates", { includePreview: "true" });

  const createMutation = useActionMutation("create-design");
  // Fires the fusion-backed cloud container build; only ever called when
  // FULL_APP_BUILDING_ENABLED is true and the user picked "Full app".
  const createFusionAppMutation = useActionMutation("create-fusion-app");
  const deleteMutation = useActionMutation("delete-design");
  const duplicateMutation = useActionMutation("duplicate-design");
  const saveAsTemplateMutation = useActionMutation("save-as-template");
  const updateMutation = useActionMutation("update-design");
  const generateTitleMutation = useActionMutation("generate-design-title");
  // Designs the user has manually renamed since creation — an AI-generated
  // title that resolves later must never clobber an explicit rename.
  const userRenamedDesignIdsRef = useRef<Set<string>>(new Set());
  const {
    designSystems,
    defaultSystem,
    isLoading: designSystemsLoading,
  } = useDesignSystems();

  const designs = designsData?.designs ?? [];
  const templates = templatesData?.templates ?? [];

  const filtered = search
    ? designs.filter((d) =>
        d.title.toLowerCase().includes(search.toLowerCase()),
      )
    : designs;
  const starterTemplateOptions = useMemo<PromptTemplateOption[]>(
    () =>
      STARTER_TEMPLATES.map((starter) => ({
        id: starter.id,
        title: t(starter.titleKey),
        type: "starter",
        icon: starter.icon,
        placeholderPrompt: t(starter.placeholderPromptKey),
        generationBrief: starter.generationBrief,
        previewHtml:
          starter.previewHtml ?? starter.seedScreens?.[0]?.html ?? null,
        screenCount: starter.seedScreens?.length ?? 0,
        hasSeedScreens: Boolean(starter.seedScreens?.length),
      })),
    [t],
  );
  const userTemplateOptions = useMemo<PromptTemplateOption[]>(
    () =>
      templates.map((template) => ({
        id: template.id,
        title: template.title,
        type: "template",
        designSystemId: template.designSystemId ?? null,
        previewHtml: template.previewHtml ?? null,
        screenCount: template.screenCount ?? 0,
        hasSeedScreens: (template.screenCount ?? 0) > 0,
      })),
    [templates],
  );
  const templateOptions = useMemo(
    () => [...starterTemplateOptions, ...userTemplateOptions],
    [starterTemplateOptions, userTemplateOptions],
  );
  const templateCards = useMemo<TemplateDesign[]>(
    () => [
      ...templates,
      ...starterTemplateOptions.map((template) => ({
        id: template.id,
        title: template.title,
        projectType: "prototype" as const,
        designSystemId: null,
        previewHtml: template.previewHtml ?? null,
        screenCount: template.screenCount ?? 0,
        isBuiltIn: true,
      })),
    ],
    [starterTemplateOptions, templates],
  );
  const filteredTemplates = search
    ? templateCards.filter((template) =>
        template.title.toLowerCase().includes(search.toLowerCase()),
      )
    : templateCards;
  const selectedTemplate = templateOptions.find(
    (template) => template.id === newTemplateId,
  );
  const selectedDesignCount = selectedDesignIds.size;
  const isSelectingDesigns = selectedDesignCount > 0;
  const allVisibleSelected =
    filtered.length > 0 &&
    filtered.every((design) => selectedDesignIds.has(design.id));

  const resolveDefaultDesignSystemId = useCallback(
    () => defaultSystem?.id ?? designSystems[0]?.id ?? null,
    [defaultSystem?.id, designSystems],
  );
  const resolveAccessibleTemplateDesignSystemId = useCallback(
    (template: PromptTemplateOption | undefined) => {
      if (template?.type !== "template" || !template.designSystemId)
        return null;
      return designSystems.some(
        (system) => system.id === template.designSystemId,
      )
        ? template.designSystemId
        : null;
    },
    [designSystems],
  );

  const openNewDesign = useCallback(
    (
      e: React.MouseEvent<HTMLElement>,
      options: {
        templateId?: string | null;
        openTemplatePicker?: boolean;
      } = {},
    ) => {
      anchorElRef.current = e.currentTarget;
      const template = templateOptions.find(
        (candidate) => candidate.id === options.templateId,
      );
      const templateDesignSystemId =
        resolveAccessibleTemplateDesignSystemId(template);
      setNewTemplateId(options.templateId ?? null);
      setOpenTemplatePickerOnStart(Boolean(options.openTemplatePicker));
      setNewDesignSystemId(
        templateDesignSystemId
          ? templateDesignSystemId
          : designSystemsLoading
            ? undefined
            : resolveDefaultDesignSystemId(),
      );
      setShowNewPrompt(true);
    },
    [
      designSystemsLoading,
      resolveAccessibleTemplateDesignSystemId,
      resolveDefaultDesignSystemId,
      templateOptions,
    ],
  );

  const handleNewPromptOpenChange = useCallback((open: boolean) => {
    setShowNewPrompt(open);
    if (!open) {
      setNewDesignSystemId(undefined);
      setNewTemplateId(null);
      setOpenTemplatePickerOnStart(false);
      setNewDesignMode("design");
    }
  }, []);

  useEffect(() => {
    if (
      !showNewPrompt ||
      newDesignSystemId !== undefined ||
      designSystemsLoading
    )
      return;
    setNewDesignSystemId(resolveDefaultDesignSystemId());
  }, [
    designSystemsLoading,
    newDesignSystemId,
    resolveDefaultDesignSystemId,
    showNewPrompt,
  ]);

  const handleTemplateChange = useCallback(
    (templateId: string | null) => {
      setNewTemplateId(templateId);
      const template = templateOptions.find(
        (candidate) => candidate.id === templateId,
      );
      if (template?.type === "template") {
        const templateDesignSystemId =
          resolveAccessibleTemplateDesignSystemId(template);
        setNewDesignSystemId(
          templateDesignSystemId ??
            (designSystemsLoading ? undefined : resolveDefaultDesignSystemId()),
        );
      }
    },
    [
      designSystemsLoading,
      resolveAccessibleTemplateDesignSystemId,
      resolveDefaultDesignSystemId,
      templateOptions,
    ],
  );

  const toggleDesignSelection = useCallback((id: string) => {
    setSelectedDesignIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const toggleVisibleSelection = useCallback(() => {
    setSelectedDesignIds((current) => {
      const next = new Set(current);
      const shouldClear =
        filtered.length > 0 && filtered.every((design) => next.has(design.id));

      filtered.forEach((design) => {
        if (shouldClear) {
          next.delete(design.id);
        } else {
          next.add(design.id);
        }
      });

      return next;
    });
  }, [filtered]);

  const handleSearchChange = useCallback((query: string) => {
    setSearch(query);
    setSelectedDesignIds((current) =>
      current.size === 0 ? current : new Set(),
    );
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedDesignIds(new Set());
  }, []);

  const createDesign = useCallback(
    (
      title: string,
      designSystemId?: string | null,
      templateId?: string | null,
    ): { id: string; title: string; ready: Promise<void> } => {
      const id = nanoid();
      const projectType: ProjectType = "prototype";
      const finalTitle = title.trim() || "Untitled Design";
      const linkedDesignSystemId = designSystemId ?? null;

      // Optimistic update
      queryClient.setQueryData(
        ["action", "list-designs", { includePreview: "true" }],
        (old: any) => {
          const newDesign: Design = {
            id,
            title: finalTitle,
            projectType,
            designSystemId: linkedDesignSystemId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          return {
            count: (old?.count ?? 0) + 1,
            designs: [newDesign, ...(old?.designs ?? [])],
          };
        },
      );

      const ready = createMutation
        .mutateAsync({
          id,
          title: finalTitle,
          projectType,
          designSystemId: linkedDesignSystemId,
          ...(templateId ? { templateId } : {}),
        } as any)
        .then(() => undefined)
        .catch((error) => {
          clearPendingGeneration(id);
          queryClient.invalidateQueries({
            queryKey: ["action", "list-designs"],
          });
          throw error;
        });
      // Fire mutation in background; keep the optimistic navigation instant.
      void ready.catch(() => {});
      return { id, title: finalTitle, ready };
    },
    [queryClient, createMutation],
  );

  // Mirrors the chat-title flow: the placeholder (derivePromptTitle) shows
  // immediately, then a short AI-generated name replaces it in the
  // background once it resolves. Never blocks navigation or generation.
  const handleGenerateDesignTitle = useCallback(
    (designId: string, prompt: string, previousTitle: string) => {
      generateTitleMutation
        .mutateAsync({ designId, prompt, previousTitle } as any)
        .then((result: any) => {
          if (!result?.updated || !result.title) return;
          if (userRenamedDesignIdsRef.current.has(designId)) return;
          queryClient.setQueriesData(
            { queryKey: ["action", "list-designs"] },
            (old: any) => {
              if (!old || typeof old !== "object") return old;
              return {
                ...old,
                count: old.count ?? (old.designs ?? []).length,
                designs: (old.designs ?? []).map((d: Design) =>
                  d.id === designId ? { ...d, title: result.title } : d,
                ),
              };
            },
          );
        })
        .catch(() => {
          // Best-effort background enhancement — the placeholder title
          // already saved at creation time stays as the final title.
        });
    },
    [generateTitleMutation, queryClient],
  );

  const handleSubmitPrompt = useCallback(
    (
      prompt: string,
      files: UploadedFile[],
      options: PromptComposerSubmitOptions,
      pendingOptions?: { skipQuestions?: boolean },
    ) => {
      // Derive a short title from the prompt — first line, ~40 chars max,
      // word-boundary truncated. The full prompt still drives generation;
      // the title is just a label, so longer is worse.
      const template = selectedTemplate;
      const derivedTitle = prompt.trim()
        ? derivePromptTitle(prompt)
        : template?.title || t("home.untitledDesign");
      const designSystemId =
        newDesignSystemId === undefined
          ? resolveDefaultDesignSystemId()
          : newDesignSystemId;

      const { id, title, ready } = createDesign(
        derivedTitle,
        designSystemId,
        template?.id ?? null,
      );
      if (prompt.trim()) {
        handleGenerateDesignTitle(id, prompt, title);
      }

      if (FULL_APP_BUILDING_ENABLED && newDesignMode === "app") {
        // Full-app designs are backed by a real running container, not a
        // queued inline generation — skip writePendingGeneration and let the
        // fusion app mutation (and its own status/progress banner in the
        // editor) drive the build instead.
        void ready
          .then(() =>
            createFusionAppMutation.mutateAsync({
              designId: id,
              prompt,
            } as any),
          )
          .then((result: any) => {
            if (result?.status !== "not-configured") return;
            // Builder isn't connected/configured, so no fusionApp linkage was
            // written and no banner will render. Hand off to the agent chat,
            // which owns the connect-Builder card flow, keeping the user's
            // prompt so nothing is lost.
            sendToDesignAgentChat({
              message: `I want to build this design as a full app: ${prompt}`,
              context:
                `create-fusion-app returned status "not-configured" for design ` +
                `${id}. ${result?.message ?? ""} Help the user connect ` +
                `Builder.io (see connect-builder-app), then retry ` +
                `create-fusion-app with the user's prompt.`,
              submit: true,
            });
          })
          .catch((error) => {
            const message =
              error instanceof Error && error.message
                ? error.message
                : String(error);
            sendToDesignAgentChat({
              message: `I want to build this design as a full app: ${prompt}`,
              context:
                `Starting the full-app build for design ${id} failed: ` +
                `${message}. Check whether the design row exists, Builder is ` +
                `connected, and create-fusion-app can be retried safely.`,
              submit: true,
            });
          });
      } else if (prompt.trim() || !template || !template.hasSeedScreens) {
        writePendingGeneration(id, {
          prompt,
          files,
          title,
          designSystemId,
          templateId: template?.id,
          templateTitle: template?.title,
          designSystemMismatch: Boolean(
            template?.type === "template" &&
            template.designSystemId &&
            designSystemId &&
            designSystemId !== template.designSystemId,
          ),
          starterBrief:
            template?.type === "starter" ? template.generationBrief : undefined,
          skipQuestions: pendingOptions?.skipQuestions,
          ...options,
        });
      }

      setNewDesignHandoffPending(true);
      navigate(`/design/${id}`);
    },
    [
      createDesign,
      createFusionAppMutation,
      handleGenerateDesignTitle,
      navigate,
      newDesignMode,
      newDesignSystemId,
      resolveDefaultDesignSystemId,
      selectedTemplate,
      t,
    ],
  );

  const handleDelete = useCallback(() => {
    if (!deleteId) return;
    const id = deleteId;

    // Optimistic update
    queryClient.setQueryData(
      ["action", "list-designs", { includePreview: "true" }],
      (old: any) => ({
        count: Math.max((old?.count ?? 1) - 1, 0),
        designs: (old?.designs ?? []).filter((d: Design) => d.id !== id),
      }),
    );
    queryClient.setQueryData(
      ["action", "list-templates", { includePreview: "true" }],
      (old: any) => ({
        count: Math.max((old?.count ?? 1) - 1, 0),
        templates: (old?.templates ?? []).filter(
          (template: TemplateDesign) => template.id !== id,
        ),
      }),
    );

    setDeleteId(null);

    deleteMutation.mutate({ id } as any, {
      onError: () => {
        queryClient.invalidateQueries({
          queryKey: ["action", "list-designs"],
        });
        queryClient.invalidateQueries({
          queryKey: ["action", "list-templates"],
        });
      },
    });
  }, [deleteId, queryClient, deleteMutation]);

  const handleBulkDelete = useCallback(() => {
    const ids = Array.from(selectedDesignIds);
    if (ids.length === 0) return;

    const idsToDelete = new Set(ids);

    queryClient.setQueryData(
      ["action", "list-designs", { includePreview: "true" }],
      (old: any) => ({
        count: Math.max(
          (old?.count ?? (old?.designs ?? []).length) - ids.length,
          0,
        ),
        designs: (old?.designs ?? []).filter(
          (d: Design) => !idsToDelete.has(d.id),
        ),
      }),
    );

    setBulkDeleteOpen(false);
    setSelectedDesignIds(new Set());

    void Promise.all(ids.map((id) => deleteMutation.mutateAsync({ id } as any)))
      .then(() => undefined)
      .catch(() => {
        queryClient.invalidateQueries({
          queryKey: ["action", "list-designs"],
        });
      });
  }, [selectedDesignIds, queryClient, deleteMutation]);

  const handleDuplicate = useCallback(
    (id: string) => {
      duplicateMutation.mutate({ id } as any, {
        onSuccess: (data: any) => {
          queryClient.invalidateQueries({
            queryKey: ["action", "list-designs"],
          });
          if (data?.id) {
            navigate(`/design/${data.id}`);
          }
        },
      });
    },
    [duplicateMutation, queryClient, navigate],
  );

  const handleSaveAsTemplate = useCallback(
    (design: Design) => {
      const optimisticId = `pending-template:${design.id}`;
      const now = new Date().toISOString();
      const optimisticTemplate: TemplateDesign = {
        ...design,
        id: optimisticId,
        screenCount: 0,
        createdAt: now,
        updatedAt: now,
      };

      queryClient.setQueryData(
        ["action", "list-templates", { includePreview: "true" }],
        (old: any) => ({
          count: (old?.count ?? 0) + 1,
          templates: [optimisticTemplate, ...(old?.templates ?? [])],
        }),
      );
      toast.success(t("home.savedAsTemplate"), {
        action: {
          label: t("home.viewTemplates"),
          onClick: () => navigate("/templates"),
        },
      });

      saveAsTemplateMutation.mutate({ designId: design.id } as any, {
        onSuccess: (result: any) => {
          queryClient.setQueryData(
            ["action", "list-templates", { includePreview: "true" }],
            (old: any) => {
              if (!old || typeof old !== "object") return old;
              return {
                ...old,
                templates: (old.templates ?? []).map(
                  (template: TemplateDesign) =>
                    template.id === optimisticId
                      ? {
                          ...optimisticTemplate,
                          id: result?.id ?? optimisticId,
                          title: result?.title ?? optimisticTemplate.title,
                          screenCount:
                            result?.fileCount ?? optimisticTemplate.screenCount,
                        }
                      : template,
                ),
              };
            },
          );
        },
        onError: () => {
          queryClient.invalidateQueries({
            queryKey: ["action", "list-templates"],
          });
          toast.error(t("home.saveAsTemplateFailed"));
        },
      });
    },
    [navigate, queryClient, saveAsTemplateMutation, t],
  );

  const startRename = useCallback((design: Design) => {
    setRenameId(design.id);
    setRenameDraft(design.title);
  }, []);

  const commitRename = useCallback(() => {
    if (!renameId) return;
    const id = renameId;
    const next = renameDraft.trim();
    setRenameId(null);
    if (!next) return;

    userRenamedDesignIdsRef.current.add(id);

    queryClient.setQueriesData(
      { queryKey: ["action", "list-designs"] },
      (old: any) => {
        if (!old || typeof old !== "object") return old;
        return {
          ...old,
          count: old.count ?? (old.designs ?? []).length,
          designs: (old.designs ?? []).map((d: Design) =>
            d.id === id ? { ...d, title: next } : d,
          ),
        };
      },
    );
    queryClient.setQueriesData(
      { queryKey: ["action", "list-templates"] },
      (old: any) => {
        if (!old || typeof old !== "object") return old;
        return {
          ...old,
          count: old.count ?? (old.templates ?? []).length,
          templates: (old.templates ?? []).map((template: TemplateDesign) =>
            template.id === id ? { ...template, title: next } : template,
          ),
        };
      },
    );

    updateMutation.mutate({ id, title: next } as any, {
      onError: () => {
        queryClient.invalidateQueries({
          queryKey: ["action", "list-designs"],
        });
        queryClient.invalidateQueries({
          queryKey: ["action", "list-templates"],
        });
      },
    });
  }, [renameId, renameDraft, queryClient, updateMutation]);

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  useSetPageTitle(t("home.pageTitle"));

  useSetHeaderActions(
    (isTemplatesTab ? templateCards.length > 0 : designs.length > 0) ? (
      <div className="flex items-center gap-3">
        <div className="relative">
          <IconSearch className="absolute start-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/70" />
          <Input
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder={
              isTemplatesTab
                ? t("home.searchTemplatesPlaceholder")
                : t("home.searchPlaceholder")
            }
            className="ps-8 h-8 w-48 bg-accent/50 border-border text-sm text-foreground/90 placeholder:text-muted-foreground/70"
          />
        </div>
        <Button
          size="sm"
          onClick={(e) =>
            openNewDesign(e, {
              openTemplatePicker: isTemplatesTab,
            })
          }
          disabled={newDesignHandoffPending}
          className="cursor-pointer"
        >
          {newDesignHandoffPending ? (
            <Spinner className="w-3.5 h-3.5" />
          ) : (
            <IconPlus className="w-3.5 h-3.5" />
          )}
          {newDesignHandoffPending
            ? t("home.openingDesign")
            : isTemplatesTab
              ? t("home.newFromTemplate")
              : t("home.newDesign")}
        </Button>
      </div>
    ) : null,
  );

  return (
    <>
      {newDesignHandoffPending ? <NewDesignHandoffOverlay /> : null}
      <main className="px-4 sm:px-6 py-6 sm:py-10">
        <Tabs value={activeTab} className="mb-6">
          <TabsList className="h-8 rounded-full bg-muted/50 p-0.5">
            <TabsTrigger
              value="designs"
              asChild
              className="h-7 rounded-full px-3 text-sm data-[state=active]:bg-accent data-[state=active]:text-foreground"
            >
              <Link to="/">{t("home.tabDesigns")}</Link>
            </TabsTrigger>
            <TabsTrigger
              value="templates"
              asChild
              className="h-7 rounded-full px-3 text-sm data-[state=active]:bg-accent data-[state=active]:text-foreground"
            >
              <Link to="/templates">{t("home.tabTemplates")}</Link>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {isTemplatesTab ? (
          templatesLoading ? (
            <LoadingSkeleton />
          ) : (
            <TemplatesGrid
              templates={filteredTemplates}
              onUse={(event, template) =>
                openNewDesign(event, { templateId: template.id })
              }
              onEdit={(template) => navigate(`/design/${template.id}`)}
              onRename={startRename}
              onShare={setShareTemplate}
              onRemove={(template) => {
                updateMutation.mutate(
                  {
                    id: template.id,
                    isTemplate: false,
                    templateMeta: null,
                  } as any,
                  {
                    onSuccess: () => {
                      queryClient.invalidateQueries({
                        queryKey: ["action", "list-templates"],
                      });
                      queryClient.invalidateQueries({
                        queryKey: ["action", "list-designs"],
                      });
                    },
                  },
                );
              }}
              onDelete={(template) => setDeleteId(template.id)}
              formatDate={formatDate}
            />
          )
        ) : isLoading ? (
          <LoadingSkeleton />
        ) : designs.length === 0 ? (
          <EmptyState
            onCreateDesign={openNewDesign}
            onUseStarter={(event, starterId) =>
              openNewDesign(event, { templateId: starterId })
            }
          />
        ) : (
          <>
            {isSelectingDesigns ? (
              <div className="-mt-4 mb-3 flex flex-wrap items-center justify-between gap-3 px-1 py-1 sm:-mt-6">
                <div className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {t("home.selected", { count: selectedDesignCount })}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={toggleVisibleSelection}
                        aria-label={
                          allVisibleSelected
                            ? t("home.clearVisibleSelection")
                            : t("home.selectVisibleDesigns")
                        }
                        className="h-8 w-8 cursor-pointer"
                      >
                        <IconChecks className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {allVisibleSelected
                        ? t("home.clearVisibleSelection")
                        : t("home.selectVisibleDesigns")}
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={clearSelection}
                        aria-label={t("home.clearSelection")}
                        className="h-8 w-8 cursor-pointer"
                      >
                        <IconX className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("home.clearSelection")}</TooltipContent>
                  </Tooltip>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setBulkDeleteOpen(true)}
                    className="cursor-pointer"
                  >
                    <IconTrash className="w-3.5 h-3.5" />
                    {t("home.delete")}
                  </Button>
                </div>
              </div>
            ) : null}
            {/* Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {/* New design card */}
              <button
                onClick={openNewDesign}
                disabled={newDesignHandoffPending}
                className="group relative rounded-xl border border-dashed border-border bg-card hover:border-foreground/15 overflow-hidden text-start cursor-pointer"
              >
                <div className="aspect-video flex items-center justify-center bg-muted/30">
                  <div className="w-12 h-12 rounded-xl bg-accent/50 flex items-center justify-center group-hover:bg-accent">
                    {newDesignHandoffPending ? (
                      <Spinner className="w-6 h-6 text-muted-foreground/70" />
                    ) : (
                      <IconPlus className="w-6 h-6 text-muted-foreground/70 group-hover:text-muted-foreground" />
                    )}
                  </div>
                </div>
                <div className="p-4">
                  <h3 className="font-medium text-sm text-muted-foreground group-hover:text-foreground/70">
                    {t("home.newDesign")}
                  </h3>
                  <div className="text-xs text-muted-foreground/70 mt-1">
                    {t("home.createDesignProject")}
                  </div>
                </div>
              </button>

              {/* Design cards */}
              {filtered.map((design) => {
                const isSelected = selectedDesignIds.has(design.id);
                const cardContent = (
                  <>
                    <DesignThumbnail html={design.previewHtml ?? null} />
                    <div className="p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium text-sm text-foreground/90 truncate flex-1">
                          {design.title}
                        </h3>
                      </div>
                      <div className="text-xs text-muted-foreground/70">
                        {formatDate(design.updatedAt || design.createdAt)}
                      </div>
                    </div>
                  </>
                );

                return (
                  <div
                    key={design.id}
                    aria-selected={isSelected}
                    className={`group relative rounded-xl border bg-card overflow-hidden ${
                      isSelected
                        ? "border-[#609FF8]/70 ring-2 ring-[#609FF8]/40"
                        : "border-border"
                    }`}
                  >
                    <Link to={`/design/${design.id}`} className="block">
                      {cardContent}
                    </Link>
                    <div
                      className={`absolute start-2 top-2 z-10 transition-opacity ${
                        isSelected || isSelectingDesigns
                          ? "pointer-events-auto opacity-100"
                          : "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
                      }`}
                    >
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() =>
                              toggleDesignSelection(design.id)
                            }
                            onClick={(event) => event.stopPropagation()}
                            aria-label={t("home.selectDesign", {
                              title: design.title,
                            })}
                            className="h-5 w-5 border-white/70 bg-black/65 text-white shadow-sm data-[state=checked]:border-[#609FF8] data-[state=checked]:bg-[#609FF8]"
                          />
                        </TooltipTrigger>
                        <TooltipContent>
                          {t("home.selectDesign", { title: design.title })}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    {/* Three-dot menu */}
                    <div className="absolute top-2 end-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t("home.actionsForDesign", {
                              title: design.title,
                            })}
                            className="h-7 w-7 bg-black/60 hover:bg-black/80 cursor-pointer"
                          >
                            <IconDots className="w-3.5 h-3.5 text-foreground/70" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => startRename(design)}
                            className="cursor-pointer"
                          >
                            <IconPencil className="w-3.5 h-3.5 me-2" />
                            {t("home.rename")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleDuplicate(design.id)}
                            className="cursor-pointer"
                          >
                            <IconCopy className="w-3.5 h-3.5 me-2" />
                            {t("home.duplicate")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleSaveAsTemplate(design)}
                            className="cursor-pointer"
                          >
                            <IconTemplate className="w-3.5 h-3.5 me-2" />
                            {t("home.saveAsTemplate")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setDeleteId(design.id)}
                            className="text-red-400 focus:text-red-400 cursor-pointer"
                          >
                            <IconTrash className="w-3.5 h-3.5 me-2" />
                            {t("home.delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </main>

      <PromptPopover
        open={showNewPrompt}
        onOpenChange={handleNewPromptOpenChange}
        title={t("home.newDesignLower")}
        placeholder={
          selectedTemplate?.placeholderPrompt ?? t("home.describeBuild")
        }
        onSubmit={handleSubmitPrompt}
        anchorRef={anchorRef}
        designSystems={designSystems}
        designSystemsLoading={designSystemsLoading}
        selectedDesignSystemId={newDesignSystemId ?? null}
        onDesignSystemChange={setNewDesignSystemId}
        templateOptions={templateOptions}
        selectedTemplateId={newTemplateId}
        onTemplateChange={handleTemplateChange}
        templatePickerDefaultOpen={openTemplatePickerOnStart}
        templateHint={
          selectedTemplate?.type === "template" ? (
            <>
              {t("promptDialog.templateCopyHint", {
                count: selectedTemplate.screenCount ?? 0,
                title: selectedTemplate.title,
              })}
              {selectedTemplate.designSystemId &&
              newDesignSystemId &&
              newDesignSystemId !== selectedTemplate.designSystemId ? (
                <span className="ms-1 inline-flex items-center gap-1">
                  <IconPalette className="size-3" />
                  {t("promptDialog.templateReskinHint", {
                    system:
                      designSystems.find(
                        (system) => system.id === newDesignSystemId,
                      )?.title ?? t("promptDialog.designSystem"),
                  })}
                </span>
              ) : null}
            </>
          ) : null
        }
        canSubmitWithoutPrompt={Boolean(
          selectedTemplate?.hasSeedScreens ||
          selectedTemplate?.type === "template",
        )}
        loading={newDesignHandoffPending}
        onCreateDesignSystem={() => {
          handleNewPromptOpenChange(false);
          navigate("/design-systems/setup");
        }}
        creationMode={FULL_APP_BUILDING_ENABLED ? newDesignMode : undefined}
        onCreationModeChange={
          FULL_APP_BUILDING_ENABLED ? setNewDesignMode : undefined
        }
      />

      {shareTemplate ? (
        <ShareButton
          key={shareTemplate.id}
          resourceType="design"
          resourceId={shareTemplate.id}
          resourceTitle={shareTemplate.title}
          defaultOpen
          triggerClassName="hidden"
          onOpenChange={(open) => {
            if (!open) setShareTemplate(null);
          }}
        />
      ) : null}

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deleteId || bulkDeleteOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteId(null);
            setBulkDeleteOpen(false);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {bulkDeleteOpen
                ? selectedDesignCount === 1
                  ? t("home.deleteSingleDesignsTitle", {
                      count: selectedDesignCount,
                    })
                  : t("home.deleteDesignsTitle", {
                      count: selectedDesignCount,
                    })
                : t("home.deleteDesignTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {bulkDeleteOpen
                ? selectedDesignCount === 1
                  ? t("home.deleteDesignDescription")
                  : t("home.deleteDesignsDescription", {
                      count: selectedDesignCount,
                    })
                : t("home.deleteDesignDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">
              {t("home.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={bulkDeleteOpen ? handleBulkDelete : handleDelete}
              className="bg-red-600 hover:bg-red-700 cursor-pointer"
            >
              {t("home.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rename Dialog */}
      <AlertDialog
        open={!!renameId}
        onOpenChange={(open) => {
          if (!open) setRenameId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("home.renameDesign")}</AlertDialogTitle>
          </AlertDialogHeader>
          <Input
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitRename();
              }
            }}
            placeholder={t("home.designName")}
            className="h-9 text-sm"
          />
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">
              {t("home.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={commitRename}
              disabled={!renameDraft.trim()}
              className="cursor-pointer"
            >
              {t("home.save")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function NewDesignHandoffOverlay() {
  const t = useT();
  return (
    <div
      className="fixed inset-0 z-[180] flex items-center justify-center bg-background/70 backdrop-blur-sm"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex items-center gap-2 rounded-lg border border-border bg-popover px-3 py-2 text-sm font-medium text-foreground shadow-lg">
        <Spinner className="size-4 text-muted-foreground" />
        {t("home.openingDesign")}
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-border bg-card overflow-hidden"
          >
            <div className="aspect-video bg-muted/50 animate-pulse" />
            <div className="p-4 space-y-2">
              <div className="h-4 w-3/4 rounded bg-muted animate-pulse" />
              <div className="h-3 w-1/2 rounded bg-muted animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function TemplatesGrid({
  templates,
  onUse,
  onEdit,
  onRename,
  onShare,
  onRemove,
  onDelete,
  formatDate,
}: {
  templates: TemplateDesign[];
  onUse: (
    event: React.MouseEvent<HTMLElement>,
    template: TemplateDesign,
  ) => void;
  onEdit: (template: TemplateDesign) => void;
  onRename: (template: TemplateDesign) => void;
  onShare: (template: TemplateDesign) => void;
  onRemove: (template: TemplateDesign) => void;
  onDelete: (template: TemplateDesign) => void;
  formatDate: (date?: string) => string;
}) {
  const t = useT();
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {templates.map((template) => (
        <div
          key={template.id}
          className="group relative overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-foreground/15"
        >
          {template.isBuiltIn ? (
            <Badge
              variant="secondary"
              className="pointer-events-none absolute end-2 top-2 z-10 h-5 px-1.5 text-[10px] font-medium shadow-sm"
            >
              {t("promptDialog.builtIn")}
            </Badge>
          ) : null}
          <button
            type="button"
            onClick={(event) => onUse(event, template)}
            className="block w-full text-start"
          >
            <DesignThumbnail html={template.previewHtml ?? null} />
            <div className="p-4">
              <h3 className="mb-1 truncate text-sm font-medium text-foreground/90">
                {template.title}
              </h3>
              <div className="text-xs text-muted-foreground/70">
                {template.isBuiltIn
                  ? t("promptDialog.builtIn")
                  : t("home.templateCardMeta", {
                      count: template.screenCount ?? 0,
                      date: formatDate(
                        template.updatedAt || template.createdAt,
                      ),
                    })}
              </div>
            </div>
          </button>
          <button
            type="button"
            onClick={(event) => onUse(event, template)}
            className="absolute bottom-2 end-2 inline-flex h-7 items-center rounded-full bg-primary px-2.5 text-xs font-medium text-primary-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
          >
            {t("home.useTemplate")}
          </button>
          {!template.isBuiltIn ? (
            <div
              className="absolute end-2 top-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
              onClick={(event) => event.stopPropagation()}
            >
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("home.actionsForDesign", {
                      title: template.title,
                    })}
                    className="h-7 w-7 cursor-pointer bg-black/60 hover:bg-black/80"
                  >
                    <IconDots className="h-3.5 w-3.5 text-foreground/70" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={(event) => onUse(event, template)}
                    className="cursor-pointer"
                  >
                    <IconTemplate className="me-2 h-3.5 w-3.5" />
                    {t("home.useTemplate")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => onEdit(template)}
                    className="cursor-pointer"
                  >
                    <IconPencil className="me-2 h-3.5 w-3.5" />
                    {t("home.editTemplate")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => onRename(template)}
                    className="cursor-pointer"
                  >
                    <IconPencil className="me-2 h-3.5 w-3.5" />
                    {t("home.rename")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => onShare(template)}
                    className="cursor-pointer"
                  >
                    <IconCopy className="me-2 h-3.5 w-3.5" />
                    {t("home.share")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => onRemove(template)}
                    className="cursor-pointer"
                  >
                    <IconX className="me-2 h-3.5 w-3.5" />
                    {t("home.removeFromTemplates")}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => onDelete(template)}
                    className="cursor-pointer text-red-400 focus:text-red-400"
                  >
                    <IconTrash className="me-2 h-3.5 w-3.5" />
                    {t("home.delete")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  onCreateDesign,
  onUseStarter,
}: {
  onCreateDesign: (e: React.MouseEvent<HTMLElement>) => void;
  onUseStarter: (
    e: React.MouseEvent<HTMLElement>,
    starterId: StarterTemplate["id"],
  ) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <h2 className="text-xl font-semibold text-foreground mb-2">
        {t("home.createFirstDesign")}
      </h2>
      <p className="text-sm text-muted-foreground max-w-sm mb-6 leading-relaxed">
        {t("home.pickStartingPoint")}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2 max-w-md mb-6">
        {STARTER_TEMPLATES.map((starter) => (
          <button
            key={starter.id}
            type="button"
            onClick={(event) => onUseStarter(event, starter.id)}
            className="cursor-pointer rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground/80 hover:border-foreground/30 hover:text-foreground/95 transition-colors"
          >
            {t(starter.titleKey)}
          </button>
        ))}
      </div>
      <Button
        onClick={(e: React.MouseEvent<HTMLButtonElement>) =>
          onCreateDesign(e as React.MouseEvent<HTMLElement>)
        }
        className="cursor-pointer dark:bg-white dark:text-black dark:hover:bg-white/90"
      >
        <IconPlus className="w-4 h-4" />
        {t("home.newDesign")}
      </Button>
    </div>
  );
}
