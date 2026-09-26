
export type AgentPageScope = "user" | "org";

export interface AgentPageTabProps {
  scope: AgentPageScope;
  canManageOrg?: boolean;
}
