import { contextBridge, ipcRenderer } from "electron";
import {
  IPC,
  type DesktopContentFileRevealRequest,
  type DesktopContentFileWriteRequest,
  type DesktopContentFilesResult,
  type DesktopContentFilesWriteRequest,
  type DesktopPlanFilesChooseFolderRequest,
  type DesktopPlanFilesClearFolderRequest,
  type DesktopPlanFilesFolderRequest,
  type DesktopPlanFilesReadRequest,
  type DesktopPlanFilesResult,
  type DesktopPlanFilesWriteRequest,
} from "@shared/ipc-channels";

const agentNativeDesktop = {
  planFiles: {
    getFolder: (
      request: DesktopPlanFilesFolderRequest,
    ): Promise<DesktopPlanFilesResult> =>
      ipcRenderer.invoke(IPC.PLAN_FILES_GET_FOLDER, request),
    chooseFolder: (
      request: DesktopPlanFilesChooseFolderRequest,
    ): Promise<DesktopPlanFilesResult> =>
      ipcRenderer.invoke(IPC.PLAN_FILES_CHOOSE_FOLDER, request),
    writePlan: (
      request: DesktopPlanFilesWriteRequest,
    ): Promise<DesktopPlanFilesResult> =>
      ipcRenderer.invoke(IPC.PLAN_FILES_WRITE, request),
    readPlan: (
      request: DesktopPlanFilesReadRequest,
    ): Promise<DesktopPlanFilesResult> =>
      ipcRenderer.invoke(IPC.PLAN_FILES_READ, request),
    clearFolder: (
      request: DesktopPlanFilesClearFolderRequest,
    ): Promise<DesktopPlanFilesResult> =>
      ipcRenderer.invoke(IPC.PLAN_FILES_CLEAR_FOLDER, request),
  },
  contentFiles: {
    getFolder: (): Promise<DesktopContentFilesResult> =>
      ipcRenderer.invoke(IPC.CONTENT_FILES_GET_FOLDER),
    chooseFolder: (): Promise<DesktopContentFilesResult> =>
      ipcRenderer.invoke(IPC.CONTENT_FILES_CHOOSE_FOLDER),
    writeFiles: (
      request: DesktopContentFilesWriteRequest,
    ): Promise<DesktopContentFilesResult> =>
      ipcRenderer.invoke(IPC.CONTENT_FILES_WRITE, request),
    writeFile: (
      request: DesktopContentFileWriteRequest,
    ): Promise<DesktopContentFilesResult> =>
      ipcRenderer.invoke(IPC.CONTENT_FILES_WRITE_FILE, request),
    readFiles: (): Promise<DesktopContentFilesResult> =>
      ipcRenderer.invoke(IPC.CONTENT_FILES_READ),
    revealFile: (
      request: DesktopContentFileRevealRequest,
    ): Promise<DesktopContentFilesResult> =>
      ipcRenderer.invoke(IPC.CONTENT_FILES_REVEAL_FILE, request),
    clearFolder: (): Promise<DesktopContentFilesResult> =>
      ipcRenderer.invoke(IPC.CONTENT_FILES_CLEAR_FOLDER),
  },
};

contextBridge.exposeInMainWorld("agentNativeDesktop", agentNativeDesktop);
