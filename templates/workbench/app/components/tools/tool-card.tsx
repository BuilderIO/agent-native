import { Link } from "react-router";
import {
  IconLayoutGrid,
  IconBuilding,
  IconLock,
  IconUsers,
  IconWorld,
} from "@tabler/icons-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type ToolVisibility = "private" | "org" | "public" | null | undefined;

export interface ToolCardData {
  id: string;
  name: string;
  description?: string | null;
  ownerEmail?: string | null;
  visibility?: ToolVisibility;
  /** True when the current user is not the owner — used to render "Shared with you". */
  sharedWithMe?: boolean;
}

interface ToolCardProps {
  tool: ToolCardData;
  /** Optional overflow menu (Edit / Share / Delete). Rendered top-right. */
  menu?: React.ReactNode;
}

/**
 * Single Custom Tool card for the `/extensions` grid.
 *
 * Whole card is a Link to /extensions/:id. The overflow menu sits as an absolutely
 * positioned child so it doesn't trigger navigation. Visibility is shown as a
 * small badge with a Tabler icon; `public` is included for defensiveness but
 * the framework registration disallows it for extensions.
 */
export function ToolCard({ tool, menu }: ToolCardProps) {
  const ownerHandle = formatOwnerHandle(tool.ownerEmail);
  return (
    <Card className="group relative h-full overflow-hidden border-border transition-all hover:-translate-y-px hover:border-primary/30 hover:shadow-md">
      <Link
        to={`/extensions/${tool.id}`}
        className="flex h-full flex-col px-5 py-5 pr-12"
        prefetch="intent"
      >
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
          <IconLayoutGrid size={20} aria-hidden />
        </div>
        <h3 className="mb-1 line-clamp-1 text-sm font-semibold text-foreground">
          {tool.name}
        </h3>
        {tool.description ? (
          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {tool.description}
          </p>
        ) : (
          <p className="text-xs italic text-muted-foreground/60">
            No description yet.
          </p>
        )}
        <div className="mt-auto flex items-center gap-2 pt-4 text-[11px] text-muted-foreground">
          {ownerHandle ? (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <Avatar label={ownerHandle} />
              <span className="truncate">{ownerHandle}</span>
            </span>
          ) : null}
          {tool.visibility ? (
            <VisibilityBadge
              visibility={tool.visibility}
              sharedWithMe={tool.sharedWithMe}
            />
          ) : null}
        </div>
      </Link>
      {menu ? (
        <div className="absolute right-3 top-3 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          {menu}
        </div>
      ) : null}
    </Card>
  );
}

function Avatar({ label }: { label: string }) {
  return (
    <span
      aria-hidden
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground"
    >
      {(label.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

function VisibilityBadge({
  visibility,
  sharedWithMe,
}: {
  visibility: NonNullable<ToolVisibility>;
  sharedWithMe?: boolean;
}) {
  // "Shared with org" or "Shared with you" wins over the literal visibility
  // label — that's the dimension users care about on a card.
  if (sharedWithMe) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full bg-accent/60 px-2 py-0.5 text-[10px] font-medium text-accent-foreground/80",
        )}
      >
        <IconUsers size={11} aria-hidden />
        Shared with you
      </span>
    );
  }
  if (visibility === "org") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full bg-accent/60 px-2 py-0.5 text-[10px] font-medium text-accent-foreground/80",
        )}
      >
        <IconBuilding size={11} aria-hidden />
        Shared with org
      </span>
    );
  }
  if (visibility === "public") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-accent/60 px-2 py-0.5 text-[10px] font-medium text-accent-foreground/80">
        <IconWorld size={11} aria-hidden />
        Public
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      <IconLock size={11} aria-hidden />
      Private
    </span>
  );
}

function formatOwnerHandle(email?: string | null): string | null {
  if (!email) return null;
  const local = email.split("@")[0];
  return local || email;
}
