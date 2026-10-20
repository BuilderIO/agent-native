import type { DesignCapabilityName } from "./design-source-capabilities";
import type { DesignSourceType } from "./source-mode";

export interface DesignSurfaceSourceMeta {
  sourceType: DesignSourceType;
  sourceRef: string;
  contentHash?: string;
  indexedAt: string;
  availableCapabilities: DesignCapabilityName[];
}

export interface DesignSurfaceNode {
  nodeId: string;
  layerName: string;
  tag: string;
  selector: string;
  parentNodeId?: string;
  childNodeIds: string[];
  selected?: boolean;
}

export type DesignComponentKind = "alpine-annotation" | "react-component";

export interface DesignSurfaceComponentProp {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: unknown;
  enumValues?: string[];
}

export interface DesignSurfaceComponent {
  componentId: string;
  kind: DesignComponentKind;
  name: string;
  filePath?: string;
  exportName?: string;
  props?: DesignSurfaceComponentProp[];
  variants?: Record<string, string[]>;
  instanceNodeIds: string[];
}

export type DesignTokenKind =
  | "color"
  | "typography"
  | "spacing"
  | "radius"
  | "shadow"
  | "motion"
  | "other";

export interface DesignSurfaceToken {
  tokenId: string;
  kind: DesignTokenKind;
  label: string;
  cssVar: string;
  resolvedValue: string;
  sourceFile?: string;
}

export interface DesignSurfaceMotionTrack {
  targetNodeId: string;
  property: string;
  keyframeCount: number;
}

export interface DesignSurfaceMotionTimeline {
  timelineId: string;
  sourceRef: string;
  durationMs: number;
  tracks: DesignSurfaceMotionTrack[];
  compiledHash?: string;
}

export type DesignStateKind = "state" | "fixture" | "capture";

export type DesignBreakpoint = "auto" | "desktop" | "tablet" | "mobile";

export interface DesignSurfaceState {
  stateId: string;
  kind: DesignStateKind;
  name: string;
  breakpoint: DesignBreakpoint;
  route?: string;
  hasData: boolean;
  previewRef?: string;
}

export type DesignReviewFindingSeverity = "error" | "warning" | "info";

export type DesignReviewFindingKind =
  | "contrast"
  | "tap-target"
  | "focus-visibility"
  | "missing-alt"
  | "missing-label"
  | "missing-role"
  | "reduced-motion"
  | "other";

export interface DesignReviewFinding {
  findingId: string;
  severity: DesignReviewFindingSeverity;
  kind: DesignReviewFindingKind;
  message: string;
  nodeId?: string;
  selector?: string;
  fixAvailable: boolean;
}

export interface DesignSurfaceReview {
  snapshotId: string | null;
  auditedAt: string | null;
  findings: DesignReviewFinding[];
  baseVersionId?: string;
  compareVersionId?: string;
}

export interface DesignSurfaceIndex {
  version: 1;

  source: DesignSurfaceSourceMeta;

  nodes?: Record<string, DesignSurfaceNode>;

  components?: DesignSurfaceComponent[];

  tokens?: DesignSurfaceToken[];

  motion?: Record<string, DesignSurfaceMotionTimeline>;

  states?: DesignSurfaceState[];

  review?: DesignSurfaceReview;
}
