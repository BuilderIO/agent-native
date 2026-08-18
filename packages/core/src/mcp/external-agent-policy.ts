/**
 * Policy for the default authenticated external-agent connector surface.
 *
 * The policy is intentionally narrow: "auto" only discovers actions that
 * explicitly opt into authenticated, read-only public-agent exposure. It
 * never makes an unannotated action callable and never grants writes.
 */
export interface ExternalAgentPolicy {
  /** Automatically advertise authenticated GET/read-only public-agent actions. */
  authenticatedReads?: "off" | "auto";
  /**
   * Keep writes behind `ask_app` by default. `allowlisted` preserves explicit
   * connectorCatalog write exposure for apps that intentionally need it.
   */
  writes?: "ask_app_only" | "allowlisted";
  /** Explicit action names to remove from the derived connector surface. */
  denyActions?: string[];
}
