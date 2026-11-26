import { IPC } from "@shared/ipc-channels";
import { beforeEach, describe, expect, it, vi } from "vitest";

const electronState = vi.hoisted(() => ({
  app: {
    isReady: vi.fn(() => true),
    show: vi.fn(),
    focus: vi.fn(),
  },
  getAllWindows: vi.fn((): unknown[] => []),
}));

vi.mock("electron", () => ({
  app: electronState.app,
  BrowserWindow: { getAllWindows: electronState.getAllWindows },
}));

import { createMainShellHandoff, type ShellWindow } from "./main-shell-handoff";

const OWNER_A = "account:a@example.com";
const OWNER_B = "account:b@example.com";

class FakeWindow implements ShellWindow {
  loading: boolean;
  destroyed = false;
  readonly restore = vi.fn();
  readonly show = vi.fn();
  readonly focus = vi.fn();
  readonly once = vi.fn();
  readonly send = vi.fn();
  readonly webContents = {
    isLoading: () => this.loading,
    send: this.send,
  };

  constructor(loading = false) {
    this.loading = loading;
  }

  isDestroyed = () => this.destroyed;
  isMinimized = () => false;

  finishLoad(): void {
    this.loading = false;
  }
}

const OPEN_RUN = { app: "code-agents", goalId: "goal-1", runId: "run-1" };

describe("main shell handoff", () => {
  let owner: string | null;
  let mainWindow: FakeWindow | null;

  beforeEach(() => {
    vi.clearAllMocks();
    electronState.app.isReady.mockReturnValue(true);
    electronState.getAllWindows.mockReturnValue([]);
    owner = OWNER_A;
    mainWindow = null;
  });

  function handoff(
    createMainWindow: () => FakeWindow = () => new FakeWindow(),
  ) {
    return createMainShellHandoff({
      getMainWindow: () => mainWindow,
      createMainWindow: () => {
        mainWindow = createMainWindow();
        return mainWindow;
      },
      currentOwner: () => owner,
    });
  }

  it("delivers a loaded run open to the main shell", () => {
    mainWindow = new FakeWindow();
    const { sendOpenRequestToRenderer } = handoff();

    sendOpenRequestToRenderer(OPEN_RUN, { owner: OWNER_A });

    expect(mainWindow.send).toHaveBeenCalledWith(IPC.DEEP_LINK_OPEN, OPEN_RUN);
  });

  describe("queued opens", () => {
    it("drops a queued open at flush when the owner changed", () => {
      mainWindow = new FakeWindow(true);
      const { sendOpenRequestToRenderer, flushPendingOpenRequests } = handoff();
      sendOpenRequestToRenderer(OPEN_RUN, { owner: OWNER_A });
      expect(mainWindow.send).not.toHaveBeenCalled();

      owner = OWNER_B;
      mainWindow.finishLoad();
      flushPendingOpenRequests(mainWindow);

      expect(mainWindow.send).not.toHaveBeenCalled();
    });

    it("clears a queued open for the old owner when the owner changes", () => {
      mainWindow = new FakeWindow(true);
      const {
        sendOpenRequestToRenderer,
        flushPendingOpenRequests,
        dropPendingOpenRequestsNotOwnedBy,
      } = handoff();
      sendOpenRequestToRenderer(OPEN_RUN, { owner: OWNER_A });

      dropPendingOpenRequestsNotOwnedBy(OWNER_B);
      mainWindow.finishLoad();
      flushPendingOpenRequests(mainWindow);

      expect(mainWindow.send).not.toHaveBeenCalled();
    });

    it("delivers a queued open at flush when the owner is unchanged", () => {
      mainWindow = new FakeWindow(true);
      const {
        sendOpenRequestToRenderer,
        flushPendingOpenRequests,
        dropPendingOpenRequestsNotOwnedBy,
      } = handoff();
      sendOpenRequestToRenderer(OPEN_RUN, { owner: OWNER_A });
      dropPendingOpenRequestsNotOwnedBy(OWNER_A);

      mainWindow.finishLoad();
      flushPendingOpenRequests(mainWindow);

      expect(mainWindow.send).toHaveBeenCalledWith(
        IPC.DEEP_LINK_OPEN,
        OPEN_RUN,
      );
    });

    it("never delivers an open queued for an unreadable owner", () => {
      mainWindow = new FakeWindow(true);
      const { sendOpenRequestToRenderer, flushPendingOpenRequests } = handoff();
      sendOpenRequestToRenderer(OPEN_RUN, { owner: null });

      owner = null;
      mainWindow.finishLoad();
      flushPendingOpenRequests(mainWindow);

      expect(mainWindow.send).not.toHaveBeenCalled();
    });

    it("keeps an open that names no owner across an owner change", () => {
      mainWindow = new FakeWindow(true);
      const {
        sendOpenRequestToRenderer,
        flushPendingOpenRequests,
        dropPendingOpenRequestsNotOwnedBy,
      } = handoff();
      sendOpenRequestToRenderer({ app: "mail", path: "/inbox" });

      owner = OWNER_B;
      dropPendingOpenRequestsNotOwnedBy(OWNER_B);
      mainWindow.finishLoad();
      flushPendingOpenRequests(mainWindow);

      expect(mainWindow.send).toHaveBeenCalledWith(IPC.DEEP_LINK_OPEN, {
        app: "mail",
        path: "/inbox",
      });
    });
  });

  describe("with no main window", () => {
    it("never selects another window and queues the open for the new shell", () => {
      const quickPromptWindow = new FakeWindow();
      electronState.getAllWindows.mockReturnValue([quickPromptWindow]);
      const created = new FakeWindow(true);
      const { sendOpenRequestToRenderer, flushPendingOpenRequests } = handoff(
        () => created,
      );

      sendOpenRequestToRenderer(OPEN_RUN, {
        stealFocus: true,
        owner: OWNER_A,
      });

      expect(quickPromptWindow.show).not.toHaveBeenCalled();
      expect(quickPromptWindow.focus).not.toHaveBeenCalled();
      expect(quickPromptWindow.send).not.toHaveBeenCalled();
      expect(created.send).not.toHaveBeenCalled();

      created.finishLoad();
      flushPendingOpenRequests(created);
      expect(created.send).toHaveBeenCalledWith(IPC.DEEP_LINK_OPEN, OPEN_RUN);
      expect(quickPromptWindow.send).not.toHaveBeenCalled();
    });

    it("queues rather than sends into a created window that has not started loading", () => {
      const created = new FakeWindow(false);
      const { sendOpenRequestToRenderer } = handoff(() => created);

      sendOpenRequestToRenderer(OPEN_RUN, { owner: OWNER_A });

      expect(created.send).not.toHaveBeenCalled();
    });

    it("queues the open without a window before the app is ready", () => {
      electronState.app.isReady.mockReturnValue(false);
      const quickPromptWindow = new FakeWindow();
      electronState.getAllWindows.mockReturnValue([quickPromptWindow]);
      const createMainWindow = vi.fn(() => new FakeWindow());
      const { sendOpenRequestToRenderer } = handoff(createMainWindow);

      sendOpenRequestToRenderer(OPEN_RUN, { owner: OWNER_A });

      expect(createMainWindow).not.toHaveBeenCalled();
      expect(quickPromptWindow.send).not.toHaveBeenCalled();
    });
  });
});
