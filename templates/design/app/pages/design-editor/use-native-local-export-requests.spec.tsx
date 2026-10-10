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
});
