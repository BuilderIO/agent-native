// @vitest-environment happy-dom

import type { FormField } from "@shared/types";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FormFillPage } from "@/pages/FormFillPage";

import { FieldPropertiesPanel } from "./FieldPropertiesPanel";
import { FieldRenderer } from "./FieldRenderer";

vi.mock("@/hooks/use-forms", () => ({
  usePublicForm: () => ({
    data: {
      id: "form",
      title: "نموذج",
      description: "Description",
      fields: [{ id: "name", type: "text", label: "الاسم", required: false }],
      settings: { submitText: "إرسال", successMessage: "شكرا" },
    },
    isLoading: false,
  }),
  useSubmitForm: () => ({
    isPending: false,
    mutate: (_data: unknown, options: { onSuccess: () => void }) =>
      options.onSuccess(),
  }),
}));
vi.mock("@/components/ThemeToggle", () => ({ ThemeToggle: () => null }));
vi.mock("@agent-native/toolkit/app/shared", () => ({
  Turnstile: () => null,
  PoweredByBadge: () => null,
}));

describe("FieldRenderer", () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
  });

  it.each([
    { language: "Arabic", label: "الاسم", answer: "أحمد" },
    { language: "English", label: "Name", answer: "Alice" },
  ])(
    "uses automatic direction for $language field content",
    ({ label, answer }) => {
      const field = {
        id: "name",
        type: "text",
        label,
        description: "Help / مساعدة",
        required: false,
      } as FormField;
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);

      act(() => {
        root?.render(<FieldRenderer field={field} value={answer} />);
      });

      const fieldLabel = container.querySelector("label");
      const description = container.querySelector("p");
      const input = container.querySelector<HTMLInputElement>("input");
      expect(fieldLabel?.textContent).toBe(label);
      expect(description?.textContent).toBe("Help / مساعدة");
      expect(input?.value).toBe(answer);
      for (const element of [fieldLabel, description, input]) {
        expect(element?.getAttribute("dir")).toBe("auto");
      }
    },
  );

  it.each([
    { type: "textarea", selector: "textarea", direction: "auto" },
    { type: "email", selector: 'input[type="email"]', direction: null },
    { type: "number", selector: 'input[type="number"]', direction: null },
    { type: "date", selector: 'input[type="date"]', direction: null },
  ] as const)(
    "sets direction appropriately for $type controls",
    ({ type, selector, direction }) => {
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      act(() => {
        root?.render(
          <FieldRenderer
            field={{ id: type, type, label: "السؤال", required: false }}
          />,
        );
      });
      const control = container.querySelector(selector);
      expect(control).not.toBeNull();
      expect(control?.getAttribute("dir")).toBe(direction);
    },
  );

  it.each(["radio", "multiselect", "checkbox"] as const)(
    "isolates $type option text from its control",
    (type) => {
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      act(() => {
        root?.render(
          <FieldRenderer
            field={{
              id: type,
              type,
              label: "Question",
              placeholder: "نعم",
              options: ["نعم", "No"],
              required: false,
            }}
          />,
        );
      });
      const option = Array.from(container.querySelectorAll("[dir=auto]")).find(
        (element) => element.textContent === "نعم",
      );
      expect(option).toBeDefined();
      expect(option?.querySelector("button, input")).toBeNull();
    },
  );

  it("uses automatic direction for the select placeholder and chosen value", () => {
    const field = {
      id: "choice",
      type: "select",
      label: "Choose",
      placeholder: "اختر",
      options: ["نعم", "No"],
      required: false,
    } as FormField;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<FieldRenderer field={field} />));
    const value = container.querySelector('[role="combobox"] [dir="auto"]');
    expect(value?.textContent).toBe("اختر");
    act(() => root?.render(<FieldRenderer field={field} value="نعم" />));
    const selected = container.querySelector('[role="combobox"] [dir="auto"]');
    expect(selected?.textContent).toBe("نعم");
  });

  it("allows field labels, help, placeholders, and options to be edited with automatic direction", () => {
    const field = {
      id: "choice",
      type: "radio",
      label: "السؤال",
      placeholder: "مثال",
      description: "مساعدة",
      options: ["نعم", "No"],
      required: false,
    } as FormField;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <FieldPropertiesPanel
          field={field}
          fields={[field]}
          onChange={vi.fn()}
          onDelete={vi.fn()}
        />,
      );
    });
    for (const value of ["السؤال", "مثال", "مساعدة", "نعم", "No"]) {
      const control = Array.from(
        container.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
          "input, textarea",
        ),
      ).find((element) => element.value === value);
      expect(control?.getAttribute("dir"), value).toBe("auto");
    }
  });

  it("renders authored content in the React fill and success views", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <MemoryRouter initialEntries={["/f/example"]}>
          <Routes>
            <Route path="/f/*" element={<FormFillPage />} />
          </Routes>
        </MemoryRouter>,
      );
    });
    for (const selector of [
      "h1",
      "p",
      "label",
      'input:not([name="website"])',
      'button[type="submit"]',
    ]) {
      const element = container.querySelector(selector);
      expect(element, selector).not.toBeNull();
      expect(element?.getAttribute("dir"), selector).toBe("auto");
    }
    expect(container.querySelector("h1")?.textContent).toBe("نموذج");
    expect(container.querySelector('button[type="submit"]')?.textContent).toBe(
      "إرسال",
    );
    act(() => {
      container
        ?.querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    const message = Array.from(container.querySelectorAll("p")).find(
      (element) => element.textContent === "شكرا",
    );
    expect(message?.getAttribute("dir")).toBe("auto");
  });

  it("renders a native multi-file input and forwards selected files", () => {
    const onChange = vi.fn();
    const field = {
      id: "screenshots",
      type: "file",
      label: "Screenshots",
      required: false,
      multiple: true,
      accept: "image/*",
    } as FormField;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root?.render(<FieldRenderer field={field} onChange={onChange} />);
    });

    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(container.querySelectorAll('input[type="file"]')).toHaveLength(1);
    expect(input?.multiple).toBe(true);
    expect(input?.accept).toBe("image/*");

    const file = new File(["image"], "screen.png", { type: "image/png" });
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    });
    act(() => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith([file]);
  });
});
