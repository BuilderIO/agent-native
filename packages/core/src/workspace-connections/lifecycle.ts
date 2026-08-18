export type WorkspaceConnectionLifecycleEvent =
  | {
      type: "connection-deleted";
      connectionId: string;
      ownerEmail: string;
      orgId: string | null;
    }
  | {
      type: "grant-revoked";
      connectionId: string;
      appId: string;
      ownerEmail: string;
      orgId: string | null;
    };

export type WorkspaceConnectionLifecycleListener = (
  event: WorkspaceConnectionLifecycleEvent,
) => void | Promise<void>;

const LISTENERS_KEY = Symbol.for(
  "@agent-native/core.workspace-connection-lifecycle-listeners",
);

function listeners(): Set<WorkspaceConnectionLifecycleListener> {
  const global = globalThis as typeof globalThis & {
    [LISTENERS_KEY]?: Set<WorkspaceConnectionLifecycleListener>;
  };
  global[LISTENERS_KEY] ??= new Set();
  return global[LISTENERS_KEY];
}

export function registerWorkspaceConnectionLifecycleListener(
  listener: WorkspaceConnectionLifecycleListener,
): () => void {
  listeners().add(listener);
  return () => listeners().delete(listener);
}

export async function notifyWorkspaceConnectionLifecycle(
  event: WorkspaceConnectionLifecycleEvent,
): Promise<void> {
  await Promise.all([...listeners()].map((listener) => listener(event)));
}
