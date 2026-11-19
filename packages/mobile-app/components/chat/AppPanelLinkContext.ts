import { createContext, useContext } from "react";

export const AppPanelLinkContext = createContext<
  ((url: string) => void) | null
>(null);
export function useAppPanelLink() {
  return useContext(AppPanelLinkContext);
}
