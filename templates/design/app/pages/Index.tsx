import {
  requireAgentEngineConfiguredForDispatch,
  useAgentEngineConfigured,
} from "@agent-native/core/client/agent-chat";
import { emailToColor, emailToName } from "@agent-native/core/client/collab";
import {
  useActionQuery,
  useActionMutation,
  useAvatarUrl,
  useSession,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useLab } from "@agent-native/core/client/labs";
import {
  CreativeContextShareSheet,
  parseCreativeContexts,
  useCreativeContextLab,
  useCreativeContexts,
  useCreativeContextState,
} from "@agent-native/creative-context/client";
import {
  AgentSuggestionBar,
  agentSuggestionPrompt,
} from "@agent-native/toolkit/agentkit";
import {
  PromptHome,
  TemplateLibraryGrid,
  createHomeSuggestionRandom,
  pickHomeSuggestions,
  useHomeSuggestionSeed,
  useFirstPaintPromptDraft,
  useHomeSearchShortcut,
  useSetPageTitle,
} from "@agent-native/toolkit/app-shell";
import { BuilderSetupCard } from "@agent-native/toolkit/app/chat/chat/run-recovery";
import {
  PromptComposer,
  snapshotComposerContextItems,
  type PromptComposerSubmitOptions,
  type TiptapComposerHandle,
} from "@agent-native/toolkit/app/chat/composer/index";
import { ClientOnly } from "@agent-native/toolkit/app/shared";
import { OwnershipFilter } from "@agent-native/toolkit/app/sharing/OwnershipFilter";
import { designTemplateRetryKey } from "@shared/design-template-retry";
import { FULL_APP_BUILDING_LAB } from "@shared/labs";
import { derivePromptTitle } from "@shared/prompt-title";
import {
  IconArrowRight,
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
import {
  useLocation,
  useNavigate,
  Link,
  useNavigationType,
  useSearchParams,
} from "react-router";
import { toast } from "sonner";

import { trace } from "@/components/design/design-trace";
import { DesignThumbnail } from "@/components/design/DesignThumbnail";
import { designSystemPickerOptions } from "@/components/editor/design-start-pickers";
import { useHomePromptContext } from "@/components/editor/HomePromptContext";
import PromptPopover from "@/components/editor/PromptDialog";
import type {
  PromptTemplateOption,
  UploadedFile,
} from "@/components/editor/PromptDialog";
import {
  DesignHomeLibrary,
  type DesignHomeLibraryTab,
} from "@/components/home/DesignHomeLibrary";
import { DesignRecentSkeleton } from "@/components/home/DesignRecentSkeleton";
import { QueryErrorState } from "@/components/QueryErrorState";
import { DesignTemplateLibrary } from "@/components/templates/DesignTemplateLibrary";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DESIGN_HOME_SUGGESTION_POOLS,
  trackDesignHomeSuggestionClick,
} from "@/home-suggestions";
import { useDesignSystemWorkflows } from "@/hooks/use-design-system-workflows";
import { useDesignSystems } from "@/hooks/use-design-systems";
import { sendToDesignAgentChat } from "@/lib/agent-chat";
import {
  readStoredDesignFilter,
  writeStoredDesignFilter,
  type DesignFilter,
} from "@/lib/design-filter";
import {
  designPromptReferenceTypes,
  trackDesignPromptSubmitted,
} from "@/lib/design-funnel-tracking";
import {
  clearPendingGeneration,
  writePendingGeneration,
} from "@/lib/pending-generation";
import { cn } from "@/lib/utils";

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

const DESIGN_PAGE_SIZE = 50;
const HOME_TEMPLATE_LIMIT = 8;
const HOME_LIBRARY_HAS_RECENTS_STORAGE_KEY = "design-home-has-recents";

function readHomeLibraryHasRecents():
  | { status: "available"; value: boolean | null }
  | { status: "unavailable" } {
  if (typeof window === "undefined") return { status: "unavailable" };

  try {
    const value = window.localStorage.getItem(
      HOME_LIBRARY_HAS_RECENTS_STORAGE_KEY,
    );
    return {
      status: "available",
      value: value === "true" ? true : value === "false" ? false : null,
    };
  } catch {
    return { status: "unavailable" };
  }
}

function writeHomeLibraryHasRecents(
  value: boolean,
): { status: "available" } | { status: "unavailable" } {
  if (typeof window === "undefined") return { status: "unavailable" };
  try {
    window.localStorage.setItem(
      HOME_LIBRARY_HAS_RECENTS_STORAGE_KEY,
      String(value),
    );
    return { status: "available" };
  } catch {
    return { status: "unavailable" };
  }
}

export default function Index() {
  const t = useT();
  const location = useLocation();
  const navigationType = useNavigationType();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isSaveTemplateGettingStarted =
    searchParams.get("gettingStarted") === "save-template";
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
  const [storedHasAccessibleDesigns] = useState(readHomeLibraryHasRecents);
  const [homeSection, setHomeSection] = useState<DesignHomeLibraryTab>(
    isSaveTemplateGettingStarted
      ? "recent"
      : storedHasAccessibleDesigns.status === "available" &&
          storedHasAccessibleDesigns.value === true
        ? "recent"
        : "templates",
  );
  const homeLibraryTabWasSelectedRef = useRef(false);
  const checklistSearch = searchParams.toString();
  const previousChecklistLocationRef = useRef({
    isSaveTemplateGettingStarted,
    search: checklistSearch,
    hash: location.hash,
  });
  const designFilterWasSelectedRef = useRef(false);
  const composerRef = useRef<TiptapComposerHandle>(null);
  const focusComposer = useCallback(() => composerRef.current?.focus(), []);
  const firstPaintPromptDraft = useFirstPaintPromptDraft("design");
  const firstPaintPrompt =
    firstPaintPromptDraft.status === "present"
      ? firstPaintPromptDraft.draft
      : null;
  const [homePromptInitialText, setHomePromptInitialText] = useState(
    () => firstPaintPrompt?.text,
  );
  const [homePromptInitialTextKey, setHomePromptInitialTextKey] = useState(
    () => firstPaintPrompt?.revision,
  );
  const homeSuggestionPromptSourceRef = useRef(
    firstPaintPrompt?.source === "home_suggestion",
  );
  const [quickStartPending, setQuickStartPending] = useState(false);
  const quickStartRef = useRef(false);
  const submissionErrorRef = useRef(false);
  const fullAppBuildingEnabled = useLab(FULL_APP_BUILDING_LAB);
  const systemsEnabled = useDesignSystemWorkflows();
  const [newDesignHandoffPending, setNewDesignHandoffPending] = useState(false);
  const [chosenDesignSystemId, setNewDesignSystemId] = useState<string | null>(
    null,
  );
  const [newTemplateId, setNewTemplateId] = useState<string | null>(null);
  const [newDesignMode, setNewDesignMode] = useState<"design" | "app">(
    "design",
  );
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [contextDesigns, setContextDesigns] = useState<Design[]>([]);

  useEffect(() => {
    const previousLocation = previousChecklistLocationRef.current;
    const checklistQueryReplace =
      navigationType === "REPLACE" &&
      previousLocation.isSaveTemplateGettingStarted &&
      isSaveTemplateGettingStarted &&
      previousLocation.search !== checklistSearch;
    previousChecklistLocationRef.current = {
      isSaveTemplateGettingStarted,
      search: checklistSearch,
      hash: location.hash,
    };

    if (isSaveTemplateGettingStarted && !checklistQueryReplace) {
      homeLibraryTabWasSelectedRef.current = true;
      setHomeSection("recent");
    }

    const targetId = location.hash.slice(1);
    if (
      !targetId ||
      (checklistQueryReplace && previousLocation.hash === location.hash)
    ) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.scrollIntoView({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    isSaveTemplateGettingStarted,
    checklistSearch,
    location.hash,
    location.key,
    navigationType,
  ]);

  const skipToEditorPendingRef = useRef(false);
  const newDesignSystemWasChosenRef = useRef(false);
  const templateCopyIdsRef = useRef(
    new Map<string, { key: string; id: string }>(),
  );

  const normalizedSearch = search.trim();
  const listDesignsParams = useMemo(
    () => ({
      page,
      pageSize: DESIGN_PAGE_SIZE,
      createdBy:
        designFilter === "mine"
          ? "me"
          : designFilter === "not-mine"
            ? "not-me"
            : "all",
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
  const accessibleDesignsSummary = useActionQuery<
    Pick<DesignListResult, "totalCount">
  >("list-designs", {
    page: 1,
    pageSize: 1,
    createdBy: "all",
    compact: "true",
    includePreview: "false",
  });
  const accessibleDesignCount = accessibleDesignsSummary.data?.totalCount;
  const hasAccessibleDesigns =
    accessibleDesignsSummary.isSuccess &&
    accessibleDesignCount !== undefined &&
    accessibleDesignCount > 0;
  const ownedDesignsSummary = useActionQuery<
    Pick<DesignListResult, "totalCount">
  >("list-designs", {
    page: 1,
    pageSize: 1,
    createdBy: "me",
    compact: "true",
    includePreview: "false",
  });
  const hasSearchResultsSection = normalizedSearch.length > 0;
  const revealRecentSearch = useCallback(() => {
    homeLibraryTabWasSelectedRef.current = true;
    setHomeSection("recent");
    return true;
  }, []);
  useHomeSearchShortcut(true, revealRecentSearch);
  useEffect(() => {
    if (
      !accessibleDesignsSummary.isSuccess ||
      accessibleDesignCount === undefined
    ) {
      return;
    }

    writeHomeLibraryHasRecents(hasAccessibleDesigns);
    if (!hasAccessibleDesigns) {
      if (isSaveTemplateGettingStarted || hasSearchResultsSection) return;
      homeLibraryTabWasSelectedRef.current = false;
      setHomeSection("templates");
      return;
    }
    if (homeLibraryTabWasSelectedRef.current) return;

    setHomeSection("recent");
  }, [
    accessibleDesignCount,
    accessibleDesignsSummary.isSuccess,
    hasAccessibleDesigns,
    hasSearchResultsSection,
    isSaveTemplateGettingStarted,
  ]);
  useEffect(() => {
    if (hasSearchResultsSection) setHomeSection("recent");
  }, [hasSearchResultsSection]);
  const {
    data: templatesData,
    isLoading: templatesLoading,
    isError: templatesError,
    isFetching: templatesFetching,
    refetch: refetchTemplates,
  } = useActionQuery("list-design-templates", {
    includePreview: "true",
    includeSavedPreview: "false",
  });
  const createMutation = useActionMutation("create-design");
  const createFromTemplateMutation = useActionMutation(
    "create-design-from-template",
  );
  const createFusionAppMutation = useActionMutation("create-builder-app");
  const deleteMutation = useActionMutation("delete-design");
  const duplicateMutation = useActionMutation("duplicate-design");
  const updateMutation = useActionMutation("update-design");
  const generateTitleMutation = useActionMutation("generate-design-title");
  const userRenamedDesignIdsRef = useRef<Set<string>>(new Set());
  const {
    designSystems,
    isLoading: designSystemsLoading,
    error: designSystemsError,
    refetch: refetchDesignSystems,
  } = useDesignSystems(systemsEnabled);
  const agentEngine = useAgentEngineConfigured();
  const agentEngineConfigured = agentEngine.canChat;
  const agentEngineMissing = agentEngine.missing;
  const [setupCardBouncePulse, setSetupCardBouncePulse] = useState(0);
  const bounceSetupCard = () => {
    if (agentEngineMissing) setSetupCardBouncePulse((pulse) => pulse + 1);
  };
  const retryAgentEngineStatus = useCallback(() => {
    window.dispatchEvent(new Event("agent-engine:configured-changed"));
  }, []);
  const quickActionsEnabled = agentEngineConfigured;
  const { session: suggestionSession } = useSession();
  const homeSuggestionsIdentity = [
    suggestionSession?.authUserId ??
      suggestionSession?.userId ??
      suggestionSession?.email ??
      "anonymous",
    suggestionSession?.orgId ?? "",
  ];
  const homeSuggestionsIdentityScope = JSON.stringify(homeSuggestionsIdentity);
  const homeSuggestionSeed = useHomeSuggestionSeed();
  const homeSuggestionsProfile = useActionQuery<{
    onboardingRole?: string | null;
  }>(
    "get-user-profile",
    {},
    {
      queryKeyScope: [homeSuggestionsIdentityScope],
      staleTime: 0,
    },
  );
  const selectedHomeSuggestionKeys = useMemo(
    () =>
      pickHomeSuggestions(
        DESIGN_HOME_SUGGESTION_POOLS,
        homeSuggestionsProfile.data?.onboardingRole,
        createHomeSuggestionRandom(homeSuggestionSeed),
      ),
    [
      homeSuggestionsIdentityScope,
      homeSuggestionsProfile.data?.onboardingRole,
      homeSuggestionSeed,
    ],
  );
  const homeSuggestions = selectedHomeSuggestionKeys.map(({ id, label }) => {
    const prompt = t(label);
    return { id, label: prompt, prompt };
  });
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
  const creativeContextEnabled = useCreativeContextLab();
  const creativeContextsQuery = useCreativeContexts(
    {},
    { enabled: creativeContextEnabled },
  );
  const creativeContextState = useCreativeContextState({
    enabled: creativeContextEnabled,
  });
  const creativeContextOptions = useMemo(
    () =>
      parseCreativeContexts(creativeContextsQuery.data)
        .filter((context) => context.memberCount > 0)
        .map((context) => ({ id: context.id, name: context.name })),
    [creativeContextsQuery.data],
  );
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
  const homeTemplates = useMemo(
    () =>
      templateOptions
        .filter((template) => template.isBuiltIn)
        .slice(0, HOME_TEMPLATE_LIMIT),
    [templateOptions],
  );
  const selectedTemplate =
    templateOptions.find((template) => template.id === newTemplateId) ?? null;
  const templateDesignSystemId =
    selectedTemplate?.designSystemId &&
    designSystems.some(
      (system) => system.id === selectedTemplate.designSystemId,
    )
      ? selectedTemplate.designSystemId
      : null;
  const newDesignSystemId = !systemsEnabled
    ? null
    : newDesignSystemWasChosenRef.current
      ? chosenDesignSystemId
      : templateDesignSystemId;

  const showAuthors = designFilter !== "mine";
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

  const syncSelectedTemplate = useCallback(
    (templateId: string | null) => {
      setNewTemplateId(templateId);
      const next = new URLSearchParams(searchParams);
      if (templateId) next.set("templateId", templateId);
      else next.delete("templateId");
      if (next.toString() === searchParams.toString()) return;
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const handleTemplateChange = useCallback(
    (templateId: string | null) => {
      syncSelectedTemplate(templateId);
    },
    [syncSelectedTemplate],
  );

  const handleNewDesignSystemChange = useCallback(
    (designSystemId: string | null) => {
      newDesignSystemWasChosenRef.current = true;
      setNewDesignSystemId(designSystemId);
    },
    [],
  );
  const homeContext = useHomePromptContext({
    systems: designSystemOptions,
    systemId: newDesignSystemId,
    onSystemChange: handleNewDesignSystemChange,
    templates: templateOptions,
    templateId: newTemplateId,
    onTemplateChange: handleTemplateChange,
    systemsLoading: designSystemsLoading,
    systemsError: designSystemsError,
    retrySystems: () => void refetchDesignSystems(),
  });

  const resolveAppDesignSystemId = useCallback(async () => {
    const linkedSystemId = selectedTemplate?.designSystemId;
    if (
      !linkedSystemId ||
      newDesignMode !== "app" ||
      !systemsEnabled ||
      newDesignSystemWasChosenRef.current ||
      (!designSystemsLoading && !designSystemsError)
    ) {
      return newDesignSystemId;
    }

    const result = await refetchDesignSystems();
    if (!result.isSuccess || !result.data) {
      throw result.error ?? new Error(t("home.failedToCreateDesign"));
    }
    return result.data.designSystems.some(
      (system) => system.id === linkedSystemId,
    )
      ? linkedSystemId
      : null;
  }, [
    designSystemsError,
    designSystemsLoading,
    newDesignMode,
    newDesignSystemId,
    refetchDesignSystems,
    selectedTemplate,
    systemsEnabled,
    t,
  ]);

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
    if (query.trim()) setHomeSection("recent");
    setPage(1);
    setSelectedDesignIds((current) =>
      current.size === 0 ? current : new Set(),
    );
  }, []);

  const handleDesignFilterChange = useCallback(
    (next: "all" | "mine" | "shared") => {
      designFilterWasSelectedRef.current = true;
      const nextFilter: DesignFilter = next === "shared" ? "not-mine" : next;
      setDesignFilter(nextFilter);
      writeStoredDesignFilter(nextFilter);
      setPage(1);
      setSelectedDesignIds((current) =>
        current.size === 0 ? current : new Set(),
      );
    },
    [],
  );

  useEffect(() => {
    if (
      designFilterWasSelectedRef.current ||
      designFilter !== "mine" ||
      !accessibleDesignsSummary.isSuccess ||
      !ownedDesignsSummary.isSuccess ||
      accessibleDesignsSummary.data.totalCount === 0 ||
      ownedDesignsSummary.data.totalCount !== 0
    ) {
      return;
    }
    designFilterWasSelectedRef.current = true;
    setDesignFilter("all");
    writeStoredDesignFilter("all");
    setPage(1);
  }, [
    accessibleDesignsSummary.data?.totalCount,
    accessibleDesignsSummary.isSuccess,
    designFilter,
    ownedDesignsSummary.data?.totalCount,
    ownedDesignsSummary.isSuccess,
  ]);

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
      designSystemId: string | null | undefined,
      creationMethod: "prompt" | "blank",
    ): { id: string; title: string; ready: Promise<void> } => {
      const id = nanoid();
      const projectType: ProjectType = "prototype";
      const finalTitle = title.trim() || "Untitled Design";
      const linkedDesignSystemId = designSystemId ?? null;

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
          ...(designSystemId !== undefined ? { designSystemId } : {}),
          creationMethod,
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
      void ready.catch(() => {});
      return { id, title: finalTitle, ready };
    },
    [listDesignsParams, normalizedSearch, page, queryClient, createMutation],
  );

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
      pendingOptions?: { skipQuestions?: boolean; fromSkip?: boolean },
    ) => {
      const promptSource =
        quickStartRef.current || homeSuggestionPromptSourceRef.current
          ? "home_suggestion"
          : "composer";
      await creativeContextPersistRef.current?.catch(() => {});
      const trimmedPrompt = prompt.trim();
      const templateCopyDesignSystemId =
        selectedTemplate &&
        newDesignMode === "design" &&
        !newDesignSystemWasChosenRef.current
          ? undefined
          : newDesignSystemId;
      const designSystemId =
        newDesignMode === "app"
          ? await resolveAppDesignSystemId()
          : templateCopyDesignSystemId;
      const reportPromptSubmitted = (outputId: string) => {
        if (pendingOptions?.fromSkip) return;
        try {
          trackDesignPromptSubmitted({
            outputId,
            source: promptSource,
            prompt,
            referenceTypes: designPromptReferenceTypes({
              contextItems: options.contextItems,
              files,
              templateSelected: Boolean(selectedTemplate),
              designSystemId,
            }),
            startMode: selectedTemplate ? "template" : newDesignMode,
          });
        } catch {
          // coercion-ok: analytics must never block opening the new design.
        }
      };

      if (selectedTemplate && newDesignMode === "design") {
        setNewDesignHandoffPending(true);
        const title = trimmedPrompt
          ? derivePromptTitle(trimmedPrompt)
          : selectedTemplate.title;
        const retryKey = designTemplateRetryKey({
          templateId: selectedTemplate.id,
          title,
          designSystemId,
          prompt,
        });
        const previousRetry = templateCopyIdsRef.current.get(
          selectedTemplate.id,
        );
        const newId =
          previousRetry?.key === retryKey ? previousRetry.id : nanoid();
        templateCopyIdsRef.current.set(selectedTemplate.id, {
          key: retryKey,
          id: newId,
        });
        try {
          const result = await createFromTemplateMutation.mutateAsync({
            templateId: selectedTemplate.id,
            title,
            newId,
            retryKey,
            ...(designSystemId !== undefined ? { designSystemId } : {}),
            ...(trimmedPrompt ? { prompt } : {}),
          });
          if (!result.id) {
            throw new Error("Template copy did not return a design ID");
          }
          const currentRetry = templateCopyIdsRef.current.get(
            selectedTemplate.id,
          );
          if (currentRetry?.id === newId && currentRetry.key === retryKey) {
            templateCopyIdsRef.current.delete(selectedTemplate.id);
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
          reportPromptSubmitted(result.id);
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

      const derivedTitle = derivePromptTitle(prompt);

      const { id, title, ready } = createDesign(
        derivedTitle,
        designSystemId,
        "prompt",
      );
      // The title action needs the saved design, and create-design is still in flight.
      void ready.then(
        () => handleGenerateDesignTitle(id, prompt, title),
        // coercion-ok: a failed create reports itself, and there is no design to title.
        () => {},
      );

      if (fullAppBuildingEnabled && newDesignMode === "app") {
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
            sendToDesignAgentChat({
              message: prompt,
              context:
                `The user's request is to build this design as a full app. ` +
                `create-builder-app returned status "not-configured" for design ` +
                `${id}. ${result?.message ?? ""} Help the user connect ` +
                `Builder.io (see connect-builder-app), then retry ` +
                `create-builder-app with the user's prompt.`,
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
                `connected, and create-builder-app can be retried safely.`,
              submit: true,
            });
          });
      } else {
        writePendingGeneration(id, {
          prompt,
          files,
          title,
          designSystemId,
          skipQuestions: pendingOptions?.skipQuestions ?? quickStartRef.current,
          outputBaselineFiles: [],
          ...options,
        });
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

      reportPromptSubmitted(id);
      homeSuggestionPromptSourceRef.current = false;
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
      resolveAppDesignSystemId,
      selectedTemplate,
      t,
    ],
  );

  const startBlankDesign = useCallback(async () => {
    if (skipToEditorPendingRef.current) return;
    skipToEditorPendingRef.current = true;
    setNewDesignHandoffPending(true);

    try {
      const designSystemId =
        newDesignMode === "app"
          ? await resolveAppDesignSystemId()
          : newDesignSystemId;
      const { id, ready } = createDesign(
        t("home.untitledDesign"),
        designSystemId,
        "blank",
      );
      await ready;
      void navigate(`/design/${id}`);
    } catch (error) {
      skipToEditorPendingRef.current = false;
      setNewDesignHandoffPending(false);
      toast.error(t("home.failedToCreateDesign"));
      throw error;
    }
  }, [
    createDesign,
    navigate,
    newDesignMode,
    newDesignSystemId,
    resolveAppDesignSystemId,
    t,
  ]);

  const handleSkipToEditor = useCallback(async () => {
    if (selectedTemplate && newDesignMode === "design") {
      try {
        await requireAgentEngineConfiguredForDispatch();
      } catch {
        if (agentEngine.missing) {
          setSetupCardBouncePulse((pulse) => pulse + 1);
        }
        return false;
      }
      await handleSubmitPrompt(
        "",
        [],
        {
          contextItems: await homeContext.prepareSubmission(
            snapshotComposerContextItems(homeContext.contextItems),
          ),
        },
        { fromSkip: true },
      );
      return false;
    }
    await startBlankDesign();
    return false;
  }, [
    handleSubmitPrompt,
    agentEngine.missing,
    homeContext.contextItems,
    newDesignMode,
    selectedTemplate,
    startBlankDesign,
  ]);

  const handleDelete = useCallback(() => {
    if (!deleteId) return;
    const id = deleteId;

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

  const searchInput = (
    <div className="relative w-full min-w-0 sm:w-64 sm:shrink-0">
      <IconSearch className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        size="sm"
        value={search}
        onChange={(event) => handleSearchChange(event.target.value)}
        placeholder={t("home.searchPlaceholder")}
        aria-label={t("home.searchPlaceholder")}
        data-home-search="true"
        className="h-9 w-full pe-3 ps-8"
      />
    </div>
  );
  return (
    <>
      {newDesignHandoffPending ? <NewDesignHandoffOverlay /> : null}
      <PromptHome
        title={t("home.designPromptTitle")}
        focusComposer={focusComposer}
        reserveConnectionSpace
        connectionPending={
          agentEngine.state === "unknown" || agentEngine.state === "unavailable"
        }
        connectionAttached={agentEngine.state !== "configured"}
        connection={
          agentEngineConfigured ? null : agentEngineMissing ? (
            <BuilderSetupCard
              attached
              fullWidth
              layout="sidebar"
              bouncePulse={setupCardBouncePulse}
              onConnected={retryAgentEngineStatus}
            />
          ) : null
        }
        composer={
          <div
            id="design-home-composer"
            data-design-home-composer
            className={
              agentEngineMissing
                ? "agent-composer-area--attached-above"
                : undefined
            }
            onFocusCapture={bounceSetupCard}
            onPointerDownCapture={bounceSetupCard}
          >
            <PromptPopover
              inline
              open
              onOpenChange={() => {}}
              composerComponent={PromptComposer}
              composerRef={composerRef}
              showModelSelector
              modelStatusChecksEnabled
              requireAgentEngine
              showMissingApiKeySetup={false}
              title={t("home.newDesignLower")}
              draftScope="design:new:0"
              initialText={homePromptInitialText}
              initialTextKey={homePromptInitialTextKey}
              placeholder={
                selectedTemplate
                  ? t("promptDialog.templatePromptPlaceholder", {
                      title: selectedTemplate.title,
                    })
                  : t("home.describeBuild")
              }
              onSkip={handleSkipToEditor}
              showInlineSkip={false}
              skipLabel={
                selectedTemplate
                  ? t("templatesPage.useTemplate")
                  : t("promptDialog.skipPrompt")
              }
              onSubmit={handleSubmitPrompt}
              onSubmitError={() => {
                submissionErrorRef.current = true;
              }}
              beforeSubmitContext={homeContext.prepareSubmission}
              submissionIdentity={homeContext.identity}
              contextItems={homeContext.contextItems}
              contextMenuItems={homeContext.menuItems}
              onRemoveContextItem={homeContext.remove}
              onRetryContextItem={homeContext.retry}
              templateOptions={templateOptions}
              templatesLoading={templatesLoading}
              selectedTemplateId={newTemplateId}
              onTemplateChange={handleTemplateChange}
              designSystems={designSystemOptions}
              designSystemsLoading={designSystemsLoading}
              selectedDesignSystemId={newDesignSystemId ?? null}
              onDesignSystemChange={handleNewDesignSystemChange}
              creativeContexts={
                creativeContextEnabled ? creativeContextOptions : []
              }
              creativeContextsLoading={
                creativeContextEnabled && creativeContextsQuery.isLoading
              }
              selectedCreativeContextId={
                creativeContextEnabled
                  ? (creativeContextState.state.selectedContextId ?? null)
                  : undefined
              }
              onCreativeContextChange={
                creativeContextEnabled ? handleCreativeContextChange : undefined
              }
              loading={newDesignHandoffPending}
              creationMode={fullAppBuildingEnabled ? newDesignMode : undefined}
              onCreationModeChange={
                fullAppBuildingEnabled ? setNewDesignMode : undefined
              }
            />
          </div>
        }
        quickActions={
          <div
            data-home-prompt-actions
            className="flex w-full min-w-0 items-center justify-between gap-1"
          >
            <AgentSuggestionBar
              announceUpdates
              layout="single-line"
              homeTracking={{
                appId: "design",
                ...(homeSuggestionsProfile.data?.onboardingRole !== undefined
                  ? { role: homeSuggestionsProfile.data.onboardingRole }
                  : {}),
                seed: homeSuggestionSeed,
              }}
              onHomeSuggestionClick={trackDesignHomeSuggestionClick}
              suggestions={homeSuggestions.map((suggestion) => ({
                ...suggestion,
                disabled: newDesignHandoffPending || quickStartPending,
              }))}
              ariaLabel={t("home.suggestedPrompts")}
              className="min-w-0 flex-1 px-0 py-0"
              onSelect={(suggestion) => {
                if (quickStartRef.current || !composerRef.current) return;
                if (!quickActionsEnabled) {
                  homeSuggestionPromptSourceRef.current = true;
                  const prompt = agentSuggestionPrompt(suggestion);
                  setHomePromptInitialText(prompt);
                  setHomePromptInitialTextKey(Date.now());
                  composerRef.current.setText(prompt);
                  composerRef.current.focus();
                  return;
                }
                quickStartRef.current = true;
                submissionErrorRef.current = false;
                setQuickStartPending(true);
                void composerRef.current
                  .submitWithText(agentSuggestionPrompt(suggestion))
                  .then((accepted) => {
                    if (!accepted && !submissionErrorRef.current) {
                      toast.error(t("homeContext.notReady"));
                    }
                  })
                  .finally(() => {
                    quickStartRef.current = false;
                    setQuickStartPending(false);
                  });
              }}
            />
            {!selectedTemplate ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={newDesignHandoffPending}
                className="h-7 min-w-[85px] shrink-0 justify-center px-2 font-normal text-muted-foreground hover:text-foreground"
                data-testid="design-home-skip-prompt"
                onClick={() => {
                  // startBlankDesign shows the failure toast before rejecting.
                  void handleSkipToEditor().catch((error: unknown) => {
                    trace("persist", "skip-to-editor-failed", {
                      message:
                        error instanceof Error ? error.message : String(error),
                    });
                  });
                }}
              >
                {t("promptDialog.skipPrompt")}
              </Button>
            ) : null}
          </div>
        }
      >
        {accessibleDesignsSummary.isError ? (
          <QueryErrorState
            onRetry={() => void accessibleDesignsSummary.refetch()}
            retrying={accessibleDesignsSummary.isFetching}
          />
        ) : null}
        <ClientOnly>
          <DesignHomeLibrary
            value={
              hasAccessibleDesigns && !homeLibraryTabWasSelectedRef.current
                ? "recent"
                : homeSection
            }
            onValueChange={(value) => {
              homeLibraryTabWasSelectedRef.current = true;
              setHomeSection(value);
            }}
            labels={{
              templates: t("navigation.templates"),
              recent: t("home.recent"),
            }}
            browseAll={
              <Button
                variant="ghost"
                size="sm"
                className="min-w-[111px] justify-center"
                asChild
              >
                <Link to="/templates">
                  {t("home.browseAllTemplates")}
                  <IconArrowRight />
                </Link>
              </Button>
            }
            search={searchInput}
            recentActions={
              <OwnershipFilter
                value={designFilter === "not-mine" ? "shared" : designFilter}
                onChange={handleDesignFilterChange}
              />
            }
            templates={
              templatesError ? (
                <QueryErrorState
                  onRetry={() => void refetchTemplates()}
                  retrying={templatesFetching}
                />
              ) : (
                <DesignTemplateLibrary
                  templates={homeTemplates}
                  loading={templatesLoading}
                  previewParam="previewTemplateId"
                />
              )
            }
            recent={
              <>
                {isLoading || (isFetching && designs.length === 0) ? (
                  <DesignRecentSkeleton />
                ) : isError ? (
                  <QueryErrorState
                    onRetry={() => void refetch()}
                    retrying={isFetching}
                  />
                ) : designs.length === 0 ? (
                  normalizedSearch ? (
                    <SearchEmptyState />
                  ) : (
                    <div className="rounded-xl bg-card p-6 text-center text-sm text-muted-foreground">
                      {t("home.noDesignsMatchFilter")}
                    </div>
                  )
                ) : (
                  <>
                    {isSelectingDesigns ? (
                      <div className="mb-3 flex w-full flex-wrap items-center justify-between gap-3 px-1 py-1">
                        <div className="text-sm text-muted-foreground">
                          <span className="font-medium text-foreground">
                            {t("home.selected", { count: selectedDesignCount })}
                          </span>
                        </div>
                        <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={toggleVisibleSelection}
                                aria-label={
                                  allVisibleSelected
                                    ? t("home.clearVisibleSelection")
                                    : t("home.selectVisibleDesigns")
                                }
                                className="cursor-pointer"
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
                                size="icon-sm"
                                onClick={clearSelection}
                                aria-label={t("home.clearSelection")}
                                className="cursor-pointer"
                              >
                                <IconX className="w-4 h-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {t("home.clearSelection")}
                            </TooltipContent>
                          </Tooltip>
                          {creativeContextEnabled ? (
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
                              {t(
                                "creativeContext.addToContext" /* i18n-key-ignore */,
                              )}
                            </Button>
                          ) : null}
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
                    <TemplateLibraryGrid
                      items={designs}
                      isSelected={(design) => selectedDesignIds.has(design.id)}
                      actionsVisible={() => isSelectingDesigns}
                      labels={{
                        loading: t("templatesPage.loading"),
                        empty: t("home.searchNoResultsTitle"),
                        retry: t("homeContext.retry"),
                      }}
                      renderLink={(design, children) => (
                        <Link to={`/design/${design.id}`}>{children}</Link>
                      )}
                      renderPreview={(design) => (
                        <div className="design-library-card-preview">
                          <DesignThumbnail
                            html={design.previewHtml ?? null}
                            designId={design.id}
                            className="h-full w-full"
                          />
                        </div>
                      )}
                      renderMetadata={(design) => (
                        <div className="flex min-w-0 items-center gap-1.5">
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
                      )}
                      renderActions={(design) => {
                        const isSelected = selectedDesignIds.has(design.id);
                        return (
                          <>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={() =>
                                    toggleDesignSelection(design.id)
                                  }
                                  aria-label={t("home.selectDesign", {
                                    title: design.title,
                                  })}
                                  className={cn(
                                    "h-5 w-5",
                                    isSelectingDesigns && "!opacity-100",
                                  )}
                                />
                              </TooltipTrigger>
                              <TooltipContent>
                                {t("home.selectDesign", {
                                  title: design.title,
                                })}
                              </TooltipContent>
                            </Tooltip>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={t("home.actionsForDesign", {
                                    title: design.title,
                                  })}
                                >
                                  <IconDots />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onClick={() =>
                                    setTimeout(() => startRename(design))
                                  }
                                >
                                  <IconPencil />
                                  {t("home.rename")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => handleDuplicate(design.id)}
                                >
                                  <IconCopy />
                                  {t("home.duplicate")}
                                </DropdownMenuItem>
                                {creativeContextEnabled ? (
                                  <DropdownMenuItem
                                    onSelect={(event) => {
                                      event.preventDefault();
                                      setContextDesigns([design]);
                                    }}
                                  >
                                    <IconPlus />
                                    {t(
                                      "creativeContext.addToContext" /* i18n-key-ignore */,
                                    )}
                                  </DropdownMenuItem>
                                ) : null}
                                <DropdownMenuItem
                                  onClick={() =>
                                    setTimeout(() => setDeleteId(design.id))
                                  }
                                  className="text-destructive focus:text-destructive"
                                >
                                  <IconTrash />
                                  {t("home.delete")}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </>
                        );
                      }}
                    />
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
              </>
            }
          />
        </ClientOnly>
      </PromptHome>

      {creativeContextEnabled ? (
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
            className="text-sm"
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

function SearchEmptyState() {
  const t = useT();
  return (
    <div
      aria-live="polite"
      className="flex flex-col items-center justify-center min-h-[60vh] text-center"
    >
      <h2 className="text-xl font-semibold text-foreground mb-2">
        {t("home.searchNoResultsTitle")}
      </h2>
      <p className="text-sm text-muted-foreground max-w-sm mb-6 leading-relaxed">
        {t("home.searchNoResultsDescription")}
      </p>
    </div>
  );
}
