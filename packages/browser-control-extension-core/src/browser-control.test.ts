import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BrowserControlService } from "./browser-control";

describe("BrowserControlService", () => {
  const debuggerMethods: string[] = [];
  const detach = vi.fn();
  const createTab = vi.fn();
  const getTab = vi.fn();
  const removeTab = vi.fn();
  const sendCommand = vi.fn();
  const persist = vi.fn();

  beforeEach(() => {
    debuggerMethods.length = 0;
    detach.mockReset();
    detach.mockImplementation(
      (_source: chrome.debugger.Debuggee, callback?: () => void) =>
        callback?.(),
    );
    createTab.mockReset();
    createTab.mockImplementation(
      (
        options: chrome.tabs.CreateProperties,
        callback?: (tab: chrome.tabs.Tab) => void,
      ) =>
        callback?.({
          id: 77,
          url: options.url,
          active: false,
        } as chrome.tabs.Tab),
    );
    removeTab.mockReset();
    removeTab.mockImplementation((_tabId: number, callback?: () => void) =>
      callback?.(),
    );
    getTab.mockReset();
    getTab.mockImplementation(
      (tabId: number, callback: (tab: chrome.tabs.Tab) => void) =>
        callback({
          id: tabId,
          url: "https://example.com/page",
        } as chrome.tabs.Tab),
    );
    sendCommand.mockReset();
    sendCommand.mockImplementation(
      (
        _source: chrome.debugger.Debuggee,
        method: string,
        _params: object | undefined,
        callback?: (result: unknown) => void,
      ) => {
        debuggerMethods.push(method);
        callback?.({});
      },
    );
    persist.mockReset();
    persist.mockResolvedValue(undefined);

    const chromeMock = {
      runtime: { lastError: undefined },
      tabs: {
        get: getTab,
        create: createTab,
        remove: removeTab,
      },
      debugger: {
        attach: vi.fn(
          (
            _source: chrome.debugger.Debuggee,
            _version: string,
            callback?: () => void,
          ) => callback?.(),
        ),
        detach,
        sendCommand,
      },
      storage: {
        session: {
          get: vi.fn(async () => ({})),
          set: persist,
        },
      },
    };

    vi.stubGlobal("chrome", chromeMock as unknown as typeof chrome);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("detaches a task when its tab leaves the exact allowed origin", async () => {
    const service = new BrowserControlService();

    await service.execute({
      id: "attach-request",
      taskId: "task-1",
      command: {
        type: "attach",
        tabId: 42,
        allowedOrigins: ["https://example.com"],
      },
    });

    expect(service.activeTaskCount).toBe(1);

    await service.enforceTabOrigin(42, "https://other.example/page");

    expect(service.activeTaskCount).toBe(0);
    expect(detach).toHaveBeenCalledWith({ tabId: 42 }, expect.any(Function));
  });

  it("never uses unrestricted runtime evaluation", async () => {
    const service = new BrowserControlService();

    await service.execute({
      id: "attach-request",
      taskId: "task-1",
      command: {
        type: "attach",
        tabId: 42,
        allowedOrigins: ["https://example.com"],
      },
    });
    await service.emergencyStopAll();

    expect(debuggerMethods).not.toContain("Runtime.evaluate");
  });

  it("rechecks ownership before committing concurrent attaches", async () => {
    let resolveFirstPersist: (() => void) | undefined;
    persist.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFirstPersist = resolve;
        }),
    );
    const service = new BrowserControlService();

    const firstAttach = service.execute({
      id: "first-attach-request",
      taskId: "task-1",
      command: {
        type: "attach",
        tabId: 42,
        allowedOrigins: ["https://example.com"],
      },
    });
    await vi.waitFor(() => expect(resolveFirstPersist).toBeDefined());

    const secondAttach = service
      .execute({
        id: "second-attach-request",
        taskId: "task-2",
        command: {
          type: "attach",
          tabId: 42,
          allowedOrigins: ["https://example.com"],
        },
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    resolveFirstPersist?.();

    await expect(firstAttach).resolves.toEqual({
      tabId: 42,
      origin: "https://example.com",
    });
    await expect(secondAttach).resolves.toMatchObject({
      code: "TAB_ALREADY_OWNED",
    });
    expect(service.activeTaskCount).toBe(1);
  });

  it("creates and controls a new tab without activating Chrome", async () => {
    const service = new BrowserControlService();

    await service.execute({
      id: "attach-request",
      taskId: "task-1",
      command: {
        type: "attach",
        tabId: 42,
        allowedOrigins: ["https://example.com"],
      },
    });

    await expect(
      service.execute({
        id: "open-tab-request",
        taskId: "task-1",
        command: {
          type: "open-tab",
          url: "https://example.com/next",
        },
      }),
    ).resolves.toEqual({
      url: "https://example.com/next",
      origin: "https://example.com",
      active: false,
    });

    expect(createTab).toHaveBeenCalledWith(
      { url: "https://example.com/next", active: false },
      expect.any(Function),
    );
    expect(detach).toHaveBeenCalledWith({ tabId: 42 }, expect.any(Function));
  });

  it("keeps the current lease when handoff persistence fails", async () => {
    const service = new BrowserControlService();

    await service.execute({
      id: "attach-request",
      taskId: "task-1",
      command: {
        type: "attach",
        tabId: 42,
        allowedOrigins: ["https://example.com"],
      },
    });
    persist.mockRejectedValueOnce(new Error("session storage unavailable"));

    const openError = await service
      .execute({
        id: "open-tab-request",
        taskId: "task-1",
        command: {
          type: "open-tab",
          url: "https://example.com/next",
        },
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(openError).toMatchObject({
      message: "session storage unavailable",
    });
    expect(removeTab).toHaveBeenCalledWith(77, expect.any(Function));
    expect(service.activeTaskCount).toBe(1);
  });

  it("revalidates a new tab before committing its exact-origin lease", async () => {
    const responses: chrome.tabs.Tab[] = [
      { id: 42, url: "https://example.com/page" } as chrome.tabs.Tab,
      { id: 42, url: "https://example.com/page" } as chrome.tabs.Tab,
      { id: 42, url: "https://example.com/page" } as chrome.tabs.Tab,
      { id: 77, url: "https://example.com/next" } as chrome.tabs.Tab,
      { id: 77, url: "https://other.example/redirect" } as chrome.tabs.Tab,
    ];
    getTab.mockReset();
    getTab.mockImplementation(
      (_tabId: number, callback: (tab: chrome.tabs.Tab) => void) => {
        const tab = responses.shift();
        if (!tab) throw new Error("Unexpected tab lookup.");
        callback(tab);
      },
    );
    const service = new BrowserControlService();

    await service.execute({
      id: "attach-request",
      taskId: "task-1",
      command: {
        type: "attach",
        tabId: 42,
        allowedOrigins: ["https://example.com"],
      },
    });

    const openError = await service
      .execute({
        id: "open-tab-request",
        taskId: "task-1",
        command: {
          type: "open-tab",
          url: "https://example.com/next",
        },
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(openError).toMatchObject({ code: "ORIGIN_NOT_ALLOWED" });
    expect(removeTab).toHaveBeenCalledWith(77, expect.any(Function));
    expect(service.activeTaskCount).toBe(1);
  });

  it("persists the stopped state after a cancelled handoff", async () => {
    const service = new BrowserControlService();

    await service.execute({
      id: "attach-request",
      taskId: "task-1",
      command: {
        type: "attach",
        tabId: 42,
        allowedOrigins: ["https://example.com"],
      },
    });

    let resolveHandoffPersist: (() => void) | undefined;
    persist.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveHandoffPersist = resolve;
        }),
    );
    const openPromise = service
      .execute({
        id: "open-tab-request",
        taskId: "task-1",
        command: {
          type: "open-tab",
          url: "https://example.com/next",
        },
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    await vi.waitFor(() => expect(resolveHandoffPersist).toBeDefined());

    const stopPromise = service.execute({
      id: "stop-request",
      taskId: "task-1",
      command: { type: "stop" },
    });
    resolveHandoffPersist?.();

    const openError = await openPromise;
    await stopPromise;
    expect(openError).toMatchObject({ code: "TASK_HANDOFF_CANCELLED" });
    const lastPersisted = persist.mock.calls.at(-1)?.[0] as {
      agentNativeBrowserTaskSessions?: unknown[];
    };
    expect(lastPersisted.agentNativeBrowserTaskSessions).toEqual([]);
  });

  it("reserves a created tab until its handoff finishes", async () => {
    let releaseTabLookup: (() => void) | undefined;
    let blockNewTabLookup = true;
    getTab.mockImplementation(
      (tabId: number, callback: (tab: chrome.tabs.Tab) => void) => {
        if (tabId === 77 && blockNewTabLookup) {
          blockNewTabLookup = false;
          releaseTabLookup = () =>
            callback({
              id: 77,
              url: "https://example.com/next",
            } as chrome.tabs.Tab);
          return;
        }
        callback({
          id: tabId,
          url: "https://example.com/page",
        } as chrome.tabs.Tab);
      },
    );
    const service = new BrowserControlService();

    await service.execute({
      id: "attach-request",
      taskId: "task-1",
      command: {
        type: "attach",
        tabId: 42,
        allowedOrigins: ["https://example.com"],
      },
    });
    const openPromise = service.execute({
      id: "open-tab-request",
      taskId: "task-1",
      command: {
        type: "open-tab",
        url: "https://example.com/next",
      },
    });
    await vi.waitFor(() => expect(releaseTabLookup).toBeDefined());

    const competingError = await service
      .execute({
        id: "competing-attach-request",
        taskId: "task-2",
        command: {
          type: "attach",
          tabId: 77,
          allowedOrigins: ["https://example.com"],
        },
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    releaseTabLookup?.();

    await expect(openPromise).resolves.toEqual({
      url: "https://example.com/next",
      origin: "https://example.com",
      active: false,
    });
    expect(competingError).toMatchObject({ code: "TAB_ALREADY_OWNED" });
    expect(removeTab).not.toHaveBeenCalled();
  });

  it("removes a background tab when Chrome violates the inactive contract", async () => {
    createTab.mockImplementationOnce(
      (
        options: chrome.tabs.CreateProperties,
        callback?: (tab: chrome.tabs.Tab) => void,
      ) =>
        callback?.({
          id: 77,
          url: options.url,
          active: true,
        } as chrome.tabs.Tab),
    );
    const service = new BrowserControlService();

    await service.execute({
      id: "attach-request",
      taskId: "task-1",
      command: {
        type: "attach",
        tabId: 42,
        allowedOrigins: ["https://example.com"],
      },
    });

    const openError = await service
      .execute({
        id: "open-tab-request",
        taskId: "task-1",
        command: {
          type: "open-tab",
          url: "https://example.com/next",
        },
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(openError).toMatchObject({ code: "TAB_NOT_BACKGROUND" });

    expect(removeTab).toHaveBeenCalledWith(77, expect.any(Function));
    expect(service.activeTaskCount).toBe(1);
  });

  it("does not resurrect a lease when stopped during tab handoff", async () => {
    let resolveCreatedTab: ((tab: chrome.tabs.Tab) => void) | undefined;
    createTab.mockImplementationOnce(
      (
        _options: chrome.tabs.CreateProperties,
        callback?: (tab: chrome.tabs.Tab) => void,
      ) => {
        resolveCreatedTab = callback;
      },
    );
    const service = new BrowserControlService();

    await service.execute({
      id: "attach-request",
      taskId: "task-1",
      command: {
        type: "attach",
        tabId: 42,
        allowedOrigins: ["https://example.com"],
      },
    });

    const openPromise = service
      .execute({
        id: "open-tab-request",
        taskId: "task-1",
        command: {
          type: "open-tab",
          url: "https://example.com/next",
        },
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    await vi.waitFor(() => expect(createTab).toHaveBeenCalledTimes(1));

    await service.execute({
      id: "stop-request",
      taskId: "task-1",
      command: { type: "stop" },
    });
    resolveCreatedTab?.({
      id: 77,
      url: "https://example.com/next",
      active: false,
    } as chrome.tabs.Tab);

    const openError = await openPromise;
    expect(openError).toMatchObject({
      code: "TASK_HANDOFF_CANCELLED",
    });
    expect(removeTab).toHaveBeenCalledWith(77, expect.any(Function));
    expect(service.activeTaskCount).toBe(0);
  });

  it("cancels a normal attach that is in flight when stopped", async () => {
    let releasePageEnable: (() => void) | undefined;
    sendCommand.mockImplementation(
      (
        _source: chrome.debugger.Debuggee,
        method: string,
        _params: object | undefined,
        callback?: (result: unknown) => void,
      ) => {
        debuggerMethods.push(method);
        if (method === "Page.enable" && !releasePageEnable) {
          releasePageEnable = () => callback?.({});
          return;
        }
        callback?.({});
      },
    );
    const service = new BrowserControlService();

    const attachPromise = service
      .execute({
        id: "attach-request",
        taskId: "task-1",
        command: {
          type: "attach",
          tabId: 42,
          allowedOrigins: ["https://example.com"],
        },
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    await vi.waitFor(() => expect(releasePageEnable).toBeDefined());

    await expect(
      service.execute({
        id: "stop-request",
        taskId: "task-1",
        command: { type: "stop" },
      }),
    ).resolves.toEqual({ detached: true });
    releasePageEnable?.();

    await expect(attachPromise).resolves.toMatchObject({
      code: "TASK_HANDOFF_CANCELLED",
    });
    expect(service.activeTaskCount).toBe(0);
    expect(detach).toHaveBeenCalledWith({ tabId: 42 }, expect.any(Function));
  });

  it("cancels a normal attach that is in flight during emergency stop", async () => {
    let releasePageEnable: (() => void) | undefined;
    sendCommand.mockImplementation(
      (
        _source: chrome.debugger.Debuggee,
        method: string,
        _params: object | undefined,
        callback?: (result: unknown) => void,
      ) => {
        debuggerMethods.push(method);
        if (method === "Page.enable" && !releasePageEnable) {
          releasePageEnable = () => callback?.({});
          return;
        }
        callback?.({});
      },
    );
    const service = new BrowserControlService();

    const attachPromise = service
      .execute({
        id: "attach-request",
        taskId: "task-1",
        command: {
          type: "attach",
          tabId: 42,
          allowedOrigins: ["https://example.com"],
        },
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    await vi.waitFor(() => expect(releasePageEnable).toBeDefined());

    const emergencyStop = service.emergencyStopAll();
    releasePageEnable?.();

    await expect(attachPromise).resolves.toMatchObject({
      code: "TASK_HANDOFF_CANCELLED",
    });
    await expect(emergencyStop).resolves.toBeUndefined();
    expect(service.activeTaskCount).toBe(0);
    expect(detach).toHaveBeenCalledWith({ tabId: 42 }, expect.any(Function));
    expect(persist).toHaveBeenLastCalledWith({
      agentNativeBrowserTaskSessions: [],
    });
  });

  it("reserves a tab until the physical debugger teardown finishes", async () => {
    let releaseDebuggerDetach: (() => void) | undefined;
    detach.mockImplementationOnce(
      (_source: chrome.debugger.Debuggee, callback?: () => void) => {
        releaseDebuggerDetach = () => callback?.();
      },
    );
    const service = new BrowserControlService();

    await service.execute({
      id: "attach-request",
      taskId: "task-1",
      command: {
        type: "attach",
        tabId: 42,
        allowedOrigins: ["https://example.com"],
      },
    });

    const stopPromise = service.execute({
      id: "stop-request",
      taskId: "task-1",
      command: { type: "stop" },
    });
    await vi.waitFor(() => expect(releaseDebuggerDetach).toBeDefined());

    const competingError = await service
      .execute({
        id: "competing-attach-request",
        taskId: "task-2",
        command: {
          type: "attach",
          tabId: 42,
          allowedOrigins: ["https://example.com"],
        },
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(competingError).toMatchObject({ code: "TAB_ALREADY_OWNED" });
    releaseDebuggerDetach?.();
    await expect(stopPromise).resolves.toEqual({ detached: true });
    expect(service.activeTaskCount).toBe(0);
  });
});
