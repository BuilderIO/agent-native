/**
 * Turns a host `design:init` payload into the `DesignData` the editor normally
 * fetches from `get-design`, so the canvas can run with no design row, no
 * session and no server writes. The host owns this state; it dies with the tab.
 */

import {
  buildShellScreens,
  type ShellScreensResult,
} from "@shared/shell-screens";

import type { DesignData, DesignFile } from "@/pages/design-editor/types";

export const SHELL_DESIGN_ID = "shell";
const SHELL_EPOCH = "1970-01-01T00:00:00.000Z";

export interface ShellDesignInput {
  previewOrigin: string;
  routes: Array<{ path: string; title?: string }>;
  projectId?: string;
  branchName?: string;
  builderOrgId?: string;
  contentId?: string;
}

export interface ShellDesign {
  design: DesignData;
  screens: ShellScreensResult["screens"];
}

/**
 * `editor` because the canvas gates click-to-edit on it. Nothing it unlocks can
 * reach a server: the shell never mounts a save path, so this only opens the
 * in-memory affordances.
 */
const SHELL_ACCESS_ROLE = "editor" as const;

export function buildShellDesign(input: ShellDesignInput): ShellDesign {
  const { screens, placedFrames } = buildShellScreens({
    previewOrigin: input.previewOrigin,
    paths: input.routes.map((route) => route.path),
  });

  // Frame geometry is keyed by fileId, the same shape the persisted canvas uses.
  const canvasFrames: Record<
    string,
    { x: number; y: number; width: number; height: number }
  > = {};
  for (const placed of placedFrames) {
    const { x = 0, y = 0, width, height } = placed.frame;
    canvasFrames[placed.fileId] = {
      x,
      y,
      width: width ?? 0,
      height: height ?? 0,
    };
  }

  // Fixed, not `Date.now()`: a repeated `design:init` must rebuild an identical
  // design, or the canvas treats it as a new document and remounts the frames.
  const now = SHELL_EPOCH;
  const files: DesignFile[] = screens.map((screen) => ({
    id: screen.fileId,
    filename: screen.filename,
    fileType: "html",
    content: screen.url,
    createdAt: now,
    updatedAt: now,
  }));

  const design: DesignData = {
    id: SHELL_DESIGN_ID,
    title: input.branchName ?? "Design",
    updatedAt: now,
    projectType: "prototype",
    accessRole: SHELL_ACCESS_ROLE,
    files,
    data: JSON.stringify({
      // Without this the editor resolves the design as `inline`, which turns off
      // the runtime layer projection and leaves the layer tree permanently empty.
      sourceType: "fusion",
      canvasFrames,
      fusionApp: {
        source: "builder-host",
        projectId: input.projectId ?? "",
        branchName: input.branchName ?? "",
        ...(input.builderOrgId ? { builderOrgId: input.builderOrgId } : {}),
        ...(input.contentId ? { contentId: input.contentId } : {}),
        previewUrl: input.previewOrigin,
        status: "ready",
        createdAt: now,
        updatedAt: now,
      },
    }),
  };

  return { design, screens };
}
