

export type TailwindBreakpointPrefix =
  | "base"
  | "sm"
  | "md"
  | "lg"
  | "xl"
  | "2xl";

export interface BreakpointDefinition {
  id: string;
  label: string;
  widthPx: number;
  prefix: TailwindBreakpointPrefix;
}

export interface BreakpointSet {
  id: string;
  breakpoints: BreakpointDefinition[];
}


export const DESIGN_STATE_KINDS = ["state", "fixture", "capture"] as const;

export type DesignStateKind = (typeof DESIGN_STATE_KINDS)[number];

export const DESIGN_STATE_BREAKPOINTS = [
  "auto",
  "desktop",
  "tablet",
  "mobile",
] as const;

export type DesignStateBreakpoint = (typeof DESIGN_STATE_BREAKPOINTS)[number];

export interface DesignState {
  id: string;
  designId: string;
  sourceRef: string | null;
  name: string;
  kind: DesignStateKind;
  breakpoint: DesignStateBreakpoint;
  route?: string;
  fixtureData: Record<string, unknown> | null;
  captureData: Record<string, unknown> | null;
  previewRef: string | null;
  createdAt: string;
  updatedAt: string;
}
