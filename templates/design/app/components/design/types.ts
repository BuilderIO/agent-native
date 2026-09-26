import type {
  ElementProvenance,
  RuntimeComponentIdentity,
} from "@shared/source-mode";

export interface PortableStyleSnapshotNode {
  sourceId?: string;
  path: number[];
  styles: Record<string, string>;
}

export interface PortableStyleSnapshot {
  version: 1;
  rootSourceId?: string;
  nodes: PortableStyleSnapshotNode[];
}

export interface RuntimeStructureMove {
  subject: { selector: string; sourceId?: string | null };
  anchor: { selector: string; sourceId?: string | null };
  placement: "before" | "after" | "inside";
  transactionId?: string;
  gridPlacement?: {
    column: number;
    columnEnd: number;
    row: number;
    rowEnd: number;
  };
  gridDisplacements?: Array<{
    sourceId?: string;
    selector?: string;
    placement: {
      column: number;
      columnEnd: number;
      row: number;
      rowEnd: number;
    };
  }>;
}

export interface RuntimeStructureMoveRequest extends RuntimeStructureMove {
  requestId: number;
  moves?: RuntimeStructureMove[];
}

export interface GridGroupStructureMove {
  requestId: string;
  transactionId?: string;
  selector: string;
  sourceId: string;
  anchorSelector: string;
  anchorSourceId: string;
  placement?: "before" | "after" | "inside";
  persistenceAnchorSelector?: string;
  persistenceAnchorSourceId?: string;
  persistencePlacement?: "before" | "after" | "inside";
  gridPlacement: {
    column: number;
    columnEnd: number;
    row: number;
    rowEnd: number;
  };
  gridDisplacements: Array<{
    sourceId: string;
    selector: string;
    placement: {
      column: number;
      columnEnd: number;
      row: number;
      rowEnd: number;
    };
  }>;
}

export interface RuntimeStructureInsertRequest {
  requestId: number;
  transactionId?: string;
  screenId?: string;
  sourceScreenId?: string;
  remintCollidingNodeIds?: boolean;
  html: string;
  additionalHtml?: string[];
  replaceAnchor?: boolean;
  anchor: {
    selector: string;
    sourceId?: string | null;
    pendingNodeId?: string | null;
  };
  placement: "before" | "after" | "inside";
}

export interface RuntimeStructureDeleteRequest {
  requestId: string;
  transactionId?: string;
  selector: string;
  selectorCandidates?: string[];
  waitForInsertTransaction?: boolean;
  rollbackScreenId?: string;
  rollbackSelector?: string;
  rollbackSourceId?: string;
  cancelRequested?: boolean;
  cancellationRetryCount?: number;
}

export interface RuntimeStructureRollbackRequest {
  requestId: string;
  transactionId?: string;
  selector: string;
  sourceId?: string;
  idempotent?: boolean;
  retryCount?: number;
}

export interface RuntimeLayerRenameRequest {
  requestId: number;
  selector: string;
  sourceId?: string | null;
  routePath?: string;
  name: string;
}

export interface RuntimeVerificationRequest {
  requestId: number;
}

export interface ElementInfo {
  tagName: string;
  componentName?: string;
  componentAnnotation?: string;
  runtimeComponent?: RuntimeComponentIdentity;
  id?: string;
  sourceId?: string;
  provenance?: ElementProvenance;
  pendingNodeId?: string;
  repeat?: {
    sourceSelector: string;
    instanceCount: number;
    instanceIndex: number;
    xFor: string;
    itemIndex: number;
    textBinding: string;
    keyExpression: string;
    itemKey: string;
  };
  selector?: string;
  hasOwnText?: boolean;
  wholeTextStyleRoot?: boolean;
  runtimeSelector?: string;
  runtimeSourceId?: string;
  sourceLayerIdentity?: { screenId: string; nodeId: string };
  classes: string[];
  computedStyles: Record<string, string>;
  inlineStyles?: Record<string, string>;
  authoredSizeStyles?: Partial<Record<"width" | "height", string>>;
  primitiveKind?: string;
  isGroup?: boolean;
  vectorStrokeCanAlign?: boolean;
  portableStyleSnapshot?: PortableStyleSnapshot;
  styleSnapshotCaptureFailed?: boolean;
  boundingRect: { x: number; y: number; width: number; height: number };
  parentBoundingRect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  textContent?: string;
  textContentTruncated?: boolean;
  htmlContent?: string;
  htmlContentTruncated?: boolean;
  imageSource?: string;
  childElementCount?: number;
  isFlexChild: boolean;
  isFlexContainer: boolean;
  isGridContainer?: boolean;
  parentDisplay?: string;
  parentAutoLayout?: {
    display?: string;
    selector?: string;
    sourceId?: string;
    boundingRect: { x: number; y: number; width: number; height: number };
  };
  parentLayout?: {
    display?: string;
    flexDirection?: string;
    alignItems?: string;
    justifyContent?: string;
    gap?: string;
    gridAutoFlow?: string;
    gridTemplateColumns?: string;
    gridTemplateRows?: string;
    position?: string;
  };
  editCapabilities?: Array<{
    kind:
      | "deterministic-style-edit"
      | "deterministic-class-edit"
      | "agent-structural-edit"
      | "unsupported";
    label: string;
    confidence: number;
    reason?: string;
  }>;
  confidence?: number;
}

export interface TextEditingState {
  active: boolean;
  selector?: string;
  sourceId?: string;
  hasRange?: boolean;
  computedStyles?: Record<string, string>;
  inlineStyles?: Record<string, string>;
  rect?: { width: number; height: number };
  screenId?: string;
}

export interface ElementSelectionIntent {
  additive?: boolean;
  range?: boolean;
  source?: "pointer" | "keyboard" | "marquee";
  final?: boolean;
  cancelled?: boolean;
  restoreHostSelection?: boolean;
  resetHistory?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
}

export interface CanvasLayerHitCandidate {
  key: string;
  label: string;
  screenId?: string;
  breakpointWidthPx?: number;
  info: ElementInfo;
}

export type DeviceFrameType = "none" | "desktop" | "tablet" | "mobile";

export const DEVICE_FRAME_VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
} as const satisfies Record<
  Exclude<DeviceFrameType, "none">,
  { width: number; height: number }
>;

export interface ViewportTab {
  id: string;
  filename: string;
}

export const ZOOM_PRESETS = [50, 75, 100, 125, 150, 200] as const;

export type ZoomPreset = (typeof ZOOM_PRESETS)[number];

export interface DrawAnnotation {
  id: string;
  type: "path" | "text";
  pathData?: string;
  text?: string;
  position: { x: number; y: number };
  color: string;
  lineWidth: number;
  elementContext?: ElementInfo;
}
