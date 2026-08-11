import { CODE_AGENTS_SURFACE_ID } from "@shared/code-agents";
import { IPC } from "@shared/ipc-channels";
import { beforeEach, describe, expect, it, vi } from "vitest";

const electronState = vi.hoisted(() => {
  type Handler = (...args: any[]) => unknown;

  const ipcHandlers = new Map<string, Handler>();
  const windows: MockBrowserWindow[] = [];
  let shortcutHandler: (() => void) | undefined;

  class MockBrowserWindow {
    private readonly onceHandlers = new Map<string, Handler>();
    private visible = false;
    private destroyed = false;

    readonly setAlwaysOnTop = vi.fn();
    readonly setVisibleOnAllWorkspaces = vi.fn();
    readonly getSize = vi.fn(() => [460, 108] as [number, number]);
    readonly setPosition = vi.fn();
    readonly loadFile = vi.fn();
    readonly show = vi.fn(() => {
      this.visible = true;
    });
    readonly focus = vi.fn();
    readonly hide = vi.fn(() => {
      this.visible = false;
    });
    readonly isVisible = vi.fn(() => this.visible);
    readonly isDestroyed = vi.fn(() => this.destroyed);
    readonly destroy = vi.fn(() => {
      this.destroyed = true;
    });
    readonly once = vi.fn((event: string, handler: Handler) => {
      this.onceHandlers.set(event, handler);
    });
    readonly on = vi.fn();

    constructor() {
      windows.push(this);
    }

    emitOnce(event: string): void {
      this.onceHandlers.get(event)?.();
    }
  }

  return {
    app: {
      isReady: vi.fn(() => true),
      focus: vi.fn(),
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
      on: vi.fn(),
    },
    screen: {
      getCursorScreenPoint: vi.fn(() => ({ x: 0, y: 0 })),
      getDisplayNearestPoint: vi.fn(() => ({
        workArea: { x: 0, y: 0, width: 1440, height: 900 },
      })),
    },
    getShortcutHandler: () => shortcutHandler,
    getWindow: () => windows[0],
    reset: () => {
      ipcHandlers.clear();
      windows.length = 0;
      shortcutHandler = undefined;
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

  it("focuses only the prompt on launch and focuses the app after submit", async () => {
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
    const promptWindow = electronState.getWindow();
    expect(promptWindow?.show).toHaveBeenCalled();
    expect(promptWindow?.focus).toHaveBeenCalled();
    expect(electronState.app.focus).not.toHaveBeenCalled();

    promptWindow?.emitOnce("ready-to-show");
    expect(electronState.app.focus).not.toHaveBeenCalled();

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
    expect(promptWindow?.hide).toHaveBeenCalled();
  });
});
