import { Link } from "react-router";
import { IconDatabase } from "@tabler/icons-react";
import { useCodeMode } from "../use-dev-mode.js";
import { appPath } from "../api-path.js";
import { cn } from "../utils.js";

export interface DevDatabaseLinkProps {
  className?: string;
  /** Route path for the DB admin page. Defaults to `/database`. */
  to?: string;
}

/**
 * Code-mode-only entry point to the database admin.
 *
 * Renders a compact footer link (designed to sit next to `FeedbackButton` /
 * `OrgSwitcher` in a template's sidebar footer) ONLY when the app can toggle
 * into Code mode (`useCodeMode().canToggle`). When it can't, it renders
 * nothing, so it is safe to drop into every template's chrome unconditionally.
 *
 * The page it links to (`/database`) and its backing routes are independently
 * gated on the server, so this is purely a convenience affordance — never a
 * security boundary.
 */
export function DevDatabaseLink({
  className,
  to = "/database",
}: DevDatabaseLinkProps) {
  const { canToggle } = useCodeMode();
  if (!canToggle) return null;
  return (
    <Link
      to={appPath(to)}
      title="Database admin — Code mode only"
      className={cn(
        "flex w-full items-center gap-2 rounded-md border border-border/50 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <IconDatabase className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 truncate text-left">Database</span>
      <span className="rounded bg-muted px-1 py-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
        code
      </span>
    </Link>
  );
}
