export interface McpOAuthNavigationGate {
  begin(webContentsId: number): () => void;
  isActive(webContentsId: number): boolean;
}

export type McpOAuthNavigationOutcome = "pending" | "success" | "error";

function normalizedPath(path: string): string {
  return path.replace(/\/+$/, "") || "/";
}

export function classifyMcpOAuthNavigation(input: {
  candidateUrl: string;
  origin: string;
  returnPath: string;
  callbackPath: string;
  httpResponseCode?: number;
}): McpOAuthNavigationOutcome {
  let candidate: URL;
  try {
    candidate = new URL(input.candidateUrl);
  } catch {
    return "pending";
  }
  if (candidate.origin !== input.origin) return "pending";

  const candidatePath = normalizedPath(candidate.pathname);
  const isErrorResponse =
    input.httpResponseCode !== undefined && input.httpResponseCode >= 400;
  if (candidatePath === normalizedPath(input.returnPath)) {
    return isErrorResponse ? "error" : "success";
  }
  if (candidatePath === normalizedPath(input.callbackPath) && isErrorResponse) {
    return "error";
  }
  return "pending";
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
