import { createContext } from "react";

export interface PortTarget {
  node: string;
  port: string;
}

/**
 * Opens the step creator so the new step goes after one output of one step.
 * The creator is a side sheet, so `handle` (the output's element) is not an
 * anchor. Null when the canvas cannot be edited, so a handle there is only a dot.
 */
export const PortPickerContext = createContext<
  ((target: PortTarget, handle: HTMLElement) => void) | null
>(null);
