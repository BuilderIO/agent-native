export interface DispatchAuthConfig {
  googleOnly?: boolean;
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
  integrations?: DispatchIntegrationsConfig;
}
