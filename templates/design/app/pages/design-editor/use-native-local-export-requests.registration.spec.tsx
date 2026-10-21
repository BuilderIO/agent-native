// @vitest-environment happy-dom

import { setAgentNativeApiDisabled } from "@agent-native/core/client/host";
import type { NativeLocalExportState } from "@shared/native-local-export";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useNativeLocalExportRequests } from "./use-native-local-export-requests";

const client = vi.hoisted(() => ({
  navigation: null as unknown,
  callAction: vi.fn(async (_name?: string): Promise<unknown> => undefined),
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
        isSignedIn: true,
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

  it("does not read or register local exports while signed out", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onError = vi.fn();
    const Probe = () => {
      useNativeLocalExportRequests({
        designId: "design-a",
        isSignedIn: false,
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

  it("keeps active read failures visible", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onError = vi.fn();
    const onExport = vi.fn();
    const readError = new Error("Local export state is unavailable.");
    client.readClientAppState.mockImplementationOnce(async () => {
      throw readError;
    });
    const Probe = () => {
      useNativeLocalExportRequests({
        designId: "design-a",
        isSignedIn: true,
        enabled: true,
        onError,
        onExport,
      });
      return null;
    };
    try {
      await act(async () => {
        root.render(<Probe />);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(onError).toHaveBeenCalledExactlyOnceWith(readError);
      expect(onExport).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("reports a failed poll once until a successful read", async () => {
    vi.useFakeTimers();
    let readError: Error | null = new Error("State read failed.");
    client.readClientAppState.mockImplementation(async (key: string) => {
      if (key === "native-local-export:design-a:tab-1" && readError)
        throw readError;
      return null;
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onError = vi.fn();
    const onExport = vi.fn();
    const Probe = () => {
      useNativeLocalExportRequests({
        designId: "design-a",
        isSignedIn: true,
        enabled: true,
        onError,
        onExport,
      });
      return null;
    };
    try {
      await act(async () => root.render(<Probe />));
      expect(onError).toHaveBeenCalledExactlyOnceWith(readError);
      await act(async () => vi.advanceTimersByTimeAsync(6000));
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onExport).not.toHaveBeenCalled();

      readError = null;
      await act(async () => vi.advanceTimersByTimeAsync(2000));
      readError = new Error("State read failed again.");
      await act(async () => vi.advanceTimersByTimeAsync(2000));
      expect(onError).toHaveBeenCalledTimes(2);
      expect(onError).toHaveBeenLastCalledWith(readError);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      client.readClientAppState.mockImplementation(async (key: string) =>
        key === "navigation:tab-1" ? client.navigation : null,
      );
    }
  });

  it("reports an invalid state once until a valid state is read", async () => {
    vi.useFakeTimers();
    let state: unknown = {};
    client.readClientAppState.mockImplementation(async (key: string) =>
      key === "native-local-export:design-a:tab-1" ? state : null,
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onError = vi.fn();
    const onExport = vi.fn();
    const Probe = () => {
      useNativeLocalExportRequests({
        designId: "design-a",
        isSignedIn: true,
        enabled: true,
        onError,
        onExport,
      });
      return null;
    };
    try {
      await act(async () => root.render(<Probe />));
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
      await act(async () => vi.advanceTimersByTimeAsync(6000));
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onExport).not.toHaveBeenCalled();

      state = null;
      await act(async () => vi.advanceTimersByTimeAsync(2000));
      state = {};
      await act(async () => vi.advanceTimersByTimeAsync(2000));
      expect(onError).toHaveBeenCalledTimes(2);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      client.readClientAppState.mockImplementation(async (key: string) =>
        key === "navigation:tab-1" ? client.navigation : null,
      );
    }
  });

  it("never renders from a failed idle context registration", async () => {
    vi.useFakeTimers();
    client.navigation = { view: "editor", designId: "design-a" };
    const registrationError = new Error("Context registration failed.");
    client.callAction.mockImplementation(async () => {
      throw registrationError;
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onError = vi.fn();
    const onExport = vi.fn();
    const Probe = () => {
      useNativeLocalExportRequests({
        designId: "design-a",
        isSignedIn: true,
        enabled: true,
        onError,
        onExport,
      });
      return null;
    };
    try {
      await act(async () => root.render(<Probe />));
      await act(async () => vi.advanceTimersByTimeAsync(2000));
      expect(onError).toHaveBeenCalledExactlyOnceWith(registrationError);
      expect(onExport).not.toHaveBeenCalled();
      expect(client.callAction).toHaveBeenCalledTimes(2);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      client.callAction.mockImplementation(async () => undefined);
    }
  });

  it("attempts each pending export request once while continuing to accept new requests", async () => {
    vi.useFakeTimers();
    let request: NativeLocalExportState = {
      designId: "design-a",
      fileId: "screen-a",
      expectedVersionHash: "v1",
      export: {
        format: "png",
        viewport: { width: 640, height: 480 },
        pixelRatio: 1,
      },
      schemaVersion: 1,
      requestId: "00000000-0000-4000-8000-000000000001",
      tabId: "tab-1",
      status: "pending",
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    };
    const claimError = new Error("The request could not be claimed.");
    client.readClientAppState.mockImplementation(async (key: string) =>
      key === "native-local-export:design-a:tab-1" ? request : null,
    );
    client.callAction.mockImplementation(async (name?: string) => {
      if (name === "claim-native-local-export") throw claimError;
      return { status: "failed" };
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onError = vi.fn();
    const onExport = vi.fn();
    const Probe = () => {
      useNativeLocalExportRequests({
        designId: "design-a",
        isSignedIn: true,
        enabled: true,
        onError,
        onExport,
      });
      return null;
    };
    try {
      await act(async () => root.render(<Probe />));
      expect(client.callAction).toHaveBeenCalledTimes(2);
      expect(onError).toHaveBeenCalledExactlyOnceWith(claimError);

      await act(async () => vi.advanceTimersByTimeAsync(6000));
      expect(client.callAction).toHaveBeenCalledTimes(2);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onExport).not.toHaveBeenCalled();

      request = {
        ...request,
        requestId: "00000000-0000-4000-8000-000000000002",
      };
      await act(async () => vi.advanceTimersByTimeAsync(2000));
      expect(client.callAction).toHaveBeenCalledTimes(4);
      expect(onError).toHaveBeenCalledTimes(2);
      expect(onError).toHaveBeenNthCalledWith(1, claimError);
      expect(onError).toHaveBeenNthCalledWith(2, claimError);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      client.callAction.mockImplementation(async () => undefined);
      client.readClientAppState.mockImplementation(async (key: string) =>
        key === "navigation:tab-1" ? client.navigation : null,
      );
    }
  });

  it("keeps a deferred read rejection quiet after sign-out", async () => {
    let rejectRead!: (error: Error) => void;
    const pendingRead = new Promise<unknown>((_, reject) => {
      rejectRead = reject;
    });
    client.readClientAppState.mockImplementationOnce(() => pendingRead);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onError = vi.fn();
    const Probe = ({ isSignedIn }: { isSignedIn: boolean }) => {
      useNativeLocalExportRequests({
        designId: "design-a",
        isSignedIn,
        enabled: true,
        onError,
        onExport: async () => ({ attachmentRef: "ref", bytes: 1 }),
      });
      return null;
    };
    try {
      await act(async () => root.render(<Probe isSignedIn={true} />));
      expect(client.readClientAppState).toHaveBeenCalled();

      await act(async () => root.render(<Probe isSignedIn={false} />));
      await act(async () => {
        rejectRead(new Error("Session closed during state read."));
        await Promise.resolve();
      });
      expect(onError).not.toHaveBeenCalled();
      expect(client.callAction).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it("registers while signed in, stops after sign-out, and tracks navigation", async () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onError = vi.fn();
    const onExport = vi.fn(async () => ({ attachmentRef: "ref", bytes: 1 }));
    const Probe = ({
      designId,
      isSignedIn,
    }: {
      designId: string;
      isSignedIn: boolean;
    }) => {
      useNativeLocalExportRequests({
        designId,
        isSignedIn,
        enabled: true,
        onError,
        onExport,
      });
      return null;
    };
    try {
      await act(async () =>
        root.render(<Probe designId="design-a" isSignedIn={true} />),
      );
      expect(client.callAction).not.toHaveBeenCalled();

      client.navigation = { view: "editor", designId: "design-a" };
      await act(async () => vi.advanceTimersByTimeAsync(2000));
      expect(client.callAction).toHaveBeenCalledExactlyOnceWith(
        "register-native-render-context",
        expect.objectContaining({ designId: "design-a" }),
        expect.anything(),
      );

      await act(async () =>
        root.render(<Probe designId="design-b" isSignedIn={true} />),
      );
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

      const readsAtSignOut = client.readClientAppState.mock.calls.length;
      const actionsAtSignOut = client.callAction.mock.calls.length;
      await act(async () =>
        root.render(<Probe designId="design-b" isSignedIn={false} />),
      );
      await act(async () => vi.advanceTimersByTimeAsync(4000));
      expect(client.readClientAppState).toHaveBeenCalledTimes(readsAtSignOut);
      expect(client.callAction).toHaveBeenCalledTimes(actionsAtSignOut);
      expect(onError).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});
