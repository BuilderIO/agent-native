// @vitest-environment happy-dom

import { setAgentNativeApiDisabled } from "@agent-native/core/client/host";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useNativeLocalExportRequests } from "./use-native-local-export-requests";

const client = vi.hoisted(() => ({
  navigation: null as unknown,
  callAction: vi.fn(async () => undefined),
  readClientAppState: vi.fn(async (key: string) =>
    key === "navigation:tab-1" ? client.navigation : null,
  ),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: client.callAction,
  getBrowserTabId: () => "tab-1",
  readClientAppState: client.readClientAppState,
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("native render-context registration", () => {
  afterEach(() => {
    setAgentNativeApiDisabled(null);
    vi.useRealTimers();
    client.callAction.mockClear();
    client.readClientAppState.mockClear();
    client.navigation = null;
  });

  it("does not read or register exports on a surface without agent-native API access", async () => {
    setAgentNativeApiDisabled("builder shell canvas");
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onError = vi.fn();
    const Probe = () => {
      useNativeLocalExportRequests({
        designId: "shell",
        enabled: true,
        onError,
        onExport: async () => ({ attachmentRef: "ref", bytes: 1 }),
      });
      return null;
    };
    try {
      await act(async () => root.render(<Probe />));
      expect(client.readClientAppState).not.toHaveBeenCalled();
      expect(client.callAction).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("waits for persisted navigation and never registers a design after navigating away", async () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onError = vi.fn();
    const onExport = vi.fn(async () => ({ attachmentRef: "ref", bytes: 1 }));
    const Probe = ({ designId }: { designId: string }) => {
      useNativeLocalExportRequests({
        designId,
        enabled: true,
        onError,
        onExport,
      });
      return null;
    };
    try {
      await act(async () => root.render(<Probe designId="design-a" />));
      expect(client.callAction).not.toHaveBeenCalled();

      client.navigation = { view: "editor", designId: "design-a" };
      await act(async () => vi.advanceTimersByTimeAsync(2000));
      expect(client.callAction).toHaveBeenCalledExactlyOnceWith(
        "register-native-render-context",
        expect.objectContaining({ designId: "design-a" }),
        expect.anything(),
      );

      await act(async () => root.render(<Probe designId="design-b" />));
      await act(async () => vi.advanceTimersByTimeAsync(2000));
      expect(client.callAction).toHaveBeenCalledTimes(1);

      client.navigation = { view: "editor", designId: "design-b" };
      await act(async () => vi.advanceTimersByTimeAsync(2000));
      expect(client.callAction).toHaveBeenCalledTimes(2);
      expect(client.callAction).toHaveBeenLastCalledWith(
        "register-native-render-context",
        expect.objectContaining({ designId: "design-b" }),
        expect.anything(),
      );
      expect(onError).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
