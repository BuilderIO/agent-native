// @vitest-environment happy-dom
import { cleanup, getByRole, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { TextField, TextArea, Picker } from "./components.js";
afterEach(cleanup);
for (const kind of ["text", "textarea", "select", "combobox"] as const) {
  for (const id of [undefined, "provided-id"]) {
    it(`connects the ${kind} label when the caller passes ${id ?? "undefined"}`, () => {
      const props = { id, label: "Title", value: "", onChange: vi.fn() };
      const { container } = render(
        kind === "text" ? (
          <TextField {...props} />
        ) : kind === "textarea" ? (
          <TextArea {...props} />
        ) : (
          <Picker
            {...props}
            mode={kind}
            options={[{ value: "x", label: "Example" }]}
          />
        ),
      );
      const control = getByRole(
        container,
        kind === "text" || kind === "textarea"
          ? "textbox"
          : kind === "select"
            ? "combobox"
            : "button",
        { name: "Title" },
      );
      const label = container.querySelector("label");
      expect(label?.control).toBe(control);
      expect(label?.contains(control)).toBe(true);
      if (id !== undefined) expect(control.id).toBe(id);
    });
  }
}
