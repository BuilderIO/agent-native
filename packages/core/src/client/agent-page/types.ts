/**
 * Shared contracts for the full-page Agent surface (`AgentTabsPage`).
 *
 * Ownership note for concurrent implementation work: the page shell and the
 * Files/MCP/Connect tabs may ADD exports here; the Context and Jobs tab
 * implementations consume these types but must not edit this file.
 */

/** Which configuration scope the page-level toggle is showing. */
export type AgentPageScope = "user" | "org";

/** Props every Agent page tab receives from the page shell. */
export interface AgentPageTabProps {
  /** Current scope selected by the page-level Personal/Organization toggle. */
  scope: AgentPageScope;
  /** Whether the current user can administer org-scoped agent config. */
  canManageOrg?: boolean;
}
