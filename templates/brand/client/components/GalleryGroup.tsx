import { Trash2 } from "lucide-react";
import type { GenerationRecord } from "@shared/types";
import { useDeleteGeneration } from "@/hooks/use-generations";
import { GenerationGrid } from "@/components/GenerationGrid";

interface GalleryGroupProps {
  generation: GenerationRecord;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function modelLabel(model: string): string {
  if (model.includes("pro")) return "Pro";
  if (model.includes("flash")) return "Flash";
  return model;
}

export function GalleryGroup({ generation }: GalleryGroupProps) {
  const deleteGeneration = useDeleteGeneration();

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-medium text-foreground">
            {generation.prompt}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {formatDate(generation.createdAt)} &middot;{" "}
            {modelLabel(generation.model)} &middot;{" "}
            {generation.outputs.length} image
            {generation.outputs.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={() => deleteGeneration.mutate(generation.id)}
          disabled={deleteGeneration.isPending}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          aria-label="Delete generation"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <GenerationGrid outputs={generation.outputs} />
    </div>
  );
}
