export interface DispatchAuthConfig {
  googleOnly?: boolean;
  workspaceAppPublicPaths?: string[];
  marketing?: Record<string, unknown>;
  publicPaths?: string[];
}

export interface DispatchIntegrationsConfig {
  systemPrompt?: string | ((defaultPrompt: string) => string);
}

export interface DispatchConfig {
  auth?: DispatchAuthConfig;
  browserExtensionIds?: readonly string[];
  hiddenAgentIds?: string[];
  /**
   * Set false in a self-hosted workspace to hide every Builder-hosted app
   * (the built-in catalog and the curated "Other apps" list). Defaults to true.
   */
  hostedCatalog?: boolean;
  integrations?: DispatchIntegrationsConfig;
}
