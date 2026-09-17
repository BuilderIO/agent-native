// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createRegistration: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: vi.fn(),
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

import { OpenVisualEditWebMcp } from "./OpenVisualEditWebMcp";

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
});
