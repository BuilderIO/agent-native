/**
 * Configuration shape for `setupDispatch(config)`. Captures every workspace
 * customization point we identified during the framework→workspace drift
 * audit so consumers can express their environment without forking source.
 */

export interface DispatchAuthConfig {
  /**
   * When true, only Google OAuth is shown on the login screen and other
   * providers are hidden. Used by Builder's own workspace, which enforces
   * Google SSO for its org.
   */
  googleOnly?: boolean;
  /** Marketing/branding copy passed straight through to `createAuthPlugin`. */
  marketing?: Record<string, unknown>;
}

export interface DispatchIntegrationsConfig {
  /**
   * Append or replace the integrations agent's system-prompt guidance.
   * Pass a string to replace the default; pass a function to mutate it.
   */
  systemPrompt?: string | ((defaultPrompt: string) => string);
}

export interface DispatchConfig {
  auth?: DispatchAuthConfig;
  /**
   * App IDs to hide from `list-connected-agents` results. Used to filter
   * out first-party Builder apps (calls, issues, macros, …) from the
   * Connected Agents list when those apps aren't shipped to end users.
   */
  hiddenAgentIds?: string[];
  integrations?: DispatchIntegrationsConfig;
}
