import { useMemo, useState } from "react";
import { useActionQuery, useActionMutation } from "@agent-native/core/client";
import { useQueryClient } from "@tanstack/react-query";
import {
  IconPlus,
  IconTarget,
  IconBrain,
  IconEdit,
  IconTrash,
  IconSparkles,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
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
import { cn } from "@/lib/utils";
import { TrackerEditor, type TrackerEditorValue } from "./tracker-editor";
import { toast } from "sonner";

interface TrackerRow {
  id: string;
  name: string;
  description: string | null;
  kind: "keyword" | "smart";
  keywords: string[];
  classifierPrompt: string | null;
  color: string;
  enabled: boolean;
  isDefault: boolean;
  hitCount30d?: number;
}

interface TrackerLibraryProps {
  workspaceId?: string;
  className?: string;
  trackers?: any[];
  onEdit?: (id: string) => void;
}

export function TrackerLibrary({
  workspaceId,
  className,
  trackers: trackersProp,
  onEdit,
}: TrackerLibraryProps) {
  const qc = useQueryClient();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<
    Partial<TrackerEditorValue> | undefined
  >(undefined);
  const [query, setQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState<TrackerRow | null>(null);

  const { data, isLoading: queryLoading } = useActionQuery<{
    trackers: TrackerRow[];
  }>("list-trackers", workspaceId ? { workspaceId } : undefined, {
    enabled: !trackersProp,
  });
  const trackers = trackersProp ?? data?.trackers ?? [];
  const isLoading = trackersProp ? false : queryLoading;
  void onEdit;

  const toggleTracker = useActionMutation<
    any,
    { id: string; enabled: boolean }
  >("update-tracker");
  const deleteTracker = useActionMutation<any, { id: string }>(
    "delete-tracker",
  );

  const hasDefaults = useMemo(
    () => trackers.some((t) => t.isDefault),
    [trackers],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return trackers;
    return trackers.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q) ||
        t.keywords.some((k) => k.toLowerCase().includes(q)),
    );
  }, [trackers, query]);

  async function handleToggle(t: TrackerRow, next: boolean) {
    try {
      await toggleTracker.mutateAsync({ id: t.id, enabled: next });
      qc.invalidateQueries({ queryKey: ["action", "list-trackers"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return;
    try {
      await deleteTracker.mutateAsync({ id: pendingDelete.id });
      qc.invalidateQueries({ queryKey: ["action", "list-trackers"] });
      toast.success(`Deleted "${pendingDelete.name}"`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setPendingDelete(null);
    }
  }

  function openNew() {
    setEditing(undefined);
    setEditorOpen(true);
  }

  function openEdit(t: TrackerRow) {
    setEditing({
      id: t.id,
      name: t.name,
      description: t.description ?? "",
      kind: t.kind,
      keywords: t.keywords,
      classifierPrompt: t.classifierPrompt ?? "",
      color: t.color,
      enabled: t.enabled,
    });
    setEditorOpen(true);
  }

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Trackers</h1>
          <p className="text-sm text-muted-foreground mt-0.5 max-w-xl">
            Trackers flag moments in your calls — by keyword or by an
            instruction we run against the transcript.
          </p>
        </div>
        <Button onClick={openNew} className="gap-1.5 shrink-0">
          <IconPlus className="h-4 w-4" />
          New tracker
        </Button>
      </div>

      {hasDefaults && (
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
          <IconSparkles className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
          <p className="text-muted-foreground">
            We added 7 default trackers to get you started. Edit, disable, or
            delete them to fit your team.
          </p>
        </div>
      )}

      <div className="flex items-center">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search trackers…"
          className="max-w-xs"
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyTrackers onCreate={openNew} />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((t) => (
            <TrackerCard
              key={t.id}
              tracker={t}
              onEdit={() => openEdit(t)}
              onDelete={() => setPendingDelete(t)}
              onToggle={(v) => handleToggle(t, v)}
            />
          ))}
        </div>
      )}

      <TrackerEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        initial={editing}
        workspaceId={workspaceId}
      />

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete tracker?</AlertDialogTitle>
            <AlertDialogDescription>
              "{pendingDelete?.name}" and all its hits across your calls will be
              removed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TrackerCard({
  tracker,
  onEdit,
  onDelete,
  onToggle,
}: {
  tracker: TrackerRow;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: (next: boolean) => void;
}) {
  const preview =
    tracker.kind === "keyword"
      ? tracker.keywords.slice(0, 4).join(", ") || "No keywords yet"
      : tracker.classifierPrompt?.trim() || "No instruction yet";

  return (
    <Card className={cn("flex flex-col", !tracker.enabled && "opacity-60")}>
      <CardContent className="p-4 flex flex-col gap-3 h-full">
        <div className="flex items-start gap-2">
          <span
            className="mt-1 h-2.5 w-2.5 rounded-full shrink-0"
            style={{ background: tracker.color }}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <div className="truncate text-sm font-semibold text-foreground">
                {tracker.name}
              </div>
              {tracker.kind === "keyword" ? (
                <IconTarget className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              ) : (
                <IconBrain className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              )}
            </div>
            {tracker.description && (
              <div className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                {tracker.description}
              </div>
            )}
          </div>
          <Switch
            checked={tracker.enabled}
            onCheckedChange={(v) => onToggle(!!v)}
          />
        </div>

        <div
          className={cn(
            "rounded-md bg-muted/40 px-2.5 py-1.5 text-xs line-clamp-2 min-h-[2.5rem]",
            tracker.kind === "smart" && "italic",
          )}
        >
          {preview}
        </div>

        <div className="flex items-center justify-between mt-auto">
          <div className="text-[11px] text-muted-foreground tabular-nums">
            {tracker.hitCount30d != null ? (
              <>
                <span className="font-medium text-foreground">
                  {tracker.hitCount30d.toLocaleString()}
                </span>{" "}
                hits · 30d
              </>
            ) : (
              <span>No hits yet</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={onEdit}
              aria-label="Edit tracker"
            >
              <IconEdit className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={onDelete}
              aria-label="Delete tracker"
            >
              <IconTrash className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyTrackers({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <IconTarget className="h-7 w-7 text-muted-foreground" />
      </div>
      <div>
        <div className="text-sm font-semibold text-foreground">
          No trackers yet
        </div>
        <p className="text-xs text-muted-foreground max-w-xs mt-1">
          Create keyword or smart trackers to surface the moments that matter —
          pricing objections, competitor mentions, next steps, and more.
        </p>
      </div>
      <Button onClick={onCreate} size="sm" className="gap-1.5">
        <IconPlus className="h-4 w-4" />
        Create your first tracker
      </Button>
    </div>
  );
}
