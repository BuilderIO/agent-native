export const API_BASE = "/api";

export type {
  DesignBridgeCapability,
  DesignBridgeOperation,
  DesignBridgeOperationStatus,
  DesignBridgeRequest,
  DesignBridgeResponse,
  DesignSourceDescriptor,
  DesignSourceType,
  FlowCanvasArtboard,
  FlowCanvasEdge,
  FlowCanvasSnapshotRef,
  FusionDesignSource,
  InlineDesignSource,
  LocalhostDesignConnectionConfig,
  LocalhostDesignRoute,
  LocalhostDesignRouteManifest,
  LocalhostDesignSource,
} from "./source-mode";
export {
  DESIGN_BRIDGE_OPERATIONS,
  DESIGN_SOURCE_TYPES,
  isDesignSourceType,
  makeLocalhostRouteId,
  normalizeDesignSourceType,
  titleFromRoutePath,
} from "./source-mode";

export interface DesignProject {
  id: string;
  title: string;
  description?: string;
  projectType: "prototype" | "other";
  files: DesignFile[];
  tweaks?: TweakDefinition[];
  createdAt: string;
  updatedAt: string;
}

export interface DesignFile {
  id: string;
  designId: string;
  filename: string;
  content: string;
  fileType: "html" | "css" | "jsx" | "asset";
}

export interface TweakDefinition {
  id: string;
  label: string;
  type: "color-swatch" | "color-swatches" | "segment" | "slider" | "toggle";
  options?: { label: string; value: string; color?: string }[];
  min?: number;
  max?: number;
  step?: number;
  defaultValue: string | number | boolean;
  cssVar?: string;
  unit?: string;
  /**
   * Absent means the tweak applies to every screen. A list shows one shared
   * knob on each place it drives, such as a remix and its explainer frames.
   */
  scope?: TweakScope | TweakScope[];
}

export interface TweakScope {
  /** Screen (file) id; absent means any screen. */
  screenId?: string;
  /** `data-agent-native-node-id` of the element the tweak drives. */
  nodeId?: string;
  /** CSS selector of that element, for URL-backed screens without node ids. */
  selector?: string;
}

export interface QuestionFlowQuestion {
  id: string;
  type: "text-options" | "color-options" | "slider" | "file" | "freeform";
  header?: string;
  question: string;
  description?: string;
  options?: {
    label: string;
    value: string;
    color?: string;
    icon?: string;
    description?: string;
    recommended?: boolean;
  }[];
  choices?: QuestionFlowQuestion["options"];
  multiSelect?: boolean;
  min?: number;
  max?: number;
  step?: number;
  required?: boolean;
  placeholder?: string;
  allowOther?: boolean;
  includeExplore?: boolean;
  includeDecide?: boolean;
}
