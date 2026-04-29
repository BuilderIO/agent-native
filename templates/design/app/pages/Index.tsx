import { useState, useRef, useCallback } from "react";
import { useNavigate, Link } from "react-router";
import { nanoid } from "nanoid";
import {
  IconPlus,
  IconPalette,
  IconSearch,
  IconDots,
  IconTrash,
  IconCopy,
  IconCode,
} from "@tabler/icons-react";
import { useActionQuery, useActionMutation } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
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
import { useAgentGenerating } from "@/hooks/use-agent-generating";
import { useSetHeaderActions } from "@/components/layout/HeaderActions";

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

export default function Index() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showNewPrompt, setShowNewPrompt] = useState(false);

  const anchorElRef = useRef<HTMLElement | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  // Keep anchorRef.current in sync so PromptPopover can read it
  anchorRef.current = anchorElRef.current;

  const { generating, submit: agentSubmit } = useAgentGenerating();

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

  const openNewDesign = useCallback((e: React.MouseEvent<HTMLElement>) => {
    anchorElRef.current = e.currentTarget;
    setShowNewPrompt(true);
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

      // Fire mutation in background
      createMutation.mutate(
        {
          id,
          title: finalTitle,
          projectType,
        } as any,
        {
          onError: () => {
            queryClient.invalidateQueries({
              queryKey: ["action", "list-designs"],
            });
          },
        },
      );
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

      const fileContext =
        files.length > 0
          ? `\n\nThe user uploaded ${files.length} file(s) for context:\n${files.map((f) => `- ${f.originalName} (${f.type}, ${(f.size / 1024).toFixed(1)}KB) at path: ${f.path}`).join("\n")}`
          : "";

      const context = [
        `The user just created a new empty design (id: "${id}", title: "${title}") and wants to fill it with files.`,
        `User request: "${prompt}"`,
        fileContext,
        "",
        `Use the \`generate-design --designId="${id}"\` action with one or more files (index.html, etc.). The design already exists — DO NOT call create-design.`,
        "Each file's content must be complete, self-contained HTML with Alpine.js + Tailwind via CDN. HTML templates are in your AGENTS.md.",
      ].join("\n");

      agentSubmit(`Create design: ${prompt}`, context);
      setShowNewPrompt(false);
      navigate(`/design/${id}`);
    },
    [createDesign, agentSubmit, navigate],
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

  useSetHeaderActions(
    designs.length > 0 ? (
      <div className="flex items-center gap-3">
        <div className="relative">
          <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/70" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search designs..."
            className="pl-8 h-8 w-48 bg-accent/50 border-border text-sm text-foreground/90 placeholder:text-muted-foreground/70"
          />
        </div>
        <Button size="sm" onClick={openNewDesign} className="cursor-pointer">
          <IconPlus className="w-3.5 h-3.5" />
          New Design
        </Button>
      </div>
    ) : null,
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
              {filtered.map((design) => (
                <div
                  key={design.id}
                  className="group relative rounded-xl border border-border bg-card overflow-hidden"
                >
                  <Link to={`/design/${design.id}`} className="block">
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
                </div>
              ))}
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
        loading={generating}
        anchorRef={anchorRef}
      />

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Design?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this design and all its files. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
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
