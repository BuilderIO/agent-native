import {
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
import {
  IconChecks,
  IconPlus,
  IconSearch,
  IconDots,
  IconTrash,
  IconCopy,
  IconCode,
  IconX,
  IconPencil,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { nanoid } from "nanoid";
import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate, Link } from "react-router";

import PromptPopover from "@/components/editor/PromptDialog";
import type { UploadedFile } from "@/components/editor/PromptDialog";
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
import { Spinner } from "@/components/ui/spinner";
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

export default function Index() {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
  // "Design" (default, inline prototype) vs "Full app" (Builder Fusion
  // cloud container). Only reachable behind FULL_APP_BUILDING_ENABLED — the
  // popover renders no mode control at all when the flag is off, so this
  // state is always "design" in that case.
  const [newDesignMode, setNewDesignMode] = useState<"design" | "app">(
    "design",
  );
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const anchorElRef = useRef<HTMLElement | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  // Keep anchorRef.current in sync so PromptPopover can read it
  anchorRef.current = anchorElRef.current;

  const { data: designsData, isLoading } = useActionQuery<{
    count: number;
    designs: Design[];
  }>("list-designs", { includePreview: "true" });

  const createMutation = useActionMutation("create-design");
  // Fires the fusion-backed cloud container build; only ever called when
  // FULL_APP_BUILDING_ENABLED is true and the user picked "Full app".
  const createFusionAppMutation = useActionMutation("create-fusion-app");
  const deleteMutation = useActionMutation("delete-design");
  const duplicateMutation = useActionMutation("duplicate-design");
  const updateMutation = useActionMutation("update-design");
  const {
    designSystems,
    defaultSystem,
    isLoading: designSystemsLoading,
  } = useDesignSystems();

  const designs = designsData?.designs ?? [];

  const filtered = search
    ? designs.filter((d) =>
        d.title.toLowerCase().includes(search.toLowerCase()),
      )
    : designs;
  const selectedDesignCount = selectedDesignIds.size;
  const isSelectingDesigns = selectedDesignCount > 0;
  const allVisibleSelected =
    filtered.length > 0 &&
    filtered.every((design) => selectedDesignIds.has(design.id));

  const resolveDefaultDesignSystemId = useCallback(
    () => defaultSystem?.id ?? designSystems[0]?.id ?? null,
    [defaultSystem?.id, designSystems],
  );

  const openNewDesign = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      anchorElRef.current = e.currentTarget;
      setNewDesignSystemId(
        designSystemsLoading ? undefined : resolveDefaultDesignSystemId(),
      );
      setShowNewPrompt(true);
    },
    [designSystemsLoading, resolveDefaultDesignSystemId],
  );

  const handleNewPromptOpenChange = useCallback((open: boolean) => {
    setShowNewPrompt(open);
    if (!open) {
      setNewDesignSystemId(undefined);
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
          ...(linkedDesignSystemId
            ? { designSystemId: linkedDesignSystemId }
            : {}),
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
      const derivedTitle = derivePromptTitle(prompt);
      const designSystemId =
        newDesignSystemId === undefined
          ? resolveDefaultDesignSystemId()
          : newDesignSystemId;

      const { id, title, ready } = createDesign(derivedTitle, designSystemId);

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
      } else {
        writePendingGeneration(id, {
          prompt,
          files,
          title,
          designSystemId,
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
      navigate,
      newDesignMode,
      newDesignSystemId,
      resolveDefaultDesignSystemId,
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

    setDeleteId(null);

    deleteMutation.mutate({ id } as any, {
      onError: () => {
        queryClient.invalidateQueries({
          queryKey: ["action", "list-designs"],
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
      onError: () => {
        queryClient.invalidateQueries({
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
    designs.length > 0 ? (
      <div className="flex items-center gap-3">
        <div className="relative">
          <IconSearch className="absolute start-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/70" />
          <Input
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder={t("home.searchPlaceholder")}
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
      </div>
    ) : null,
  );

  return (
    <>
      {newDesignHandoffPending ? <NewDesignHandoffOverlay /> : null}
      <main className="px-4 sm:px-6 py-6 sm:py-10">
        {isLoading ? (
          <LoadingSkeleton />
        ) : designs.length === 0 ? (
          <EmptyState
            onCreateDesign={openNewDesign}
            onStarterPrompt={(prompt) =>
              handleSubmitPrompt(prompt, [], {}, { skipQuestions: true })
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
        placeholder={t("home.describeBuild")}
        onSubmit={handleSubmitPrompt}
        anchorRef={anchorRef}
        designSystems={designSystems}
        designSystemsLoading={designSystemsLoading}
        selectedDesignSystemId={newDesignSystemId ?? null}
        onDesignSystemChange={setNewDesignSystemId}
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

/**
 * Derive a short, friendly title from a prompt. The full prompt still drives
 * generation — the title is just a label that shows up in the editor header
 * and the design card, so longer is worse.
 *
 * Strategy: take the first line, strip trailing punctuation, then truncate
 * at the nearest word boundary near 40 chars (with an ellipsis when cut).
 */
function derivePromptTitle(prompt: string): string {
  const firstLine = prompt
    .split("\n")[0]
    ?.trim()
    .replace(/[.!?]+$/, "");
  if (!firstLine) return "Untitled Design";
  const MAX = 40;
  if (firstLine.length <= MAX) return firstLine;
  const slice = firstLine.slice(0, MAX);
  const lastSpace = slice.lastIndexOf(" ");
  const trimmed = lastSpace > 20 ? slice.slice(0, lastSpace) : slice;
  return `${trimmed.trim()}…`;
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
function DesignThumbnail({ html }: { html: string | null }) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.25);

  // Designs are generated for a desktop-ish viewport. Render at 1280×720 then
  // shrink — close enough to 16:10 for the aspect-video card without leaving
  // a sliver of letterbox at the bottom.
  const NATURAL_WIDTH = 1280;
  const NATURAL_HEIGHT = 720;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      if (w > 0) setScale(w / NATURAL_WIDTH);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (!html) {
    return (
      <div className="aspect-video bg-muted/50 flex items-center justify-center">
        <IconCode className="w-8 h-8 text-muted-foreground/40" />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="aspect-video relative overflow-hidden bg-white"
    >
      <iframe
        srcDoc={html}
        sandbox="allow-scripts"
        loading="lazy"
        tabIndex={-1}
        aria-hidden
        title={t("home.designPreview")}
        style={{
          width: `${NATURAL_WIDTH}px`,
          height: `${NATURAL_HEIGHT}px`,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          border: 0,
          pointerEvents: "none",
        }}
      />
    </div>
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
