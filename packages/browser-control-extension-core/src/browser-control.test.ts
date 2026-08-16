import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BrowserControlService } from "./browser-control";

describe("BrowserControlService", () => {
  const debuggerMethods: string[] = [];
  const detach = vi.fn();
  const createTab = vi.fn();
  const getTab = vi.fn();
  const removeTab = vi.fn();
  const sendCommand = vi.fn();
  const storageGet = vi.fn();
  const persist = vi.fn();
  let runtimeLastError: { message?: string } | undefined;

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
    runtimeLastError = undefined;
    storageGet.mockReset();
    storageGet.mockResolvedValue({});
    persist.mockReset();
    persist.mockResolvedValue(undefined);

    const chromeMock = {
      runtime: {
        get lastError() {
          return runtimeLastError;
        },
      },
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
          get: storageGet,
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

  it("does not restore a superseded lease after committed handoff cancellation", async () => {
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

    let releaseOldDetach: (() => void) | undefined;
    detach.mockImplementationOnce(
      (_source: chrome.debugger.Debuggee, callback?: () => void) => {
        releaseOldDetach = callback;
      },
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
    await vi.waitFor(() => expect(releaseOldDetach).toBeDefined());

    const internals = service as unknown as {
      invalidateTask(taskId: string): void;
    };
    internals.invalidateTask("task-1");
    releaseOldDetach?.();

    await expect(openPromise).resolves.toMatchObject({
      code: "TASK_HANDOFF_CANCELLED",
    });
    expect(persist).toHaveBeenLastCalledWith({
      agentNativeBrowserTaskSessions: [],
      agentNativeBrowserPendingTeardowns: [],
    });
    expect(removeTab).toHaveBeenCalledWith(77, expect.any(Function));
    expect(service.activeTaskCount).toBe(0);
  });

  it("waits for an in-flight background tab creation during emergency stop", async () => {
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

    let emergencySettled = false;
    const emergencyStop = service.emergencyStopAll().then(() => {
      emergencySettled = true;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(emergencySettled).toBe(false);

    resolveCreatedTab?.({
      id: 77,
      url: "https://example.com/next",
      active: false,
    } as chrome.tabs.Tab);

    await expect(openPromise).resolves.toMatchObject({
      code: "TASK_HANDOFF_CANCELLED",
    });
    await expect(emergencyStop).resolves.toBeUndefined();
    expect(removeTab).toHaveBeenCalledWith(77, expect.any(Function));
    expect(service.activeTaskCount).toBe(0);
  });

  it("rejects new browser commands while emergency stop is active", async () => {
    const service = new BrowserControlService();
    let releaseDetach: (() => void) | undefined;
    detach.mockImplementationOnce(
      (_source: chrome.debugger.Debuggee, callback?: () => void) => {
        releaseDetach = callback;
      },
    );

    await service.execute({
      id: "attach-request",
      taskId: "task-1",
      command: {
        type: "attach",
        tabId: 42,
        allowedOrigins: ["https://example.com"],
      },
    });
    const emergencyStop = service.emergencyStopAll();

    await expect(
      service.execute({
        id: "late-attach-request",
        taskId: "task-2",
        command: {
          type: "attach",
          tabId: 43,
          allowedOrigins: ["https://example.com"],
        },
      }),
    ).rejects.toMatchObject({ code: "BROWSER_STOPPING" });

    releaseDetach?.();
    await expect(emergencyStop).resolves.toBeUndefined();
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

  it("keeps the original lease when a reserved handoff tab detaches", async () => {
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
    await vi.waitFor(() => expect(releaseTabLookup).toBeDefined());

    const detachEvent = service.handleDebuggerDetach(77);
    expect(service.activeTaskCount).toBe(1);
    releaseTabLookup?.();

    const openError = await openPromise;
    await detachEvent;
    expect(openError).toMatchObject({ code: "TASK_HANDOFF_CANCELLED" });
    expect(service.activeTaskCount).toBe(1);
    expect(removeTab).toHaveBeenCalledWith(77, expect.any(Function));
  });

  it("retains a superseded tab reservation when debugger teardown fails", async () => {
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
    detach.mockImplementationOnce(
      (_source: chrome.debugger.Debuggee, callback?: () => void) => {
        runtimeLastError = { message: "old debugger detach failed" };
        callback?.();
        runtimeLastError = undefined;
      },
    );

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
    expect(persist).toHaveBeenLastCalledWith({
      agentNativeBrowserTaskSessions: [
        {
          taskId: "task-1",
          tabId: 77,
          allowedOrigins: ["https://example.com"],
        },
      ],
      agentNativeBrowserPendingTeardowns: [{ taskId: "task-1", tabId: 42 }],
    });
    await expect(service.emergencyStopAll()).resolves.toBeUndefined();
    expect(service.activeTaskCount).toBe(0);
    expect(detach).toHaveBeenCalledWith({ tabId: 42 }, expect.any(Function));
  });

  it("retries a superseded teardown when stopping a live handoff", async () => {
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
    detach.mockImplementationOnce(
      (_source: chrome.debugger.Debuggee, callback?: () => void) => {
        runtimeLastError = { message: "old debugger detach failed" };
        callback?.();
        runtimeLastError = undefined;
      },
    );

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

    await expect(
      service.execute({
        id: "stop-request",
        taskId: "task-1",
        command: { type: "stop" },
      }),
    ).resolves.toEqual({ detached: true });
    expect(detach).toHaveBeenCalledTimes(3);
    expect(service.activeTaskCount).toBe(0);
  });

  it("coordinates stop with a handoff teardown already in progress", async () => {
    const service = new BrowserControlService();
    let releaseOldDetach: (() => void) | undefined;
    let detachCalls = 0;
    detach.mockImplementation(
      (_source: chrome.debugger.Debuggee, callback?: () => void) => {
        detachCalls += 1;
        if (detachCalls === 1) {
          releaseOldDetach = callback;
          return;
        }
        if (detachCalls === 3) {
          runtimeLastError = { message: "duplicate debugger detach" };
          callback?.();
          runtimeLastError = undefined;
          return;
        }
        callback?.();
      },
    );

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
    await vi.waitFor(() => expect(releaseOldDetach).toBeDefined());

    const stopPromise = service.execute({
      id: "stop-request",
      taskId: "task-1",
      command: { type: "stop" },
    });
    releaseOldDetach?.();

    await expect(openPromise).resolves.toMatchObject({
      code: "TASK_HANDOFF_CANCELLED",
    });
    await expect(stopPromise).resolves.toEqual({ detached: true });
    expect(detachCalls).toBe(2);
  });

  it("detaches the debugger when injected input release fails", async () => {
    sendCommand.mockImplementation(
      (
        _source: chrome.debugger.Debuggee,
        method: string,
        _params: object | undefined,
        callback?: (result: unknown) => void,
      ) => {
        debuggerMethods.push(method);
        if (method === "Input.dispatchMouseEvent") {
          runtimeLastError = { message: "input release failed" };
          callback?.({});
          runtimeLastError = undefined;
          return;
        }
        callback?.({});
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

    const stopError = await service
      .execute({
        id: "stop-request",
        taskId: "task-1",
        command: { type: "stop" },
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(stopError).toBeInstanceOf(AggregateError);
    expect(stopError).toMatchObject({
      message: "Could not release injected input.",
    });
    expect(detach).toHaveBeenCalledWith({ tabId: 42 }, expect.any(Function));
    expect(service.activeTaskCount).toBe(0);
  });

  it("retries a pending debugger teardown on a later stop", async () => {
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
    detach.mockImplementationOnce(
      (_source: chrome.debugger.Debuggee, callback?: () => void) => {
        runtimeLastError = { message: "first debugger detach failed" };
        callback?.();
        runtimeLastError = undefined;
      },
    );

    await expect(
      service.execute({
        id: "first-stop-request",
        taskId: "task-1",
        command: { type: "stop" },
      }),
    ).rejects.toMatchObject({ message: "first debugger detach failed" });

    await expect(
      service.execute({
        id: "second-stop-request",
        taskId: "task-1",
        command: { type: "stop" },
      }),
    ).resolves.toEqual({ detached: true });
    expect(detach).toHaveBeenCalledTimes(2);
    expect(service.activeTaskCount).toBe(0);
  });

  it("continues restoring sessions when stale-session cleanup fails", async () => {
    storageGet.mockResolvedValue({
      agentNativeBrowserTaskSessions: [
        {
          taskId: "stale-task",
          tabId: 41,
          allowedOrigins: ["https://example.com"],
        },
        {
          taskId: "live-task",
          tabId: 42,
          allowedOrigins: ["https://example.com"],
        },
      ],
    });
    let staleFrameTreeFailed = false;
    sendCommand.mockImplementation(
      (
        _source: chrome.debugger.Debuggee,
        method: string,
        _params: object | undefined,
        callback?: (result: unknown) => void,
      ) => {
        debuggerMethods.push(method);
        if (method === "Page.getFrameTree" && !staleFrameTreeFailed) {
          staleFrameTreeFailed = true;
          runtimeLastError = { message: "stale tab is gone" };
          callback?.({});
          runtimeLastError = undefined;
          return;
        }
        callback?.({});
      },
    );
    let staleDetachAttempts = 0;
    detach.mockImplementation(
      (_source: chrome.debugger.Debuggee, callback?: () => void) => {
        staleDetachAttempts += 1;
        if (staleDetachAttempts > 2) {
          callback?.();
          return;
        }
        runtimeLastError = { message: "stale debugger detach failed" };
        callback?.();
        runtimeLastError = undefined;
      },
    );
    const service = new BrowserControlService();

    await expect(service.restore()).resolves.toBeUndefined();

    expect(service.activeTaskCount).toBe(1);
    expect(persist).toHaveBeenLastCalledWith({
      agentNativeBrowserTaskSessions: [
        {
          taskId: "live-task",
          tabId: 42,
          allowedOrigins: ["https://example.com"],
        },
      ],
      agentNativeBrowserPendingTeardowns: [{ taskId: "stale-task", tabId: 41 }],
    });
  });

  it("restores and retries durable pending teardowns", async () => {
    storageGet.mockResolvedValue({
      agentNativeBrowserPendingTeardowns: [
        { taskId: "pending-task", tabId: 41 },
      ],
    });
    const service = new BrowserControlService();

    await expect(service.restore()).resolves.toBeUndefined();

    expect(detach).toHaveBeenCalledWith({ tabId: 41 }, expect.any(Function));
    expect(service.activeTaskCount).toBe(0);
    expect(persist).toHaveBeenLastCalledWith({
      agentNativeBrowserTaskSessions: [],
      agentNativeBrowserPendingTeardowns: [],
    });
  });

  it("detaches a new debugger when rollback persistence fails", async () => {
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

    let newTabLookups = 0;
    getTab.mockImplementation(
      (tabId: number, callback: (tab: chrome.tabs.Tab) => void) => {
        if (tabId === 77) {
          newTabLookups += 1;
          callback({
            id: 77,
            url:
              newTabLookups >= 3
                ? "https://other.example/redirect"
                : "https://example.com/next",
          } as chrome.tabs.Tab);
          return;
        }
        callback({
          id: tabId,
          url: "https://example.com/page",
        } as chrome.tabs.Tab);
      },
    );
    persist.mockImplementationOnce(async () => {
      persist.mockRejectedValueOnce(new Error("rollback unavailable"));
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

    expect(openError).toMatchObject({
      message: "Chrome attach rollback failed.",
    });
    expect(detach).toHaveBeenCalledWith({ tabId: 77 }, expect.any(Function));
    expect(removeTab).toHaveBeenCalledWith(77, expect.any(Function));
    expect(service.activeTaskCount).toBe(1);
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
      agentNativeBrowserPendingTeardowns: [],
    });
  });

  it("cancels an in-flight key before stop releases injected input", async () => {
    let releaseKeyDown: (() => void) | undefined;
    const keyUps: string[] = [];
    sendCommand.mockImplementation(
      (
        _source: chrome.debugger.Debuggee,
        method: string,
        params: object | undefined,
        callback?: (result: unknown) => void,
      ) => {
        debuggerMethods.push(method);
        const input = params as { key?: string; type?: string } | undefined;
        if (
          method === "Input.dispatchKeyEvent" &&
          input?.type === "keyUp" &&
          input.key
        ) {
          keyUps.push(input.key);
        }
        if (
          method === "Input.dispatchKeyEvent" &&
          input?.type === "keyDown" &&
          !releaseKeyDown
        ) {
          releaseKeyDown = () => callback?.({});
          return;
        }
        callback?.({});
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

    const keyPromise = service
      .execute({
        id: "key-request",
        taskId: "task-1",
        command: { type: "key", key: "Enter" },
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    await vi.waitFor(() => expect(releaseKeyDown).toBeDefined());

    await expect(
      service.execute({
        id: "stop-request",
        taskId: "task-1",
        command: { type: "stop" },
      }),
    ).resolves.toEqual({ detached: true });

    await expect(keyPromise).resolves.toMatchObject({
      code: "TASK_HANDOFF_CANCELLED",
    });
    expect(keyUps).not.toContain("Enter");
    releaseKeyDown?.();
  });

  it("does not wait behind an existing handoff teardown during emergency stop", async () => {
    let releaseOldDetach: (() => void) | undefined;
    detach.mockImplementationOnce(
      (_source: chrome.debugger.Debuggee, callback?: () => void) => {
        releaseOldDetach = callback;
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
    await vi.waitFor(() => expect(releaseOldDetach).toBeDefined());

    let emergencySettled = false;
    const emergencyStop = service.emergencyStopAll().then(() => {
      emergencySettled = true;
    });
    await vi.waitFor(() => expect(emergencySettled).toBe(true));
    expect(service.activeTaskCount).toBe(0);

    releaseOldDetach?.();
    await expect(openPromise).resolves.toBeDefined();
    await expect(emergencyStop).resolves.toBeUndefined();
  });

  it("treats an external debugger detach as completed teardown", async () => {
    let detachEvent: Promise<void> | undefined;
    const service = new BrowserControlService();
    detach.mockImplementationOnce(
      (_source: chrome.debugger.Debuggee, callback?: () => void) => {
        detachEvent = service.handleDebuggerDetach(42);
        runtimeLastError = { message: "debugger already detached" };
        callback?.();
        runtimeLastError = undefined;
      },
    );

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
        id: "stop-request",
        taskId: "task-1",
        command: { type: "stop" },
      }),
    ).resolves.toEqual({ detached: true });
    await detachEvent;
    expect(service.activeTaskCount).toBe(0);
    expect(persist).toHaveBeenLastCalledWith({
      agentNativeBrowserTaskSessions: [],
      agentNativeBrowserPendingTeardowns: [],
    });
  });

  it("cancels an attach queued before stop", async () => {
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

    const firstAttach = service
      .execute({
        id: "first-attach-request",
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

    const queuedAttach = service
      .execute({
        id: "queued-attach-request",
        taskId: "task-1",
        command: {
          type: "attach",
          tabId: 43,
          allowedOrigins: ["https://example.com"],
        },
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    const stopPromise = service.execute({
      id: "stop-request",
      taskId: "task-1",
      command: { type: "stop" },
    });
    releasePageEnable?.();

    await expect(firstAttach).resolves.toMatchObject({
      code: "TASK_HANDOFF_CANCELLED",
    });
    await expect(queuedAttach).resolves.toMatchObject({
      code: "TASK_HANDOFF_CANCELLED",
    });
    await expect(stopPromise).resolves.toEqual({ detached: true });
    expect(service.activeTaskCount).toBe(0);
    expect(detach).toHaveBeenCalledWith({ tabId: 42 }, expect.any(Function));
  });

  it("cancels an attach queued before emergency stop", async () => {
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

    const firstAttach = service
      .execute({
        id: "first-attach-request",
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

    const queuedAttach = service
      .execute({
        id: "queued-attach-request",
        taskId: "task-1",
        command: {
          type: "attach",
          tabId: 43,
          allowedOrigins: ["https://example.com"],
        },
      })
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    const emergencyStop = service.emergencyStopAll();
    releasePageEnable?.();

    await expect(firstAttach).resolves.toMatchObject({
      code: "TASK_HANDOFF_CANCELLED",
    });
    await expect(queuedAttach).resolves.toMatchObject({
      code: "TASK_HANDOFF_CANCELLED",
    });
    await expect(emergencyStop).resolves.toBeUndefined();
    expect(service.activeTaskCount).toBe(0);
    expect(persist).toHaveBeenLastCalledWith({
      agentNativeBrowserTaskSessions: [],
      agentNativeBrowserPendingTeardowns: [],
    });
  });

  it("reclaims a task generation after its teardown completes", async () => {
    const service = new BrowserControlService();
    const internals = service as unknown as {
      taskGenerations: Map<string, number>;
    };

    await service.execute({
      id: "attach-request",
      taskId: "task-1",
      command: {
        type: "attach",
        tabId: 42,
        allowedOrigins: ["https://example.com"],
      },
    });
    expect(internals.taskGenerations.size).toBe(1);

    await service.execute({
      id: "stop-request",
      taskId: "task-1",
      command: { type: "stop" },
    });
    await vi.waitFor(() => expect(internals.taskGenerations.size).toBe(0));
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
