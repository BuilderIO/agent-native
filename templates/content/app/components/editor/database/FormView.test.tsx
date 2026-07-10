// @vitest-environment happy-dom

import type { ContentDatabaseView, DocumentProperty } from "@shared/api";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const submitMutation = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  isPending: false,
  error: null as unknown,
}));

vi.mock("@agent-native/core/client", () => ({
  cn: (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(" "),
  useT: () => (key: string) => key,
}));

vi.mock("@/hooks/use-content-database", () => ({
  useSubmitContentDatabaseForm: () => submitMutation,
}));

import { DatabaseFormView } from "./FormView";

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

const descriptionProperty: DocumentProperty = {
  definition: {
    id: "description",
    databaseId: "database",
    name: "Description",
    type: "blocks",
    visibility: "always_show",
    options: { blocks: { primary: true } },
    position: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  value: null,
  editable: true,
};

const hiddenProperty: DocumentProperty = {
  ...descriptionProperty,
  definition: {
    ...descriptionProperty.definition,
    id: "hidden",
    name: "Hidden detail",
    type: "text",
    position: 1,
  },
};

const view: ContentDatabaseView = {
  id: "request-form",
  name: "Request design",
  type: "form",
  sorts: [],
  filters: [],
  columnWidths: {},
  formQuestions: [
    { key: "name", enabled: true, required: true },
    { key: "description", enabled: true, required: true },
    { key: "hidden", enabled: false, required: false },
  ],
};

describe("DatabaseFormView", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    submitMutation.mutateAsync.mockReset();
    submitMutation.mutateAsync.mockResolvedValue({
      databaseId: "database",
      viewId: "request-form",
      createdItemId: "item",
      createdDocumentId: "created-document",
      urlPath: "/page/created-document",
      deepLink: "https://content.example/page/created-document",
      verified: true,
    });
    submitMutation.isPending = false;
    submitMutation.error = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <MemoryRouter>
          <DatabaseFormView
            databaseId="database"
            databaseDocumentId="database-document"
            databaseTitle="Design asks"
            view={view}
            properties={[descriptionProperty, hiddenProperty]}
            canEdit
          />
        </MemoryRouter>,
      );
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("renders enabled questions in order and omits disabled questions", () => {
    const labels = [...container.querySelectorAll("label")].map((label) =>
      label.textContent?.trim(),
    );
    expect(labels).toEqual(["database.formName*", "Description*"]);
    expect(container.textContent).not.toContain("Hidden detail");
  });

  it("connects required validation errors to every invalid control", async () => {
    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    await act(async () => {
      form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    const invalidControls = container.querySelectorAll('[aria-invalid="true"]');
    expect(invalidControls).toHaveLength(2);
    for (const control of invalidControls) {
      const errorId = control.getAttribute("aria-describedby");
      expect(errorId).toBeTruthy();
      expect(container.querySelector(`#${errorId}`)?.textContent).toBe(
        "database.formRequiredError",
      );
    }
    expect(submitMutation.mutateAsync).not.toHaveBeenCalled();
  });

  it("submits one complete payload and shows the persisted-response confirmation", async () => {
    const title = container.querySelector<HTMLInputElement>(
      "#database-form-name",
    );
    const description = container.querySelector<HTMLTextAreaElement>(
      "#database-form-description",
    );
    expect(title).not.toBeNull();
    expect(description).not.toBeNull();
    await act(async () => {
      if (title) {
        setControlValue(title, "Refresh the pricing page");
      }
      if (description) {
        setControlValue(description, "Clarify the enterprise story.");
      }
    });
    await act(async () => {
      container
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });

    expect(submitMutation.mutateAsync).toHaveBeenCalledWith({
      databaseId: "database",
      viewId: "request-form",
      title: "Refresh the pricing page",
      propertyValues: { description: "Clarify the enterprise story." },
    });
    expect(container.textContent).toContain("database.formSubmitted");
    expect(container.textContent).toContain("database.openPage");
  });
});
