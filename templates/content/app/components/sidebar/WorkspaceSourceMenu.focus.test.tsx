// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspaceSourceMenu } from "./WorkspaceSourceMenu";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@/hooks/use-content-spaces", () => ({
  useCreateContentSpace: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
}));

describe("WorkspaceSourceMenu focus", () => {
  let container: HTMLDivElement;
  let root: Root;

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
  });

  it("opens the workspace dialog after the menu closes and focuses its name input", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () =>
      root.render(
        <MemoryRouter>
          <WorkspaceSourceMenu menuStart={<div>Existing workspace</div>}>
            <button type="button">Workspace</button>
          </WorkspaceSourceMenu>
        </MemoryRouter>,
      ),
    );

    const trigger = container.querySelector<HTMLButtonElement>("button")!;
    await act(async () => {
      trigger.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerType: "mouse",
        }),
      );
    });
    const newWorkspace = [
      ...document.querySelectorAll<HTMLElement>("[role=menuitem]"),
    ].find((item) => item.textContent === "sidebar.newWorkspace")!;

    await act(async () => {
      newWorkspace.click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    const input = document.querySelector<HTMLInputElement>(
      'input[aria-label="sidebar.workspaceName"]',
    );
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
  });
});
