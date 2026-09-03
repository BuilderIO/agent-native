import { emailToColor, emailToName } from "@agent-native/core/client/collab";
import { type PromptComposerSubmitOptions } from "@agent-native/core/client/composer";
import { useFeatureFlag } from "@agent-native/core/client/feature-flags";
import {
  useActionQuery,
  useActionMutation,
  useAvatarUrl,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  CreativeContextShareSheet,
  parseCreativeContexts,
  useCreativeContexts,
  useCreativeContextState,
} from "@agent-native/creative-context/client";
import {
  useSetHeaderActions,
  useSetPageTitle,
} from "@agent-native/toolkit/app-shell";
import { FULL_APP_BUILDING } from "@shared/full-app";
import { derivePromptTitle } from "@shared/prompt-title";
import {
  IconChecks,
  IconChevronLeft,
  IconChevronRight,
  IconPlus,
  IconSearch,
  IconDots,
  IconTrash,
  IconCopy,
  IconX,
  IconPencil,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { nanoid } from "nanoid";
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { useNavigate, Link, useSearchParams } from "react-router";
import { toast } from "sonner";

import { trace } from "@/components/design/design-trace";
import { DesignThumbnail } from "@/components/design/DesignThumbnail";
import { designSystemPickerOptions } from "@/components/editor/design-start-pickers";
import PromptPopover from "@/components/editor/PromptDialog";
import type {
  PromptTemplateOption,
  UploadedFile,
} from "@/components/editor/PromptDialog";
import { QueryErrorState } from "@/components/QueryErrorState";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useDesignSystems } from "@/hooks/use-design-systems";
import { sendToDesignAgentChat } from "@/lib/agent-chat";
import {
  readStoredDesignFilter,
  writeStoredDesignFilter,
  type DesignFilter,
} from "@/lib/design-filter";
import { isDesignSystemUsableForGeneration } from "@/lib/design-system-data";
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
  ownerEmail?: string | null;
  ownerName?: string | null;
  createdAt?: string;
  updatedAt?: string;
  /** Preview HTML for the thumbnail. Only present when the list query asks
   *  for `includePreview: 'true'`. Truncated server-side. */
  previewHtml?: string | null;
}

interface DesignListResult {
  count: number;
  totalCount: number;
  hasMore: boolean;
  page: number;
  pageSize: number;
  totalPages: number;
  designs: Design[];
}

const DESIGN_PAGE_SIZE = 12;

export default function Index() {
  const t = useT();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [designFilter, setDesignFilter] = useState<DesignFilter>(
    () => readStoredDesignFilter() ?? "mine",
  );
  const [page, setPage] = useState(1);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [selectedDesignIds, setSelectedDesignIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [showNewPrompt, setShowNewPrompt] = useState(false);
  const fullAppBuildingEnabled = useFeatureFlag(FULL_APP_BUILDING.key);
  const [newDesignHandoffPending, setNewDesignHandoffPending] = useState(false);
  const [newDesignSystemId, setNewDesignSystemId] = useState<
    string | null | undefined
  >(undefined);
  const [newTemplateId, setNewTemplateId] = useState<string | null>(null);
  // "Design" (default, inline prototype) vs "Full app" (Builder Fusion
  // cloud container). Only reachable behind the full-app-building flag — the
  // popover renders no mode control at all when the flag is off, so this
  // state is always "design" in that case.
  const [newDesignMode, setNewDesignMode] = useState<"design" | "app">(
    "design",
  );
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [contextDesigns, setContextDesigns] = useState<Design[]>([]);

  const anchorElRef = useRef<HTMLElement | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const skipToEditorPendingRef = useRef(false);
  const newDesignSystemWasChosenRef = useRef(false);
  // Keep anchorRef.current in sync so PromptPopover can read it
  anchorRef.current = anchorElRef.current;

  const normalizedSearch = search.trim();
  const listDesignsParams = useMemo(
    () => ({
      page,
      pageSize: DESIGN_PAGE_SIZE,
      createdBy: designFilter === "mine" ? "me" : "all",
      search: normalizedSearch || undefined,
      includePreview: "true",
    }),
    [designFilter, normalizedSearch, page],
  );

  const {
    data: designsData,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useActionQuery<DesignListResult>("list-designs", listDesignsParams);
  const { data: templatesData, isLoading: templatesLoading } = useActionQuery(
    "list-design-templates",
    { includePreview: "true" },
  );
  const createMutation = useActionMutation("create-design");
  const createFromTemplateMutation = useActionMutation(
    "create-design-from-template",
  );
  // Fires the fusion-backed cloud container build; only ever called when
  // runtime flag is true and the user picked "Full app".
  const createFusionAppMutation = useActionMutation("create-fusion-app");
  const deleteMutation = useActionMutation("delete-design");
  const duplicateMutation = useActionMutation("duplicate-design");
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

  /**
   * The picker showed a column of near-identical names ("Builder indexed
   * design system" three times over). Each system already carries its palette
   * in `data`, so the row can show it and be chosen by colour.
   */
  const designSystemOptions = useMemo(
    () => designSystemPickerOptions(designSystems),
    [designSystems],
  );

  const designs = useMemo(
    () => designsData?.designs ?? [],
    [designsData?.designs],
  );
  const templateOptions = useMemo<PromptTemplateOption[]>(
    () =>
      (templatesData?.templates ?? []).map((template) => ({
        id: template.id,
        title: template.title,
        description: template.description,
        category: template.category,
        width: template.width,
        height: template.height,
        previewHtml: template.previewHtml,
        designSystemId: template.designSystemId,
        isBuiltIn: template.isBuiltIn,
      })),
    [templatesData?.templates],
  );
  const creativeContextsQuery = useCreativeContexts();
  const creativeContextState = useCreativeContextState();
  const creativeContextOptions = useMemo(
    () =>
      parseCreativeContexts(creativeContextsQuery.data)
        .filter((context) => context.memberCount > 0)
        .map((context) => ({ id: context.id, name: context.name })),
    [creativeContextsQuery.data],
  );
  // The editor rereads persisted creative-context state after navigation to
  // pick the generation precedent. Track the in-flight save so a submit that
  // follows a pick right away can wait for it instead of racing it.
  const creativeContextPersistRef = useRef<Promise<unknown> | null>(null);
  const handleCreativeContextChange = useCallback(
    (contextId: string | null) => {
      creativeContextPersistRef.current = creativeContextState
        .setState({
          ...creativeContextState.state,
          contextMode: "auto",
          selectedContextId: contextId,
          pinnedPackId: null,
        })
        .catch((error) => {
          toast.error(t("creativeContext.stateSaveFailed"));
          throw error;
        });
    },
    [creativeContextState, t],
  );
  const selectedTemplate =
    templateOptions.find((template) => template.id === newTemplateId) ?? null;

  const showAuthors = designFilter === "all";
  const selectedDesignCount = selectedDesignIds.size;
  const isSelectingDesigns = selectedDesignCount > 0;
  const allVisibleSelected =
    designs.length > 0 &&
    designs.every((design) => selectedDesignIds.has(design.id));
  const totalPages = Math.max(1, designsData?.totalPages ?? 1);

  useEffect(() => {
    if (!designsData || page <= totalPages) return;
    setPage(totalPages);
    setSelectedDesignIds(new Set());
  }, [designsData, page, totalPages]);

  const resolveDefaultDesignSystemId = useCallback(() => {
    if (
      defaultSystem &&
      isDesignSystemUsableForGeneration(defaultSystem.data)
    ) {
      return defaultSystem.id;
    }
    return (
      designSystems.find((system) =>
        isDesignSystemUsableForGeneration(system.data),
      )?.id ?? null
    );
  }, [defaultSystem, designSystems]);

  const syncSelectedTemplate = useCallback(
    (templateId: string | null) => {
      setNewTemplateId(templateId);
      const next = new URLSearchParams(searchParams);
      if (templateId) next.set("templateId", templateId);
      else next.delete("templateId");
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const handleNewPromptOpenChange = useCallback(
    (open: boolean) => {
      setShowNewPrompt(open);
      if (!open) {
        newDesignSystemWasChosenRef.current = false;
        syncSelectedTemplate(null);
        setNewDesignSystemId(undefined);
        setNewDesignMode("design");
      }
    },
    [syncSelectedTemplate],
  );

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
      syncSelectedTemplate(templateId);
      const template = templateOptions.find(
        (candidate) => candidate.id === templateId,
      );
      if (newDesignSystemWasChosenRef.current) return;
      const linkedSystemId =
        template?.designSystemId &&
        designSystems.some((system) => system.id === template.designSystemId)
          ? template.designSystemId
          : null;
      setNewDesignSystemId(
        linkedSystemId ??
          (designSystemsLoading ? undefined : resolveDefaultDesignSystemId()),
      );
    },
    [
      designSystems,
      designSystemsLoading,
      resolveDefaultDesignSystemId,
      syncSelectedTemplate,
      templateOptions,
    ],
  );

  const handleNewDesignSystemChange = useCallback(
    (designSystemId: string | null) => {
      newDesignSystemWasChosenRef.current = true;
      setNewDesignSystemId(designSystemId);
    },
    [],
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
        designs.length > 0 && designs.every((design) => next.has(design.id));

      designs.forEach((design) => {
        if (shouldClear) {
          next.delete(design.id);
        } else {
          next.add(design.id);
        }
      });

      return next;
    });
  }, [designs]);

  const handleSearchChange = useCallback((query: string) => {
    setSearch(query);
    setPage(1);
    setSelectedDesignIds((current) =>
      current.size === 0 ? current : new Set(),
    );
  }, []);

  const handleDesignFilterChange = useCallback((next: string) => {
    if (next !== "all" && next !== "mine") return;
    const nextFilter: DesignFilter = next;
    setDesignFilter(nextFilter);
    writeStoredDesignFilter(nextFilter);
    setPage(1);
    setSelectedDesignIds((current) =>
      current.size === 0 ? current : new Set(),
    );
  }, []);

  const handlePageChange = useCallback(
    (nextPage: number) => {
      setPage(Math.min(Math.max(nextPage, 1), totalPages));
      setSelectedDesignIds((current) =>
        current.size === 0 ? current : new Set(),
      );
    },
    [totalPages],
  );

  const clearSelection = useCallback(() => {
    setSelectedDesignIds(new Set());
  }, []);

  const createDesign = useCallback(
    (
      title: string,
      designSystemId?: string | null,
    ): { id: string; title: string; ready: Promise<void> } => {
      const id = nanoid();
      const projectType: ProjectType = "prototype";
      const finalTitle = title.trim() || "Untitled Design";
      const linkedDesignSystemId = designSystemId ?? null;

      // Optimistic update
      queryClient.setQueryData(
        ["action", "list-designs", listDesignsParams],
        (old: any) => {
          if (!old) return old;
          const newDesign: Design = {
            id,
            title: finalTitle,
            projectType,
            designSystemId: linkedDesignSystemId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          const matchesSearch =
            !normalizedSearch ||
            finalTitle.toLowerCase().includes(normalizedSearch.toLowerCase());
          if (!matchesSearch) return old;

          const totalCount = (old.totalCount ?? old.count ?? 0) + 1;
          const pageSize = old.pageSize ?? DESIGN_PAGE_SIZE;
          const totalPages = Math.max(Math.ceil(totalCount / pageSize), 1);
          const nextDesigns =
            page === 1
              ? [newDesign, ...(old.designs ?? [])].slice(0, pageSize)
              : (old.designs ?? []);
          return {
            ...old,
            count: totalCount,
            totalCount,
            totalPages,
            hasMore: page < totalPages,
            designs: nextDesigns,
          };
        },
      );

      const ready = createMutation
        .mutateAsync({
          id,
          title: finalTitle,
          projectType,
          ...(linkedDesignSystemId
            ? { designSystemId: linkedDesignSystemId }
            : {}),
        } as any)
        .then(() => {
          void queryClient.invalidateQueries({
            queryKey: ["action", "list-designs"],
          });
        })
        .catch((error) => {
          clearPendingGeneration(id);
          void queryClient.invalidateQueries({
            queryKey: ["action", "list-designs"],
          });
          throw error;
        });
      // Fire mutation in background; keep the optimistic navigation instant.
      void ready.catch(() => {});
      return { id, title: finalTitle, ready };
    },
    [listDesignsParams, normalizedSearch, page, queryClient, createMutation],
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
    async (
      prompt: string,
      files: UploadedFile[],
      options: PromptComposerSubmitOptions,
      pendingOptions?: { skipQuestions?: boolean },
    ) => {
      // The rejection already surfaced its own toast in handleCreativeContextChange;
      // swallow it here so a flaky context save can't block generation, but
      // only after letting it settle instead of racing it.
      await creativeContextPersistRef.current?.catch(() => {});
      const trimmedPrompt = prompt.trim();
      const designSystemId =
        newDesignSystemId === undefined
          ? resolveDefaultDesignSystemId()
          : newDesignSystemId;

      if (selectedTemplate && newDesignMode === "design") {
        setNewDesignHandoffPending(true);
        const title = trimmedPrompt
          ? derivePromptTitle(trimmedPrompt)
          : selectedTemplate.title;
        try {
          const result = await createFromTemplateMutation.mutateAsync({
            templateId: selectedTemplate.id,
            title,
            designSystemId,
            ...(trimmedPrompt ? { prompt } : {}),
          });
          if (!result.id) {
            throw new Error("Template copy did not return a design ID");
          }
          const effectiveDesignSystemId = result.designSystemId ?? null;
          if (result.adaptationPending) {
            const effectiveSystemTitle =
              designSystems.find(
                (system) => system.id === effectiveDesignSystemId,
              )?.title ?? t("promptDialog.designSystem");
            writePendingGeneration(result.id, {
              prompt:
                prompt.trim() ||
                t("promptDialog.reskinTemplatePrompt", {
                  title: selectedTemplate.title,
                  system: effectiveSystemTitle,
                }),
              files,
              title: result.title ?? title,
              source: selectedTemplate.title,
              templateId: selectedTemplate.id,
              templateBaselineFiles: result.templateBaselineFiles,
              designSystemId: effectiveDesignSystemId,
              skipQuestions: true,
              ...options,
            });
          }
          if (trimmedPrompt) {
            handleGenerateDesignTitle(
              result.id,
              trimmedPrompt,
              result.title ?? title,
            );
          }
          void queryClient
            .invalidateQueries({
              queryKey: ["action", "list-designs"],
            })
            .catch(() => {});
          void navigate(`/design/${result.id}`);
          return;
        } catch (error) {
          setNewDesignHandoffPending(false);
          toast.error(
            error instanceof Error
              ? error.message
              : t("templatesPage.createFailed"),
          );
          throw error;
        }
      }

      // Derive a short title from the prompt — first line, ~40 chars max,
      // word-boundary truncated. The full prompt still drives generation;
      // the title is just a label, so longer is worse.
      const derivedTitle = derivePromptTitle(prompt);

      const { id, title, ready } = createDesign(derivedTitle, designSystemId);
      handleGenerateDesignTitle(id, prompt, title);

      if (fullAppBuildingEnabled && newDesignMode === "app") {
        // Full-app designs are backed by a real running container, not a
        // queued inline generation — skip writePendingGeneration and let the
        // fusion app mutation (and its own status/progress banner in the
        // editor) drive the build instead. Still wait for the design row
        // before navigating so the first get-design cannot 404 and bounce
        // home while create is settling.
        try {
          await ready;
        } catch (error) {
          setNewDesignHandoffPending(false);
          trace("persist", "create-design-failed", {
            id,
            designSystemId,
            message: error instanceof Error ? error.message : String(error),
          });
          toast.error(t("home.failedToCreateDesign"));
          throw error;
        }
        void createFusionAppMutation
          .mutateAsync({
            designId: id,
            prompt,
          } as any)
          .then((result: any) => {
            if (result?.status !== "not-configured") return;
            // Builder isn't connected/configured, so no fusionApp linkage was
            // written and no banner will render. Hand off to the agent chat,
            // which owns the connect-Builder card flow, keeping the user's
            // prompt so nothing is lost.
            sendToDesignAgentChat({
              message: prompt,
              context:
                `The user's request is to build this design as a full app. ` +
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
              message: prompt,
              context:
                `The user's request is to build this design as a full app. ` +
                `Starting the full-app build for design ${id} failed: ` +
                `${message}. Check whether the design row exists, Builder is ` +
                `connected, and create-fusion-app can be retried safely.`,
              submit: true,
            });
          });
      } else {
        writePendingGeneration(id, {
          prompt,
          files,
          title,
          designSystemId,
          skipQuestions: pendingOptions?.skipQuestions,
          ...options,
        });
        // Rejecting here is what lets PromptPopover restore the typed prompt.
        // Navigating first strands the user in an empty editor with no error.
        try {
          await ready;
        } catch (error) {
          clearPendingGeneration(id);
          setNewDesignHandoffPending(false);
          trace("persist", "create-design-failed", {
            id,
            designSystemId,
            message: error instanceof Error ? error.message : String(error),
          });
          toast.error(t("home.failedToCreateDesign"));
          throw error;
        }
      }

      trace("persist", "new-design-handoff", { id, designSystemId });
      setNewDesignHandoffPending(true);
      void navigate(`/design/${id}`);
    },
    [
      createDesign,
      createFromTemplateMutation,
      createFusionAppMutation,
      designSystems,
      fullAppBuildingEnabled,
      handleGenerateDesignTitle,
      navigate,
      newDesignMode,
      newDesignSystemId,
      queryClient,
      resolveDefaultDesignSystemId,
      selectedTemplate,
      t,
    ],
  );

  const startBlankDesign = useCallback(
    async (askInEditor: boolean) => {
      if (skipToEditorPendingRef.current) return;
      skipToEditorPendingRef.current = true;
      setNewDesignHandoffPending(true);

      const designSystemId =
        newDesignSystemId === undefined
          ? resolveDefaultDesignSystemId()
          : newDesignSystemId;
      const { id, ready } = createDesign(
        t("home.untitledDesign"),
        designSystemId,
      );

      try {
        // Unlike prompt-backed creation, an empty shell has no pending-generation
        // marker to keep the editor polling across its route remount. Wait for the
        // row to persist so the first get-design read cannot briefly return 404.
        await ready;
        void navigate(`/design/${id}${askInEditor ? "?new=1" : ""}`);
      } catch (error) {
        skipToEditorPendingRef.current = false;
        setNewDesignHandoffPending(false);
        toast.error(t("home.failedToCreateDesign"));
        throw error;
      }
    },
    [
      createDesign,
      navigate,
      newDesignSystemId,
      resolveDefaultDesignSystemId,
      t,
    ],
  );

  const handleSkipToEditor = useCallback(async () => {
    if (selectedTemplate && newDesignMode === "design") {
      await handleSubmitPrompt("", [], {});
      return false;
    }
    // Picking the blank-canvas card already answered "what do you want", so the
    // editor must not open its own ask on arrival.
    await startBlankDesign(false);
    return false;
  }, [handleSubmitPrompt, newDesignMode, selectedTemplate, startBlankDesign]);

  const openNewDesign = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      // A design and an app are different creation calls, so that one choice
      // has to be made before the row exists. With full app building off there
      // is nothing left to ask up front, and the editor asks instead — where
      // the drawing tools are also on screen.
      if (!fullAppBuildingEnabled) {
        void startBlankDesign(true);
        return;
      }
      anchorElRef.current = e.currentTarget;
      newDesignSystemWasChosenRef.current = false;
      syncSelectedTemplate(null);
      setNewDesignSystemId(
        designSystemsLoading ? undefined : resolveDefaultDesignSystemId(),
      );
      setShowNewPrompt(true);
    },
    [
      designSystemsLoading,
      fullAppBuildingEnabled,
      resolveDefaultDesignSystemId,
      startBlankDesign,
      syncSelectedTemplate,
    ],
  );

  const handleDelete = useCallback(() => {
    if (!deleteId) return;
    const id = deleteId;

    // Optimistic update
    queryClient.setQueryData(
      ["action", "list-designs", listDesignsParams],
      (old: any) => {
        if (!old) return old;
        const designs = old.designs ?? [];
        if (!designs.some((design: Design) => design.id === id)) return old;
        const totalCount = Math.max(
          (old.totalCount ?? old.count ?? designs.length) - 1,
          0,
        );
        const pageSize = old.pageSize ?? DESIGN_PAGE_SIZE;
        const totalPages = Math.max(Math.ceil(totalCount / pageSize), 1);
        return {
          ...old,
          count: totalCount,
          totalCount,
          totalPages,
          hasMore: page < totalPages,
          designs: designs.filter((design: Design) => design.id !== id),
        };
      },
    );

    setDeleteId(null);

    deleteMutation.mutate({ id } as any, {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: ["action", "list-designs"],
        });
      },
      onError: () => {
        void queryClient.invalidateQueries({
          queryKey: ["action", "list-designs"],
        });
      },
    });
  }, [deleteId, listDesignsParams, page, queryClient, deleteMutation]);

  const handleBulkDelete = useCallback(() => {
    const ids = Array.from(selectedDesignIds);
    if (ids.length === 0) return;

    const idsToDelete = new Set(ids);

    queryClient.setQueryData(
      ["action", "list-designs", listDesignsParams],
      (old: any) => {
        if (!old) return old;
        const designs = old.designs ?? [];
        const nextDesigns = designs.filter(
          (design: Design) => !idsToDelete.has(design.id),
        );
        const deletedCount = designs.length - nextDesigns.length;
        if (deletedCount === 0) return old;
        const totalCount = Math.max(
          (old.totalCount ?? old.count ?? designs.length) - deletedCount,
          0,
        );
        const pageSize = old.pageSize ?? DESIGN_PAGE_SIZE;
        const totalPages = Math.max(Math.ceil(totalCount / pageSize), 1);
        return {
          ...old,
          count: totalCount,
          totalCount,
          totalPages,
          hasMore: page < totalPages,
          designs: nextDesigns,
        };
      },
    );

    setBulkDeleteOpen(false);
    setSelectedDesignIds(new Set());

    void Promise.allSettled(
      ids.map((id) => deleteMutation.mutateAsync({ id } as any)),
    ).then(() => {
      void queryClient.invalidateQueries({
        queryKey: ["action", "list-designs"],
      });
    });
  }, [listDesignsParams, page, selectedDesignIds, queryClient, deleteMutation]);

  const handleDuplicate = useCallback(
    (id: string) => {
      duplicateMutation.mutate({ id } as any, {
        onSuccess: (data: any) => {
          void queryClient.invalidateQueries({
            queryKey: ["action", "list-designs"],
          });
          if (data?.id) {
            void navigate(`/design/${data.id}`);
          }
        },
      });
    },
    [duplicateMutation, queryClient, navigate],
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

    updateMutation.mutate({ id, title: next } as any, {
      onSuccess: () => {
        void queryClient.invalidateQueries({
          queryKey: ["action", "list-designs"],
        });
      },
      onError: () => {
        void queryClient.invalidateQueries({
          queryKey: ["action", "list-designs"],
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
    <div className="flex flex-wrap items-center gap-3">
      <ToggleGroup
        type="single"
        value={designFilter}
        onValueChange={handleDesignFilterChange}
        aria-label={t("home.designFilter")}
        className="w-fit rounded-lg border border-border bg-card p-0.5"
        size="sm"
      >
        <ToggleGroupItem
          value="mine"
          aria-label={t("home.showMineDesigns")}
          className="h-7 rounded-md px-3 text-xs data-[state=on]:bg-accent"
        >
          {t("home.mine")}
        </ToggleGroupItem>
        <ToggleGroupItem
          value="all"
          aria-label={t("home.showAllDesigns")}
          className="h-7 rounded-md px-3 text-xs data-[state=on]:bg-accent"
        >
          {t("home.all")}
        </ToggleGroupItem>
      </ToggleGroup>
      <div className="relative">
        <IconSearch className="absolute start-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/70" />
        <Input
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder={t("home.searchPlaceholder")}
          aria-label={t("home.searchPlaceholder")}
          className="ps-8 h-8 w-48 bg-accent/50 border-border text-sm text-foreground/90 placeholder:text-muted-foreground/70"
        />
      </div>
      <Button
        size="sm"
        onClick={openNewDesign}
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
          : t("home.newDesign")}
      </Button>
    </div>,
  );

  return (
    <>
      {newDesignHandoffPending ? <NewDesignHandoffOverlay /> : null}
      <main className="px-4 sm:px-6 py-6 sm:py-10">
        {isLoading ? (
          <LoadingSkeleton />
        ) : isError ? (
          <QueryErrorState
            onRetry={() => void refetch()}
            retrying={isFetching}
          />
        ) : designs.length === 0 ? (
          <EmptyState
            onCreateDesign={openNewDesign}
            onStarterPrompt={(prompt) => handleSubmitPrompt(prompt, [], {})}
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
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setContextDesigns(
                        designs.filter((design) =>
                          selectedDesignIds.has(design.id),
                        ),
                      )
                    }
                    className="cursor-pointer"
                  >
                    <IconPlus className="w-3.5 h-3.5" />
                    {t("creativeContext.addToContext" /* i18n-key-ignore */)}
                  </Button>
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
              {designs.map((design) => {
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
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
                        <span className="shrink-0">
                          {formatDate(design.updatedAt || design.createdAt)}
                        </span>
                        {showAuthors && design.ownerEmail ? (
                          <>
                            <span aria-hidden>·</span>
                            <DesignAuthorByline
                              email={design.ownerEmail}
                              name={design.ownerName}
                            />
                          </>
                        ) : null}
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
                    <div className="absolute top-2 end-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
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
                            onClick={() =>
                              setTimeout(() => startRename(design))
                            }
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
                            onSelect={(event) => {
                              event.preventDefault();
                              setContextDesigns([design]);
                            }}
                            className="cursor-pointer"
                          >
                            <IconPlus className="w-3.5 h-3.5 me-2" />
                            {t(
                              "creativeContext.addToContext" /* i18n-key-ignore */,
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              setTimeout(() => setDeleteId(design.id))
                            }
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
            {totalPages > 1 ? (
              <nav
                aria-label={t("home.paginationPage", {
                  page,
                  totalPages,
                })}
                className="mt-6 flex items-center justify-between gap-3 border-t border-border px-1 pt-3"
              >
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(page - 1)}
                  disabled={page <= 1 || isFetching}
                  className="cursor-pointer"
                >
                  <IconChevronLeft className="size-3.5" />
                  {t("home.paginationPrevious")}
                </Button>
                <span
                  aria-live="polite"
                  className="text-xs text-muted-foreground"
                >
                  {t("home.paginationPage", { page, totalPages })}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handlePageChange(page + 1)}
                  disabled={page >= totalPages || isFetching}
                  className="cursor-pointer"
                >
                  {t("home.paginationNext")}
                  <IconChevronRight className="size-3.5" />
                </Button>
              </nav>
            ) : null}
          </>
        )}
      </main>

      <CreativeContextShareSheet
        open={contextDesigns.length > 0}
        onOpenChange={(open) => {
          if (!open) setContextDesigns([]);
        }}
        resources={contextDesigns.map((design) => ({
          appId: "design",
          resourceType: "design",
          resourceId: design.id,
          title: design.title,
          updatedAt: design.updatedAt ?? design.createdAt,
          preview: { kind: "document", label: "Design" },
        }))}
      />

      <PromptPopover
        open={showNewPrompt}
        onOpenChange={handleNewPromptOpenChange}
        title={t("home.newDesignLower")}
        placeholder={
          selectedTemplate
            ? t("promptDialog.templatePromptPlaceholder", {
                title: selectedTemplate.title,
              })
            : t("home.describeBuild")
        }
        onSkip={handleSkipToEditor}
        offerStartChoice
        skipLabel={
          selectedTemplate
            ? t("templatesPage.useTemplate")
            : t("home.skipToEditor")
        }
        onSubmit={handleSubmitPrompt}
        anchorRef={anchorRef}
        templateOptions={templateOptions}
        templatesLoading={templatesLoading}
        selectedTemplateId={newTemplateId}
        onTemplateChange={handleTemplateChange}
        designSystems={designSystemOptions}
        designSystemsLoading={designSystemsLoading}
        selectedDesignSystemId={newDesignSystemId ?? null}
        onDesignSystemChange={handleNewDesignSystemChange}
        creativeContexts={creativeContextOptions}
        creativeContextsLoading={creativeContextsQuery.isLoading}
        selectedCreativeContextId={
          creativeContextState.state.selectedContextId ?? null
        }
        onCreativeContextChange={handleCreativeContextChange}
        loading={newDesignHandoffPending}
        onCreateDesignSystem={() => {
          handleNewPromptOpenChange(false);
          void navigate("/design-systems/setup");
        }}
        creationMode={fullAppBuildingEnabled ? newDesignMode : undefined}
        onCreationModeChange={
          fullAppBuildingEnabled ? setNewDesignMode : undefined
        }
      />

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
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 cursor-pointer"
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
            aria-label={t("home.designName")}
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

/** Who created a design, shown on its library card in shared workspaces. */
function DesignAuthorByline({
  email,
  name: profileName,
}: {
  email: string;
  name?: string | null;
}) {
  const name = profileName?.trim() || emailToName(email);
  const avatarUrl = useAvatarUrl(email);

  return (
    <span className="flex min-w-0 items-center gap-1.5" title={email}>
      <Avatar className="size-4 shrink-0">
        {avatarUrl ? <AvatarImage src={avatarUrl} alt="" /> : null}
        <AvatarFallback
          /* guard:allow-raw-color — emailToColor ignores the theme, so the initial stays white in both. */
          className="text-[8px] font-semibold text-white"
          style={{ backgroundColor: emailToColor(email) }}
        >
          {name.trim().charAt(0).toUpperCase() || "?"}
        </AvatarFallback>
      </Avatar>
      <span className="truncate">{name}</span>
    </span>
  );
}

/**
 * Render the design's index.html as a non-interactive thumbnail. The iframe
 * renders at a fixed natural size (so designs that assume a desktop viewport
 * still look right) and is then scaled to fill the card via a transform.
 *
 * The size is recomputed via ResizeObserver so the same component works in
 * 1, 2, 3 and 4-column grid layouts. We use a sandboxed iframe with only
 * allow-scripts (no allow-same-origin) so Tailwind/Alpine CDN render without
 * granting arbitrary design HTML access to the host origin.
 */
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

// Starter prompt chips shown on the empty home state. Each one is a fully
// formed prompt that the user can run with one click instead of staring at
// an empty composer. Keep these distinct enough that the four results would
// all look meaningfully different — same approach as Phase 2 variant
// generation in the design agent.
const STARTER_PROMPTS: { labelKey: string; prompt: string }[] = [
  {
    labelKey: "home.starterSaas",
    prompt:
      "A modern SaaS landing page with a dark theme, hero section, three feature cards, and a final CTA section.",
  },
  {
    labelKey: "home.starterDashboard",
    prompt:
      "A clean analytics dashboard with a sidebar nav, four KPI tiles, a chart, and a recent-activity table.",
  },
  {
    labelKey: "home.starterMobile",
    prompt:
      "A mobile app prototype shown on a phone frame, with a tab bar at the bottom and three list cards on the home screen.",
  },
  {
    labelKey: "home.starterPricing",
    prompt:
      "A three-tier pricing page with a monthly/annual toggle, feature checklists, and a highlighted recommended tier.",
  },
];

function EmptyState({
  onCreateDesign,
  onStarterPrompt,
}: {
  onCreateDesign: (e: React.MouseEvent<HTMLElement>) => void;
  onStarterPrompt: (prompt: string) => void;
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
        {STARTER_PROMPTS.map((s) => (
          <button
            key={s.labelKey}
            type="button"
            onClick={() => onStarterPrompt(s.prompt)}
            className="cursor-pointer rounded-full border border-border bg-card px-3 py-1.5 text-xs text-foreground/80 hover:border-foreground/30 hover:text-foreground/95 transition-colors"
          >
            {t(s.labelKey)}
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
