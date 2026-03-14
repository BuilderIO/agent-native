import { createContext, useContext, type ReactNode } from "react";
import React from "react";

export interface HarnessOption {
  key: string;
  flag: string;
  label: string;
  description: string;
  defaultValue: boolean;
}

export interface HarnessConfig {
  /** Display name, e.g. "Claude Code" or "Codex" */
  name: string;
  /** CLI command, e.g. "claude" or "codex" */
  command: string;
  /** npm package to install, e.g. "@anthropic-ai/claude-code" */
  installPackage: string;
  /** Toggle options shown in settings panel */
  options: HarnessOption[];
  /** Placeholder for custom flags input */
  customPlaceholder: string;
}

const ConfigContext = createContext<HarnessConfig | null>(null);

export function HarnessConfigProvider({
  config,
  children,
}: {
  config: HarnessConfig;
  children: ReactNode;
}) {
  return React.createElement(ConfigContext.Provider, { value: config }, children);
}

export function useHarnessConfig(): HarnessConfig {
  const config = useContext(ConfigContext);
  if (!config)
    throw new Error("useHarnessConfig must be used within HarnessConfigProvider");
  return config;
}
