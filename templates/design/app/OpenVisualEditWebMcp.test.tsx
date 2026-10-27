// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callAction: vi.fn(),
  createRegistration: vi.fn(),
  locationPathname: "/visual-edit/design-1",
  clearProxy: vi.fn(),
  installProxy: vi.fn(),
  persistTransport: vi.fn(),
  readPersistedTransport: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
  useSession: () => ({ session: null, isLoading: false }),
}));

vi.mock("@agent-native/core/client/host", () => ({
  defineClientAction: (action: unknown) => action,
}));

vi.mock("@agent-native/core/client/webmcp", () => ({
  createAgentNativeWebMcpRegistration: mocks.createRegistration,
}));

vi.mock("react-router", () => ({
  useLocation: () => ({ pathname: mocks.locationPathname }),
}));

vi.mock("./localhost-bridge-proxy.js", () => ({
  clearLocalhostBridgeFetchProxy: mocks.clearProxy,
  installLocalhostBridgeFetchProxy: mocks.installProxy,
  persistLocalhostBridgeTransport: mocks.persistTransport,
  readPersistedLocalhostBridgeTransport: mocks.readPersistedTransport,
}));

vi.mock("@/components/ui/alert-dialog", () => {
  const passthrough = ({ children }: { children?: ReactNode }) => (
    <>{children}</>
  );
  return {
    AlertDialog: passthrough,
    AlertDialogAction: passthrough,
    AlertDialogCancel: passthrough,
    AlertDialogContent: passthrough,
    AlertDialogDescription: passthrough,
    AlertDialogFooter: passthrough,
    AlertDialogHeader: passthrough,
    AlertDialogTitle: passthrough,
  };
});

import {
  createOpenVisualEditWebMcpActions,
  OpenVisualEditWebMcp,
} from "./OpenVisualEditWebMcp";

describe("OpenVisualEditWebMcp", () => {
  let container: HTMLDivElement;
  let root: Root;
  let registrations: Array<{
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  }>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.callAction.mockReset();
    mocks.locationPathname = "/visual-edit/design-1";
    mocks.clearProxy.mockReset();
    mocks.installProxy.mockReset();
    mocks.persistTransport.mockReset();
    mocks.readPersistedTransport.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    registrations = [];
    mocks.createRegistration.mockReset().mockImplementation(() => {
      const attempt = registrations.length;
      const registration = {
        supported: true,
        registered: 1,
        start: vi.fn(() =>
          attempt === 0
            ? Promise.reject(new Error("transient"))
            : Promise.resolve(),
        ),
        stop: vi.fn(),
      };
      registrations.push(registration);
      return registration;
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("retries after a transient registration failure", async () => {
    act(() => root.render(<OpenVisualEditWebMcp />));
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.createRegistration).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(mocks.createRegistration).toHaveBeenCalledTimes(2);
    expect(registrations[0].stop).toHaveBeenCalledTimes(1);
  });

  it("clears a stale relay when same-tab navigation changes the design", async () => {
    mocks.readPersistedTransport.mockReturnValue({
      designId: "design-1",
      connectionId: "connection-1",
      bridgeUrl: "http://127.0.0.1:7331",
    });

    act(() => root.render(<OpenVisualEditWebMcp />));
    expect(mocks.readPersistedTransport).toHaveBeenCalled();
    expect(mocks.installProxy).toHaveBeenCalledTimes(1);
    expect(mocks.createRegistration).toHaveBeenCalledTimes(1);

    mocks.locationPathname = "/visual-edit/design-2";
    act(() => root.render(<OpenVisualEditWebMcp />));

    expect(mocks.clearProxy).toHaveBeenCalled();
    expect(mocks.installProxy).toHaveBeenCalledTimes(1);
    expect(mocks.createRegistration).toHaveBeenCalledTimes(2);
    expect(registrations[0].stop).toHaveBeenCalledTimes(1);
  });

  it("publishes a signed-out-compatible bootstrap contract", () => {
    const [action] = createOpenVisualEditWebMcpActions() as Array<{
      schema: {
        required?: string[];
        properties?: Record<string, unknown>;
      };
    }>;
    expect(action.schema.required).toEqual(["devServerUrl"]);
    expect(action.schema.properties).not.toHaveProperty("bridgeToken");
    expect(action.schema.properties).not.toHaveProperty("previewToken");
    expect(action.schema.properties).not.toHaveProperty("bridgeAttestation");
  });

  it("offers an explicit new-project option", () => {
    const [action] = createOpenVisualEditWebMcpActions() as Array<{
      schema: { properties?: Record<string, { type?: string }> };
    }>;
    expect(action.schema.properties?.newDesign?.type).toBe("boolean");
  });

  it("uses the authenticated action path without issuing a bootstrap capability", async () => {
    const [action] = createOpenVisualEditWebMcpActions({
      isAuthenticated: true,
    }) as unknown as Array<{
      run: (
        input: Record<string, unknown>,
        runtime: unknown,
      ) => Promise<unknown>;
    }>;
    const result = { designId: "design-1" };
    mocks.callAction.mockResolvedValue(result);

    await action.run(
      { devServerUrl: "http://localhost:5173" },
      { signal: undefined },
    );

    expect(mocks.callAction).toHaveBeenCalledWith(
      "open-visual-edit",
      { devServerUrl: "http://localhost:5173" },
      { signal: undefined },
    );
    expect(mocks.callAction).not.toHaveBeenCalledWith(
      "issue-visual-edit-bootstrap",
      expect.anything(),
      expect.anything(),
    );
  });

  it("forwards the explicit new-project request to the action", async () => {
    const [action] = createOpenVisualEditWebMcpActions({
      isAuthenticated: true,
    }) as unknown as Array<{
      run: (
        input: Record<string, unknown>,
        runtime: unknown,
      ) => Promise<unknown>;
    }>;
    mocks.callAction.mockResolvedValue({ designId: "design_new" });

    await action.run(
      { devServerUrl: "http://localhost:5173", newDesign: true },
      { signal: undefined },
    );

    expect(mocks.callAction).toHaveBeenCalledWith(
      "open-visual-edit",
      { devServerUrl: "http://localhost:5173", newDesign: true },
      { signal: undefined },
    );
  });

  it.each([true, false])(
    "omits bridge credentials from %s WebMCP callAction payloads and results",
    async (isAuthenticated) => {
      const [action] = createOpenVisualEditWebMcpActions({
        isAuthenticated,
      }) as unknown as Array<{
        run: (
          input: Record<string, unknown>,
          runtime: unknown,
        ) => Promise<unknown>;
      }>;
      const callActionResults = isAuthenticated
        ? []
        : [{ token: "bootstrap-capability", challenge: "a".repeat(32) }];
      mocks.callAction.mockReset();
      for (const result of callActionResults) {
        mocks.callAction.mockResolvedValueOnce(result);
      }
      mocks.callAction.mockResolvedValueOnce({
        designId: "design-1",
        connectionId: "connection-1",
        createdDesign: true,
        publicReadOnly: true,
        devServerUrl: "http://localhost:5173",
        bridgeUrl: "http://127.0.0.1:7331",
        screenCount: 1,
        overview: true,
        urlPath: "/visual-edit/design-1?editorView=overview&embedChrome=1",
        openUrl:
          "agent-native://open/visual-edit/design-1?editorView=overview&embedChrome=1",
        bridgeToken: "bridge-secret",
        previewToken: "preview-secret",
        embedStartUrl: "/_agent-native/embed/start?ticket=one-time-ticket",
      });

      const input = {
        devServerUrl: "http://localhost:5173",
        bridgeToken: "bridge-secret",
        previewToken: "preview-secret",
        bridgeAttestation: { previewToken: "preview-secret" },
        routeManifest: {
          routes: [
            {
              path: "/",
              metadata: {
                title: "Home",
                bridgeToken: "nested-bridge-secret",
                previewToken: "nested-preview-secret",
              },
            },
          ],
        },
        navigate: false,
      };
      const safeResult = await action.run(input, { signal: undefined });
      const openCall = mocks.callAction.mock.calls.find(
        ([name]) => name === "open-visual-edit",
      );

      expect(openCall?.[1]).toEqual({
        devServerUrl: "http://localhost:5173",
        routeManifest: {
          routes: [{ path: "/", metadata: { title: "Home" } }],
        },
        navigate: false,
      });
      expect(JSON.stringify(openCall?.[1])).not.toContain("bridge-secret");
      expect(JSON.stringify(openCall?.[1])).not.toContain("preview-secret");
      expect(JSON.stringify(openCall?.[1])).not.toContain(
        "nested-bridge-secret",
      );
      expect(JSON.stringify(openCall?.[1])).not.toContain(
        "nested-preview-secret",
      );
      expect(safeResult).not.toHaveProperty("bridgeToken");
      expect(safeResult).not.toHaveProperty("previewToken");
    },
  );

  it("persists only the scoped bridge transport, never its bridge token", async () => {
    const [action] = createOpenVisualEditWebMcpActions() as unknown as Array<{
      run: (
        input: Record<string, unknown>,
        runtime: unknown,
      ) => Promise<unknown>;
    }>;
    const result = {
      designId: "design-1",
      connectionId: "connection-1",
      createdDesign: false,
      publicReadOnly: true,
      devServerUrl: "http://localhost:5173",
      bridgeUrl: "http://127.0.0.1:7331",
      screenCount: 1,
      overview: true,
      urlPath: "/visual-edit/design-1",
      openUrl: "agent-native://open/visual-edit/design-1",
    };
    mocks.callAction
      .mockResolvedValueOnce({
        token: "bootstrap-capability",
        challenge: "a".repeat(32),
      })
      .mockResolvedValueOnce(result);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            attestation: {
              challenge: "a".repeat(32),
              signature: "a".repeat(64),
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    await action.run(
      {
        devServerUrl: "http://localhost:5173",
        bridgeToken: "stale-bridge-token",
        navigate: false,
      },
      { signal: undefined },
    );
    expect(mocks.persistTransport).toHaveBeenCalledWith({
      designId: "design-1",
      connectionId: "connection-1",
      bridgeUrl: "http://127.0.0.1:7331",
    });
    expect(mocks.persistTransport.mock.calls[0]?.[0]).not.toHaveProperty(
      "bridgeToken",
    );
    expect(mocks.installProxy.mock.calls[0]?.[0]).not.toHaveProperty(
      "bridgeToken",
    );
  });

  it("refreshes the bootstrap capability after its cache expires", async () => {
    const [action] = createOpenVisualEditWebMcpActions() as unknown as Array<{
      run: (
        input: Record<string, unknown>,
        runtime: unknown,
      ) => Promise<unknown>;
    }>;
    const result = {
      designId: "design-1",
      connectionId: "connection-1",
      createdDesign: false,
      publicReadOnly: true,
      devServerUrl: "http://localhost:5173",
      bridgeUrl: "http://127.0.0.1:7331",
      screenCount: 1,
      overview: true,
      urlPath: "/visual-edit/design-1",
      openUrl: "agent-native://open/visual-edit/design-1",
    };
    mocks.callAction
      .mockResolvedValueOnce({
        token: "first-bootstrap",
        challenge: "a".repeat(32),
      })
      .mockResolvedValueOnce(result)
      .mockResolvedValueOnce({
        token: "second-bootstrap",
        challenge: "b".repeat(32),
      })
      .mockResolvedValueOnce(result);

    await action.run(
      { devServerUrl: "http://localhost:5173", navigate: false },
      { signal: undefined },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000);
    });
    await action.run(
      { devServerUrl: "http://localhost:5173", navigate: false },
      { signal: undefined },
    );

    expect(mocks.callAction).toHaveBeenNthCalledWith(
      1,
      "issue-visual-edit-bootstrap",
      {},
      { signal: undefined },
    );
    expect(mocks.callAction).toHaveBeenNthCalledWith(
      3,
      "issue-visual-edit-bootstrap",
      {},
      { signal: undefined },
    );
  });
});
