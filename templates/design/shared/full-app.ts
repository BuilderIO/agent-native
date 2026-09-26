
import { defineFeatureFlag } from "@agent-native/core/feature-flags/registry";

export const FULL_APP_BUILDING = defineFeatureFlag({
  key: "full-app-building",
  displayName: "Full app building",
  description: "Create and edit Builder Fusion-backed applications.",
});

export type DesignFusionAppStatus = "building" | "ready" | "error";

export type DesignFusionAppSource = "design-app" | "builder-host";

export interface DesignFusionApp {
  projectId: string;
  branchName: string;
  source?: DesignFusionAppSource;
  builderOrgId?: string;
  contentId?: string;
  editorUrl?: string;
  previewUrl?: string;
  status: DesignFusionAppStatus;
  statusMessage?: string;
  hostingSlug?: string;
  deployedUrl?: string;
  lastDeployId?: string;
  lastDeployStatus?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FusionEditTarget {
  selector?: string;
  path?: string;
  url?: string;
  nodeName?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parseDesignDataBlob(raw: unknown): Record<string, unknown> {
  if (isRecord(raw)) return raw;
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function readFusionApp(data: unknown): DesignFusionApp | null {
  const blob = parseDesignDataBlob(data);
  const app = blob.fusionApp;
  if (!isRecord(app)) return null;
  const projectId = typeof app.projectId === "string" ? app.projectId : "";
  const branchName = typeof app.branchName === "string" ? app.branchName : "";
  if (!projectId || !branchName) return null;
  const status: DesignFusionAppStatus =
    app.status === "ready" || app.status === "error" ? app.status : "building";
  const str = (value: unknown): string | undefined =>
    typeof value === "string" && value ? value : undefined;
  const source: DesignFusionAppSource | undefined =
    app.source === "builder-host" || app.source === "design-app"
      ? app.source
      : undefined;
  return {
    projectId,
    branchName,
    status,
    source,
    builderOrgId: str(app.builderOrgId),
    contentId: str(app.contentId),
    editorUrl: str(app.editorUrl),
    previewUrl: str(app.previewUrl),
    statusMessage: str(app.statusMessage),
    hostingSlug: str(app.hostingSlug),
    deployedUrl: str(app.deployedUrl),
    lastDeployId: str(app.lastDeployId),
    lastDeployStatus: str(app.lastDeployStatus),
    createdAt: str(app.createdAt) ?? "",
    updatedAt: str(app.updatedAt) ?? "",
  };
}

export function writeFusionApp(
  data: unknown,
  app: DesignFusionApp,
): Record<string, unknown> {
  const blob = parseDesignDataBlob(data);
  return {
    ...blob,
    sourceType: "fusion",
    sourceMode: "fusion",
    fusionApp: { ...app },
  };
}
