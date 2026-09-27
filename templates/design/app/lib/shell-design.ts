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

const SHELL_ACCESS_ROLE = "editor" as const;

export function shellContextChanged(
  previous: ShellDesignInput,
  next: ShellDesignInput,
): boolean {
  return (
    previous.previewOrigin !== next.previewOrigin ||
    previous.branchName !== next.branchName ||
    previous.projectId !== next.projectId
  );
}

export function buildShellDesign(input: ShellDesignInput): ShellDesign {
  const { screens, placedFrames } = buildShellScreens({
    previewOrigin: input.previewOrigin,
    paths: input.routes.map((route) => route.path),
  });

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
