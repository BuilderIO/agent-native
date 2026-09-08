// @vitest-environment happy-dom

import { act, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CodeWorkbenchProps } from "./CodeWorkbench";
import {
  RetryableCodeWorkbenchLoader,
  type CodeWorkbenchModuleLoader,
} from "./CodeWorkbenchLoader";

const hooks = vi.hoisted(() => ({
  useActionQuery: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (...args: unknown[]) => hooks.useActionQuery(...args),
}));

const props: CodeWorkbenchProps = {
  designId: "design-1",
  canEdit: true,
  localhostConnections: [
    {
      connectionId: "connection-1",
      label: "local-app",
      rootPath: "/tmp/local-app",
    },
  ],
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  hooks.useActionQuery.mockReturnValue({
    data: { files: [] },
    error: null,
    isLoading: false,
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
  }
  root = null;
  container?.remove();
  container = null;
  vi.restoreAllMocks();
});

describe("RetryableCodeWorkbenchLoader", () => {
  it("retries a failed lazy import in place without reloading the page", async () => {
    const ReadyWorkbench: ComponentType<CodeWorkbenchProps> = () => (
      <div data-testid="ready-workbench">Ready</div>
    );
    const loadWorkbench = vi
      .fn<CodeWorkbenchModuleLoader>()
      .mockRejectedValueOnce(new Error("Chunk request failed"))
      .mockResolvedValueOnce({ default: ReadyWorkbench });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    window.history.replaceState(
      { preserved: true },
      "",
      "/design/design-1?panel=code&zoom=60",
    );

    await act(async () => {
      root!.render(
        <RetryableCodeWorkbenchLoader
          loadWorkbench={loadWorkbench}
          workbenchProps={props}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container!.textContent).toContain("Chunk request failed");
    const retry = Array.from(container!.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Retry code editor"),
    );
    expect(retry).toBeDefined();

    await act(async () => {
      retry!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(loadWorkbench).toHaveBeenCalledTimes(2);
    expect(
      container!.querySelector('[data-testid="ready-workbench"]'),
    ).not.toBe(null);
    expect(window.location.pathname).toBe("/design/design-1");
    expect(window.location.search).toBe("?panel=code&zoom=60");
    expect(window.history.state).toEqual({ preserved: true });
    expect(consoleError).toHaveBeenCalled();
  });
});
