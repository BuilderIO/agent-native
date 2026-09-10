export interface McpOAuthNavigationGate {
  begin(webContentsId: number): () => void;
  isActive(webContentsId: number): boolean;
}

export type McpOAuthNavigationOutcome = "pending" | "success" | "error";

export interface McpOAuthNavigationTarget {
  isDestroyed(): boolean;
  loadURL(url: string): Promise<unknown>;
}

function normalizedPath(path: string): string {
  return path.replace(/\/+$/, "") || "/";
}

export function classifyMcpOAuthNavigation(input: {
  candidateUrl: string;
  origin: string;
  returnPath: string;
  httpResponseCode?: number;
}): McpOAuthNavigationOutcome {
  let candidate: URL;
  try {
    candidate = new URL(input.candidateUrl);
  } catch {
    return "pending";
  }
  if (input.httpResponseCode !== undefined && input.httpResponseCode >= 400) {
    return "error";
  }
  if (candidate.origin !== input.origin) return "pending";

  const candidatePath = normalizedPath(candidate.pathname);
  if (candidatePath === normalizedPath(input.returnPath)) {
    return "success";
  }
  return "pending";
}

export async function restoreMcpOAuthNavigationTarget(
  target: McpOAuthNavigationTarget,
  origin: string,
  returnPath: string,
): Promise<void> {
  if (target.isDestroyed()) return;
  await target.loadURL(new URL(returnPath, origin).toString());
}

export function createMcpOAuthNavigationGate(): McpOAuthNavigationGate {
  const activeCounts = new Map<number, number>();

  return {
    begin(webContentsId) {
      activeCounts.set(
        webContentsId,
        (activeCounts.get(webContentsId) ?? 0) + 1,
      );
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const count = activeCounts.get(webContentsId) ?? 0;
        if (count <= 1) activeCounts.delete(webContentsId);
        else activeCounts.set(webContentsId, count - 1);
      };
    },
    isActive(webContentsId) {
      return activeCounts.has(webContentsId);
    },
  };
}
