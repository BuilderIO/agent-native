// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { SettingsSections } from "./SettingsSections.js";
import { snapshotSettings, compareSettingsSnapshots } from "./snapshot.js";

afterEach(cleanup);

it("observes two explicitly paired identities on one element", () => {
  const root = document.createElement("div");
  root.innerHTML =
    '<p data-rid="settings.items settings.items.empty" data-part="settings.row settings.collection.empty">No items</p>';
  const entries = snapshotSettings(root);
  expect(entries.map(({ rid, part, value }) => ({ rid, part, value }))).toEqual(
    [
      { rid: "settings.items", part: "settings.row", value: null },
      {
        rid: "settings.items.empty",
        part: "settings.collection.empty",
        value: "No items",
      },
    ],
  );
  root.innerHTML =
    '<p data-rid="settings.items" data-part="settings.row">No items</p>';
  expect(snapshotSettings(root).map(({ rid }) => rid)).toEqual([
    "settings.items",
  ]);
});

it("compares counter presence and live value even with behavior witnesses", () => {
  const root = document.createElement("div");
  root.innerHTML =
    '<input data-rid="settings.title" data-part="settings.row.control" aria-label="Title" value="Hi"><p data-rid="settings.title" data-part="settings.row.counter">2/120</p>';
  const before = snapshotSettings(root);
  root.querySelector("p")?.remove();
  expect(
    compareSettingsSnapshots(before, snapshotSettings(root)).differences,
  ).toEqual(['settings.title: counter "2/120" (reference) vs null (house)']);
  root.insertAdjacentHTML(
    "beforeend",
    '<p data-rid="settings.title" data-part="settings.row.counter">3/120</p>',
  );
  expect(
    compareSettingsSnapshots(before, snapshotSettings(root)).differences,
  ).toEqual(['settings.title: counter "2/120" (reference) vs "3/120" (house)']);
});

it("renders opt-in counters independently of validation and updates local drafts", () => {
  const view = render(
    <SettingsSections
      sections={[
        {
          id: "profile",
          rows: [
            {
              id: "settings.title",
              kind: "text",
              label: "Title",
              maxLength: 200,
              counter: { limit: 120 },
              binding: { value: "", set: vi.fn(), commit: "blur" },
            },
            {
              id: "settings.notes",
              kind: "textarea",
              label: "Notes",
              description: "Help below",
              descriptionPlacement: "below-field",
              counter: { limit: 2000 },
              binding: { value: "", set: vi.fn(), commit: "blur" },
            },
            {
              id: "settings.other",
              kind: "text",
              label: "Other",
              maxLength: 50,
              binding: { value: "", set: vi.fn() },
            },
          ],
        },
      ]}
    />,
  );
  expect(
    snapshotSettings(view.container).find((row) => row.rid === "settings.title")
      ?.counter,
  ).toBe("0/120");
  fireEvent.change(view.getByRole("textbox", { name: "Title" }), {
    target: { value: "Hi" },
  });
  expect(
    snapshotSettings(view.container).find((row) => row.rid === "settings.title")
      ?.counter,
  ).toBe("2/120");
  expect(
    snapshotSettings(view.container).find((row) => row.rid === "settings.other")
      ?.counter,
  ).toBeNull();
  const field = view.getByRole("textbox", { name: "Notes" });
  expect(
    field.compareDocumentPosition(view.getByText("Help below")) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it("honors a field condition without locking its editable siblings", () => {
  const view = render(
    <SettingsSections
      sections={[
        {
          id: "keys",
          rows: [
            {
              id: "settings.keys",
              kind: "collection",
              label: "Keys",
              items: { status: "ready", value: [] },
              add: {
                kind: "fields",
                label: "Add",
                submitLabel: "Save",
                pending: true,
                submit: vi.fn(),
                fields: [
                  {
                    id: "description",
                    kind: "text",
                    label: "Description",
                    condition: { disabled: true },
                  },
                  { id: "domain", kind: "text", label: "Domain" },
                ],
              },
            },
          ],
        },
      ]}
    />,
  );
  fireEvent.click(view.getByRole("button", { name: "Add" }));
  expect(
    view.getByRole("textbox", { name: "Description" }).hasAttribute("disabled"),
  ).toBe(true);
  expect(
    view.getByRole("textbox", { name: "Domain" }).hasAttribute("disabled"),
  ).toBe(false);
});
