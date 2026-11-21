import { IPC, type DesktopOpenRequest } from "@shared/ipc-channels";
import { app } from "electron";

export interface ShellWindow {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
  once(event: "ready-to-show", listener: () => void): unknown;
  webContents: {
    isLoading(): boolean;
    send(channel: string, ...args: unknown[]): void;
  };
}

interface PendingOpenRequest {
  request: DesktopOpenRequest;
  // Present for opens that reveal one owner's data; null never matches.
  owner?: string | null;
}

function belongsToOwner(
  pending: PendingOpenRequest,
  owner: string | null,
): boolean {
  return (
    pending.owner === undefined ||
    (pending.owner !== null && pending.owner === owner)
  );
}

// Only the main shell renders the app, so no other window is a handoff target.
export function createMainShellHandoff<W extends ShellWindow>(deps: {
  getMainWindow: () => W | null;
  createMainWindow: () => W;
  currentOwner: () => string | null;
}) {
  const pending: PendingOpenRequest[] = [];

  function focusMainWindow(options: { stealFocus?: boolean } = {}): W | null {
    const existing = deps.getMainWindow();
    const win = existing && !existing.isDestroyed() ? existing : null;
    if (win) {
      if (win.isMinimized()) win.restore();
      if (process.platform === "darwin") app.show();
      win.show();
      win.focus();
      if (process.platform === "darwin" && options.stealFocus) {
        app.focus({ steal: true });
      }
      return win;
    }

    if (app.isReady()) {
      const created = deps.createMainWindow();
      if (process.platform === "darwin" && options.stealFocus) {
        created.once("ready-to-show", () => app.focus({ steal: true }));
      }
      return created;
    }
    return null;
  }

  function sendOpenRequestToRenderer(
    request: DesktopOpenRequest,
    options: { stealFocus?: boolean; owner?: string | null } = {},
  ): void {
    const existing = deps.getMainWindow();
    const reusable = existing !== null && !existing.isDestroyed();
    const win = focusMainWindow(options);
    // A window created just now has no listener until it finishes loading.
    if (!win || win.isDestroyed() || !reusable || win.webContents.isLoading()) {
      pending.push({
        request,
        ...(options.owner !== undefined ? { owner: options.owner } : {}),
      });
      return;
    }
    win.webContents.send(IPC.DEEP_LINK_OPEN, request);
  }

  function flushPendingOpenRequests(win: ShellWindow | null): void {
    if (!win || win.isDestroyed() || win.webContents.isLoading()) return;
    const owner = deps.currentOwner();
    while (pending.length > 0) {
      const next = pending.shift();
      if (next && belongsToOwner(next, owner)) {
        win.webContents.send(IPC.DEEP_LINK_OPEN, next.request);
      }
    }
  }

  function dropPendingOpenRequestsNotOwnedBy(owner: string | null): void {
    const kept = pending.filter((entry) => belongsToOwner(entry, owner));
    pending.splice(0, pending.length, ...kept);
  }

  return {
    focusMainWindow,
    sendOpenRequestToRenderer,
    flushPendingOpenRequests,
    dropPendingOpenRequestsNotOwnedBy,
  };
}
