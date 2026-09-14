import { createContext, useContext, type ReactNode } from "react";

export const SidebarTriggerContext = createContext<ReactNode>(null);

export function useSidebarTrigger() {
  return useContext(SidebarTriggerContext);
}
