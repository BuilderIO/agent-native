import {
  useActionMutation,
  useActionQuery,
  useT,
} from "@agent-native/core/client";
import { IconPalette, IconPhotoPlus, IconSearch } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import { PageShell } from "@/components/layout/PageShell";
import { CreateLibraryDialog } from "@/components/library/CreateLibraryDialog";
import { EditLibraryDialog } from "@/components/library/EditLibraryDialog";
import { LibraryCard } from "@/components/library/LibraryCard";
import { LibraryPresetGrid } from "@/components/library/LibraryPresetGrid";
import { Button } from "@/components/ui/button";
import {
  sortLibrariesByUsage,
  type ImageLibrarySummary,
} from "@/lib/libraries";

import type { LibraryPreset } from "../../shared/library-presets";

export default function BrandKitsIndexPage() {
  const t = useT();
  const navigate = useNavigate();
  const { data, isLoading } = useActionQuery("list-libraries", {});
  const { data: presetData } = useActionQuery("list-library-presets", {});
  const createFromPreset = useActionMutation("create-library-from-preset");
  const duplicateLibrary = useActionMutation("duplicate-library");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ImageLibrarySummary | null>(null);
  const [creatingPresetId, setCreatingPresetId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
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
          navigate(`/brand-kits/${library.id}`);
        },
        onError: (error: Error) => {
          setCreatingPresetId(null);
          toast.error(error.message || t("brandKits.presetCreateFailed"));
        },
      },
    );
  }

  function duplicateBrandKit(library: ImageLibrarySummary) {
    if (duplicatingId) return;
    setDuplicatingId(library.id);
    duplicateLibrary.mutate(
      { id: library.id },
      {
        onSuccess: (copy: any) => {
          setDuplicatingId(null);
          toast.success(t("brandKits.duplicateCreated"));
          navigate(`/brand-kits/${copy.id}`);
        },
        onError: (error: Error) => {
          setDuplicatingId(null);
          toast.error(error.message || t("brandKits.duplicateFailed"));
        },
      },
    );
  }

  return (
    <PageShell
      title={t("brandKits.title")}
      description={t("brandKits.description")}
    >
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            {t("brandKits.yourBrandKits")}
          </h2>
          <p className="mt-1 w-full text-sm text-muted-foreground">
            {t("brandKits.yourBrandKitsDescription")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-10 flex-1 items-center gap-2 rounded-md border border-border bg-background px-3">
            <IconSearch className="h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("brandKits.searchPlaceholder")}
              className="h-full flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <Button
            variant="outline"
            onClick={() => setOpen(true)}
            className="gap-2"
          >
            <IconPhotoPlus className="h-4 w-4" />
            {t("brandKits.newBrandKit")}
          </Button>
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
                to={`/brand-kits/${library.id}`}
                onEdit={() => setEditing(library)}
                onDuplicate={() => duplicateBrandKit(library)}
                duplicatePending={duplicatingId === library.id}
                showInstructions={false}
              />
            ))}
          </div>
        ) : (
          <div className="p-6">
            <div className="mx-auto max-w-2xl text-center">
              <IconPalette className="mx-auto h-10 w-10 text-muted-foreground" />
              <h3 className="mt-4 text-base font-semibold">
                {t("brandKits.emptyTitle")}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {t("brandKits.emptyDescription")}
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
                {t("brandKits.newBrandKitLower")}
              </Button>
              <Button asChild variant="outline">
                <Link to="/">{t("brandKits.createAsset")}</Link>
              </Button>
            </div>
          </div>
        )}
      </section>

      <CreateLibraryDialog
        open={open}
        onOpenChange={setOpen}
        onCreated={(library) => navigate(`/brand-kits/${library.id}`)}
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
