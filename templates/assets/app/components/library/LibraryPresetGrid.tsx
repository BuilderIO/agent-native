import { appPath } from "@agent-native/core/client";
import { IconBox, IconBrush, IconLayersIntersect } from "@tabler/icons-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import type { LibraryPreset } from "../../../shared/library-presets";

const PRESET_ICONS = [IconBox, IconBrush, IconLayersIntersect];

export function LibraryPresetGrid({
  presets,
  creatingId,
  onCreate,
  compact = false,
}: {
  presets: LibraryPreset[];
  creatingId?: string | null;
  onCreate: (presetId: string) => void;
  compact?: boolean;
}) {
  if (!presets.length) return null;

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {presets.map((preset, index) => {
        const Icon = PRESET_ICONS[index % PRESET_ICONS.length];
        const colors = preset.styleBrief.palette ?? [];
        const loading = creatingId === preset.id;
        const references = preset.referenceImages ?? [];
        return (
          <article
            key={preset.id}
            className="flex min-h-36 flex-col rounded-lg border border-border bg-card p-4 text-card-foreground"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold">
                    {preset.title}
                  </h3>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {preset.tags.slice(0, compact ? 2 : 3).map((tag) => (
                      <Badge key={tag} variant="secondary">
                        {tag}
                      </Badge>
                    ))}
                    {references.length ? (
                      <Badge variant="outline">{references.length} refs</Badge>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                {colors.slice(0, 4).map((color) => (
                  <span
                    key={color}
                    className="h-3 w-3 rounded-full border border-border"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>

            <p className="mt-3 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
              {preset.description}
            </p>

            {references.length ? (
              <div className="mt-3 grid grid-cols-3 gap-1 overflow-hidden rounded-md border border-border bg-muted p-1">
                {references.slice(0, 3).map((reference) => (
                  <img
                    key={reference.id}
                    src={appPath(reference.path)}
                    alt={reference.title}
                    className="aspect-[4/3] w-full rounded-sm object-cover"
                    loading="lazy"
                  />
                ))}
              </div>
            ) : null}

            {!compact && preset.samplePrompts[0] ? (
              <p className="mt-3 mb-3 line-clamp-1 text-xs text-muted-foreground">
                Try: {preset.samplePrompts[0]}
              </p>
            ) : null}

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-auto w-full"
              disabled={loading}
              onClick={() => onCreate(preset.id)}
            >
              {loading ? "Creating..." : "Use preset"}
            </Button>
          </article>
        );
      })}
    </div>
  );
}
