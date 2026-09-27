// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BrandingEditor } from "./branding-editor";

const mocks = vi.hoisted(() => ({
  save: vi.fn(async (_payload: unknown) => ({})),
}));

vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: (path: string) => path,
  appBasePath: () => "",
}));

vi.mock("@agent-native/core/client/setup-connections", () => ({
  FileStorageSetupCard: () => null,
}));

vi.mock("@/hooks/use-video-storage-status", () => ({
  useVideoStorageStatus: () => ({
    data: { configured: true },
    isError: false,
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: () => ({
    isPending: false,
    mutateAsync: (payload: unknown) => mocks.save(payload),
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new InputEvent("input", { bubbles: true, data: value }));
}

describe("BrandingEditor save button dirty state", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.save.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <BrandingEditor
          organizationId="org_1"
          initialName="Acme"
          initialBrandColor="#18181B"
          initialBrandLogoUrl={null}
          initialDefaultVisibility="public"
        />,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  function findSaveButton() {
    return Array.from(container.querySelectorAll("button")).find((button) =>
      ["brandingEditor.save", "brandingEditor.saved"].includes(
        button.textContent ?? "",
      ),
    );
  }

  it("enables and highlights Save once a branding field changes, then resets after saving", async () => {
    const nameInput = container.querySelector<HTMLInputElement>("#ws-name");
    expect(nameInput).not.toBeNull();

    let save = findSaveButton();
    expect(save?.disabled).toBe(true);
    expect(save?.textContent).toBe("brandingEditor.saved");

    act(() => setInputValue(nameInput!, "New Name"));

    save = findSaveButton();
    expect(save?.disabled).toBe(false);
    expect(save?.textContent).toBe("brandingEditor.save");

    await act(async () => {
      save?.click();
      await Promise.resolve();
    });

    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ name: "New Name" }),
    );

    save = findSaveButton();
    expect(save?.disabled).toBe(true);
    expect(save?.textContent).toBe("brandingEditor.saved");
  });
});
