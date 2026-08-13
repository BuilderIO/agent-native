import { CODE_AGENTS_SURFACE_ID } from "@shared/code-agents";
import { IPC } from "@shared/ipc-channels";
import { beforeEach, describe, expect, it, vi } from "vitest";

const electronState = vi.hoisted(() => {
  type Handler = (...args: any[]) => unknown;

  const ipcHandlers = new Map<string, Handler>();
  const windows: MockBrowserWindow[] = [];
  let shortcutHandler: (() => void) | undefined;
  let focusedWindow: MockBrowserWindow | null = null;

  class MockBrowserWindow {
    private readonly onceHandlers = new Map<string, Handler>();
    private readonly eventHandlers = new Map<string, Handler>();
    private visible = false;
    private destroyed = false;

    static getFocusedWindow = vi.fn(() => focusedWindow);

    readonly setAlwaysOnTop = vi.fn();
    readonly setVisibleOnAllWorkspaces = vi.fn();
    readonly getSize = vi.fn(() => [460, 108] as [number, number]);
    readonly setPosition = vi.fn();
    readonly loadFile = vi.fn();
    readonly show = vi.fn(() => {
      this.visible = true;
    });
    readonly focus = vi.fn(() => {
      focusedWindow = this;
    });
    readonly hide = vi.fn(() => {
      this.visible = false;
      if (focusedWindow === this) focusedWindow = null;
    });
    readonly isVisible = vi.fn(() => this.visible);
    readonly isDestroyed = vi.fn(() => this.destroyed);
    readonly destroy = vi.fn(() => {
      this.destroyed = true;
    });
    readonly once = vi.fn((event: string, handler: Handler) => {
      this.onceHandlers.set(event, handler);
    });
    readonly on = vi.fn((event: string, handler: Handler) => {
      this.eventHandlers.set(event, handler);
    });

    constructor() {
      windows.push(this);
    }

    emitOnce(event: string): void {
      this.onceHandlers.get(event)?.();
    }

    emit(event: string): void {
      this.eventHandlers.get(event)?.();
    }
  }

  return {
    app: {
      isReady: vi.fn(() => true),
      focus: vi.fn(),
      hide: vi.fn(),
      on: vi.fn(),
    },
    BrowserWindow: MockBrowserWindow,
    globalShortcut: {
      register: vi.fn((_accelerator: string, handler: () => void) => {
        shortcutHandler = handler;
        return true;
      }),
      unregister: vi.fn(),
    },
    ipcMain: {
      handlers: ipcHandlers,
      handle: vi.fn((channel: string, handler: Handler) => {
        ipcHandlers.set(channel, handler);
      }),
      on: vi.fn((channel: string, handler: Handler) => {
        ipcHandlers.set(channel, handler);
      }),
    },
    screen: {
      getCursorScreenPoint: vi.fn(() => ({ x: 0, y: 0 })),
      getDisplayNearestPoint: vi.fn(() => ({
        workArea: { x: 0, y: 0, width: 1440, height: 900 },
      })),
    },
    getShortcutHandler: () => shortcutHandler,
    getWindow: () => windows[windows.length - 1],
    reset: () => {
      ipcHandlers.clear();
      windows.length = 0;
      shortcutHandler = undefined;
      focusedWindow = null;
      MockBrowserWindow.getFocusedWindow.mockClear();
    },
  };
});

const appStore = vi.hoisted(() => ({
  loadQuickPromptPreferences: vi.fn(() => ({ enabled: true })),
  saveQuickPromptPreferences: vi.fn(),
}));

vi.mock("electron", () => ({
  app: electronState.app,
  BrowserWindow: electronState.BrowserWindow,
  globalShortcut: electronState.globalShortcut,
  ipcMain: electronState.ipcMain,
  screen: electronState.screen,
}));

vi.mock("./app-store", () => appStore);

describe("Quick Prompt focus behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electronState.reset();
    appStore.loadQuickPromptPreferences.mockReturnValue({ enabled: true });
  });

  it("restores the previously focused window instead of the main app on dismiss", async () => {
    vi.resetModules();
    const { registerQuickPromptIpc, registerQuickPromptShortcut } =
      await import("./quick-prompt.js");

    registerQuickPromptIpc({
      createCodeAgentRun: vi.fn(),
      sendOpenRequestToRenderer: vi.fn(),
    });
    registerQuickPromptShortcut();

    electronState.getShortcutHandler()?.();
    const promptWindow = electronState.getWindow();
    expect(promptWindow?.show).toHaveBeenCalled();
    expect(promptWindow?.focus).toHaveBeenCalled();
    expect(electronState.app.focus).not.toHaveBeenCalled();

    electronState.getShortcutHandler()?.();
    expect(promptWindow?.hide).toHaveBeenCalled();
    if (process.platform === "darwin") {
      expect(electronState.app.hide).toHaveBeenCalledTimes(1);
    } else {
      expect(electronState.app.hide).not.toHaveBeenCalled();
    }
    expect(electronState.app.focus).not.toHaveBeenCalled();

    electronState.getShortcutHandler()?.();
    electronState.ipcMain.handlers.get(IPC.QUICK_PROMPT_DISMISS)?.();
    expect(promptWindow?.hide).toHaveBeenCalledTimes(2);
    if (process.platform === "darwin") {
      expect(electronState.app.hide).toHaveBeenCalledTimes(2);
    }
  });

  it("keeps the main app focused when the prompt was opened from it", async () => {
    vi.resetModules();
    const { registerQuickPromptIpc, registerQuickPromptShortcut } =
      await import("./quick-prompt.js");
    const mainWindow = new electronState.BrowserWindow();
    mainWindow.show();
    mainWindow.focus();

    registerQuickPromptIpc({
      createCodeAgentRun: vi.fn(),
      sendOpenRequestToRenderer: vi.fn(),
    });
    registerQuickPromptShortcut();

    electronState.getShortcutHandler()?.();
    const promptWindow = electronState.getWindow();
    electronState.getShortcutHandler()?.();

    expect(promptWindow?.hide).toHaveBeenCalled();
    expect(electronState.app.hide).not.toHaveBeenCalled();
    expect(mainWindow.focus).toHaveBeenCalledTimes(2);
  });

  it("hides when the native prompt window loses focus", async () => {
    vi.resetModules();
    const { registerQuickPromptIpc, registerQuickPromptShortcut } =
      await import("./quick-prompt.js");

    registerQuickPromptIpc({
      createCodeAgentRun: vi.fn(),
      sendOpenRequestToRenderer: vi.fn(),
    });
    registerQuickPromptShortcut();

    electronState.getShortcutHandler()?.();
    const promptWindow = electronState.getWindow();
    promptWindow?.emit("blur");

    expect(promptWindow?.hide).toHaveBeenCalled();
    expect(electronState.app.hide).not.toHaveBeenCalled();
  });

  it("does not resurrect after dismissal before ready-to-show", async () => {
    vi.resetModules();
    const { registerQuickPromptIpc, registerQuickPromptShortcut } =
      await import("./quick-prompt.js");

    registerQuickPromptIpc({
      createCodeAgentRun: vi.fn(),
      sendOpenRequestToRenderer: vi.fn(),
    });
    registerQuickPromptShortcut();

    electronState.getShortcutHandler()?.();
    const promptWindow = electronState.getWindow();
    electronState.getShortcutHandler()?.();
    promptWindow?.emitOnce("ready-to-show");

    expect(promptWindow?.isVisible()).toBe(false);
    expect(promptWindow?.focus).toHaveBeenCalledTimes(1);
  });

  it("keeps the intentional app focus handoff after submit", async () => {
    vi.resetModules();
    const { registerQuickPromptIpc, registerQuickPromptShortcut } =
      await import("./quick-prompt.js");
    const createCodeAgentRun = vi.fn(async () => ({
      ok: true,
      message: "Run created",
      run: {
        id: "run-1",
        goalId: "goal-1",
        title: "Prompt",
        status: "queued" as const,
        createdAt: "2026-08-10T00:00:00.000Z",
        updatedAt: "2026-08-10T00:00:00.000Z",
      },
    }));
    const sendOpenRequestToRenderer = vi.fn();

    registerQuickPromptIpc({
      createCodeAgentRun,
      sendOpenRequestToRenderer,
    });
    registerQuickPromptShortcut();
    electronState.getShortcutHandler()?.();

    const submit = electronState.ipcMain.handlers.get(IPC.QUICK_PROMPT_SUBMIT);
    const result = await submit?.(undefined, { prompt: "Investigate this" });

    expect(result).toMatchObject({ ok: true });
    expect(sendOpenRequestToRenderer).toHaveBeenCalledWith(
      {
        app: CODE_AGENTS_SURFACE_ID,
        goalId: "goal-1",
        runId: "run-1",
      },
      { stealFocus: true },
    );
    expect(electronState.getWindow()?.hide).toHaveBeenCalled();
  });
});
