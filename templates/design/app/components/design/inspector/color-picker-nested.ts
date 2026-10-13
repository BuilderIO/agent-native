import type { ReactNode } from "react";

/**
 * A request for the second picker that opens beside the panel, level with the
 * row whose swatch was clicked: one gradient stop, or one shader color.
 */
export interface NestedColorRequest {
  /** The row the picker sits level with. */
  anchor: HTMLElement;
  /** The color being edited. */
  css: string;
  /** A change on its way, such as a drag. */
  onChange: (css: string) => void;
  /** A change that is final: a drag ending, a typed value, a restored color. */
  onCommit: (css: string) => void;
  onClose: () => void;
  /**
   * The color is written for something that reads only opaque sRGB, so the
   * picker offers neither opacity nor the wide-gamut modes.
   */
  opaqueSrgb?: boolean;
}

/**
 * How a pane opens the nested picker. The picker supplies it, so a pane never
 * imports the picker back.
 */
export type RenderNestedColorPicker = (
  request: NestedColorRequest,
) => ReactNode;
