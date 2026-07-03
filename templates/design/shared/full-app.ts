/**
 * full-app — feature flag, types, and `designs.data` helpers for fusion-backed
 * "full app" designs.
 *
 * A full-app design is backed by a real running app in a Builder Fusion
 * container (one branch per design in the configured Builder project). Its
 * screens are URL-backed iframes of the container's dev server — the same
 * model as visual-edit/localhost screens, but remote — and edits queue in
 * `design_fusion_edits` until they are applied by the in-container app agent.
 *
 * The `fusionApp` linkage lives in the design's `data` JSON blob (additive,
 * like `screenMetadata`/`canvasFrames`), so no schema change is needed to mark
 * a design as app-backed.
 */

/**
 * Master switch for full app building in the Design app.
 *
 * Deliberately a plain code boolean for now: flip to `true` to expose the
 * "Full app" creation option and enable the fusion app actions. Builder
 * credentials plus a branch project id (DISPATCH_BUILDER_PROJECT_ID /
 * BUILDER_BRANCH_PROJECT_ID / BUILDER_PROJECT_ID) are still required at
 * runtime — without them the actions return the standard connect CTA.
 */
export const FULL_APP_BUILDING_ENABLED = false;

export type DesignFusionAppStatus = "building" | "ready" | "error";

export interface DesignFusionApp {
  /** Builder project id the app branch lives in. */
  projectId: string;
  /** Branch backing this design (one branch per design). */
  branchName: string;
  /** Builder visual-editor URL for the branch (progress/debugging). */
  editorUrl?: string;
  /** Container dev-server URL once the container is ready; iframe-able. */
  previewUrl?: string;
  status: DesignFusionAppStatus;
  /** Last provisioning/progress/error message. */
  statusMessage?: string;
  /** Reserved hosting slug — the app publishes to https://<slug>.builder.cloud */
  hostingSlug?: string;
  /** Public URL of the last successful deploy. */
  deployedUrl?: string;
  lastDeployId?: string;
  lastDeployStatus?: string;
  createdAt: string;
  updatedAt: string;
}

/** JSON target context attached to a queued fusion edit. */
export interface FusionEditTarget {
  /** CSS selector or data-node id of the element the user pointed at. */
  selector?: string;
  /** Route path of the screen the edit applies to (e.g. "/settings"). */
  path?: string;
  /** Full screen URL at edit time. */
  url?: string;
  /** Human-readable element description ("primary button", "nav logo"). */
  nodeName?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Parse a design's raw `data` JSON string into an object (never throws). */
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

/**
 * Read the fusion app linkage from a design's `data` (raw JSON string or
 * already-parsed object). Returns null when the design is not app-backed.
 */
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
  return {
    projectId,
    branchName,
    status,
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

/**
 * Return a new `data` object with the fusion app linkage written. Also stamps
 * `sourceType/sourceMode: "fusion"` so capability resolution treats the design
 * as fusion-backed. Additive — all other keys are preserved.
 */
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
