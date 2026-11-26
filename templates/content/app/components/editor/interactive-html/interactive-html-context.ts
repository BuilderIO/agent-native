import type { InteractiveHtmlDisplaySources } from "@shared/interactive-html";
import { createContext } from "react";

export interface InteractiveHtmlContextValue {
  runsOnOpen: boolean;
  displaySources: InteractiveHtmlDisplaySources | null;
  fullScreenPos: number | null;
  onFullScreenClosed: () => void;
  copyLink: ((pos: number) => void) | null;
}

export const InteractiveHtmlContext =
  createContext<InteractiveHtmlContextValue>({
    runsOnOpen: false,
    displaySources: null,
    fullScreenPos: null,
    onFullScreenClosed: () => {},
    copyLink: null,
  });
