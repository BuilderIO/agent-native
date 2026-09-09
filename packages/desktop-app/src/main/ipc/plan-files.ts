import {
  IPC,
  type DesktopPlanFilesChooseFolderRequest,
  type DesktopPlanFilesClearFolderRequest,
  type DesktopPlanFilesFolder,
  type DesktopPlanFilesFolderRequest,
  type DesktopPlanFilesReadRequest,
  type DesktopPlanFilesResult,
  type DesktopPlanFilesWriteRequest,
} from "@shared/ipc-channels";
import { ipcMain, type IpcMainInvokeEvent } from "electron";

import type { PlanFilesGrant } from "../index";

export interface PlanFilesIpcDeps {
  /** Rejects requests that don't come from the Plan app's own webview. */
  requirePlanFilesWebviewAccess: (
    event: IpcMainInvokeEvent,
  ) => DesktopPlanFilesResult | null;
  normalizePlanFilesRequestPlanId: (request: unknown) => string | null;
  getPlanFilesGrant: (planId: string) => PlanFilesGrant | null;
  planFilesFolderInfo: (
    planId: string,
    grant: PlanFilesGrant,
  ) => DesktopPlanFilesFolder;
  collectLocalControlResources: (
    folder: string,
  ) => Promise<Record<string, string>>;
  choosePlanFilesFolder: (
    request: DesktopPlanFilesChooseFolderRequest,
  ) => Promise<DesktopPlanFilesResult>;
  writePlanFilesForRequest: (
    request: DesktopPlanFilesWriteRequest,
  ) => Promise<DesktopPlanFilesResult>;
  readPlanFilesForRequest: (
    request: DesktopPlanFilesReadRequest,
  ) => Promise<DesktopPlanFilesResult>;
  clearPlanFilesGrant: (planId: string) => DesktopPlanFilesResult;
}

/**
 * Registers the Plan-app local-folder sync IPC handlers (get/choose/write/read/clear).
 * All access is gated to the Plan app's own webview via `requirePlanFilesWebviewAccess`.
 */
export function registerPlanFilesIpc(deps: PlanFilesIpcDeps): void {
  const {
    requirePlanFilesWebviewAccess,
    normalizePlanFilesRequestPlanId,
    getPlanFilesGrant,
    planFilesFolderInfo,
    collectLocalControlResources,
    choosePlanFilesFolder,
    writePlanFilesForRequest,
    readPlanFilesForRequest,
    clearPlanFilesGrant,
  } = deps;

  ipcMain.handle(
    IPC.PLAN_FILES_GET_FOLDER,
    async (
      event: IpcMainInvokeEvent,
      request: DesktopPlanFilesFolderRequest,
    ): Promise<DesktopPlanFilesResult> => {
      const denied = requirePlanFilesWebviewAccess(event);
      if (denied) return denied;
      const planId = normalizePlanFilesRequestPlanId(request);
      if (!planId) return { ok: false, error: "Invalid plan ID." };
      const grant = getPlanFilesGrant(planId);
      if (!grant) return { ok: false, error: "No local folder is linked." };
      return {
        ok: true,
        folder: planFilesFolderInfo(planId, grant),
        controlResources: await collectLocalControlResources(grant.path),
      };
    },
  );

  ipcMain.handle(
    IPC.PLAN_FILES_CHOOSE_FOLDER,
    (
      event: IpcMainInvokeEvent,
      request: DesktopPlanFilesChooseFolderRequest,
    ): Promise<DesktopPlanFilesResult> => {
      const denied = requirePlanFilesWebviewAccess(event);
      if (denied) return Promise.resolve(denied);
      return choosePlanFilesFolder(request);
    },
  );

  ipcMain.handle(
    IPC.PLAN_FILES_WRITE,
    (
      event: IpcMainInvokeEvent,
      request: DesktopPlanFilesWriteRequest,
    ): Promise<DesktopPlanFilesResult> => {
      const denied = requirePlanFilesWebviewAccess(event);
      if (denied) return Promise.resolve(denied);
      return writePlanFilesForRequest(request);
    },
  );

  ipcMain.handle(
    IPC.PLAN_FILES_READ,
    (
      event: IpcMainInvokeEvent,
      request: DesktopPlanFilesReadRequest,
    ): Promise<DesktopPlanFilesResult> => {
      const denied = requirePlanFilesWebviewAccess(event);
      if (denied) return Promise.resolve(denied);
      return readPlanFilesForRequest(request);
    },
  );

  ipcMain.handle(
    IPC.PLAN_FILES_CLEAR_FOLDER,
    (
      event: IpcMainInvokeEvent,
      request: DesktopPlanFilesClearFolderRequest,
    ): DesktopPlanFilesResult => {
      const denied = requirePlanFilesWebviewAccess(event);
      if (denied) return denied;
      const planId = normalizePlanFilesRequestPlanId(request);
      if (!planId) return { ok: false, error: "Invalid plan ID." };
      return clearPlanFilesGrant(planId);
    },
  );
}
