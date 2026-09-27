import { createContext, useContext } from "react";

const ShellSettledContext = createContext(false);

export const ShellSettledProvider = ShellSettledContext.Provider;

export function useShellSettled(): boolean {
  return useContext(ShellSettledContext);
}
