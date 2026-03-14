import { createContext, useContext, useState, type ReactNode } from "react";
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

export interface HarnessConfigContextValue {
  config: HarnessConfig;
  configs: HarnessConfig[];
  switchHarness: (command: string) => void;
}

const ACTIVE_HARNESS_KEY = "harness-active-cli";

const ConfigContext = createContext<HarnessConfigContextValue | null>(null);

export function HarnessConfigProvider({
  configs,
  children,
}: {
  configs: HarnessConfig[];
  children: ReactNode;
}) {
  const [activeCommand, setActiveCommand] = useState(() => {
    const saved = localStorage.getItem(ACTIVE_HARNESS_KEY);
    if (saved && configs.some((c) => c.command === saved)) return saved;
    return configs[0].command;
  });

  const config = configs.find((c) => c.command === activeCommand) || configs[0];

  const switchHarness = (command: string) => {
    localStorage.setItem(ACTIVE_HARNESS_KEY, command);
    setActiveCommand(command);
  };

  return React.createElement(
    ConfigContext.Provider,
    { value: { config, configs, switchHarness } },
    children,
  );
}

export function useHarnessConfig(): HarnessConfig {
  const ctx = useContext(ConfigContext);
  if (!ctx)
    throw new Error(
      "useHarnessConfig must be used within HarnessConfigProvider",
    );
  return ctx.config;
}

export function useHarnessConfigs(): HarnessConfigContextValue {
  const ctx = useContext(ConfigContext);
  if (!ctx)
    throw new Error(
      "useHarnessConfigs must be used within HarnessConfigProvider",
    );
  return ctx;
}
