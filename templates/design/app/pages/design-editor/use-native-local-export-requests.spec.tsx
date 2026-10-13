// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  nativeLocalExportDocumentId,
  useNativeLocalExportRequests,
} from "./use-native-local-export-requests";

const mocks = vi.hoisted(() => ({
  callAction: vi.fn(),
  readClientAppState: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
  getBrowserTabId: () => "actual-tab",
  readClientAppState: mocks.readClientAppState,
}));

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT;
  mocks.callAction.mockReset();
  mocks.readClientAppState.mockReset();
});

describe("native local export editor registration", () => {
  it("keeps one ID across same-document rerenders and changes it for a new document", () => {
    const original = nativeLocalExportDocumentId(document);
    expect(nativeLocalExportDocumentId(document)).toBe(original);
    const next = document.implementation.createHTMLDocument();
    expect(nativeLocalExportDocumentId(next)).not.toBe(original);
  });

  it("renews the real tab context while mounted and stops at unmount", async () => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    mocks.callAction.mockResolvedValue({ tabId: "actual-tab" });
    mocks.readClientAppState.mockResolvedValue(null);
    function Harness() {
      useNativeLocalExportRequests({
        designId: "design-1",
        enabled: true,
        onExport: async () => {},
        onError: () => {},
      });
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Harness />));
    expect(mocks.callAction).toHaveBeenCalledWith(
      "register-native-render-context",
      {
        designId: "design-1",
        documentId: nativeLocalExportDocumentId(document),
      },
      { signal: expect.any(AbortSignal), timeoutMs: 8_000 },
    );
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(
      mocks.callAction.mock.calls.filter(
        ([name]) => name === "register-native-render-context",
      ),
    ).toHaveLength(2);
    await act(async () => root.unmount());
    await vi.advanceTimersByTimeAsync(30_000);
    expect(
      mocks.callAction.mock.calls.filter(
        ([name]) => name === "register-native-render-context",
      ),
    ).toHaveLength(2);
  });

  it("retries a timed-out renewal before the context lease expires", async () => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    mocks.readClientAppState.mockResolvedValue(null);
    let registrations = 0;
    mocks.callAction.mockImplementation(
      (_name: string, _input: unknown, options: { timeoutMs: number }) => {
        registrations += 1;
        if (registrations !== 2)
          return Promise.resolve({ tabId: "actual-tab" });
        return new Promise((_resolve, reject) => {
          setTimeout(
            () => reject(new Error("Registration timed out")),
            options.timeoutMs,
          );
        });
      },
    );
    function Harness() {
      useNativeLocalExportRequests({
        designId: "design-1",
        enabled: true,
        onExport: async () => {},
        onError: () => {},
      });
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Harness />));
    await act(async () => vi.advanceTimersByTimeAsync(23_000));
    expect(registrations).toBe(2);
    await act(async () => vi.advanceTimersByTimeAsync(7_000));
    expect(registrations).toBe(3);
    expect(mocks.callAction.mock.calls[1]?.[2]).toMatchObject({
      timeoutMs: 8_000,
    });
    await act(async () => root.unmount());
  });

  it("aborts its in-flight registration on unmount", async () => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    mocks.readClientAppState.mockResolvedValue(null);
    let registrationSignal: AbortSignal | undefined;
    let aborted = false;
    mocks.callAction.mockImplementation(
      (_name: string, _input: unknown, options: { signal: AbortSignal }) => {
        registrationSignal = options.signal;
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(new Error("Registration aborted"));
            },
            { once: true },
          );
        });
      },
    );
    function Harness() {
      useNativeLocalExportRequests({
        designId: "design-1",
        enabled: true,
        onExport: async () => {},
        onError: () => {},
      });
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(<Harness />));
    expect(registrationSignal?.aborted).toBe(false);
    await act(async () => root.unmount());
    expect(aborted).toBe(true);
    expect(registrationSignal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(mocks.callAction).toHaveBeenCalledTimes(1);
  });
});
