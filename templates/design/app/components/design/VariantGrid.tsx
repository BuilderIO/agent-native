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
  compact?: boolean;
}

export function VariantGrid({
  variants,
  selectedId,
  onSelect,
  onUse,
  compact = false,
}: VariantGridProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const previewScale = compact ? 0.36 : 0.5;
  const previewSize = `${100 / previewScale}%`;

  // The same grid renders both in the full editor and in compact MCP App
  // embeds, so it needs to wrap instead of squeezing previews into slivers.
  const gridClass = compact
    ? variants.length <= 1
      ? "grid-cols-1"
      : variants.length === 2
        ? "grid-cols-1 min-[520px]:grid-cols-2"
        : variants.length === 3
          ? "grid-cols-1 min-[520px]:grid-cols-2 min-[820px]:grid-cols-3"
          : "grid-cols-1 min-[520px]:grid-cols-2 min-[880px]:grid-cols-3"
    : variants.length <= 1
      ? "grid-cols-1"
      : variants.length === 2
        ? "grid-cols-1 sm:grid-cols-2"
        : variants.length === 3
          ? "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"
          : "grid-cols-1 sm:grid-cols-2";

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col overflow-y-auto bg-background",
        compact ? "p-3" : "p-3 sm:p-4 lg:p-6",
      )}
    >
      <div
        className={cn(
          "grid min-h-0 flex-1 gap-3 sm:gap-4",
          compact
            ? "auto-rows-[minmax(190px,1fr)]"
            : "auto-rows-[minmax(260px,1fr)]",
          gridClass,
        )}
      >
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
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onSelect(variant.id);
                }}
                role="button"
                tabIndex={0}
                aria-label={`Use ${variant.label}`}
                className={cn(
                  "relative flex-1 cursor-pointer overflow-hidden rounded-lg border-2 bg-muted/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
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
                    width: previewSize,
                    height: previewSize,
                    transform: `scale(${previewScale})`,
                  }}
                  sandbox="allow-scripts"
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

/** Prepare generated HTML for the iframe preview without changing full docs. */
function wrapContent(content: string): string {
  const previewStyle = `<style data-agent-native-preview>
    *, *::before, *::after { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; }
    body { margin: 0; background: #fff; }
  </style>`;
  const trimmed = content.trim();

  if (/<!doctype\s+html|<html[\s>]/i.test(trimmed)) {
    if (/<\/head>/i.test(trimmed)) {
      return trimmed.replace(/<\/head>/i, `${previewStyle}</head>`);
    }
    return trimmed.replace(
      /<html([^>]*)>/i,
      `<html$1><head>${previewStyle}</head>`,
    );
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  ${previewStyle}
</head>
<body>${trimmed}</body>
</html>`;
}
