import { createContext, useContext, type ReactNode } from "react";

export type PreviewControls = {
  slot: HTMLElement | null;
  rowMenu: ReactNode;
  touch: boolean;
  discussionInMenu: boolean;
};

export const PreviewControlsContext = createContext<PreviewControls | null>(
  null,
);

export function usePreviewControls() {
  return useContext(PreviewControlsContext);
}
