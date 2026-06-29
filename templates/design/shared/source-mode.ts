export const DESIGN_SOURCE_TYPES = ["inline", "localhost", "fusion"] as const;

export type DesignSourceType = (typeof DESIGN_SOURCE_TYPES)[number];

export const DESIGN_BRIDGE_OPERATIONS = [
  "select",
  "resolveNodeToFile",
  "readFile",
  "applyEdit",
  "writeFile",
  "captureSnapshot",
  "captureState",
] as const;

export type DesignBridgeOperation = (typeof DESIGN_BRIDGE_OPERATIONS)[number];

export type DesignBridgeOperationStatus = "available" | "planned" | "disabled";

export interface DesignBridgeCapability {
  operation: DesignBridgeOperation;
  status: DesignBridgeOperationStatus;
  reason?: string;
}

export interface LocalhostDesignRoute {
  id: string;
  path: string;
  title: string;
  sourceFile?: string;
  sourceKind?: "react-router" | "html" | "manual";
  screenshotUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface LocalhostDesignRouteManifest {
  version: 1;
  sourceType: "localhost";
  devServerUrl: string;
  rootPath?: string;
  routes: LocalhostDesignRoute[];
  generatedAt: string;
}

export interface LocalhostDesignConnectionConfig {
  id: string;
  sourceType: "localhost";
  name: string;
  devServerUrl: string;
  bridgeUrl?: string;
  rootPath?: string;
  routeManifest: LocalhostDesignRouteManifest;
  capabilities: DesignBridgeCapability[];
  status: "connected" | "detected" | "manual" | "error";
  lastSeenAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface InlineDesignSource {
  sourceType: "inline";
  designId?: string;
  fileId?: string;
  filename?: string;
  revision?: string;
}

export interface LocalhostDesignSource {
  sourceType: "localhost";
  connectionId: string;
  routeId?: string;
  path?: string;
  url?: string;
  bridgeUrl?: string;
  revision?: string;
}

export interface FusionDesignSource {
  sourceType: "fusion";
  externalId?: string;
  url?: string;
  revision?: string;
  metadata?: Record<string, unknown>;
}

export type DesignSourceDescriptor =
  | InlineDesignSource
  | LocalhostDesignSource
  | FusionDesignSource;

export interface FlowCanvasSnapshotRef {
  id: string;
  sourceType: DesignSourceType;
  capturedAt: string;
  imageUrl?: string;
  stateUrl?: string;
  contentHash?: string;
  width?: number;
  height?: number;
}

export interface FlowCanvasArtboard {
  id: string;
  title: string;
  sourceType: DesignSourceType;
  source: DesignSourceDescriptor;
  routeId?: string;
  path?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  snapshot?: FlowCanvasSnapshotRef;
  metadata?: Record<string, unknown>;
}

export interface FlowCanvasEdge {
  id: string;
  fromArtboardId: string;
  toArtboardId: string;
  trigger?: string;
  derivedFrom?: {
    operation: "captureState" | "captureSnapshot" | "manual";
    sourceNodeId?: string;
    selector?: string;
  };
  metadata?: Record<string, unknown>;
}

export type DesignBridgeRequest =
  | {
      operation: "select";
      source: DesignSourceDescriptor;
      selector?: string;
      nodeId?: string;
    }
  | {
      operation: "resolveNodeToFile";
      source: DesignSourceDescriptor;
      selector?: string;
      nodeId?: string;
    }
  | {
      operation: "readFile";
      source: DesignSourceDescriptor;
      path: string;
    }
  | {
      operation: "applyEdit";
      source: DesignSourceDescriptor;
      path: string;
      edit: {
        kind: "replace" | "instruction";
        search?: string;
        replacement?: string;
        instruction?: string;
      };
    }
  | {
      operation: "writeFile";
      source: DesignSourceDescriptor;
      path: string;
      content: string;
    }
  | {
      operation: "captureSnapshot" | "captureState";
      source: DesignSourceDescriptor;
      routeId?: string;
      path?: string;
    };

export interface DesignBridgeResponse<T = unknown> {
  ok: boolean;
  operation: DesignBridgeOperation;
  data?: T;
  error?: string;
}

export function isDesignSourceType(value: unknown): value is DesignSourceType {
  return (
    typeof value === "string" &&
    (DESIGN_SOURCE_TYPES as readonly string[]).includes(value)
  );
}

export function normalizeDesignSourceType(
  value: unknown,
): DesignSourceType | null {
  if (isDesignSourceType(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "design-file" ||
    normalized === "inline-html" ||
    normalized === "sql" ||
    normalized === "snapshot"
  ) {
    return "inline";
  }
  if (
    normalized === "local" ||
    normalized === "local-file" ||
    normalized === "localhost" ||
    normalized === "dev-server"
  ) {
    return "localhost";
  }
  if (normalized === "fusion" || normalized === "remote-url") {
    return "fusion";
  }
  return null;
}

export function makeLocalhostRouteId(path: string): string {
  const normalized = path.trim() || "/";
  if (normalized === "/") return "route-root";
  const slug = normalized
    .replace(/^\/+/, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return slug ? `route-${slug}` : "route-wildcard";
}

export function titleFromRoutePath(path: string): string {
  const normalized = path.trim();
  if (!normalized || normalized === "/") return "Home";
  if (normalized === "/*" || normalized === "*") return "Wildcard";
  return (
    normalized
      .replace(/^\/+/, "")
      .replace(/[:$]/g, "")
      .replace(/[-_/]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (char) => char.toUpperCase()) || "Screen"
  );
}
