// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import { PanelSection } from "./panel-primitives";

async function mount(node: React.ReactNode): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  return container;
}

describe("PanelSection", () => {
  it("offers no disclosure control when there is nothing to disclose", async () => {
    const container = await mount(
      <PanelSection title="Stroke" actions={<button type="button">Add</button>}>
        {null}
      </PanelSection>,
    );
    expect(container.textContent).toContain("Stroke");
    expect(container.querySelector("[aria-expanded]")).toBeNull();
    // The add affordance is the point of an empty section; it must survive.
    expect(container.textContent).toContain("Add");
  });

  it("is collapsible once it has content", async () => {
    const container = await mount(
      <PanelSection title="Fill">
        <div>FFFFFF</div>
      </PanelSection>,
    );
    const toggle = container.querySelector("[aria-expanded]");
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
  });

  it("treats an all-empty children array as nothing to disclose", async () => {
    const container = await mount(
      <PanelSection title="Effects">{[false, null, undefined]}</PanelSection>,
    );
    expect(container.querySelector("[aria-expanded]")).toBeNull();
  });
});
