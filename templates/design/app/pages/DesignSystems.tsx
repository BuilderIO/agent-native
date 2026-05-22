import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import {
  IconCheckbox,
  IconChecks,
  IconDots,
  IconPlus,
  IconPalette,
  IconStar,
  IconStarFilled,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import {
  ShareButton,
  VisibilityBadge,
  useActionQuery,
  useActionMutation,
} from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  useSetHeaderActions,
  useSetPageTitle,
} from "@/components/layout/HeaderActions";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "sonner";

interface DesignSystem {
  id: string;
  title: string;
  description?: string | null;
  data: string;
  assets?: string | null;
  customInstructions?: string | null;
  isDefault: boolean;
  visibility?: "private" | "org" | "public" | null;
  accessRole?: "owner" | "viewer" | "editor" | "admin";
  canManage?: boolean;
  createdAt: string;
  updatedAt?: string;
}

interface DesignSystemData {
  colors?: {
    primary?: string;
    secondary?: string;
    accent?: string;
    background?: string;
    surface?: string;
    text?: string;
    textMuted?: string;
  };
  typography?: {
    headingFont?: string;
    bodyFont?: string;
    headingWeight?: string;
    bodyWeight?: string;
  };
  spacing?: Record<string, string | undefined>;
  borders?: Record<string, string | undefined>;
  logos?: Array<{ url?: string; name?: string; variant?: string }>;
  defaults?: Record<string, string | undefined>;
  notes?: string;
}

export default function DesignSystems() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedSystemIds, setSelectedSystemIds] = useState<Set<string>>(
    () => new Set(),
  );

  const { data, isLoading } = useActionQuery<{
    designSystems: DesignSystem[];
  }>("list-design-systems");

  const setDefaultMutation = useActionMutation("set-default-design-system");
  const deleteMutation = useActionMutation("delete-design-system");
  const updateMutation = useActionMutation("update-design-system");

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
    (id: string) => {
      // Optimistic update
      queryClient.setQueryData(
        ["action", "list-design-systems", undefined],
        (old: any) => {
          if (!old?.designSystems) return old;
          return {
            ...old,
            designSystems: old.designSystems.map((ds: DesignSystem) => ({
              ...ds,
              isDefault: ds.id === id,
            })),
          };
        },
      );

      setDefaultMutation.mutate({ id } as any, {
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
        toast.error("Could not delete design system", {
          description:
            error instanceof Error ? error.message : "Something went wrong",
        });
      },
    });
  }, [deleteId, queryClient, deleteMutation]);

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
          toast.success("Design system updated");
        },
        onError: (error) => {
          queryClient.setQueryData(
            ["action", "list-design-systems", undefined],
            previous,
          );
          toast.error("Could not update design system", {
            description:
              error instanceof Error ? error.message : "Something went wrong",
          });
        },
      });
    },
    [queryClient, updateMutation],
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
        toast.error("Could not delete selected design systems", {
          description:
            error instanceof Error ? error.message : "Something went wrong",
        });
      });
  }, [selectedSystemIds, queryClient, exitSelectionMode, deleteMutation]);

  const parseData = (dataStr: string): DesignSystemData | null => {
    try {
      return JSON.parse(dataStr);
    } catch {
      return null;
    }
  };

  useSetPageTitle("Design Systems");

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
          {isSelectionMode ? "Done" : "Select"}
        </Button>
      ) : null}
      <Button
        size="sm"
        onClick={() => navigate("/design-systems/setup")}
        className="cursor-pointer"
      >
        <IconPlus className="w-3.5 h-3.5" />
        New Design System
      </Button>
    </div>,
  );

  return (
    <>
      <div className="flex-1 overflow-y-auto">
        <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
          {isLoading ? (
            <LoadingSkeleton />
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
                    selected
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
                          ? "Clear all design systems"
                          : "Select all design systems"}
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
                      <TooltipContent>Clear selection</TooltipContent>
                    </Tooltip>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setBulkDeleteOpen(true)}
                      disabled={selectedSystemCount === 0}
                      className="cursor-pointer"
                    >
                      <IconTrash className="w-3.5 h-3.5" />
                      Delete
                    </Button>
                  </div>
                </div>
              ) : null}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {/* New design system card */}
                <button
                  onClick={() => navigate("/design-systems/setup")}
                  className="group relative rounded-xl border border-dashed border-border bg-card hover:border-foreground/15 overflow-hidden text-left cursor-pointer"
                >
                  <div className="aspect-video flex items-center justify-center bg-muted/30">
                    <div className="w-12 h-12 rounded-xl bg-accent/50 flex items-center justify-center group-hover:bg-accent">
                      <IconPlus className="w-6 h-6 text-muted-foreground/70 group-hover:text-muted-foreground" />
                    </div>
                  </div>
                  <div className="p-4">
                    <h3 className="font-medium text-sm text-muted-foreground group-hover:text-foreground/70">
                      New Design System
                    </h3>
                    <div className="text-xs text-muted-foreground/70 mt-1">
                      Set up your brand
                    </div>
                  </div>
                </button>

                {/* Design system cards */}
                {designSystems.map((ds) => {
                  const parsed = parseData(ds.data);
                  const colors = parsed?.colors;
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
                        aria-pressed={isSelectionMode ? isSelected : undefined}
                        className="block w-full text-left cursor-pointer"
                      >
                        {/* Color preview */}
                        <div className="aspect-video bg-muted/50 flex items-center justify-center gap-2 p-4">
                          {colors?.primary && (
                            <div
                              className="w-10 h-10 rounded-lg"
                              style={{ backgroundColor: colors.primary }}
                            />
                          )}
                          {colors?.secondary && (
                            <div
                              className="w-10 h-10 rounded-lg"
                              style={{ backgroundColor: colors.secondary }}
                            />
                          )}
                          {colors?.accent && (
                            <div
                              className="w-10 h-10 rounded-lg"
                              style={{ backgroundColor: colors.accent }}
                            />
                          )}
                          {!colors?.primary &&
                            !colors?.secondary &&
                            !colors?.accent && (
                              <IconPalette className="w-8 h-8 text-muted-foreground/40" />
                            )}
                        </div>
                        <div className="p-4 pb-3">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-medium text-sm text-foreground/90 truncate flex-1">
                              {ds.title}
                            </h3>
                            {ds.isDefault && (
                              <span className="text-[10px] text-[#609FF8] font-medium">
                                Default
                              </span>
                            )}
                          </div>
                          {parsed?.typography?.headingFont && (
                            <div className="text-xs text-muted-foreground/70">
                              {parsed.typography.headingFont}
                            </div>
                          )}
                        </div>
                      </button>
                      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-4">
                        <VisibilityBadge
                          visibility={ds.visibility}
                          className="text-[11px]"
                        />
                        <ShareButton
                          resourceType="design-system"
                          resourceId={ds.id}
                          resourceTitle={ds.title}
                        />
                      </div>
                      {isSelectionMode && ds.canManage ? (
                        <div className="absolute top-2 left-2 z-10">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() =>
                                  toggleSystemSelection(ds.id)
                                }
                                onClick={(event) => event.stopPropagation()}
                                aria-label={`Select ${ds.title}`}
                                className="h-5 w-5 border-white/60 bg-black/60 text-white data-[state=checked]:border-[#609FF8] data-[state=checked]:bg-[#609FF8]"
                              />
                            </TooltipTrigger>
                            <TooltipContent>{`Select ${ds.title}`}</TooltipContent>
                          </Tooltip>
                        </div>
                      ) : (
                        <>
                          {/* Star button */}
                          {ds.accessRole === "owner" && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  onClick={() => handleSetDefault(ds.id)}
                                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 w-7 h-7 flex items-center justify-center rounded-md bg-black/60 hover:bg-black/80 cursor-pointer"
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
                                  ? "Currently default"
                                  : "Set as default"}
                              </TooltipContent>
                            </Tooltip>
                          )}
                          {ds.canManage && (
                            <div
                              className={`absolute top-2 z-10 opacity-0 group-hover:opacity-100 ${
                                ds.accessRole === "owner"
                                  ? "right-10"
                                  : "right-2"
                              }`}
                            >
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 bg-black/60 hover:bg-black/80 cursor-pointer"
                                    aria-label={`More actions for ${ds.title}`}
                                  >
                                    <IconDots className="w-3.5 h-3.5 text-foreground/70" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem
                                    onClick={() => setDeleteId(ds.id)}
                                    className="text-red-400 focus:text-red-400 cursor-pointer"
                                  >
                                    <IconTrash className="w-3.5 h-3.5 mr-2" />
                                    Delete
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
                ? `Delete ${selectedSystemCount} ${
                    selectedSystemCount === 1
                      ? "Design System"
                      : "Design Systems"
                  }?`
                : "Delete Design System?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {bulkDeleteOpen
                ? `This will permanently delete ${
                    selectedSystemCount === 1
                      ? "this design system and unlink it from any designs that use it"
                      : `these ${selectedSystemCount} design systems and unlink them from any designs that use them`
                  }. This action cannot be undone.`
                : "This will permanently delete this design system and unlink it from any designs that use it. This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={bulkDeleteOpen ? handleBulkDelete : handleDelete}
              className="bg-red-600 hover:bg-red-700 cursor-pointer"
            >
              Delete
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
    () => parseDesignSystemAssets(designSystem?.assets),
    [designSystem?.assets],
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
            Review the saved tokens and update the details agents use when they
            apply this design system.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-7 py-6">
          <section className="space-y-3">
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="design-system-title">Title</Label>
                <Input
                  id="design-system-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  readOnly={!canEdit}
                  className="bg-accent/50"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="design-system-description">Description</Label>
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

          <TokenPreview data={parsed} assets={assets} />

          <section className="space-y-3 border-t border-border pt-6">
            <div>
              <h3 className="text-sm font-medium text-foreground">
                Custom instructions
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Durable guidance the agent reuses whenever this system is linked
                to a design.
              </p>
            </div>
            <Textarea
              value={customInstructions}
              onChange={(event) => setCustomInstructions(event.target.value)}
              readOnly={!canEdit}
              rows={5}
              placeholder="No custom instructions saved yet."
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
            Use as starting point
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
              {isSaving ? "Saving..." : "Save changes"}
            </Button>
          ) : null}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function TokenPreview({
  data,
  assets,
}: {
  data: DesignSystemData | null;
  assets: Array<{ name?: string; url?: string; variant?: string }>;
}) {
  const colors = getColorTokens(data);
  const typeTokens = getTypographyTokens(data);
  const detailTokens = getDetailTokens(data, assets);

  return (
    <section className="space-y-6 border-t border-border pt-6">
      <div>
        <h3 className="text-sm font-medium text-foreground">Token preview</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          A snapshot of the colors, type, spacing, and assets currently stored.
        </p>
      </div>

      <div className="space-y-3">
        <h4 className="text-xs font-medium uppercase text-muted-foreground">
          Colors
        </h4>
        {colors.length > 0 ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {colors.map((color) => (
              <div
                key={color.label}
                className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-muted/30 p-2"
              >
                <div
                  className="h-9 w-9 shrink-0 rounded-md border border-border"
                  style={{ backgroundColor: color.value }}
                />
                <div className="min-w-0">
                  <div className="text-xs font-medium text-foreground">
                    {color.label}
                  </div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">
                    {color.value}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyPreviewLine icon={<IconPalette className="h-4 w-4" />}>
            No color tokens saved.
          </EmptyPreviewLine>
        )}
      </div>

      {typeTokens.length > 0 ? (
        <PreviewList title="Typography" items={typeTokens} />
      ) : null}
      {detailTokens.length > 0 ? (
        <PreviewList title="Details" items={detailTokens} />
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

function parseDesignSystemData(dataStr: string): DesignSystemData | null {
  try {
    const parsed = JSON.parse(dataStr);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as DesignSystemData;
  } catch {
    return null;
  }
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

function getColorTokens(data: DesignSystemData | null) {
  const colors = data?.colors;
  if (!colors) return [];
  return [
    { label: "Primary", value: colors.primary },
    { label: "Secondary", value: colors.secondary },
    { label: "Accent", value: colors.accent },
    { label: "Background", value: colors.background },
    { label: "Surface", value: colors.surface },
    { label: "Text", value: colors.text },
    { label: "Muted text", value: colors.textMuted },
  ].filter((item): item is { label: string; value: string } =>
    Boolean(item.value),
  );
}

function getTypographyTokens(data: DesignSystemData | null) {
  const typography = data?.typography;
  if (!typography) return [];
  return [
    { label: "Heading font", value: typography.headingFont },
    { label: "Body font", value: typography.bodyFont },
    { label: "Heading weight", value: typography.headingWeight },
    { label: "Body weight", value: typography.bodyWeight },
  ].filter((item): item is { label: string; value: string } =>
    Boolean(item.value),
  );
}

function getDetailTokens(
  data: DesignSystemData | null,
  assets: Array<{ name?: string; url?: string; variant?: string }>,
) {
  const spacing = data?.spacing ?? {};
  const borders = data?.borders ?? {};
  const defaults = data?.defaults ?? {};
  const logos = data?.logos ?? [];
  return [
    ...objectPreviewItems("Spacing", spacing),
    ...objectPreviewItems("Borders", borders),
    ...objectPreviewItems("Defaults", defaults),
    logos.length > 0
      ? { label: "Logos", value: `${logos.length} saved` }
      : null,
    assets.length > 0
      ? { label: "Assets", value: `${assets.length} saved` }
      : null,
  ].filter((item): item is { label: string; value: string } => Boolean(item));
}

function objectPreviewItems(
  prefix: string,
  values: Record<string, string | undefined>,
) {
  return Object.entries(values)
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
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
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#609FF8]/20 to-[#4080E0]/20 border border-[#609FF8]/20 flex items-center justify-center mb-6">
        <IconPalette className="w-7 h-7 text-[#609FF8]" />
      </div>
      <h2 className="text-xl font-semibold text-foreground mb-2">
        Create your first design system
      </h2>
      <p className="text-sm text-muted-foreground max-w-sm mb-8 leading-relaxed">
        Maintain consistent branding across all your designs with shared colors,
        typography, and assets.
      </p>
      <Button asChild className="cursor-pointer">
        <Link to="/design-systems/setup">
          <IconPlus className="w-4 h-4" />
          New Design System
        </Link>
      </Button>
    </div>
  );
}
