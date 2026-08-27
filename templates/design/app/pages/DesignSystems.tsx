import { appApiPath } from "@agent-native/core/client/api-path";
import {
  useActionQuery,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { ShareButton } from "@agent-native/core/client/sharing";
import { withBuilderUtmTrackingParams } from "@agent-native/core/shared";
import {
  useSetHeaderActions,
  useSetPageTitle,
} from "@agent-native/toolkit/app-shell";
import { VisibilityBadge } from "@agent-native/toolkit/sharing";
import {
  IconCheckbox,
  IconChecks,
  IconComponents,
  IconDots,
  IconExternalLink,
  IconPalette,
  IconPlus,
  IconStar,
  IconStarFilled,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

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
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  formatDesignTokenValue,
  getCssColorToken,
} from "@/lib/design-system-preview";

import { QueryErrorState } from "../components/QueryErrorState";
import {
  builderRefreshKey,
  isTrustedBuilderPreviewUrl,
  parseDesignSystemData,
  shouldRefreshBuilderDesignSystem,
  type DesignSystemData,
} from "../lib/design-system-data";

interface DesignSystem {
  id: string;
  title: string;
  description?: string | null;
  data: string;
  assets?: string | null;
  customInstructions?: string | null;
  isDefault: boolean;
  visibility?: "private" | "org" | "public" | null;
  accessRole?: "owner" | "viewer" | "commenter" | "editor" | "admin";
  canManage?: boolean;
  createdAt: string;
  updatedAt?: string;
}

type BuilderRefreshResult = {
  synced: boolean;
  status?: string;
  rejectedTokenCount?: number;
};

function isTerminalBuilderStatus(status?: string): boolean {
  return (
    status === "ready" ||
    status === "complete" ||
    status === "completed" ||
    status === "error" ||
    status === "failed" ||
    status === "cancelled"
  );
}

export default function DesignSystems() {
  const t = useT();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedSystemIds, setSelectedSystemIds] = useState<Set<string>>(
    () => new Set(),
  );

  const { data, isLoading, isError, isFetching, refetch } = useActionQuery<{
    designSystems: DesignSystem[];
  }>("list-design-systems");

  const setDefaultMutation = useActionMutation("set-default-design-system");
  const deleteMutation = useActionMutation("delete-design-system");
  const updateMutation = useActionMutation("update-design-system");
  const refreshBuilderSystemMutation = useActionMutation<
    BuilderRefreshResult,
    { id: string }
  >("refresh-design-system-with-builder", {
    skipActionQueryInvalidation: true,
  });
  const refreshBuilderSystemRef = useRef(
    refreshBuilderSystemMutation.mutateAsync,
  );
  refreshBuilderSystemRef.current = refreshBuilderSystemMutation.mutateAsync;
  const settledBuilderRefreshesRef = useRef(new Set<string>());
  const stoppedBuilderRefreshesRef = useRef(new Set<string>());
  const activeBuilderRefreshesRef = useRef(new Set<string>());

  const designSystems = data?.designSystems ?? [];
  const selectedDesignSystemId = searchParams.get("designSystemId");
  const selectedDesignSystem = useMemo(
    () =>
      selectedDesignSystemId
        ? (designSystems.find((ds) => ds.id === selectedDesignSystemId) ?? null)
        : null,
    [designSystems, selectedDesignSystemId],
  );
  const manageableDesignSystems = designSystems.filter((ds) => ds.canManage);
  const selectedSystemCount = selectedSystemIds.size;
  const allSystemsSelected =
    manageableDesignSystems.length > 0 &&
    manageableDesignSystems.every((ds) => selectedSystemIds.has(ds.id));

  const openDesignSystemDetails = useCallback(
    (id: string) => {
      navigate(`/design-systems?designSystemId=${encodeURIComponent(id)}`);
    },
    [navigate],
  );

  const closeDesignSystemDetails = useCallback(() => {
    navigate("/design-systems", { replace: true });
  }, [navigate]);

  const openSetupFromDesignSystem = useCallback(
    (id: string) => {
      navigate(`/design-systems/setup?source=${encodeURIComponent(id)}`);
    },
    [navigate],
  );

  const toggleSelectionMode = useCallback(() => {
    if (isSelectionMode) {
      setSelectedSystemIds(new Set());
    }
    setIsSelectionMode((current) => !current);
  }, [isSelectionMode]);

  const exitSelectionMode = useCallback(() => {
    setIsSelectionMode(false);
    setSelectedSystemIds(new Set());
  }, []);

  const toggleSystemSelection = useCallback(
    (id: string) => {
      if (!designSystems.find((ds) => ds.id === id)?.canManage) return;
      setSelectedSystemIds((current) => {
        const next = new Set(current);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
    },
    [designSystems],
  );

  const toggleAllSystems = useCallback(() => {
    setSelectedSystemIds((current) => {
      const next = new Set(current);
      const shouldClear =
        manageableDesignSystems.length > 0 &&
        manageableDesignSystems.every((ds) => next.has(ds.id));

      manageableDesignSystems.forEach((ds) => {
        if (shouldClear) {
          next.delete(ds.id);
        } else {
          next.add(ds.id);
        }
      });

      return next;
    });
  }, [manageableDesignSystems]);

  const clearSelection = useCallback(() => {
    setSelectedSystemIds(new Set());
  }, []);

  const handleSetDefault = useCallback(
    (id: string, isDefault: boolean) => {
      // Optimistic update
      queryClient.setQueryData(
        ["action", "list-design-systems", undefined],
        (old: any) => {
          if (!old?.designSystems) return old;
          return {
            ...old,
            designSystems: old.designSystems.map((ds: DesignSystem) => ({
              ...ds,
              isDefault: isDefault
                ? ds.id === id
                : ds.id === id
                  ? false
                  : ds.isDefault,
            })),
          };
        },
      );

      setDefaultMutation.mutate({ id, isDefault } as any, {
        onError: () => {
          queryClient.invalidateQueries({
            queryKey: ["action", "list-design-systems"],
          });
        },
      });
    },
    [queryClient, setDefaultMutation],
  );

  const handleDelete = useCallback(() => {
    if (!deleteId) return;
    const id = deleteId;

    queryClient.setQueryData(
      ["action", "list-design-systems", undefined],
      (old: any) => {
        const systems = old?.designSystems ?? [];
        return {
          count: Math.max((old?.count ?? systems.length) - 1, 0),
          designSystems: systems.filter((ds: DesignSystem) => ds.id !== id),
        };
      },
    );

    setDeleteId(null);

    deleteMutation.mutate({ id } as any, {
      onError: (error) => {
        queryClient.invalidateQueries({
          queryKey: ["action", "list-design-systems"],
        });
        toast.error(t("designSystems.deleteError"), {
          description:
            error instanceof Error ? error.message : t("common.genericError"),
        });
      },
    });
  }, [deleteId, queryClient, deleteMutation, t]);

  const handleUpdateDetails = useCallback(
    (
      id: string,
      updates: {
        title: string;
        description: string;
        customInstructions: string;
      },
    ) => {
      const previous = queryClient.getQueryData([
        "action",
        "list-design-systems",
        undefined,
      ]);

      queryClient.setQueryData(
        ["action", "list-design-systems", undefined],
        (old: any) => {
          const systems = old?.designSystems ?? [];
          return {
            ...old,
            designSystems: systems.map((ds: DesignSystem) =>
              ds.id === id ? { ...ds, ...updates } : ds,
            ),
          };
        },
      );

      updateMutation.mutate({ id, ...updates } as any, {
        onSuccess: () => {
          toast.success(t("designSystems.updateSuccess"));
        },
        onError: (error) => {
          queryClient.setQueryData(
            ["action", "list-design-systems", undefined],
            previous,
          );
          toast.error(t("designSystems.updateError"), {
            description:
              error instanceof Error ? error.message : t("common.genericError"),
          });
        },
      });
    },
    [queryClient, updateMutation, t],
  );

  const handleBulkDelete = useCallback(() => {
    const ids = Array.from(selectedSystemIds);
    if (ids.length === 0) return;

    const idsToDelete = new Set(ids);

    queryClient.setQueryData(
      ["action", "list-design-systems", undefined],
      (old: any) => {
        const systems = old?.designSystems ?? [];
        return {
          ...old,
          count: Math.max((old?.count ?? systems.length) - ids.length, 0),
          designSystems: systems.filter(
            (ds: DesignSystem) => !idsToDelete.has(ds.id),
          ),
        };
      },
    );

    setBulkDeleteOpen(false);
    exitSelectionMode();

    void Promise.all(ids.map((id) => deleteMutation.mutateAsync({ id } as any)))
      .then(() => undefined)
      .catch((error) => {
        queryClient.invalidateQueries({
          queryKey: ["action", "list-design-systems"],
        });
        toast.error(t("designSystems.bulkDeleteError"), {
          description:
            error instanceof Error ? error.message : t("common.genericError"),
        });
      });
  }, [selectedSystemIds, queryClient, exitSelectionMode, deleteMutation, t]);

  useEffect(() => {
    const builderSystemEntries = designSystems
      .filter(shouldRefreshBuilderDesignSystem)
      .map((system) => ({
        id: system.id,
        key: builderRefreshKey(system),
      }))
      .filter(
        ({ key }) =>
          !settledBuilderRefreshesRef.current.has(key) &&
          !stoppedBuilderRefreshesRef.current.has(key) &&
          !activeBuilderRefreshesRef.current.has(key),
      );
    if (builderSystemEntries.length === 0) return;

    let disposed = false;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    const maxAttempts = 5;
    const maxPolls = 3;
    const retryDelayMs = 5_000;
    const retryPollDelayMs = 30_000;

    const scheduleRetry = (
      entry: { id: string; key: string },
      delayMs: number,
      attempt: number,
      pollCount: number,
    ): void => {
      if (disposed) return;
      timers.push(
        setTimeout(() => {
          void refresh(entry, attempt, pollCount);
        }, delayMs),
      );
    };

    const refresh = async (
      entry: { id: string; key: string },
      attempt: number,
      pollCount: number,
    ): Promise<void> => {
      try {
        const result = await refreshBuilderSystemRef.current({ id: entry.id });
        if (disposed) return;
        if (result.synced) {
          activeBuilderRefreshesRef.current.delete(entry.key);
          settledBuilderRefreshesRef.current.add(entry.key);
          await queryClient.invalidateQueries({
            queryKey: ["action", "list-design-systems"],
          });
          return;
        }
        if (result.status === "conflict") {
          activeBuilderRefreshesRef.current.delete(entry.key);
          stoppedBuilderRefreshesRef.current.add(entry.key);
          await queryClient.invalidateQueries({
            queryKey: ["action", "list-design-systems"],
          });
          return;
        }
        if (result.status === "incomplete" || result.rejectedTokenCount) {
          activeBuilderRefreshesRef.current.delete(entry.key);
          stoppedBuilderRefreshesRef.current.add(entry.key);
          return;
        }
        if (isTerminalBuilderStatus(result.status)) {
          activeBuilderRefreshesRef.current.delete(entry.key);
          settledBuilderRefreshesRef.current.add(entry.key);
          return;
        }
      } catch {
        if (disposed) return;
      }
      if (disposed) return;
      const exhausted = attempt >= maxAttempts;
      if (exhausted && pollCount >= maxPolls) {
        activeBuilderRefreshesRef.current.delete(entry.key);
        stoppedBuilderRefreshesRef.current.add(entry.key);
        return;
      }
      scheduleRetry(
        entry,
        exhausted ? retryPollDelayMs : retryDelayMs,
        exhausted ? 0 : attempt + 1,
        exhausted ? pollCount + 1 : pollCount,
      );
    };

    for (const entry of builderSystemEntries) {
      activeBuilderRefreshesRef.current.add(entry.key);
      void refresh(entry, 0, 0);
    }

    return () => {
      disposed = true;
      for (const timer of timers) clearTimeout(timer);
      for (const entry of builderSystemEntries) {
        activeBuilderRefreshesRef.current.delete(entry.key);
      }
    };
  }, [designSystems, queryClient]);

  useSetPageTitle(t("navigation.designSystems"));

  useSetHeaderActions(
    <div className="flex items-center gap-2">
      {manageableDesignSystems.length > 0 ? (
        <Button
          variant={isSelectionMode ? "secondary" : "ghost"}
          size="sm"
          onClick={toggleSelectionMode}
          className="cursor-pointer"
        >
          <IconCheckbox className="w-3.5 h-3.5" />
          {isSelectionMode
            ? t("designSystems.actions.done")
            : t("designSystems.actions.select")}
        </Button>
      ) : null}
      <Button asChild size="sm" className="cursor-pointer">
        <Link to="/design-systems/setup">
          <IconPlus className="w-3.5 h-3.5" />
          {t("designSystems.actions.new")}
        </Link>
      </Button>
    </div>,
  );

  return (
    <>
      <div className="flex-1 overflow-y-auto">
        <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
          {isLoading ? (
            <LoadingSkeleton />
          ) : isError ? (
            <QueryErrorState
              onRetry={() => void refetch()}
              retrying={isFetching}
            />
          ) : designSystems.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              {isSelectionMode ? (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2">
                  <div className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {selectedSystemCount}
                    </span>{" "}
                    {t("designSystems.selectedLabel")}
                  </div>
                  <div className="flex items-center gap-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={toggleAllSystems}
                          className="h-8 w-8 cursor-pointer"
                        >
                          <IconChecks className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {allSystemsSelected
                          ? t("designSystems.actions.clearAll")
                          : t("designSystems.actions.selectAll")}
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={clearSelection}
                          className="h-8 w-8 cursor-pointer"
                        >
                          <IconX className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {t("designSystems.actions.clearSelection")}
                      </TooltipContent>
                    </Tooltip>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setBulkDeleteOpen(true)}
                      disabled={selectedSystemCount === 0}
                      className="cursor-pointer"
                    >
                      <IconTrash className="w-3.5 h-3.5" />
                      {t("designSystems.actions.delete")}
                    </Button>
                  </div>
                </div>
              ) : null}
              <section aria-label={t("designSystems.yoursTitle")}>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-3">
                  {/* New design system card */}
                  <Link
                    to="/design-systems/setup"
                    className="group relative rounded-xl border border-dashed border-border bg-card hover:border-foreground/15 overflow-hidden text-start cursor-pointer"
                  >
                    <div className="aspect-video flex items-center justify-center bg-muted/30">
                      <div className="w-12 h-12 rounded-xl bg-accent/50 flex items-center justify-center group-hover:bg-accent">
                        <IconPlus className="w-6 h-6 text-muted-foreground/70 group-hover:text-muted-foreground" />
                      </div>
                    </div>
                    <div className="p-3">
                      <h3 className="font-medium text-sm text-muted-foreground group-hover:text-foreground/70">
                        {t("designSystems.actions.new")}
                      </h3>
                    </div>
                  </Link>

                  {/* Design system cards */}
                  {designSystems.map((ds) => {
                    const parsed = parseDesignSystemData(ds.data);
                    const colors = parsed?.colors;
                    const primaryColor = getCssColorToken(colors?.primary);
                    const secondaryColor = getCssColorToken(colors?.secondary);
                    const accentColor = getCssColorToken(colors?.accent);
                    const headingFont = formatDesignTokenValue(
                      parsed?.typography?.headingFont,
                    );
                    const isSelected = selectedSystemIds.has(ds.id);
                    return (
                      <div
                        key={ds.id}
                        aria-selected={isSelected}
                        className={`group relative rounded-xl border bg-card overflow-hidden ${
                          isSelected
                            ? "border-[#609FF8]/70 ring-2 ring-[#609FF8]/40"
                            : "border-border"
                        }`}
                      >
                        <button
                          onClick={() => {
                            if (isSelectionMode) {
                              if (ds.canManage) toggleSystemSelection(ds.id);
                              return;
                            }
                            openDesignSystemDetails(ds.id);
                          }}
                          aria-pressed={
                            isSelectionMode ? isSelected : undefined
                          }
                          className="block w-full text-start cursor-pointer"
                        >
                          {/* Color preview */}
                          <div className="aspect-video bg-muted/50 flex items-center justify-center gap-2 p-4">
                            {primaryColor && (
                              <div
                                className="w-10 h-10 rounded-lg"
                                style={{ backgroundColor: primaryColor }}
                              />
                            )}
                            {secondaryColor && (
                              <div
                                className="w-10 h-10 rounded-lg"
                                style={{ backgroundColor: secondaryColor }}
                              />
                            )}
                            {accentColor && (
                              <div
                                className="w-10 h-10 rounded-lg"
                                style={{ backgroundColor: accentColor }}
                              />
                            )}
                            {!primaryColor &&
                              !secondaryColor &&
                              !accentColor && (
                                <IconComponents className="w-8 h-8 text-muted-foreground/40" />
                              )}
                          </div>
                          <div className="p-4 pb-3">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className="font-medium text-sm text-foreground/90 truncate flex-1">
                                {ds.title}
                              </h3>
                              {ds.isDefault && (
                                <span className="text-[10px] text-[#609FF8] font-medium">
                                  {t("designSystems.defaultBadge")}
                                </span>
                              )}
                            </div>
                            {headingFont && (
                              <div className="text-xs text-muted-foreground/70">
                                {headingFont}
                              </div>
                            )}
                          </div>
                        </button>
                        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-4">
                          <VisibilityBadge
                            visibility={ds.visibility}
                            className="!text-[11px]"
                          />
                          <ShareButton
                            resourceType="design-system"
                            resourceId={ds.id}
                            allowedRoles={["viewer", "editor", "admin"]}
                            resourceTitle={ds.title}
                          />
                        </div>
                        {isSelectionMode && ds.canManage ? (
                          <div className="absolute top-2 start-2 z-10">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={() =>
                                    toggleSystemSelection(ds.id)
                                  }
                                  onClick={(event) => event.stopPropagation()}
                                  aria-label={t("designSystems.selectAria", {
                                    title: ds.title,
                                  })}
                                  className="h-5 w-5 border-white/60 bg-black/60 text-white data-[state=checked]:border-[#609FF8] data-[state=checked]:bg-[#609FF8]"
                                />
                              </TooltipTrigger>
                              <TooltipContent>
                                {t("designSystems.selectAria", {
                                  title: ds.title,
                                })}
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        ) : (
                          <>
                            {/* Star button */}
                            {ds.accessRole === "owner" && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    onClick={() =>
                                      handleSetDefault(ds.id, !ds.isDefault)
                                    }
                                    className="absolute top-2 end-2 opacity-0 group-hover:opacity-100 w-7 h-7 flex items-center justify-center rounded-md bg-black/60 hover:bg-black/80 cursor-pointer"
                                  >
                                    {ds.isDefault ? (
                                      <IconStarFilled className="w-3.5 h-3.5 text-yellow-400" />
                                    ) : (
                                      <IconStar className="w-3.5 h-3.5 text-muted-foreground" />
                                    )}
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {ds.isDefault
                                    ? t("designSystems.currentlyDefault")
                                    : t("designSystems.actions.setDefault")}
                                </TooltipContent>
                              </Tooltip>
                            )}
                            {ds.canManage && (
                              <div
                                className={`absolute top-2 z-10 opacity-0 group-hover:opacity-100 ${
                                  ds.accessRole === "owner" ? "end-10" : "end-2"
                                }`}
                              >
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 bg-black/60 hover:bg-black/80 cursor-pointer"
                                      aria-label={t(
                                        "designSystems.moreActionsAria",
                                        { title: ds.title },
                                      )}
                                    >
                                      <IconDots className="w-3.5 h-3.5 text-foreground/70" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      onClick={() => setDeleteId(ds.id)}
                                      className="text-red-400 focus:text-red-400 cursor-pointer"
                                    >
                                      <IconTrash className="w-3.5 h-3.5 me-2" />
                                      {t("designSystems.actions.delete")}
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            </>
          )}
        </main>
      </div>

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
                ? t("designSystems.deleteDialog.bulkTitle", {
                    count: selectedSystemCount,
                  })
                : t("designSystems.deleteDialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {bulkDeleteOpen
                ? t("designSystems.deleteDialog.bulkDescription", {
                    count: selectedSystemCount,
                  })
                : t("designSystems.deleteDialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">
              {t("designSystems.actions.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={bulkDeleteOpen ? handleBulkDelete : handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 cursor-pointer"
            >
              {t("designSystems.actions.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DesignSystemDetailsSheet
        designSystem={selectedDesignSystem}
        open={Boolean(selectedDesignSystem)}
        isSaving={updateMutation.isPending}
        onOpenChange={(open) => {
          if (!open) closeDesignSystemDetails();
        }}
        onUseAsSource={openSetupFromDesignSystem}
        onSave={handleUpdateDetails}
      />
    </>
  );
}

function DesignSystemDetailsSheet({
  designSystem,
  open,
  isSaving,
  onOpenChange,
  onUseAsSource,
  onSave,
}: {
  designSystem: DesignSystem | null;
  open: boolean;
  isSaving?: boolean;
  onOpenChange: (open: boolean) => void;
  onUseAsSource: (id: string) => void;
  onSave: (
    id: string,
    updates: {
      title: string;
      description: string;
      customInstructions: string;
    },
  ) => void;
}) {
  const t = useT();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");

  useEffect(() => {
    if (!designSystem) return;
    setTitle(designSystem.title);
    setDescription(designSystem.description ?? "");
    setCustomInstructions(designSystem.customInstructions ?? "");
    // Only rehydrate when the user opens a different design system. Query
    // refetches can replace this object while the user is editing the sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designSystem?.id]);

  const parsed = useMemo(
    () => (designSystem ? parseDesignSystemData(designSystem.data) : null),
    [designSystem],
  );
  const assets = useMemo(
    () => parseDesignSystemAssets(designSystem && designSystem.assets),
    [designSystem],
  );

  if (!designSystem) {
    return null;
  }

  const canEdit =
    designSystem.accessRole === "owner" ||
    designSystem.accessRole === "admin" ||
    designSystem.accessRole === "editor";
  const trimmedTitle = title.trim();
  const hasChanges =
    trimmedTitle !== designSystem.title ||
    description.trim() !== (designSystem.description ?? "") ||
    customInstructions.trim() !== (designSystem.customInstructions ?? "");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-xl">
        <SheetHeader className="pr-8">
          <SheetTitle>{designSystem.title}</SheetTitle>
          <SheetDescription>
            {t("designSystems.details.description")}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-7 py-6">
          <section className="space-y-3">
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="design-system-title">
                  {t("designSystems.details.titleLabel")}
                </Label>
                <Input
                  id="design-system-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  readOnly={!canEdit}
                  className="bg-accent/50"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="design-system-description">
                  {t("designSystems.details.descriptionLabel")}
                </Label>
                <Textarea
                  id="design-system-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  readOnly={!canEdit}
                  rows={3}
                  className="bg-accent/50"
                />
              </div>
            </div>
          </section>

          <DesignSystemPreview
            id={designSystem.id}
            data={parsed}
            assets={assets}
          />

          <section className="space-y-3 border-t border-border pt-6">
            <div>
              <h3 className="text-sm font-medium text-foreground">
                {t("designSystems.details.customInstructionsTitle")}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {t("designSystems.details.customInstructionsDescription")}
              </p>
            </div>
            <Textarea
              value={customInstructions}
              onChange={(event) => setCustomInstructions(event.target.value)}
              readOnly={!canEdit}
              rows={5}
              placeholder={t("designSystems.details.noCustomInstructions")}
              className="bg-accent/50"
            />
          </section>
        </div>

        <SheetFooter className="gap-2 border-t border-border pt-4 sm:space-x-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onUseAsSource(designSystem.id)}
            className="cursor-pointer"
          >
            {t("designSystems.details.useAsStartingPoint")}
          </Button>
          {canEdit ? (
            <Button
              type="button"
              onClick={() =>
                onSave(designSystem.id, {
                  title: trimmedTitle,
                  description: description.trim(),
                  customInstructions: customInstructions.trim(),
                })
              }
              disabled={!trimmedTitle || !hasChanges || isSaving}
              className="cursor-pointer"
            >
              {isSaving
                ? t("designSystems.details.saving")
                : t("designSystems.details.saveChanges")}
            </Button>
          ) : null}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function DesignSystemPreview({
  id,
  data,
  assets,
}: {
  id: string;
  data: DesignSystemData | null;
  assets: Array<{ name?: string; url?: string; variant?: string }>;
}) {
  return data?.source === "builder" ? (
    <DesignSystemPreviewLink id={id} data={data} />
  ) : (
    <TokenPreview data={data} assets={assets} />
  );
}

function DesignSystemPreviewLink({
  id,
  data,
}: {
  id: string;
  data: DesignSystemData;
}) {
  const t = useT();
  const [resolvedBuilderUrl, setResolvedBuilderUrl] = useState<string | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    setResolvedBuilderUrl(null);
    void fetch(
      appApiPath(
        `/api/design-system-builder-link?id=${encodeURIComponent(id)}`,
      ),
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { builderUrl?: string | null } | null) => {
        if (!cancelled) setResolvedBuilderUrl(json?.builderUrl ?? null);
      })
      .catch(() => {
        if (!cancelled) setResolvedBuilderUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const persistedBuilderUrl =
    data.builderUrl && isTrustedBuilderPreviewUrl(data.builderUrl)
      ? data.builderUrl
      : undefined;
  // The stored URL is the project/branch link for every source that returns a
  // branch from indexing, so it renders straight away; the resolve only
  // upgrades a `.fig` import whose branch was cut after the row was written.
  const trustedBuilderUrl =
    (resolvedBuilderUrl && isTrustedBuilderPreviewUrl(resolvedBuilderUrl)
      ? resolvedBuilderUrl
      : undefined) ?? persistedBuilderUrl;

  return (
    <section className="space-y-3 border-t border-border pt-6">
      <div>
        <h3 className="text-sm font-medium text-foreground">
          {t("designSystems.preview.title")}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t("designSystems.preview.description")}
        </p>
      </div>
      {trustedBuilderUrl ? (
        <Button asChild className="cursor-pointer">
          <a
            href={withBuilderUtmTrackingParams(trustedBuilderUrl, {
              campaign: "product",
              content: "design_system_intelligence",
            })}
            target="_blank"
            rel="noreferrer"
          >
            <IconExternalLink className="size-4" />
            {"Open in Builder" /* i18n-ignore Builder link action */}
          </a>
        </Button>
      ) : null}
    </section>
  );
}

function TokenPreview({
  data,
  assets,
}: {
  data: DesignSystemData | null;
  assets: Array<{ name?: string; url?: string; variant?: string }>;
}) {
  const t = useT();
  const colors = getColorTokens(data, t);
  const typeTokens = getTypographyTokens(data, t);
  const detailTokens = getDetailTokens(data, assets, t);

  return (
    <section className="space-y-6 border-t border-border pt-6">
      <div>
        <h3 className="text-sm font-medium text-foreground">
          {t("designSystems.tokenPreview.title")}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t("designSystems.tokenPreview.description")}
        </p>
      </div>

      <div className="space-y-3">
        <h4 className="text-xs font-medium uppercase text-muted-foreground">
          {t("designSystems.tokenPreview.colors")}
        </h4>
        {colors.length > 0 ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {colors.map((color) => (
              <div
                key={color.label}
                className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-muted/30 p-2"
              >
                {color.swatch ? (
                  <div
                    className="h-9 w-9 shrink-0 rounded-md border border-border"
                    style={{ backgroundColor: color.swatch }}
                  />
                ) : null}
                <div className="min-w-0">
                  <div className="text-xs font-medium text-foreground">
                    {color.label}
                  </div>
                  <div className="truncate font-mono !text-[11px] text-muted-foreground">
                    {color.value}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyPreviewLine icon={<IconPalette className="h-4 w-4" />}>
            {t("designSystems.tokenPreview.noColors")}
          </EmptyPreviewLine>
        )}
      </div>

      {typeTokens.length > 0 ? (
        <PreviewList
          title={t("designSystems.tokenPreview.typography")}
          items={typeTokens}
        />
      ) : null}
      {detailTokens.length > 0 ? (
        <PreviewList
          title={t("designSystems.tokenPreview.details")}
          items={detailTokens}
        />
      ) : null}
    </section>
  );
}

function PreviewList({
  title,
  items,
}: {
  title: string;
  items: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="space-y-3">
      <h4 className="text-xs font-medium uppercase text-muted-foreground">
        {title}
      </h4>
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <div
            key={`${item.label}:${item.value}`}
            className="min-w-0 rounded-lg border border-border bg-muted/30 p-3"
          >
            <dt className="text-xs font-medium text-foreground">
              {item.label}
            </dt>
            <dd className="mt-1 truncate text-xs text-muted-foreground">
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function EmptyPreviewLine({
  icon,
  children,
}: {
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      {icon}
      {children}
    </div>
  );
}

function parseDesignSystemAssets(
  assetsStr?: string | null,
): Array<{ name?: string; url?: string; variant?: string }> {
  if (!assetsStr) return [];
  try {
    const parsed = JSON.parse(assetsStr);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

type DesignT = ReturnType<typeof useT>;

function getColorTokens(data: DesignSystemData | null, t: DesignT) {
  const colors = data?.colors;
  if (!colors) return [];
  return [
    {
      label: t("designSystems.tokenPreview.colorLabels.primary"),
      value: formatDesignTokenValue(colors.primary),
      swatch: getCssColorToken(colors.primary),
    },
    {
      label: t("designSystems.tokenPreview.colorLabels.secondary"),
      value: formatDesignTokenValue(colors.secondary),
      swatch: getCssColorToken(colors.secondary),
    },
    {
      label: t("designSystems.tokenPreview.colorLabels.accent"),
      value: formatDesignTokenValue(colors.accent),
      swatch: getCssColorToken(colors.accent),
    },
    {
      label: t("designSystems.tokenPreview.colorLabels.background"),
      value: formatDesignTokenValue(colors.background),
      swatch: getCssColorToken(colors.background),
    },
    {
      label: t("designSystems.tokenPreview.colorLabels.surface"),
      value: formatDesignTokenValue(colors.surface),
      swatch: getCssColorToken(colors.surface),
    },
    {
      label: t("designSystems.tokenPreview.colorLabels.text"),
      value: formatDesignTokenValue(colors.text),
      swatch: getCssColorToken(colors.text),
    },
    {
      label: t("designSystems.tokenPreview.colorLabels.mutedText"),
      value: formatDesignTokenValue(colors.textMuted),
      swatch: getCssColorToken(colors.textMuted),
    },
  ].filter(
    (
      item,
    ): item is {
      label: string;
      value: string;
      swatch: string | undefined;
    } => Boolean(item.value),
  );
}

function getTypographyTokens(data: DesignSystemData | null, t: DesignT) {
  const typography = data?.typography;
  if (!typography) return [];
  return [
    {
      label: t("designSystems.tokenPreview.typeLabels.headingFont"),
      value: formatDesignTokenValue(typography.headingFont),
    },
    {
      label: t("designSystems.tokenPreview.typeLabels.bodyFont"),
      value: formatDesignTokenValue(typography.bodyFont),
    },
    {
      label: t("designSystems.tokenPreview.typeLabels.headingWeight"),
      value: formatDesignTokenValue(typography.headingWeight),
    },
    {
      label: t("designSystems.tokenPreview.typeLabels.bodyWeight"),
      value: formatDesignTokenValue(typography.bodyWeight),
    },
  ].filter((item): item is { label: string; value: string } =>
    Boolean(item.value),
  );
}

function getDetailTokens(
  data: DesignSystemData | null,
  assets: Array<{ name?: string; url?: string; variant?: string }>,
  t: DesignT,
) {
  const spacing = data?.spacing ?? {};
  const borders = data?.borders ?? {};
  const defaults = data?.defaults ?? {};
  const logos = data?.logos ?? [];
  const namedTokenCount = Array.isArray(data?.tokens) ? data.tokens.length : 0;
  return [
    ...objectPreviewItems(t("designSystems.tokenPreview.spacing"), spacing),
    ...objectPreviewItems(t("designSystems.tokenPreview.borders"), borders),
    ...objectPreviewItems(t("designSystems.tokenPreview.defaults"), defaults),
    // The seven color roles are a summary of an import, not its extent. Without
    // this the panel renders a 200-token system identically to a 7-token one,
    // which reads as "it only captured a few colors".
    namedTokenCount > 0
      ? {
          label: t("designSystems.tokenPreview.namedTokens"),
          value: t("designSystems.tokenPreview.savedCount", {
            count: namedTokenCount,
          }),
        }
      : null,
    logos.length > 0
      ? {
          label: t("designSystems.tokenPreview.logos"),
          value: t("designSystems.tokenPreview.savedCount", {
            count: logos.length,
          }),
        }
      : null,
    assets.length > 0
      ? {
          label: t("designSystems.tokenPreview.assets"),
          value: t("designSystems.tokenPreview.savedCount", {
            count: assets.length,
          }),
        }
      : null,
  ].filter((item): item is { label: string; value: string } => Boolean(item));
}

function objectPreviewItems(prefix: string, values: Record<string, unknown>) {
  return Object.entries(values)
    .map(([key, value]) => [key, formatDesignTokenValue(value)] as const)
    .filter((entry): entry is readonly [string, string] => Boolean(entry[1]))
    .slice(0, 4)
    .map(([key, value]) => ({
      label: `${prefix}: ${labelizeKey(key)}`,
      value,
    }));
}

function labelizeKey(key: string) {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/[-_]/g, " ")
    .replace(/^./, (char) => char.toUpperCase());
}

function LoadingSkeleton() {
  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div className="h-5 w-40 rounded-md bg-muted animate-pulse" />
        <div className="h-3 w-16 rounded bg-muted animate-pulse" />
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
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

function EmptyState() {
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center py-10 sm:py-14 text-center">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#609FF8]/20 to-[#4080E0]/20 border border-[#609FF8]/20 flex items-center justify-center mb-6">
        <IconComponents className="w-7 h-7 text-primary" />
      </div>
      <h2 className="text-xl font-semibold text-foreground mb-2">
        {t("designSystems.empty.title")}
      </h2>
      <p className="text-sm text-muted-foreground max-w-sm mb-8 leading-relaxed">
        {t("designSystems.empty.description")}
      </p>
      <Button asChild className="cursor-pointer">
        <Link to="/design-systems/setup">
          <IconPlus className="w-4 h-4" />
          {t("designSystems.actions.new")}
        </Link>
      </Button>
    </div>
  );
}
