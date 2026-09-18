// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callAction: vi.fn(),
  createRegistration: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: mocks.callAction,
}));

vi.mock("@agent-native/core/client/host", () => ({
  defineClientAction: (action: unknown) => action,
}));

vi.mock("@agent-native/core/client/webmcp", () => ({
  createAgentNativeWebMcpRegistration: mocks.createRegistration,
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

  it("publishes a signed-out-compatible bootstrap contract", () => {
    const [action] = createOpenVisualEditWebMcpActions() as Array<{
      schema: { required?: string[] };
    }>;
    expect(action.schema.required).toEqual(["devServerUrl"]);
  });

  it("redeems and opens the private editor handoff after bootstrap", async () => {
    const [action] = createOpenVisualEditWebMcpActions() as unknown as Array<{
      run: (
        input: Record<string, unknown>,
        runtime: unknown,
      ) => Promise<unknown>;
    }>;
    mocks.callAction.mockResolvedValue({
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
    const replace = vi
      .spyOn(window.location, "replace")
      .mockImplementation(() => {});

    await action.run(
      {
        devServerUrl: "http://localhost:5173",
        bridgeToken: "locally-generated-bridge-token",
      },
      { signal: undefined },
    );

    expect(mocks.callAction).toHaveBeenCalledWith(
      "open-visual-edit",
      {
        devServerUrl: "http://localhost:5173",
        bridgeToken: "locally-generated-bridge-token",
      },
      { signal: undefined },
    );
    const safeResult = await action.run(
      { devServerUrl: "http://localhost:5173", navigate: false },
      { signal: undefined },
    );
    expect(safeResult).not.toHaveProperty("bridgeToken");
    expect(safeResult).not.toHaveProperty("previewToken");
    expect(replace).toHaveBeenCalledWith(
      new URL(
        "/_agent-native/embed/start?ticket=one-time-ticket",
        window.location.href,
      ).toString(),
    );
    replace.mockRestore();
  });
});
