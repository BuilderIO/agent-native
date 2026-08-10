import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BrowserControlService } from "./browser-control";

describe("BrowserControlService", () => {
  const debuggerMethods: string[] = [];
  const detach = vi.fn();

  beforeEach(() => {
    debuggerMethods.length = 0;
    detach.mockReset();
    detach.mockImplementation(
      (_source: chrome.debugger.Debuggee, callback?: () => void) =>
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
});
