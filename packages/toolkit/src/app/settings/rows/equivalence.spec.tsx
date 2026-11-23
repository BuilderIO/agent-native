// @vitest-environment happy-dom
import {
  fireEvent,
  render,
  cleanup,
  getByRole,
  getByLabelText,
} from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TextField, Picker } from "../../../design-system/components.js";
import type { SettingsRowDefinition, SettingsSubmitResult } from "./schema.js";
import { SettingsSections } from "./SettingsSections.js";
import { snapshotSettings } from "./snapshot.js";

afterEach(cleanup);

function mount(row: SettingsRowDefinition) {
  return render(<SettingsSections sections={[{ id: "test", rows: [row] }]} />);
}

const invoke = { kind: "invoke" as const, run: vi.fn() };

describe("settings control equivalence", () => {
  it("names a field from its label and describes its helper separately", () => {
    const { container } = render(
      <TextField
        label="Description"
        description="Identify this item"
        value=""
        onChange={vi.fn()}
      />,
    );
    const input = getByRole(container, "textbox", { name: "Description" });
    const descriptionId = input.getAttribute("aria-describedby");
    expect(descriptionId).toBeTruthy();
    expect(document.getElementById(descriptionId ?? "")?.textContent).toBe(
      "Identify this item",
    );
  });

  it("keeps a picker's label separate from its selected value", () => {
    const { container } = render(
      <span data-rid="settings.team" data-part="settings.row.control">
        <Picker
          mode="select"
          label="Team"
          value="platform"
          options={[{ value: "platform", label: "Platform" }]}
          onChange={vi.fn()}
        />
      </span>,
    );
    expect(
      getByRole(container, "combobox", { name: "Team" }).textContent,
    ).toContain("Platform");
    expect(snapshotSettings(container)[0]?.name).toBe("Team");
  });

  it("keeps an errored boolean checked, named and disabled beside recovery", () => {
    const retry = vi.fn();
    const { container } = mount({
      id: "settings.events",
      kind: "toggle",
      label: "Show events",
      binding: { value: true, set: vi.fn() },
      state: {
        status: "error",
        message: "Read failed",
        retry,
        retryLabel: "Retry",
      },
    });
    const control = getByRole(container, "switch", { name: "Show events" });
    expect(control.getAttribute("aria-checked")).toBe("true");
    expect(control.hasAttribute("disabled")).toBe(true);
    fireEvent.click(getByRole(container, "button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("names an action from its explicitly associated row label", () => {
    const { container } = mount({
      id: "settings.delete",
      kind: "action",
      label: "Delete history",
      dom: { controlId: "delete-history" },
      action: { id: "delete", label: "Delete data", trigger: invoke },
    });
    expect(
      getByRole(container, "button", { name: "Delete history" }).textContent,
    ).toBe("Delete data");
  });

  it("opens a confirmation without exposing an unrelated disclosure state", () => {
    const { container } = mount({
      id: "settings.confirm",
      kind: "action",
      label: "Remove",
      action: {
        id: "remove",
        label: "Remove",
        trigger: {
          kind: "confirm",
          title: "Remove item?",
          confirmLabel: "Remove",
          cancelLabel: "Cancel",
          run: vi.fn(),
        },
      },
    });
    const trigger = getByRole(container, "button", { name: "Remove" });
    expect(trigger.hasAttribute("aria-expanded")).toBe(false);
    fireEvent.click(trigger);
    expect(trigger.hasAttribute("aria-expanded")).toBe(false);
    expect(
      getByRole(document.body, "dialog", { name: "Remove item?" }),
    ).toBeTruthy();
  });

  it("prefers the explicit group name and excludes the preview from radio names", () => {
    const { container } = mount({
      id: "settings.style",
      kind: "radio",
      label: "Email",
      dom: { labelId: "style-label" },
      controlLabel: "Choose style",
      binding: { value: "formal", set: vi.fn() },
      options: [
        {
          value: "formal",
          label: "Formal",
          description: "Full punctuation",
          preview: <p>Preview sentence.</p>,
        },
      ],
    });
    expect(
      getByRole(container, "radiogroup", { name: "Choose style" }),
    ).toBeTruthy();
    expect(
      getByRole(container, "radio", {
        name: /Formal.*Full punctuation/,
      }).getAttribute("aria-describedby"),
    ).toBeTruthy();
    expect(
      snapshotSettings(container).find(
        (row) => row.rid === "settings.style.formal",
      )?.name,
    ).toBe("FormalFull punctuation");
    expect(container.textContent).toContain("Preview sentence.");
  });

  it("locks cancellation while a submit is in flight", async () => {
    let finish: (() => void) | undefined;
    const submit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { container } = mount({
      id: "settings.keys",
      kind: "collection",
      label: "Keys",
      items: { status: "ready", value: [] },
      add: {
        kind: "fields",
        label: "Add",
        submitLabel: "Create",
        cancelLabel: "Cancel",
        fields: [{ kind: "text", id: "description", label: "Description" }],
        submit,
      },
    });
    fireEvent.click(getByRole(container, "button", { name: "Add" }));
    fireEvent.click(getByRole(document.body, "button", { name: "Create" }));
    expect(
      getByRole(document.body, "button", { name: "Cancel" }).hasAttribute(
        "disabled",
      ),
    ).toBe(true);
    await act(async () => finish?.());
  });
  it.each(["success", "error", "rejection"] as const)(
    "locks all add fields and Close while pending, then recovers after %s",
    async (outcome) => {
      let finish: (value: SettingsSubmitResult) => void = () => {
        throw new Error("No submit pending");
      };
      let fail: (error: Error) => void = () => {
        throw new Error("No submit pending");
      };
      const submit = vi.fn(
        () =>
          new Promise<SettingsSubmitResult>((resolve, reject) => {
            finish = resolve;
            fail = reject;
          }),
      );
      const { container } = mount({
        id: "settings.items",
        kind: "collection",
        label: "Items",
        items: { status: "ready", value: [] },
        add: {
          kind: "fields",
          label: "Add",
          submitLabel: "Create",
          cancelLabel: "Cancel",
          fields: [
            { kind: "text", id: "name", label: "Name" },
            { kind: "textarea", id: "notes", label: "Notes" },
            {
              kind: "checkbox",
              id: "enabled",
              label: "Enabled",
              initialValue: true,
            },
            {
              kind: "select",
              id: "team",
              label: "Team",
              initialValue: "a",
              options: [{ value: "a", label: "Team A" }],
            },
            {
              kind: "color",
              id: "color",
              label: "Color",
              initialValue: "blue",
              options: [{ value: "blue", label: "Blue" }],
            },
            { kind: "image", id: "image", label: "Image" },
            {
              kind: "text",
              id: "fixed",
              label: "Fixed",
              initialValue: "Keep",
              condition: { disabled: true },
            },
          ],
          submit,
        },
      });
      const open = () =>
        fireEvent.click(getByRole(container, "button", { name: "Add" }));
      open();
      const dialog = getByRole(document.body, "dialog");
      const name = getByRole(dialog, "textbox", {
        name: "Name",
      }) as HTMLInputElement;
      const notes = getByRole(dialog, "textbox", {
        name: "Notes",
      }) as HTMLTextAreaElement;
      fireEvent.change(name, { target: { value: "Entered name" } });
      fireEvent.change(notes, { target: { value: "Entered notes" } });
      const controls = [
        name,
        notes,
        getByRole(dialog, "checkbox", { name: "Enabled" }),
        getByRole(dialog, "combobox", { name: "Team" }),
        getByRole(dialog, "combobox", { name: "Color" }),
        getByLabelText(dialog, "Image"),
        getByRole(dialog, "button", { name: "Close" }),
        getByRole(dialog, "button", { name: "Cancel" }),
      ];
      for (const control of controls)
        expect(control.hasAttribute("disabled")).toBe(false);
      fireEvent.click(getByRole(dialog, "button", { name: "Create" }));
      for (const control of controls)
        expect(control.hasAttribute("disabled")).toBe(true);
      fireEvent.click(getByRole(dialog, "button", { name: "Close" }));
      fireEvent.click(getByRole(dialog, "button", { name: "Create" }));
      fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
      expect(getByRole(document.body, "dialog")).toBe(dialog);
      expect(submit).toHaveBeenCalledOnce();
      expect(submit.mock.calls[0]).toEqual([
        {
          name: "Entered name",
          notes: "Entered notes",
          enabled: true,
          team: "a",
          color: "blue",
          image: null,
          fixed: "Keep",
        },
      ]);
      await act(async () => {
        if (outcome === "rejection") fail(new Error("Service unavailable"));
        else finish(outcome === "error" ? { error: "Try again" } : undefined);
      });
      if (outcome === "success") {
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        open();
        expect(
          (
            getByRole(document.body, "textbox", {
              name: "Name",
            }) as HTMLInputElement
          ).value,
        ).toBe("");
        expect(
          getByRole(document.body, "button", { name: "Close" }).hasAttribute(
            "disabled",
          ),
        ).toBe(false);
      } else {
        expect(getByRole(document.body, "dialog")).toBe(dialog);
        for (const control of controls)
          expect(control.hasAttribute("disabled")).toBe(false);
        expect(name.value).toBe("Entered name");
        expect(notes.value).toBe("Entered notes");
        expect(
          getByRole(dialog, "checkbox", { name: "Enabled" }).getAttribute(
            "aria-checked",
          ),
        ).toBe("true");
        expect(
          getByRole(dialog, "combobox", { name: "Team" }).textContent,
        ).toContain("Team A");
        if (outcome === "error")
          expect(dialog.textContent).toContain("Try again");
        submit.mockResolvedValueOnce(undefined);
        fireEvent.click(getByRole(dialog, "button", { name: "Create" }));
        await act(async () => {});
        expect(submit).toHaveBeenCalledTimes(2);
        expect(submit.mock.calls[1]).toEqual(submit.mock.calls[0]);
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        open();
      }
      const reopened = getByRole(document.body, "dialog");
      expect(
        getByRole(reopened, "textbox", { name: "Fixed" }).hasAttribute(
          "disabled",
        ),
      ).toBe(true);
      fireEvent.click(getByRole(reopened, "button", { name: "Close" }));
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    },
  );
  it("retains disclosure state for a dialog drawn by the skin", () => {
    const { container } = mount({
      id: "settings.preview",
      kind: "action",
      label: "Preview",
      action: {
        id: "preview",
        label: "Preview",
        trigger: { kind: "dialog", title: "Message preview" },
      },
    });
    const trigger = getByRole(container, "button", { name: "Preview" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("keeps a submitting add dialog open when Escape is pressed", () => {
    const { container } = mount({
      id: "settings.keys",
      kind: "collection",
      label: "Keys",
      items: { status: "ready", value: [] },
      add: {
        kind: "fields",
        label: "Add",
        submitLabel: "Create",
        cancelLabel: "Cancel",
        fields: [{ kind: "text", id: "description", label: "Description" }],
        submit: () => new Promise(() => {}),
      },
    });
    fireEvent.click(getByRole(container, "button", { name: "Add" }));
    fireEvent.click(getByRole(document.body, "button", { name: "Create" }));
    fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    expect(getByRole(document.body, "dialog")).toBeTruthy();
  });
  it("keeps a custom-body dialog trigger free of disclosure state", () => {
    const { container } = mount({
      id: "settings.custom-dialog",
      kind: "action",
      label: "Configure",
      action: {
        id: "configure",
        label: "Configure",
        trigger: {
          kind: "dialog",
          title: "Configure item",
          body: () => <p>Custom controls</p>,
        },
      },
    });
    const trigger = getByRole(container, "button", { name: "Configure" });
    expect(trigger.hasAttribute("aria-expanded")).toBe(false);
    fireEvent.click(trigger);
    expect(trigger.hasAttribute("aria-expanded")).toBe(false);
  });
});
