import { useState } from "react";
import { IconPlus, IconTarget } from "@tabler/icons-react";
import { useActionQuery } from "@agent-native/core/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TrackerLibrary } from "@/components/trackers/tracker-library";
import { TrackerEditor } from "@/components/trackers/tracker-editor";

export function meta() {
  return [{ title: "Trackers · Calls" }];
}

interface Tracker {
  id: string;
  name: string;
  description?: string | null;
  keywords?: string[];
  hitCount?: number;
}

export default function TrackersRoute() {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data, isLoading, refetch } = useActionQuery<{ trackers: Tracker[] }>(
    "list-trackers",
  );
  const trackers = data?.trackers ?? [];

  function openNew() {
    setEditingId(null);
    setEditorOpen(true);
  }

  function openEdit(id: string) {
    setEditingId(id);
    setEditorOpen(true);
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="flex items-center gap-3 px-6 py-4 border-b border-border shrink-0">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <IconTarget className="h-6 w-6 text-[#625DF5]" />
            Trackers
          </h1>
          <p className="text-xs text-muted-foreground">
            Watch for keywords and topics across every call
          </p>
        </div>
        <Button
          onClick={openNew}
          className="bg-[#625DF5] hover:bg-[#5049d9] text-white gap-1.5"
          size="sm"
        >
          <IconPlus className="h-4 w-4" />
          New tracker
        </Button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto p-6">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-md" />
            ))}
          </div>
        ) : trackers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="h-16 w-16 rounded-full bg-[#625DF5]/10 flex items-center justify-center mb-4">
              <IconTarget className="h-8 w-8 text-[#625DF5]" />
            </div>
            <h2 className="text-lg font-semibold mb-1">No trackers yet</h2>
            <p className="text-sm text-muted-foreground max-w-sm mb-6">
              Create a tracker to watch for pricing objections, competitors, or
              any topic you care about.
            </p>
            <Button
              onClick={openNew}
              className="bg-[#625DF5] hover:bg-[#5049d9] text-white gap-1.5"
            >
              <IconPlus className="h-4 w-4" />
              Create tracker
            </Button>
          </div>
        ) : (
          <TrackerLibrary trackers={trackers} onEdit={openEdit} />
        )}
      </div>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit tracker" : "New tracker"}
            </DialogTitle>
          </DialogHeader>
          <TrackerEditor
            trackerId={editingId}
            onSaved={() => {
              setEditorOpen(false);
              refetch();
            }}
            onCancel={() => setEditorOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
