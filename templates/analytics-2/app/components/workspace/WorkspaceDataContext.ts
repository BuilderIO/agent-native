import { createContext, useContext } from "react";

import type activityAction from "../../../actions/get-workspace-activity";
import type bootstrapAction from "../../../actions/get-workspace-bootstrap";
import type contextSetupAction from "../../../actions/get-workspace-context-setup";

type WorkspaceShellSnapshot = Awaited<ReturnType<typeof bootstrapAction.run>>;

export interface WorkspaceDataValue {
  shell: WorkspaceShellSnapshot;
  activity: Awaited<ReturnType<typeof activityAction.run>> | undefined;
  activityStatus: "loading" | "error" | "ready";
  contextSetup: Awaited<ReturnType<typeof contextSetupAction.run>> | undefined;
  contextSetupPending: boolean;
  onCreateProject: () => void;
  onImportProject?: () => void;
  quickCreateProject: () => Promise<void>;
  onCreateThread: () => void;
}

/** Shell identity and shell write handlers for pages rendered inside it. */
export const WorkspaceDataContext = createContext<
  WorkspaceDataValue | undefined
>(undefined);

export function useWorkspaceData() {
  return useContext(WorkspaceDataContext);
}
