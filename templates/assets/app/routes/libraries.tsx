import { Link, useNavigate } from "react-router";
import { useMemo, useState } from "react";
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import { toast } from "sonner";
import {
  IconLibraryPhoto,
  IconPhotoPlus,
  IconSearch,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { CreateLibraryDialog } from "@/components/library/CreateLibraryDialog";
import { EditLibraryDialog } from "@/components/library/EditLibraryDialog";
import { LibraryCard } from "@/components/library/LibraryCard";
import { LibraryPresetGrid } from "@/components/library/LibraryPresetGrid";
import { PageShell } from "@/components/layout/PageShell";
import {
  sortLibrariesByUsage,
  type ImageLibrarySummary,
} from "@/lib/libraries";
import type { LibraryPreset } from "../../shared/library-presets";

export default function LibrariesPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useActionQuery("list-libraries", {});
  const { data: presetData } = useActionQuery("list-library-presets", {});
  const createFromPreset = useActionMutation("create-library-from-preset");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ImageLibrarySummary | null>(null);
  const [creatingPresetId, setCreatingPresetId] = useState<string | null>(null);
  const presets = ((presetData as any)?.presets ?? []) as LibraryPreset[];

  const libraries = useMemo(() => {
    const items = sortLibrariesByUsage(
      (((data as any)?.libraries ?? []) as ImageLibrarySummary[]).filter(
        Boolean,
      ),
    );
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((library) =>
      [library.title, library.description]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [data, query]);

  function createPresetLibrary(presetId: string) {
    setCreatingPresetId(presetId);
    createFromPreset.mutate(
      { presetId },
      {
        onSuccess: (library: any) => {
          setCreatingPresetId(null);
          navigate(`/library/${library.id}`);
        },
        onError: (error: Error) => {
          setCreatingPresetId(null);
          toast.error(error.message || "Could not create preset library.");
        },
      },
    );
  }

  return (
    <PageShell
      title="Libraries"
      description="Organize references, generated assets, folders, and reusable style guidance."
    >
      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              Your libraries
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Brand references, product imagery, videos, diagrams, and generated
              candidates that other agents can reuse.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => setOpen(true)}
            className="gap-2"
          >
            <IconPhotoPlus className="h-4 w-4" />
            New library
          </Button>
        </div>

        <div className="flex h-10 items-center gap-2 rounded-md border border-border bg-background px-3">
          <IconSearch className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search libraries"
            className="h-full flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="h-64 animate-pulse rounded-lg border bg-card"
              />
            ))}
          </div>
        ) : libraries.length ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {libraries.map((library) => (
              <LibraryCard
                key={library.id}
                library={library}
                to={`/library/${library.id}`}
                onEdit={() => setEditing(library)}
                showInstructions={false}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed bg-muted/20 p-6">
            <div className="mx-auto max-w-2xl text-center">
              <IconLibraryPhoto className="mx-auto h-10 w-10 text-muted-foreground" />
              <h3 className="mt-4 text-base font-semibold">No libraries yet</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Start with a default style library or create your own references
                and style guidance.
              </p>
            </div>
            <div className="mx-auto mt-6 max-w-4xl">
              <LibraryPresetGrid
                presets={presets}
                creatingId={creatingPresetId}
                onCreate={createPresetLibrary}
              />
            </div>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Button onClick={() => setOpen(true)} className="gap-2">
                <IconPhotoPlus className="h-4 w-4" />
                New library
              </Button>
              <Button asChild variant="outline">
                <Link to="/">Create asset</Link>
              </Button>
            </div>
          </div>
        )}
      </section>

      <CreateLibraryDialog
        open={open}
        onOpenChange={setOpen}
        onCreated={(library) => navigate(`/library/${library.id}`)}
      />
      <EditLibraryDialog
        library={editing}
        open={!!editing}
        onOpenChange={(next) => {
          if (!next) setEditing(null);
        }}
      />
    </PageShell>
  );
}
