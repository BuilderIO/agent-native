import { useState, useRef, useCallback } from "react";
import { useNavigate, Link } from "react-router";
import { nanoid } from "nanoid";
import {
  IconCheckbox,
  IconChecks,
  IconPlus,
  IconPalette,
  IconSearch,
  IconDots,
  IconTrash,
  IconCopy,
  IconCode,
  IconX,
} from "@tabler/icons-react";
import { useActionQuery, useActionMutation } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import PromptPopover from "@/components/editor/PromptDialog";
import type { UploadedFile } from "@/components/editor/PromptDialog";
import {
  useSetHeaderActions,
  useSetPageTitle,
} from "@/components/layout/HeaderActions";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type ProjectType = "prototype" | "other";

interface Design {
  id: string;
  title: string;
  description?: string;
  projectType: ProjectType;
  designSystemId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

const pendingGenerationKey = (id: string) => `design.pending-generation.${id}`;

export default function Index() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedDesignIds, setSelectedDesignIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [showNewPrompt, setShowNewPrompt] = useState(false);

  const anchorElRef = useRef<HTMLElement | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  // Keep anchorRef.current in sync so PromptPopover can read it
  anchorRef.current = anchorElRef.current;

  const { data: designsData, isLoading } = useActionQuery<{
    count: number;
    designs: Design[];
  }>("list-designs");

  const createMutation = useActionMutation("create-design");
  const deleteMutation = useActionMutation("delete-design");
  const duplicateMutation = useActionMutation("duplicate-design");

  const designs = designsData?.designs ?? [];

  const filtered = search
    ? designs.filter(
        (d) =>
          d.title.toLowerCase().includes(search.toLowerCase()) ||
          d.projectType.toLowerCase().includes(search.toLowerCase()),
      )
    : designs;
  const selectedDesignCount = selectedDesignIds.size;
  const allVisibleSelected =
    filtered.length > 0 &&
    filtered.every((design) => selectedDesignIds.has(design.id));

  const openNewDesign = useCallback((e: React.MouseEvent<HTMLElement>) => {
    anchorElRef.current = e.currentTarget;
    setShowNewPrompt(true);
  }, []);

  const toggleSelectionMode = useCallback(() => {
    if (isSelectionMode) {
      setSelectedDesignIds(new Set());
    }
    setIsSelectionMode((current) => !current);
  }, [isSelectionMode]);

  const exitSelectionMode = useCallback(() => {
    setIsSelectionMode(false);
    setSelectedDesignIds(new Set());
  }, []);

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

  const clearSelection = useCallback(() => {
    setSelectedDesignIds(new Set());
  }, []);

  const createDesign = useCallback(
    (title: string): { id: string; title: string } => {
      const id = nanoid();
      const projectType: ProjectType = "prototype";
      const finalTitle = title.trim() || "Untitled Design";

      // Optimistic update
      queryClient.setQueryData(
        ["action", "list-designs", undefined],
        (old: any) => {
          const newDesign: Design = {
            id,
            title: finalTitle,
            projectType,
            designSystemId: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          return {
            count: (old?.count ?? 0) + 1,
            designs: [newDesign, ...(old?.designs ?? [])],
          };
        },
      );

      // Fire mutation in background; keep the optimistic navigation instant.
      void createMutation
        .mutateAsync({
          id,
          title: finalTitle,
          projectType,
        } as any)
        .catch(() => {
          try {
            window.sessionStorage.removeItem(pendingGenerationKey(id));
          } catch {
            // Storage may be unavailable.
          }
          queryClient.invalidateQueries({
            queryKey: ["action", "list-designs"],
          });
        });
      return { id, title: finalTitle };
    },
    [queryClient, createMutation],
  );

  const handleSkipPrompt = useCallback(() => {
    const { id } = createDesign("Untitled Design");
    setShowNewPrompt(false);
    navigate(`/design/${id}`);
  }, [createDesign, navigate]);

  const handleSubmitPrompt = useCallback(
    (prompt: string, files: UploadedFile[]) => {
      // Derive a title from the prompt — first line / first ~60 chars
      const derivedTitle =
        prompt
          .split("\n")[0]
          ?.trim()
          .replace(/[.!?]+$/, "")
          .slice(0, 60) || "New Design";

      const { id, title } = createDesign(derivedTitle);

      try {
        window.sessionStorage.setItem(
          pendingGenerationKey(id),
          JSON.stringify({ prompt, files, title }),
        );
      } catch {
        // Storage may be unavailable; the editor still opens with the design.
      }

      setShowNewPrompt(false);
      navigate(`/design/${id}`);
    },
    [createDesign, navigate],
  );

  const handleDelete = useCallback(() => {
    if (!deleteId) return;
    const id = deleteId;

    // Optimistic update
    queryClient.setQueryData(
      ["action", "list-designs", undefined],
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
      ["action", "list-designs", undefined],
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
    exitSelectionMode();

    void Promise.all(ids.map((id) => deleteMutation.mutateAsync({ id } as any)))
      .then(() => undefined)
      .catch(() => {
        queryClient.invalidateQueries({
          queryKey: ["action", "list-designs"],
        });
      });
  }, [selectedDesignIds, queryClient, exitSelectionMode, deleteMutation]);

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

  const projectTypeBadge = (type: ProjectType) => {
    const labels: Record<ProjectType, string> = {
      prototype: "Prototype",
      other: "Other",
    };
    return (
      <Badge variant="secondary" className="text-[10px] font-medium">
        {labels[type] ?? type}
      </Badge>
    );
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  useSetPageTitle("Designs");

  useSetHeaderActions(
    <div className="flex items-center gap-3">
      {designs.length > 0 ? (
        <div className="relative">
          <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/70" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search designs..."
            className="pl-8 h-8 w-48 bg-accent/50 border-border text-sm text-foreground/90 placeholder:text-muted-foreground/70"
          />
        </div>
      ) : null}
      {designs.length > 0 ? (
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
      <Button size="sm" onClick={openNewDesign} className="cursor-pointer">
        <IconPlus className="w-3.5 h-3.5" />
        New Design
      </Button>
    </div>,
  );

  return (
    <>
      <main className="px-4 sm:px-6 py-6 sm:py-10">
        {isLoading ? (
          <LoadingSkeleton />
        ) : designs.length === 0 ? (
          <EmptyState onCreateDesign={openNewDesign} />
        ) : (
          <>
            {isSelectionMode ? (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2">
                <div className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {selectedDesignCount}
                  </span>{" "}
                  selected
                </div>
                <div className="flex items-center gap-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={toggleVisibleSelection}
                        className="h-8 w-8 cursor-pointer"
                      >
                        <IconChecks className="w-4 h-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {allVisibleSelected
                        ? "Clear visible selection"
                        : "Select visible designs"}
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
                    disabled={selectedDesignCount === 0}
                    className="cursor-pointer"
                  >
                    <IconTrash className="w-3.5 h-3.5" />
                    Delete
                  </Button>
                </div>
              </div>
            ) : null}
            {/* Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {/* New design card */}
              <button
                onClick={openNewDesign}
                className="group relative rounded-xl border border-dashed border-border bg-card hover:border-foreground/15 overflow-hidden text-left cursor-pointer"
              >
                <div className="aspect-video flex items-center justify-center bg-muted/30">
                  <div className="w-12 h-12 rounded-xl bg-accent/50 flex items-center justify-center group-hover:bg-accent">
                    <IconPlus className="w-6 h-6 text-muted-foreground/70 group-hover:text-muted-foreground" />
                  </div>
                </div>
                <div className="p-4">
                  <h3 className="font-medium text-sm text-muted-foreground group-hover:text-foreground/70">
                    New Design
                  </h3>
                  <div className="text-xs text-muted-foreground/70 mt-1">
                    Create a design project
                  </div>
                </div>
              </button>

              {/* Design cards */}
              {filtered.map((design) => {
                const isSelected = selectedDesignIds.has(design.id);
                const cardContent = (
                  <>
                    <div className="aspect-video bg-muted/50 flex items-center justify-center">
                      <IconCode className="w-8 h-8 text-muted-foreground/40" />
                    </div>
                    <div className="p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium text-sm text-foreground/90 truncate flex-1">
                          {design.title}
                        </h3>
                        {projectTypeBadge(design.projectType)}
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
                    {isSelectionMode ? (
                      <>
                        <button
                          type="button"
                          onClick={() => toggleDesignSelection(design.id)}
                          className="block w-full text-left cursor-pointer"
                        >
                          {cardContent}
                        </button>
                        <div className="absolute top-2 left-2 z-10">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() =>
                                  toggleDesignSelection(design.id)
                                }
                                onClick={(event) => event.stopPropagation()}
                                aria-label={`Select ${design.title}`}
                                className="h-5 w-5 border-white/60 bg-black/60 text-white data-[state=checked]:border-[#609FF8] data-[state=checked]:bg-[#609FF8]"
                              />
                            </TooltipTrigger>
                            <TooltipContent>{`Select ${design.title}`}</TooltipContent>
                          </Tooltip>
                        </div>
                      </>
                    ) : (
                      <>
                        <Link to={`/design/${design.id}`} className="block">
                          {cardContent}
                        </Link>
                        {/* Three-dot menu */}
                        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 bg-black/60 hover:bg-black/80 cursor-pointer"
                              >
                                <IconDots className="w-3.5 h-3.5 text-foreground/70" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => handleDuplicate(design.id)}
                                className="cursor-pointer"
                              >
                                <IconCopy className="w-3.5 h-3.5 mr-2" />
                                Duplicate
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => setDeleteId(design.id)}
                                className="text-red-400 focus:text-red-400 cursor-pointer"
                              >
                                <IconTrash className="w-3.5 h-3.5 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </main>

      <PromptPopover
        open={showNewPrompt}
        onOpenChange={setShowNewPrompt}
        title="New design"
        placeholder="Describe what you want to build..."
        onSkip={handleSkipPrompt}
        skipLabel="Skip prompt"
        onSubmit={handleSubmitPrompt}
        anchorRef={anchorRef}
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
                ? `Delete ${selectedDesignCount} ${
                    selectedDesignCount === 1 ? "Design" : "Designs"
                  }?`
                : "Delete Design?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {bulkDeleteOpen
                ? `This will permanently delete ${
                    selectedDesignCount === 1
                      ? "this design and all its files"
                      : `these ${selectedDesignCount} designs and all their files`
                  }. This action cannot be undone.`
                : "This will permanently delete this design and all its files. This action cannot be undone."}
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
    </>
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

function EmptyState({
  onCreateDesign,
}: {
  onCreateDesign: (e: React.MouseEvent<HTMLElement>) => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#609FF8]/20 to-[#4080E0]/20 border border-[#609FF8]/20 flex items-center justify-center mb-6">
        <IconPalette className="w-7 h-7 text-[#609FF8]" />
      </div>
      <h2 className="text-xl font-semibold text-foreground mb-2">
        Create your first design
      </h2>
      <p className="text-sm text-muted-foreground max-w-sm mb-8 leading-relaxed">
        Build interactive prototypes and design artifacts with AI-powered
        generation and a visual editor.
      </p>
      <Button
        onClick={(e: React.MouseEvent<HTMLButtonElement>) =>
          onCreateDesign(e as React.MouseEvent<HTMLElement>)
        }
        className="cursor-pointer"
      >
        <IconPlus className="w-4 h-4" />
        New Design
      </Button>
    </div>
  );
}
