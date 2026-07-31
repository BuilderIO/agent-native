/** @vitest-environment jsdom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../i18n.js", () => ({
  useT:
    () =>
    (key: string, options?: Record<string, string | undefined>): string =>
      String(options?.defaultValue ?? key),
}));

import { AutomationScheduleDialog } from "./AutomationScheduleDialog.js";

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const match = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.trim().startsWith(text),
  );
  if (!match) throw new Error(`no button starting with "${text}"`);
  return match as HTMLButtonElement;
}

describe("AutomationScheduleDialog", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onSave = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    onSave.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  function render(
    props: Partial<{ schedule: string; timezone: string | null }>,
  ) {
    act(() => {
      root.render(
        <AutomationScheduleDialog
          open
          name="digest"
          schedule={props.schedule ?? "0 8 * * *"}
          timezone={props.timezone ?? null}
          saving={false}
          onCancel={() => {}}
          onSave={onSave}
        />,
      );
    });
  }

  it("saves the automation's stored zone alongside an edited schedule", () => {
    render({ schedule: "0 8 * * *", timezone: "America/New_York" });

    act(() => {
      findButton(document.body, "Every hour").click();
    });
    act(() => {
      findButton(document.body, "Save").click();
    });

    expect(onSave).toHaveBeenCalledWith({
      schedule: "0 * * * *",
      timezone: "America/New_York",
    });
  });

  it("keeps Save disabled until something actually changes", () => {
    // A legacy automation has no stored zone, so the picker defaults to the
    // browser's. That default is not an edit and must not arm the button.
    render({ schedule: "0 8 * * *", timezone: null });

    expect(findButton(document.body, "Save").disabled).toBe(true);
  });
});
