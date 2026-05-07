import { Link, useNavigate } from "react-router";
import { useMemo, useState } from "react";
import { useActionQuery } from "@agent-native/core/client";
import {
  IconLibraryPhoto,
  IconPhotoPlus,
  IconSearch,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { CreateLibraryDialog } from "@/components/library/CreateLibraryDialog";
import { LibraryCard } from "@/components/library/LibraryCard";
import { PageShell } from "@/components/layout/PageShell";
import {
  sortLibrariesByUsage,
  type ImageLibrarySummary,
} from "@/lib/libraries";

export default function LibrariesPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useActionQuery("list-libraries", {});
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

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

  return (
    <PageShell
      title="Libraries"
      description="Organize references, saved generations, and image instructions."
    >
      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              Your libraries
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Brand references, product imagery, diagrams, and generated
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
              />
            ))}
          </div>
        ) : (
          <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed bg-muted/20 p-8 text-center">
            <IconLibraryPhoto className="h-10 w-10 text-muted-foreground" />
            <h3 className="mt-4 text-base font-semibold">No libraries yet</h3>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              You can still generate images from Create. Add a library when you
              want future generations to follow your references and
              instructions.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Button onClick={() => setOpen(true)} className="gap-2">
                <IconPhotoPlus className="h-4 w-4" />
                New library
              </Button>
              <Button asChild variant="outline">
                <Link to="/">Create image</Link>
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
    </PageShell>
  );
}
