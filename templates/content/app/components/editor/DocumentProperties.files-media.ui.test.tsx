// @vitest-environment happy-dom

import type { DocumentProperty } from "@shared/api";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { setPropertyMutation, uploadStatus } = vi.hoisted(() => ({
  setPropertyMutation: {
    mutateAsync: vi.fn(async () => ({})),
    isPending: false,
  },
  uploadStatus: {
    current: { isSuccess: true, data: { configured: false } },
  },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, options?: Record<string, unknown>) => {
    if (key === "editor.properties.editProperty") {
      return `Edit ${String(options?.name)}`;
    }
    if (key === "editor.properties.editValue") {
      return `Edit ${String(options?.name)} value`;
    }
    return key;
  },
}));

vi.mock("@agent-native/core/client/uploads", () => ({
  useFileUploadStatus: () => uploadStatus.current,
}));

vi.mock("@agent-native/core/client/setup-connections", async () => {
  const { createElement } = await import("react");
  return {
    FileStorageSetupCard: () =>
      createElement("div", { "data-testid": "file-storage-setup-card" }),
  };
});

vi.mock("@/hooks/use-document-properties", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-document-properties")>()),
  useSetDocumentProperty: () => setPropertyMutation,
}));

import { PropertyValuePopover } from "./DocumentProperties";

const imageProperty: DocumentProperty = {
  definition: {
    id: "image",
    databaseId: "database",
    name: "Image",
    type: "files_media",
    visibility: "always_show",
    options: {},
    position: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  value: ["https://example.com/existing.png"],
  editable: true,
};

function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("files and media property editor", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    setPropertyMutation.mutateAsync.mockClear();
    uploadStatus.current = { isSuccess: true, data: { configured: false } };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <PropertyValuePopover
          property={imageProperty}
          documentId="document"
          databaseDocumentId="database-document"
          portalled={false}
        >
          Existing image
        </PropertyValuePopover>,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("saves a valid pending link in the first mutation", async () => {
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Edit Image"]',
    );
    expect(trigger).not.toBeNull();

    await act(async () => trigger?.click());

    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Edit Image value"]',
    );
    expect(input?.type).toBe("url");

    await act(async () => {
      if (input) setInputValue(input, "https://example.com/pending.png");
    });

    const save = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "editor.properties.save",
    );
    await act(async () => save?.click());

    expect(setPropertyMutation.mutateAsync).toHaveBeenCalledTimes(1);
    expect(setPropertyMutation.mutateAsync).toHaveBeenCalledWith({
      documentId: "document",
      propertyId: "image",
      value: [
        "https://example.com/existing.png",
        "https://example.com/pending.png",
      ],
    });
  });

  it("blocks image uploads and shows the shared storage setup", async () => {
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Edit Image"]',
    );
    await act(async () => trigger?.click());

    expect(
      container.querySelector('[data-testid="file-storage-setup-card"]'),
    ).not.toBeNull();
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (button) => button.textContent === "editor.properties.upload",
      ),
    ).toBe(false);

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input?.disabled).toBe(true);
    if (input) {
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [new File(["image"], "photo.png", { type: "image/png" })],
      });
      await act(async () => input.dispatchEvent(new Event("change")));
    }

    expect(fetchMock).not.toHaveBeenCalled();
    expect(setPropertyMutation.mutateAsync).not.toHaveBeenCalled();
  });
});
