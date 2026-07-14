// @vitest-environment happy-dom

import type { DocumentProperty } from "@shared/api";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setPropertyMutation = vi.hoisted(() => ({
  mutateAsync: vi.fn(async () => ({})),
  isPending: false,
}));

vi.mock("@agent-native/core/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client")>()),
  useT: () => (key: string, options?: Record<string, unknown>) => {
    if (key === "editor.properties.editProperty") {
      return `Edit ${String(options?.name)}`;
    }
    if (key === "editor.properties.editStartDate") {
      return `Edit ${String(options?.name)} start date`;
    }
    return key;
  },
}));

vi.mock("@/hooks/use-document-properties", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-document-properties")>()),
  useSetDocumentProperty: () => setPropertyMutation,
}));

import { PropertyValuePopover } from "./DocumentProperties";

const dateProperty: DocumentProperty = {
  definition: {
    id: "date",
    databaseId: "database",
    name: "Date",
    type: "date",
    visibility: "always_show",
    options: {},
    position: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  value: null,
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

describe("date property editor", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    setPropertyMutation.mutateAsync.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <PropertyValuePopover
          property={dateProperty}
          documentId="document"
          databaseDocumentId="database-document"
          portalled={false}
        >
          Empty
        </PropertyValuePopover>,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("saves the date entered immediately before the first submit", async () => {
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Edit Date"]',
    );
    expect(trigger).not.toBeNull();
    await act(async () => trigger?.click());

    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Edit Date start date"]',
    );
    expect(input?.type).toBe("date");

    const save = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "editor.properties.save",
    );
    await act(async () => {
      if (input) setInputValue(input, "2026-07-13");
      save?.click();
    });

    expect(setPropertyMutation.mutateAsync).toHaveBeenCalledTimes(1);
    expect(setPropertyMutation.mutateAsync).toHaveBeenCalledWith({
      documentId: "document",
      propertyId: "date",
      value: { start: "2026-07-13", includeTime: false },
    });
  });

  it("submits the native date control value when a browser fill misses React state", async () => {
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Edit Date"]',
    );
    await act(async () => trigger?.click());

    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Edit Date start date"]',
    );
    expect(input).not.toBeNull();
    if (input) input.value = "2026-07-13";

    const save = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "editor.properties.save",
    );
    await act(async () => save?.click());

    expect(setPropertyMutation.mutateAsync).toHaveBeenCalledTimes(1);
    expect(setPropertyMutation.mutateAsync).toHaveBeenCalledWith({
      documentId: "document",
      propertyId: "date",
      value: { start: "2026-07-13", includeTime: false },
    });
  });
});
