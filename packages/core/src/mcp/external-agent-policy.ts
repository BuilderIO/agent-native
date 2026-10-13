export interface ExternalAgentPolicy {
  authenticatedReads?: "off" | "auto";
  writes?: "ask_app_only" | "allowlisted";
  denyActions?: string[];
}
