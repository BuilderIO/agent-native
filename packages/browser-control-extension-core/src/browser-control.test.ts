import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BrowserControlService } from "./browser-control";

describe("BrowserControlService", () => {
  const debuggerMethods: string[] = [];
  const detach = vi.fn();
  const createTab = vi.fn();
  const removeTab = vi.fn();

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

    const chromeMock = {
      runtime: { lastError: undefined },
      tabs: {
        get: vi.fn((tabId: number, callback: (tab: chrome.tabs.Tab) => void) =>
          callback({
            id: tabId,
            url: "https://example.com/page",
          } as chrome.tabs.Tab),
        ),
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
        sendCommand: vi.fn(
          (
            _source: chrome.debugger.Debuggee,
            method: string,
            _params: object | undefined,
            callback?: (result: unknown) => void,
          ) => {
            debuggerMethods.push(method);
            callback?.({});
          },
        ),
      },
      storage: {
        session: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined),
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
});
