export interface DevDatabaseLinkProps {
  className?: string;
  /** Route path for the DB admin page. Defaults to `/database`. */
  to?: string;
}

/**
 * Hidden compatibility component for templates that still include the old
 * database admin footer affordance.
 *
 * The page it links to (`/database`) and its backing routes are independently
 * gated on the server; this component only controls the sidebar chrome.
 */
export function DevDatabaseLink(_props: DevDatabaseLinkProps) {
  return null;
}
