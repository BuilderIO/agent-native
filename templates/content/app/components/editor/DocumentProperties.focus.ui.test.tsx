// @vitest-environment happy-dom

import type { DocumentProperty } from "@shared/api";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  byLabel,
  click,
  focus,
  nextFrame,
  press,
  queryByLabel,
  renderUi,
} from "@/test-utils/render-ui";

const mutations = vi.hoisted(() => {
  const mutation = () => ({
    mutateAsync: vi.fn(async (_input: unknown) => ({})),
    isPending: false,
  });
  return {
    setValue: mutation(),
    configure: mutation(),
    duplicate: mutation(),
    remove: mutation(),
  };
});

vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => (key: string, options?: Record<string, unknown>) =>
    options ? `${key}(${Object.values(options).join(", ")})` : key,
  // The real hook reads react-i18next, which has no instance in unit tests.
  useIconPickerLabels: () => ({}),
}));

vi.mock("@/hooks/use-document-properties", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-document-properties")>()),
  useSetDocumentProperty: () => mutations.setValue,
  useConfigureDocumentProperty: () => mutations.configure,
  useDuplicateDocumentProperty: () => mutations.duplicate,
  useDeleteDocumentProperty: () => mutations.remove,
  useDocumentProperties: () => ({ data: undefined }),
}));

import {
  PropertyManagementPopover,
  PropertyValuePopover,
  TYPE_ICONS,
} from "./DocumentProperties";

function property(
  type: DocumentProperty["definition"]["type"],
  name: string,
  value: DocumentProperty["value"],
  options: DocumentProperty["definition"]["options"] = {},
): DocumentProperty {
  return {
    definition: {
      id: `${type}-property`,
      databaseId: "database",
      name,
      type,
      visibility: "always_show",
      options,
      position: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    value,
    editable: true,
  };
}

const statusOptions = {
  options: [
    { id: "draft", name: "Draft", color: "gray" as const },
    { id: "review", name: "Review", color: "blue" as const },
  ],
};

function expectFocusedAndSelected(
  control: HTMLInputElement | HTMLTextAreaElement,
) {
  expect(document.activeElement).toBe(control);
  expect(control.selectionStart).toBe(0);
  expect(control.selectionEnd).toBe(control.value.length);
}

async function openValueEditor(documentProperty: DocumentProperty) {
  await click(
    byLabel(
      `editor.properties.editProperty(${documentProperty.definition.name})`,
    ),
  );
  await nextFrame();
}

beforeEach(() => {
  for (const mutation of Object.values(mutations)) {
    mutation.mutateAsync.mockClear();
  }
});

describe("property management menu", () => {
  it("focuses and selects the property name when the menu opens", async () => {
    renderUi(
      <PropertyManagementPopover
        property={property("text", "Notes", "")}
        documentId="document"
        databaseId="database"
        icon={TYPE_ICONS.text}
      />,
    );

    await click(byLabel("editor.properties.propertyMenuFor(Notes)"));
    await nextFrame();

    const nameInput = byLabel<HTMLInputElement>(
      "editor.properties.propertyName",
    );
    expect(nameInput.value).toBe("Notes");
    expectFocusedAndSelected(nameInput);
  });

  it("moves columns from the keyboard and disables unavailable directions", async () => {
    const onMoveLeft = vi.fn();
    renderUi(
      <PropertyManagementPopover
        property={property("text", "Notes", "")}
        documentId="document"
        databaseId="database"
        icon={TYPE_ICONS.text}
        sorts={[]}
        filters={[]}
        onSortsChange={vi.fn()}
        onFiltersChange={vi.fn()}
        onMoveLeft={onMoveLeft}
      />,
    );

    const trigger = byLabel("editor.properties.propertyMenuFor(Notes)");
    await focus(trigger);
    await press(trigger, "Enter");
    await nextFrame();

    expect(document.activeElement?.getAttribute("role")).toBe("menuitem");
    const menuItem = (text: string) => {
      const item = [
        ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
      ].find((candidate) => candidate.textContent?.trim() === text);
      if (!item) throw new Error(`No menu item "${text}"`);
      return item;
    };
    const moveLeft = menuItem("editor.properties.moveColumnLeft");
    const moveRight = menuItem("editor.properties.moveColumnRight");
    expect(moveLeft.getAttribute("aria-disabled")).not.toBe("true");
    expect(moveRight.getAttribute("aria-disabled")).toBe("true");

    await focus(moveLeft);
    await press(moveLeft, "Enter");
    expect(onMoveLeft).toHaveBeenCalledTimes(1);
  });
});

describe("property value editors", () => {
  it("focuses and selects a number value, and Escape closes without saving", async () => {
    const estimate = property("number", "Estimate", 42);
    renderUi(
      <PropertyValuePopover
        property={estimate}
        documentId="document"
        portalled={false}
      >
        42
      </PropertyValuePopover>,
    );

    await openValueEditor(estimate);
    const input = byLabel<HTMLInputElement>(
      "editor.properties.editValue(Estimate)",
    );
    expect(input.value).toBe("42");
    expectFocusedAndSelected(input);

    await press(input, "Escape");
    expect(queryByLabel("editor.properties.editValue(Estimate)")).toBeNull();
    expect(mutations.setValue.mutateAsync).not.toHaveBeenCalled();
  });

  it("focuses and selects multiline text when its editor opens", async () => {
    const notes = property("text", "Notes", "First line\nSecond line");
    renderUi(
      <PropertyValuePopover
        property={notes}
        documentId="document"
        portalled={false}
      >
        Notes
      </PropertyValuePopover>,
    );

    await openValueEditor(notes);
    const textarea = byLabel<HTMLTextAreaElement>(
      "editor.properties.editValue(Notes)",
    );
    expect(textarea.tagName).toBe("TEXTAREA");
    expectFocusedAndSelected(textarea);
  });

  it("focuses and selects the start date, and Escape closes without saving", async () => {
    const due = property("date", "Due", { start: "2026-09-26" });
    renderUi(
      <PropertyValuePopover
        property={due}
        documentId="document"
        portalled={false}
      >
        Sep 26
      </PropertyValuePopover>,
    );

    await openValueEditor(due);
    const startDate = byLabel<HTMLInputElement>(
      "editor.properties.editStartDate(Due)",
    );
    expect(startDate.value).toBe("2026-09-26");
    expect(document.activeElement).toBe(startDate);

    await press(startDate, "Escape");
    expect(queryByLabel("editor.properties.editStartDate(Due)")).toBeNull();
    expect(mutations.setValue.mutateAsync).not.toHaveBeenCalled();
  });

  it("focuses option search, and Escape closes without choosing", async () => {
    const status = property("select", "Status", "draft", statusOptions);
    renderUi(
      <PropertyValuePopover
        property={status}
        documentId="document"
        portalled={false}
      >
        Draft
      </PropertyValuePopover>,
    );

    await openValueEditor(status);
    const search = byLabel<HTMLInputElement>(
      "editor.properties.searchPropertyOptions(Status)",
    );
    expect(document.activeElement).toBe(search);

    await press(search, "Escape");
    expect(
      queryByLabel("editor.properties.searchPropertyOptions(Status)"),
    ).toBeNull();
    expect(mutations.setValue.mutateAsync).not.toHaveBeenCalled();
  });

  it("returns focus to option search after toggling a multi-select option", async () => {
    const tags = property("multi_select", "Tags", [], statusOptions);
    renderUi(
      <PropertyValuePopover
        property={tags}
        documentId="document"
        portalled={false}
      >
        Tags
      </PropertyValuePopover>,
    );

    await openValueEditor(tags);
    const option = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.includes("Review"));
    if (!option) throw new Error('No "Review" option');

    // Clicking moves focus to the option; the editor must hand it back.
    await click(option);
    await nextFrame();

    expect(mutations.setValue.mutateAsync).toHaveBeenCalledWith({
      documentId: "document",
      propertyId: "multi_select-property",
      value: ["review"],
    });
    expect(document.activeElement).toBe(
      byLabel("editor.properties.searchPropertyOptions(Tags)"),
    );
  });

  it("renders the editor inside its parent surface when portalling is off", async () => {
    const estimate = property("number", "Estimate", 3);
    const { container } = renderUi(
      <PropertyValuePopover
        property={estimate}
        documentId="document"
        portalled={false}
      >
        3
      </PropertyValuePopover>,
    );

    await openValueEditor(estimate);
    expect(
      container.contains(byLabel("editor.properties.editValue(Estimate)")),
    ).toBe(true);
  });

  it("portals the editor out of its parent surface by default", async () => {
    const estimate = property("number", "Estimate", 3);
    const { container } = renderUi(
      <PropertyValuePopover property={estimate} documentId="document">
        3
      </PropertyValuePopover>,
    );

    await openValueEditor(estimate);
    expect(
      container.contains(byLabel("editor.properties.editValue(Estimate)")),
    ).toBe(false);
  });
});
