// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BrandingEditor } from "./branding-editor";

const mocks = vi.hoisted(() => ({
  save: vi.fn(async (_payload: unknown) => ({})),
  storageConfigured: true,
  storageRefetch: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@agent-native/core/client/api-path", () => ({
  appApiPath: (path: string) => path,
  agentNativePath: (path: string) => path,
  appBasePath: () => "",
}));

vi.mock("@agent-native/toolkit/app/chat/FileStorageSetupPopover", () => ({
  FileStorageSetupPopover: ({
    open,
    onConnected,
    onOpenChange,
  }: {
    open: boolean;
    onConnected?: () => void;
    onOpenChange: (open: boolean, reason?: string) => void;
  }) =>
    open ? (
      <div role="dialog">
        <button type="button" onClick={onConnected}>
          Connected
        </button>
        <button
          type="button"
          data-testid="file-storage-dismiss"
          onClick={() => onOpenChange(false, "dismiss")}
        >
          Dismiss
        </button>
      </div>
    ) : null,
}));

vi.mock("@/hooks/use-video-storage-status", () => ({
  useVideoStorageStatus: () => ({
    data: { configured: mocks.storageConfigured },
    isError: false,
    isLoading: false,
    refetch: mocks.storageRefetch,
  }),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  getBrowserTabId: () => "test-tab",
  useActionMutation: () => ({
    isPending: false,
    mutateAsync: (payload: unknown) => mocks.save(payload),
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: mocks.toastError },
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
    mocks.toastError.mockClear();
    mocks.storageConfigured = true;
    mocks.storageRefetch.mockImplementation(async () => ({
      data: { configured: mocks.storageConfigured },
      isError: false,
    }));
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

  it("uploads a dropped logo after the user connects storage", async () => {
    const file = new File(["logo"], "brand.png", { type: "image/png" });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new TextEncoder().encode("logo").buffer,
    });
    const upload = vi.fn(async () => ({
      ok: true,
      json: async () => ({ reference: "logo-ref" }),
    }));
    const TestURL = class extends URL {};
    Object.assign(TestURL, {
      createObjectURL: vi.fn(() => "blob:brand-logo"),
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal("URL", TestURL);
    vi.stubGlobal("fetch", upload);
    mocks.storageConfigured = false;
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

    const dropZone = container.querySelector<HTMLElement>(".border-dashed")!;
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { files: [file] } });
    await act(async () => dropZone.dispatchEvent(drop));
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    expect(upload).not.toHaveBeenCalled();

    mocks.storageConfigured = true;
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[role="dialog"] button')!
        .click();
      await Promise.resolve();
      root.render(
        <BrandingEditor
          organizationId="org_1"
          initialName="Acme"
          initialBrandColor="#18181B"
          initialBrandLogoUrl={null}
          initialDefaultVisibility="public"
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(mocks.storageRefetch).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(upload).toHaveBeenCalledOnce());
    expect(upload).toHaveBeenCalledWith(
      expect.stringContaining("filename=brand.png"),
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "image/png" },
      }),
    );
  });

  it("does not upload a queued logo after storage setup is dismissed", async () => {
    const file = new File(["logo"], "brand.png", { type: "image/png" });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new TextEncoder().encode("logo").buffer,
    });
    const upload = vi.fn(async () => ({
      ok: true,
      json: async () => ({ reference: "logo-ref" }),
    }));
    vi.stubGlobal("fetch", upload);
    mocks.storageConfigured = false;
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

    const dropZone = container.querySelector<HTMLElement>(".border-dashed")!;
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: { files: [file] } });
    await act(async () => dropZone.dispatchEvent(drop));
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="file-storage-dismiss"]',
        )
        ?.click(),
    );

    mocks.storageConfigured = true;
    await act(async () => {
      root.render(
        <BrandingEditor
          organizationId="org_1"
          initialName="Acme"
          initialBrandColor="#18181B"
          initialBrandLogoUrl={null}
          initialDefaultVisibility="public"
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(upload).not.toHaveBeenCalled();
  });
});
