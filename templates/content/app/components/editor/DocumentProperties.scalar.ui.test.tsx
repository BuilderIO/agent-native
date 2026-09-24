// @vitest-environment happy-dom

import type { DocumentProperty } from "@shared/api";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setPropertyMutation = vi.hoisted(() => ({
  mutateAsync: vi.fn(async () => ({})),
  isPending: false,
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

vi.mock("@/hooks/use-document-properties", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-document-properties")>()),
  useSetDocumentProperty: () => setPropertyMutation,
}));

import { displayValue, PropertyValuePopover } from "./DocumentProperties";

function property(
  type: DocumentProperty["definition"]["type"],
  value: DocumentProperty["value"],
): DocumentProperty {
  return {
    definition: {
      id: type,
      databaseId: "database",
      name: type === "text" ? "Notes" : "Estimate",
      type,
      visibility: "always_show",
      options:
        type === "select" || type === "status" || type === "multi_select"
          ? {
              options: [
                {
                  id: "long-option",
                  name: "A very long option label without convenient breaks",
                  color: "blue",
                },
              ],
            }
          : {},
      position: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    value,
    editable: true,
  };
}

function setControlValue(
  control: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const prototype =
    control instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(
    control,
    value,
  );
  control.dispatchEvent(new Event("input", { bubbles: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("scalar property value editor", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    setPropertyMutation.mutateAsync.mockReset();
    setPropertyMutation.mutateAsync.mockResolvedValue({});
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  function renderEditor(documentProperty: DocumentProperty) {
    act(() => {
      root.render(
        <PropertyValuePopover
          property={documentProperty}
          documentId="document"
          databaseDocumentId="database-document"
          portalled={false}
        >
          Current value
        </PropertyValuePopover>,
      );
    });
    const trigger = container.querySelector<HTMLButtonElement>(
      `button[aria-label="Edit ${documentProperty.definition.name}"]`,
    );
    act(() => trigger?.click());
  }

  it("preserves multiline Text and commits it only with Cmd/Ctrl+Enter", async () => {
    renderEditor(property("text", "First line"));
    const textarea = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Edit Notes value"]',
    );
    expect(textarea).not.toBeNull();

    await act(async () => {
      if (!textarea) return;
      setControlValue(textarea, "First line\nSecond line\nEND");
      const plainEnter = new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      });
      expect(textarea.dispatchEvent(plainEnter)).toBe(true);
    });
    expect(setPropertyMutation.mutateAsync).not.toHaveBeenCalled();

    await act(async () => {
      textarea?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          metaKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(setPropertyMutation.mutateAsync).toHaveBeenCalledTimes(1);
    expect(setPropertyMutation.mutateAsync).toHaveBeenCalledWith({
      documentId: "document",
      propertyId: "text",
      value: "First line\nSecond line\nEND",
    });
  });

  it("cancels multiline Text with Escape without saving", () => {
    renderEditor(property("text", "Saved value"));
    const textarea = container.querySelector<HTMLTextAreaElement>(
      'textarea[aria-label="Edit Notes value"]',
    );
    expect(textarea).not.toBeNull();

    act(() => {
      if (!textarea) return;
      setControlValue(textarea, "Uncommitted\nvalue");
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(setPropertyMutation.mutateAsync).not.toHaveBeenCalled();
    expect(
      container.querySelector('textarea[aria-label="Edit Notes value"]'),
    ).toBeNull();
  });

  it.each(["not-a-number", "1e", "Infinity"])(
    "retains invalid numeric input %s without saving an empty value",
    (invalid) => {
      renderEditor(property("number", 3));
      const input = container.querySelector<HTMLInputElement>(
        'input[aria-label="Edit Estimate value"]',
      )!;
      act(() => setControlValue(input, invalid));
      act(() =>
        input.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
      expect(setPropertyMutation.mutateAsync).not.toHaveBeenCalled();
      expect(input.value).toBe(invalid);
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(
        "database.enterAValidNumber",
      );
    },
  );

  it("clears a whitespace-only numeric entry instead of storing zero", async () => {
    renderEditor(property("number", 3));
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Edit Estimate value"]',
    )!;
    act(() => setControlValue(input, "   "));
    await act(async () =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(setPropertyMutation.mutateAsync).toHaveBeenCalledWith({
      documentId: "document",
      propertyId: "number",
      value: null,
    });
  });

  it("submits Number once on Enter even when Enter repeats", async () => {
    let resolveSave: (() => void) | undefined;
    setPropertyMutation.mutateAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = () => resolve({});
        }),
    );
    renderEditor(property("number", 3));
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Edit Estimate value"]',
    );
    expect(input?.inputMode).toBe("decimal");

    act(() => {
      if (!input) return;
      setControlValue(input, "42");
      for (let index = 0; index < 2; index += 1) {
        input.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    });
    expect(setPropertyMutation.mutateAsync).toHaveBeenCalledTimes(1);
    expect(setPropertyMutation.mutateAsync).toHaveBeenCalledWith({
      documentId: "document",
      propertyId: "number",
      value: "42",
    });

    await act(async () => resolveSave?.());
    expect(
      container.querySelector('input[aria-label="Edit Estimate value"]'),
    ).toBeNull();
  });
});

describe("property value presentation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  function renderValue(
    documentProperty: DocumentProperty,
    presentation: "compact" | "wrapped",
  ) {
    act(() =>
      root.render(displayValue(documentProperty, undefined, presentation)),
    );
    return container.firstElementChild as HTMLElement;
  }

  it("preserves Text line boundaries in wrapped cells and ellipsizes compact cells", () => {
    const documentProperty = property("text", "First line\nSecond line");
    const wrapped = renderValue(documentProperty, "wrapped");
    expect(wrapped.textContent).toBe("First line\nSecond line");
    expect(wrapped.className).toContain("whitespace-pre-wrap");
    expect(wrapped.className).toContain("[overflow-wrap:anywhere]");

    const compact = renderValue(documentProperty, "compact");
    expect(compact.className).toContain("truncate");
    expect(compact.className).toContain("whitespace-nowrap");
  });

  it.each(["select", "status"] as const)(
    "wraps long %s option labels only in wrapped presentation",
    (type) => {
      const documentProperty = property(type, "long-option");
      const wrapped = renderValue(documentProperty, "wrapped");
      const wrappedLabel = wrapped.firstElementChild as HTMLElement;
      expect(wrapped.className).toContain("max-w-full");
      expect(wrappedLabel.className).toContain("[overflow-wrap:anywhere]");
      expect(wrappedLabel.className).not.toContain("truncate");

      const compact = renderValue(documentProperty, "compact");
      expect(compact.firstElementChild?.className).toContain("truncate");
    },
  );

  it("contains and wraps long multi-select pills within the cell", () => {
    const wrapped = renderValue(
      property("multi_select", ["long-option"]),
      "wrapped",
    );
    expect(wrapped.className).toContain("max-w-full");
    expect(wrapped.className).toContain("flex-wrap");
    expect(wrapped.firstElementChild?.firstElementChild?.className).toContain(
      "[overflow-wrap:anywhere]",
    );

    const compact = renderValue(
      property("multi_select", ["long-option"]),
      "compact",
    );
    expect(compact.className).toContain("overflow-hidden");
    expect(compact.className).toContain("flex-nowrap");
  });
});
