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
    if (key === "editor.properties.editStartDate") {
      return `Edit ${String(options?.name)} start date`;
    }
    if (key === "editor.properties.editEndDate") {
      return `Edit ${String(options?.name)} end date`;
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

describe("date property editor", () => {
  let container: HTMLDivElement;
  let root: Root;

  function render(value: DocumentProperty["value"] = null) {
    act(() => {
      root.render(
        <PropertyValuePopover
          property={{ ...dateProperty, value }}
          documentId="document"
          databaseDocumentId="database-document"
          portalled={false}
        >
          Empty
        </PropertyValuePopover>,
      );
    });
  }

  async function open() {
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Edit Date"]',
    );
    expect(trigger).not.toBeNull();
    await act(async () => trigger?.click());
  }

  function buttonWithText(text: string) {
    return Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === text,
    );
  }

  function calendarDay(year: number, month: number, day: number) {
    return container.querySelector<HTMLButtonElement>(
      `button[data-day="${new Date(year, month - 1, day).toLocaleDateString()}"]`,
    );
  }

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    setPropertyMutation.mutateAsync.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    render();
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("saves the native date control's live value when React state lags", async () => {
    await open();

    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Edit Date start date"]',
    );
    expect(input?.type).toBe("date");

    if (input) input.value = "2026-07-24";

    const save = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "editor.properties.save",
    );
    await act(async () => save?.click());

    expect(setPropertyMutation.mutateAsync).toHaveBeenCalledTimes(1);
    expect(setPropertyMutation.mutateAsync).toHaveBeenCalledWith({
      documentId: "document",
      propertyId: "date",
      value: {
        start: "2026-07-24",
        includeTime: false,
      },
    });
  });

  it("saves a day picked in the calendar in one click", async () => {
    render({ start: "2026-10-01", includeTime: false });
    await open();

    const day = calendarDay(2026, 10, 7);
    expect(day).not.toBeNull();
    await act(async () => day?.click());

    expect(setPropertyMutation.mutateAsync).toHaveBeenCalledTimes(1);
    expect(setPropertyMutation.mutateAsync).toHaveBeenCalledWith({
      documentId: "document",
      propertyId: "date",
      value: { start: "2026-10-07", includeTime: false },
    });
  });

  it("keeps the end date when only the end is filled in", async () => {
    await open();
    expect(
      container.querySelector('input[aria-label="Edit Date end date"]'),
    ).toBeNull();

    const endToggle = Array.from(
      container.querySelectorAll<HTMLLabelElement>("label"),
    )
      .find((label) => label.textContent === "database.endDate")
      ?.querySelector("input");
    await act(async () => endToggle?.click());

    const end = container.querySelector<HTMLInputElement>(
      'input[aria-label="Edit Date end date"]',
    );
    expect(end).not.toBeNull();
    if (end) end.value = "2026-10-07";
    await act(async () => buttonWithText("editor.properties.save")?.click());

    expect(setPropertyMutation.mutateAsync).toHaveBeenCalledWith({
      documentId: "document",
      propertyId: "date",
      value: { start: "2026-10-07", includeTime: false },
    });
  });

  it("picks a range in the calendar and saves it in order", async () => {
    render({ start: "2026-10-09", end: "2026-10-12", includeTime: false });
    await open();

    await act(async () => calendarDay(2026, 10, 9)?.click());
    await act(async () => calendarDay(2026, 10, 5)?.click());
    await act(async () => calendarDay(2026, 10, 7)?.click());
    expect(setPropertyMutation.mutateAsync).not.toHaveBeenCalled();

    await act(async () => buttonWithText("editor.properties.save")?.click());

    expect(setPropertyMutation.mutateAsync).toHaveBeenCalledWith({
      documentId: "document",
      propertyId: "date",
      value: { start: "2026-10-05", end: "2026-10-07", includeTime: false },
    });
  });

  it("saves a typed range with its ends reversed in order", async () => {
    render({ start: "2026-10-09", end: "2026-10-12", includeTime: false });
    await open();

    const end = container.querySelector<HTMLInputElement>(
      'input[aria-label="Edit Date end date"]',
    );
    if (end) end.value = "2026-10-07";
    await act(async () => buttonWithText("editor.properties.save")?.click());

    expect(setPropertyMutation.mutateAsync).toHaveBeenCalledWith({
      documentId: "document",
      propertyId: "date",
      value: { start: "2026-10-07", end: "2026-10-09", includeTime: false },
    });
  });
});
