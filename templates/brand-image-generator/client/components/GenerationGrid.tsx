import type { GenerationOutput } from "@shared/types";
import { Download } from "lucide-react";

interface GenerationGridProps {
  outputs: GenerationOutput[];
}

export function GenerationGrid({ outputs }: GenerationGridProps) {
  if (!outputs || outputs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No images generated yet.</p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {outputs.map((output) => (
        <div
          key={output.filename}
          className="group relative overflow-hidden rounded-lg border border-border bg-card"
        >
          <img
            src={`/api/generated/${output.filename}`}
            alt={output.filename}
            className="aspect-square w-full object-cover"
          />
          <a
            href={`/api/generated/${output.filename}`}
            download={output.filename}
            className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
            aria-label={`Download ${output.filename}`}
          >
            <Download className="h-4 w-4" />
          </a>
        </div>
      ))}
    </div>
  );
}
