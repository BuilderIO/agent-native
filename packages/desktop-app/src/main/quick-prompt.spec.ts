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
    private size: [number, number] = [460, 108];
    private position: [number, number] = [0, 0];

    static getFocusedWindow = vi.fn(() => focusedWindow);

    readonly setAlwaysOnTop = vi.fn();
    readonly setVisibleOnAllWorkspaces = vi.fn();
    readonly setVibrancy = vi.fn();
    readonly setHasShadow = vi.fn();
    readonly getSize = vi.fn(() => this.size);
    readonly getPosition = vi.fn(() => this.position);
    readonly setSize = vi.fn((width: number, height: number) => {
      this.size = [width, height];
    });
    readonly setPosition = vi.fn((x: number, y: number) => {
      this.position = [x, y];
    });
    readonly webContents = {
      send: vi.fn(),
    };
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

const OWNER_A = "account:a@example.com";
const OWNER_B = "account:b@example.com";

describe("Quick Prompt focus behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electronState.reset();
    appStore.loadQuickPromptPreferences.mockReturnValue({ enabled: true });
  });

  it("restores the previously focused window instead of the main app on dismiss", async () => {
    vi.resetModules();
    const {
      isQuickPromptActive,
      registerQuickPromptIpc,
      registerQuickPromptShortcut,
    } = await import("./quick-prompt.js");

    registerQuickPromptIpc({
      getIdentityKey: () => OWNER_A,
      createCodeAgentRun: vi.fn(),
      sendOpenRequestToRenderer: vi.fn(),
    });
    registerQuickPromptShortcut();

    expect(isQuickPromptActive()).toBe(false);
    electronState.getShortcutHandler()?.();
    expect(isQuickPromptActive()).toBe(true);
    const promptWindow = electronState.getWindow();
    expect(promptWindow?.show).toHaveBeenCalled();
    expect(promptWindow?.focus).toHaveBeenCalled();
    expect(electronState.app.focus).not.toHaveBeenCalled();

    electronState.getShortcutHandler()?.();
    expect(isQuickPromptActive()).toBe(false);
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
      getIdentityKey: () => OWNER_A,
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
      getIdentityKey: () => OWNER_A,
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

  it("expands the picker bounds around the existing overlay center", async () => {
    vi.resetModules();
    const { registerQuickPromptIpc, registerQuickPromptShortcut } =
      await import("./quick-prompt.js");

    registerQuickPromptIpc({
      getIdentityKey: () => OWNER_A,
      createCodeAgentRun: vi.fn(),
      sendOpenRequestToRenderer: vi.fn(),
    });
    registerQuickPromptShortcut();
    electronState.getShortcutHandler()?.();

    const promptWindow = electronState.getWindow();
    expect(promptWindow?.getSize()).toEqual([460, 108]);
    expect(promptWindow?.getPosition()).toEqual([490, 396]);

    electronState.ipcMain.handlers.get(IPC.QUICK_PROMPT_SET_PICKER_OPEN)?.(
      undefined,
      true,
    );
    expect(promptWindow?.getSize()).toEqual([760, 360]);
    expect(promptWindow?.getPosition()).toEqual([340, 270]);
    if (process.platform === "darwin") {
      expect(promptWindow?.setVibrancy).toHaveBeenCalledWith(null);
      expect(promptWindow?.setHasShadow).toHaveBeenCalledWith(false);
    }

    electronState.ipcMain.handlers.get(IPC.QUICK_PROMPT_SET_PICKER_OPEN)?.(
      undefined,
      false,
    );
    expect(promptWindow?.getSize()).toEqual([460, 108]);
    expect(promptWindow?.getPosition()).toEqual([490, 396]);
    if (process.platform === "darwin") {
      expect(promptWindow?.setVibrancy).toHaveBeenLastCalledWith(
        "under-window",
      );
      expect(promptWindow?.setHasShadow).toHaveBeenLastCalledWith(true);
    }
  });

  it("expands for setup and opens provider settings from the setup card", async () => {
    vi.resetModules();
    const { registerQuickPromptIpc, registerQuickPromptShortcut } =
      await import("./quick-prompt.js");
    const sendOpenRequestToRenderer = vi.fn();

    registerQuickPromptIpc({
      getIdentityKey: () => OWNER_A,
      createCodeAgentRun: vi.fn(),
      sendOpenRequestToRenderer,
    });
    registerQuickPromptShortcut();
    electronState.getShortcutHandler()?.();

    const promptWindow = electronState.getWindow();
    electronState.ipcMain.handlers.get(IPC.QUICK_PROMPT_SET_SETUP_REQUIRED)?.(
      undefined,
      true,
    );
    expect(promptWindow?.getSize()).toEqual([460, 244]);

    electronState.ipcMain.handlers.get(
      IPC.QUICK_PROMPT_OPEN_PROVIDER_SETTINGS,
    )?.();
    expect(promptWindow?.isVisible()).toBe(false);
    expect(sendOpenRequestToRenderer).toHaveBeenCalledWith(
      { settingsTab: "providers" },
      { stealFocus: true },
    );
  });

  it("restores setup height when reopening the reused prompt after dismissal", async () => {
    vi.resetModules();
    const { registerQuickPromptIpc, registerQuickPromptShortcut } =
      await import("./quick-prompt.js");

    registerQuickPromptIpc({
      getIdentityKey: () => OWNER_A,
      createCodeAgentRun: vi.fn(),
      sendOpenRequestToRenderer: vi.fn(),
    });
    registerQuickPromptShortcut();
    electronState.getShortcutHandler()?.();

    const promptWindow = electronState.getWindow();
    electronState.ipcMain.handlers.get(IPC.QUICK_PROMPT_SET_SETUP_REQUIRED)?.(
      undefined,
      true,
    );
    expect(promptWindow?.getSize()).toEqual([460, 244]);

    electronState.ipcMain.handlers.get(IPC.QUICK_PROMPT_DISMISS)?.();
    expect(promptWindow?.isVisible()).toBe(false);
    expect(promptWindow?.getSize()).toEqual([460, 108]);

    electronState.getShortcutHandler()?.();

    expect(electronState.getWindow()).toBe(promptWindow);
    expect(promptWindow?.isVisible()).toBe(true);
    expect(promptWindow?.getSize()).toEqual([460, 244]);
  });

  it("does not resurrect after dismissal before ready-to-show", async () => {
    vi.resetModules();
    const { registerQuickPromptIpc, registerQuickPromptShortcut } =
      await import("./quick-prompt.js");

    registerQuickPromptIpc({
      getIdentityKey: () => OWNER_A,
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
      getIdentityKey: () => OWNER_A,
      createCodeAgentRun,
      sendOpenRequestToRenderer,
    });
    registerQuickPromptShortcut();
    electronState.getShortcutHandler()?.();

    const submit = electronState.ipcMain.handlers.get(IPC.QUICK_PROMPT_SUBMIT);
    const result = await submit?.(undefined, {
      prompt: "Investigate this",
      engine: "codex-cli",
      model: "gpt-5.6-luna",
      effort: "high",
    });

    expect(result).toMatchObject({ ok: true });
    expect(createCodeAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Investigate this",
        engine: "codex-cli",
        model: "gpt-5.6-luna",
        effort: "high",
        metadata: { source: "quick-prompt" },
      }),
    );
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

describe("Quick Prompt account changes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electronState.reset();
    appStore.loadQuickPromptPreferences.mockReturnValue({ enabled: true });
  });

  async function openForAccount(email: string | null) {
    vi.resetModules();
    const quickPrompt = await import("./quick-prompt.js");
    quickPrompt.registerQuickPromptIpc({
      getIdentityKey: () => OWNER_A,
      createCodeAgentRun: vi.fn(),
      sendOpenRequestToRenderer: vi.fn(),
    });
    quickPrompt.registerQuickPromptShortcut();
    quickPrompt.noteQuickPromptIdentity(
      quickPrompt.quickPromptIdentityKey("signed-in", email),
    );
    electronState.getShortcutHandler()?.();
    const first = electronState.getWindow();
    electronState.getShortcutHandler()?.();
    return { quickPrompt, first };
  }

  it("destroys the window when the account changes and opens a fresh one", async () => {
    const { quickPrompt, first } = await openForAccount("a@example.com");

    quickPrompt.noteQuickPromptIdentity(
      quickPrompt.quickPromptIdentityKey("signed-in", "b@example.com"),
    );
    expect(first?.destroy).toHaveBeenCalledTimes(1);

    electronState.getShortcutHandler()?.();
    expect(electronState.getWindow()).not.toBe(first);
    expect(electronState.getWindow()?.show).toHaveBeenCalled();
  });

  it("destroys the window on sign-out", async () => {
    const { quickPrompt, first } = await openForAccount("a@example.com");

    quickPrompt.noteQuickPromptIdentity(
      quickPrompt.quickPromptIdentityKey("idle", null),
    );
    expect(first?.destroy).toHaveBeenCalledTimes(1);
  });

  it("destroys the window when the signed-in account cannot be read", async () => {
    const { quickPrompt, first } = await openForAccount("a@example.com");

    quickPrompt.noteQuickPromptIdentity(
      quickPrompt.quickPromptIdentityKey("signed-in", null),
    );
    expect(first?.destroy).toHaveBeenCalledTimes(1);
  });

  it("keeps a startup window when the first note matches the window's owner", async () => {
    vi.resetModules();
    const quickPrompt = await import("./quick-prompt.js");
    quickPrompt.registerQuickPromptIpc({
      getIdentityKey: () => "no-account",
      createCodeAgentRun: vi.fn(),
      sendOpenRequestToRenderer: vi.fn(),
    });
    quickPrompt.registerQuickPromptShortcut();
    electronState.getShortcutHandler()?.();
    const first = electronState.getWindow();

    quickPrompt.noteQuickPromptIdentity(
      quickPrompt.quickPromptIdentityKey("sign-in-required", null),
    );

    expect(first?.destroy).not.toHaveBeenCalled();
    electronState.getShortcutHandler()?.();
    expect(electronState.getWindow()).toBe(first);
  });

  it("keeps the window when a status refresh reports the same account", async () => {
    const { quickPrompt, first } = await openForAccount("a@example.com");

    quickPrompt.noteQuickPromptIdentity(
      quickPrompt.quickPromptIdentityKey("signed-in", "a@example.com"),
    );
    expect(first?.destroy).not.toHaveBeenCalled();

    electronState.getShortcutHandler()?.();
    expect(electronState.getWindow()).toBe(first);
  });
});

describe("Quick Prompt owner binding", () => {
  let currentOwner: string | null;

  beforeEach(() => {
    vi.clearAllMocks();
    electronState.reset();
    appStore.loadQuickPromptPreferences.mockReturnValue({ enabled: true });
    currentOwner = OWNER_A;
  });

  function createdRun() {
    return {
      ok: true as const,
      message: "Run created",
      run: {
        id: "run-1",
        goalId: "goal-1",
        title: "Prompt",
        status: "queued" as const,
        createdAt: "2026-08-10T00:00:00.000Z",
        updatedAt: "2026-08-10T00:00:00.000Z",
      },
    };
  }

  // The owner changes without the broker's status callback ever running.
  async function openForA(
    createCodeAgentRun: () => Promise<
      ReturnType<typeof createdRun>
    > = async () => createdRun(),
  ) {
    vi.resetModules();
    const quickPrompt = await import("./quick-prompt.js");
    const sendOpenRequestToRenderer = vi.fn();
    const runCreator = vi.fn(createCodeAgentRun);
    quickPrompt.registerQuickPromptIpc({
      getIdentityKey: () => currentOwner,
      createCodeAgentRun: runCreator,
      sendOpenRequestToRenderer,
    });
    quickPrompt.registerQuickPromptShortcut();
    electronState.getShortcutHandler()?.();
    const first = electronState.getWindow();
    return { first, sendOpenRequestToRenderer, runCreator };
  }

  const submit = (prompt = "A private notes") =>
    electronState.ipcMain.handlers.get(IPC.QUICK_PROMPT_SUBMIT)?.(undefined, {
      prompt,
    });

  it("replaces the window at show when only the verified email changed", async () => {
    const { first } = await openForA();
    electronState.getShortcutHandler()?.();

    currentOwner = OWNER_B;
    electronState.getShortcutHandler()?.();

    expect(first?.destroy).toHaveBeenCalledTimes(1);
    expect(electronState.getWindow()).not.toBe(first);
    expect(electronState.getWindow()?.show).toHaveBeenCalled();
  });

  it("replaces the window at show when the owner cannot be read", async () => {
    const { first } = await openForA();
    electronState.getShortcutHandler()?.();

    currentOwner = null;
    electronState.getShortcutHandler()?.();

    expect(first?.destroy).toHaveBeenCalledTimes(1);
    expect(electronState.getWindow()).not.toBe(first);
  });

  it("keeps the window at show for the same owner", async () => {
    const { first } = await openForA();
    electronState.getShortcutHandler()?.();

    electronState.getShortcutHandler()?.();

    expect(first?.destroy).not.toHaveBeenCalled();
    expect(electronState.getWindow()).toBe(first);
    expect(first?.show).toHaveBeenCalledTimes(2);
  });

  it("refuses a submission when only the verified email changed", async () => {
    const { first, sendOpenRequestToRenderer, runCreator } = await openForA();
    currentOwner = OWNER_B;

    const result = await submit();

    expect(result).toMatchObject({ ok: false });
    expect(runCreator).not.toHaveBeenCalled();
    expect(first?.destroy).toHaveBeenCalledTimes(1);
    expect(sendOpenRequestToRenderer).not.toHaveBeenCalled();
  });

  it("opens the run for a same-owner submission", async () => {
    const { first, sendOpenRequestToRenderer } = await openForA();

    const result = await submit();

    expect(result).toMatchObject({ ok: true });
    expect(first?.destroy).not.toHaveBeenCalled();
    expect(sendOpenRequestToRenderer).toHaveBeenCalledWith(
      { app: CODE_AGENTS_SURFACE_ID, goalId: "goal-1", runId: "run-1" },
      { stealFocus: true },
    );
  });

  it("opens and focuses nothing when the owner changes during run creation", async () => {
    let finishRun: (value: ReturnType<typeof createdRun>) => void = () => {};
    const runCreation = new Promise<ReturnType<typeof createdRun>>(
      (resolve) => {
        finishRun = resolve;
      },
    );
    const { first, sendOpenRequestToRenderer } = await openForA(
      () => runCreation,
    );
    const focusCalls = first?.focus.mock.calls.length;

    const pending = submit();
    currentOwner = OWNER_B;
    finishRun(createdRun());
    const result = await pending;

    expect(result).toMatchObject({ ok: true });
    expect(sendOpenRequestToRenderer).not.toHaveBeenCalled();
    expect(first?.hide).not.toHaveBeenCalled();
    expect(first?.focus.mock.calls.length).toBe(focusCalls);
    expect(electronState.app.focus).not.toHaveBeenCalled();
  });
});

describe("Quick Prompt owner changes from the identity broker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    electronState.reset();
    appStore.loadQuickPromptPreferences.mockReturnValue({ enabled: true });
  });

  function deferredResponse() {
    let resolve: (value: Response) => void = () => {};
    const promise = new Promise<Response>((resolvePromise) => {
      resolve = resolvePromise;
    });
    return { promise, resolve };
  }

  const emailResponse = (email: string) =>
    new Response(JSON.stringify({ email }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  async function brokerWithQuickPrompt(identityFetch: () => Promise<Response>) {
    vi.resetModules();
    const quickPrompt = await import("./quick-prompt.js");
    const { DesktopIdentityBroker } = await import("./desktop-identity.js");
    const authority = {
      id: "dispatch",
      origin: "https://dispatch.example.test",
      cookieNames: ["an_session_dispatch"],
      cookieNamesToClear: ["an_session_dispatch"],
      workspaceSso: true,
      identityAuthority: true,
      session: {} as Electron.Session,
    };
    const broker = new DesktopIdentityBroker({
      identitySession: {
        cookies: { get: vi.fn(async () => []) },
        fetch: vi.fn(identityFetch),
        clearStorageData: vi.fn(async () => {}),
      } as unknown as Electron.Session,
      resolveApp: (id) => (id === authority.id ? authority : null),
      createWindow: vi.fn() as never,
      reloadApp: vi.fn(),
      clearLocalBroker: vi.fn(),
      statusRevalidationIntervalMs: 0,
      onOwnerChange: quickPrompt.noteQuickPromptIdentity,
    });
    quickPrompt.registerQuickPromptIpc({
      getIdentityKey: () =>
        quickPrompt.quickPromptIdentityKey(
          broker.getStatus(),
          broker.getVerifiedEmail(),
        ),
      createCodeAgentRun: vi.fn(),
      sendOpenRequestToRenderer: vi.fn(),
    });
    quickPrompt.registerQuickPromptShortcut();
    return { broker, authority };
  }

  it("destroys a visible window when only the verified email changes", async () => {
    const second = deferredResponse();
    const fetches = [
      () => Promise.resolve(emailResponse("a@example.com")),
      () => second.promise,
    ];
    const { broker, authority } = await brokerWithQuickPrompt(
      () => fetches.shift()?.() ?? Promise.reject(new Error("unexpected")),
    );
    await broker.refreshStatus(authority);
    expect(broker.getStatus()).toBe("signed-in");

    const refresh = broker.refreshStatus(authority);
    electronState.getShortcutHandler()?.();
    const visible = electronState.getWindow();
    expect(visible?.show).toHaveBeenCalled();
    expect(visible?.destroy).not.toHaveBeenCalled();

    second.resolve(emailResponse("b@example.com"));
    await refresh;

    expect(broker.getStatus()).toBe("signed-in");
    expect(broker.getVerifiedEmail()).toBe("b@example.com");
    expect(visible?.destroy).toHaveBeenCalledTimes(1);
  });

  it("keeps a visible window while the same owner is verified again", async () => {
    const second = deferredResponse();
    const fetches = [
      () => Promise.resolve(emailResponse("a@example.com")),
      () => second.promise,
    ];
    const { broker, authority } = await brokerWithQuickPrompt(
      () => fetches.shift()?.() ?? Promise.reject(new Error("unexpected")),
    );
    await broker.refreshStatus(authority);

    const refresh = broker.refreshStatus(authority);
    electronState.getShortcutHandler()?.();
    const visible = electronState.getWindow();
    second.resolve(emailResponse("a@example.com"));
    await refresh;

    expect(visible?.destroy).not.toHaveBeenCalled();
  });

  it("keeps a startup window when the first status note keeps the start owner", async () => {
    const first = deferredResponse();
    const { broker, authority } = await brokerWithQuickPrompt(
      () => first.promise,
    );

    const refresh = broker.refreshStatus(authority);
    electronState.getShortcutHandler()?.();
    const startup = electronState.getWindow();
    first.resolve(new Response(null, { status: 401 }));
    await refresh;

    expect(broker.getStatus()).toBe("sign-in-required");
    expect(startup?.destroy).not.toHaveBeenCalled();
  });
});
