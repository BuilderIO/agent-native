export interface McpOAuthNavigationGate {
  begin(webContentsId: number): () => void;
  isActive(webContentsId: number): boolean;
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
