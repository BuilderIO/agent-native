export const loadHomeComposer = () =>
  import("@/components/agent").then((module) => ({
    default: module.WorkspaceAgent,
  }));

export const loadNotebookCell = () =>
  import("@/components/notebook/NotebookCell").then((module) => ({
    default: module.NotebookCell,
  }));
