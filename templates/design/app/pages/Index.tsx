import { useState, useCallback } from "react";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
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

type ProjectType = "prototype" | "deck" | "other";

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
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [createTab, setCreateTab] = useState<
    "prototype" | "deck" | "template" | "other"
  >("prototype");
  const [projectName, setProjectName] = useState("");
  const [designSystemId, setDesignSystemId] = useState<string>("");
  const [fidelity, setFidelity] = useState<"wireframe" | "high">("high");
  const [useSpeakerNotes, setUseSpeakerNotes] = useState(false);

  const { data: designsData, isLoading } = useActionQuery<{
    count: number;
    designs: Design[];
  }>("list-designs");

  const { data: designSystemsData } = useActionQuery<{
    designSystems: Array<{
      id: string;
      title: string;
      isDefault: boolean;
    }>;
  }>("list-design-systems");

  const createMutation = useActionMutation("create-design");
  const deleteMutation = useActionMutation("delete-design");
  const duplicateMutation = useActionMutation("duplicate-design");

  const designs = designsData?.designs ?? [];
  const designSystems = designSystemsData?.designSystems ?? [];

  const filtered = search
    ? designs.filter(
        (d) =>
          d.title.toLowerCase().includes(search.toLowerCase()) ||
          d.projectType.toLowerCase().includes(search.toLowerCase()),
      )
    : designs;

  const handleCreate = useCallback(() => {
    const id = nanoid();
    const projectType: ProjectType =
      createTab === "template" ? "prototype" : (createTab as ProjectType);
    const title = projectName.trim() || "Untitled Design";

    // Optimistic update
    queryClient.setQueryData(
      ["action", "list-designs", undefined],
      (old: any) => {
        const newDesign: Design = {
          id,
          title,
          projectType,
          designSystemId: designSystemId || null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        return {
          count: (old?.count ?? 0) + 1,
          designs: [newDesign, ...(old?.designs ?? [])],
        };
      },
    );

    // Navigate immediately
    navigate(`/design/${id}`);

    // Fire mutation in background
    createMutation.mutate(
      {
        id,
        title,
        projectType,
        designSystemId: designSystemId || undefined,
      } as any,
      {
        onError: () => {
          queryClient.invalidateQueries({
            queryKey: ["action", "list-designs"],
          });
        },
      },
    );

    // Reset form
    setShowCreateDialog(false);
    setProjectName("");
    setDesignSystemId("");
    setCreateTab("prototype");
  }, [
    createTab,
    projectName,
    designSystemId,
    queryClient,
    navigate,
    createMutation,
  ]);

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
      deck: "Slide Deck",
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

  return (
    <>
      <main className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 sm:py-10">
        {isLoading ? (
          <LoadingSkeleton />
        ) : designs.length === 0 ? (
          <EmptyState onCreateDesign={() => setShowCreateDialog(true)} />
        ) : (
          <>
            {/* Search + Count */}
            <div className="flex items-center justify-between mb-6">
              <h1 className="text-lg font-semibold text-white/90">
                Your Designs
              </h1>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search designs..."
                    className="pl-8 h-8 w-48 bg-white/[0.04] border-white/[0.06] text-sm text-white/80 placeholder:text-white/30"
                  />
                </div>
                <span className="text-xs text-white/30">
                  {filtered.length} design{filtered.length !== 1 ? "s" : ""}
                </span>
                <Button
                  size="sm"
                  onClick={() => setShowCreateDialog(true)}
                  className="cursor-pointer"
                >
                  <IconPlus className="w-3.5 h-3.5" />
                  New Design
                </Button>
              </div>
            </div>

            {/* Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {/* New design card */}
              <button
                onClick={() => setShowCreateDialog(true)}
                className="group relative rounded-xl border border-dashed border-white/[0.08] bg-[hsl(240,5%,8%)] hover:border-white/[0.15] overflow-hidden text-left cursor-pointer"
              >
                <div className="aspect-video flex items-center justify-center bg-white/[0.02]">
                  <div className="w-12 h-12 rounded-xl bg-white/[0.04] flex items-center justify-center group-hover:bg-white/[0.06]">
                    <IconPlus className="w-6 h-6 text-white/30 group-hover:text-white/50" />
                  </div>
                </div>
                <div className="p-4">
                  <h3 className="font-medium text-sm text-white/50 group-hover:text-white/70">
                    New Design
                  </h3>
                  <div className="text-xs text-white/30 mt-1">
                    Create a design project
                  </div>
                </div>
              </button>

              {/* Design cards */}
              {filtered.map((design) => (
                <div
                  key={design.id}
                  className="group relative rounded-xl border border-white/[0.06] bg-[hsl(240,5%,8%)] overflow-hidden"
                >
                  <Link to={`/design/${design.id}`} className="block">
                    <div className="aspect-video bg-white/[0.03] flex items-center justify-center">
                      <IconCode className="w-8 h-8 text-white/10" />
                    </div>
                    <div className="p-4">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium text-sm text-white/80 truncate flex-1">
                          {design.title}
                        </h3>
                        {projectTypeBadge(design.projectType)}
                      </div>
                      <div className="text-xs text-white/30">
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
                          <IconDots className="w-3.5 h-3.5 text-white/70" />
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

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Design</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Tabs
              value={createTab}
              onValueChange={(v) =>
                setCreateTab(v as "prototype" | "deck" | "template" | "other")
              }
            >
              <TabsList className="w-full">
                <TabsTrigger value="prototype" className="flex-1">
                  Prototype
                </TabsTrigger>
                <TabsTrigger value="deck" className="flex-1">
                  Slide Deck
                </TabsTrigger>
                <TabsTrigger value="template" className="flex-1">
                  From Template
                </TabsTrigger>
                <TabsTrigger value="other" className="flex-1">
                  Other
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="space-y-3">
              <Input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="Project name"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                }}
              />

              {designSystems.length > 0 && (
                <Select
                  value={designSystemId}
                  onValueChange={setDesignSystemId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Design system (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {designSystems.map((ds) => (
                      <SelectItem key={ds.id} value={ds.id}>
                        {ds.title}
                        {ds.isDefault ? " (default)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {createTab === "prototype" && (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-white/60">Fidelity:</span>
                  <div className="flex gap-2">
                    <Button
                      variant={fidelity === "wireframe" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setFidelity("wireframe")}
                      className="cursor-pointer"
                    >
                      Wireframe
                    </Button>
                    <Button
                      variant={fidelity === "high" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setFidelity("high")}
                      className="cursor-pointer"
                    >
                      High fidelity
                    </Button>
                  </div>
                </div>
              )}

              {createTab === "deck" && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-white/60">
                    Use speaker notes
                  </span>
                  <Switch
                    checked={useSpeakerNotes}
                    onCheckedChange={setUseSpeakerNotes}
                  />
                </div>
              )}

              {createTab === "template" && (
                <p className="text-sm text-white/40">
                  Browse the{" "}
                  <Link
                    to="/examples"
                    className="text-[#609FF8] hover:underline"
                  >
                    examples gallery
                  </Link>{" "}
                  for starter templates.
                </p>
              )}
            </div>

            <Button onClick={handleCreate} className="w-full cursor-pointer">
              <IconPlus className="w-3.5 h-3.5" />
              Create
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
      <div className="flex items-center justify-between mb-6">
        <div className="h-5 w-32 rounded-md bg-white/[0.05] animate-pulse" />
        <div className="h-3 w-16 rounded bg-white/[0.05] animate-pulse" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-white/[0.06] bg-[hsl(240,5%,8%)] overflow-hidden"
          >
            <div className="aspect-video bg-white/[0.03] animate-pulse" />
            <div className="p-4 space-y-2">
              <div className="h-4 w-3/4 rounded bg-white/[0.05] animate-pulse" />
              <div className="h-3 w-1/2 rounded bg-white/[0.05] animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function EmptyState({ onCreateDesign }: { onCreateDesign: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#609FF8]/20 to-[#4080E0]/20 border border-[#609FF8]/20 flex items-center justify-center mb-6">
        <IconPalette className="w-7 h-7 text-[#609FF8]" />
      </div>
      <h2 className="text-xl font-semibold text-white/90 mb-2">
        Create your first design
      </h2>
      <p className="text-sm text-white/40 max-w-sm mb-8 leading-relaxed">
        Build interactive prototypes, slide decks, and design artifacts with
        AI-powered generation and a visual editor.
      </p>
      <Button onClick={onCreateDesign} className="cursor-pointer">
        <IconPlus className="w-4 h-4" />
        New Design
      </Button>
    </div>
  );
}
