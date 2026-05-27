import { Link } from "react-router";
import { IconDots, IconLibraryPhoto, IconPencil } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  getLibraryCustomInstructions,
  type ImageLibrarySummary,
} from "@/lib/libraries";
import { assetMediaUrl } from "@/lib/asset-urls";

export function LibraryCard({
  library,
  to,
  selected,
  onClick,
  onEdit,
  compact = false,
  showInstructions = !compact,
}: {
  library: ImageLibrarySummary;
  to?: string;
  selected?: boolean;
  onClick?: () => void;
  onEdit?: () => void;
  compact?: boolean;
  showInstructions?: boolean;
}) {
  const instructions = getLibraryCustomInstructions(library);
  const coverThumbnailUrl = assetMediaUrl(library.coverAsset?.thumbnailUrl);
  const className = cn(
    "group flex h-full w-full min-w-0 flex-col overflow-hidden rounded-lg border bg-card text-left text-card-foreground transition hover:border-foreground/30",
    compact ? "min-h-0" : "min-h-32",
    selected && "border-foreground/40 ring-2 ring-ring/20",
  );

  const body = (
    <>
      <div
        className={cn(
          "relative flex items-center justify-center overflow-hidden bg-muted",
          compact ? "aspect-[16/8]" : "aspect-[16/9]",
        )}
      >
        <IconLibraryPhoto className="h-8 w-8 text-muted-foreground" />
        {coverThumbnailUrl ? (
          <img
            src={coverThumbnailUrl}
            alt=""
            onError={(event) => {
              event.currentTarget.hidden = true;
            }}
            className="absolute inset-0 h-full w-full object-cover transition group-hover:scale-[1.02]"
          />
        ) : null}
      </div>
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col",
          compact ? "gap-2 p-3" : "gap-3 p-4",
        )}
      >
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground">
            {library.title}
          </div>
          {!compact ? (
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {library.description || "No description yet"}
            </p>
          ) : null}
        </div>
        {showInstructions && instructions ? (
          <div className="rounded-md border bg-muted/30 px-3 py-2">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Instructions
            </div>
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {instructions}
            </p>
          </div>
        ) : null}
        <div className="mt-auto flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{library.referenceCount ?? 0} refs</Badge>
          <Badge variant="outline">{library.generatedCount ?? 0} assets</Badge>
          {(library as any).videoCount ? (
            <Badge variant="outline">
              {(library as any).videoCount} videos
            </Badge>
          ) : null}
        </div>
      </div>
    </>
  );

  const editAffordance = onEdit ? (
    <div className="absolute right-2 top-2 z-10">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="h-8 w-8 shadow-sm opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 data-[state=open]:opacity-100"
            aria-label="Library actions"
          >
            <IconDots className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onEdit()}>
            <IconPencil className="mr-2 h-4 w-4 shrink-0" />
            Edit
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  ) : null;

  if (to) {
    return (
      <div className="relative h-full w-full min-w-0">
        <Link to={to} className={className}>
          {body}
        </Link>
        {editAffordance}
      </div>
    );
  }

  return (
    <div className="relative h-full w-full min-w-0">
      <button type="button" onClick={onClick} className={className}>
        {body}
      </button>
      {editAffordance}
    </div>
  );
}
