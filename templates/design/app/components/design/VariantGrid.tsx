import { useState } from "react";
import { IconCheck } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Variant {
  id: string;
  label: string;
  content: string;
}

interface VariantGridProps {
  variants: Variant[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onUse: (id: string) => void;
}

export function VariantGrid({
  variants,
  selectedId,
  onSelect,
  onUse,
}: VariantGridProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Determine grid layout based on variant count
  const gridClass =
    variants.length === 2
      ? "grid-cols-2"
      : variants.length === 3
        ? "grid-cols-3"
        : "grid-cols-2";

  return (
    <div className="flex h-full w-full flex-col bg-background p-6">
      <div className={cn("grid flex-1 gap-4", gridClass)}>
        {variants.map((variant) => {
          const isSelected = selectedId === variant.id;
          const isHovered = hoveredId === variant.id;

          return (
            <div
              key={variant.id}
              className="flex flex-col gap-2"
              onMouseEnter={() => setHoveredId(variant.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              {/* Preview frame */}
              <div
                onClick={() => onSelect(variant.id)}
                className={cn(
                  "relative flex-1 cursor-pointer overflow-hidden rounded-lg border-2 bg-muted/10",
                  isSelected
                    ? "border-primary"
                    : "border-transparent hover:border-muted-foreground/30",
                )}
              >
                {/* Scaled iframe preview */}
                <iframe
                  srcDoc={wrapContent(variant.content)}
                  className="pointer-events-none h-full w-full origin-top-left"
                  style={{
                    width: "200%",
                    height: "200%",
                    transform: "scale(0.5)",
                  }}
                  sandbox="allow-same-origin"
                  title={variant.label}
                />

                {/* Selection indicator */}
                {isSelected && (
                  <div className="absolute top-2 right-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary">
                    <IconCheck className="h-3 w-3 text-primary-foreground" />
                  </div>
                )}

                {/* Hover overlay with "Use this one" */}
                {isHovered && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                    <Button
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onUse(variant.id);
                      }}
                    >
                      Use this one
                    </Button>
                  </div>
                )}
              </div>

              {/* Label */}
              <span
                className={cn(
                  "text-center text-xs",
                  isSelected
                    ? "font-medium text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {variant.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Wrap raw HTML content in a minimal document for the iframe */
function wrapContent(content: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0a0a0a; overflow: hidden; }
  </style>
</head>
<body>${content}</body>
</html>`;
}
