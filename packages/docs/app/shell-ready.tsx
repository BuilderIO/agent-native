import { createContext, useContext } from "react";

const ShellSettledContext = createContext(false);
const AssistantLoadingContext = createContext(false);
const AssistantReadyContext = createContext<() => Promise<void>>(() =>
  Promise.resolve(),
);

export const ShellSettledProvider = ShellSettledContext.Provider;
export const AssistantLoadingProvider = AssistantLoadingContext.Provider;
export const AssistantReadyProvider = AssistantReadyContext.Provider;

export function useAssistantReady(): () => Promise<void> {
  return useContext(AssistantReadyContext);
}

export function useAssistantLoading(): boolean {
  return useContext(AssistantLoadingContext);
}

export function useShellSettled(): boolean {
  return useContext(ShellSettledContext);
}
