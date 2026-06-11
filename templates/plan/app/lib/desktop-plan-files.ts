export interface PlanMdxFolder {
  "plan.mdx": string;
  "canvas.mdx"?: string;
  "prototype.mdx"?: string;
  ".plan-state.json"?: string;
  "assets/"?: Record<string, string>;
}

export interface DesktopPlanFilesFolder {
  name: string;
  planId: string;
  title?: string;
  updatedAt?: string;
}

export type DesktopPlanFilesResult =
  | {
      ok: true;
      folder: DesktopPlanFilesFolder;
      files?: string[];
      mdx?: PlanMdxFolder;
    }
  | {
      ok: false;
      error: string;
      canceled?: boolean;
      folder?: DesktopPlanFilesFolder;
    };

export interface DesktopPlanFilesApi {
  getFolder(request: { planId: string }): Promise<DesktopPlanFilesResult>;
  chooseFolder(request: {
    planId: string;
    title?: string;
  }): Promise<DesktopPlanFilesResult>;
  writePlan(request: {
    planId: string;
    title?: string;
    mdx: PlanMdxFolder;
  }): Promise<DesktopPlanFilesResult>;
  readPlan(request: { planId: string }): Promise<DesktopPlanFilesResult>;
  clearFolder(request: { planId: string }): Promise<DesktopPlanFilesResult>;
}

declare global {
  interface Window {
    agentNativeDesktop?: {
      planFiles?: DesktopPlanFilesApi;
    };
  }
}

export function getDesktopPlanFiles(): DesktopPlanFilesApi | null {
  if (typeof window === "undefined") return null;
  return window.agentNativeDesktop?.planFiles ?? null;
}
