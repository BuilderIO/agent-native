/** @vitest-environment jsdom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../i18n.js", () => ({
  useT:
    () =>
    (key: string, options?: Record<string, string | undefined>): string =>
      String(options?.defaultValue ?? key).replace(
        /{{(\w+)}}/g,
        (_, name: string) => options?.[name] ?? `{{${name}}}`,
      ),
}));

vi.mock("./TimezoneSelect.js", () => ({
  browserTimezone: () => "UTC",
  TimezoneSelect: ({
    id,
    value,
    disabled,
    onChange,
  }: {
    id?: string;
    value: string;
    disabled?: boolean;
    onChange: (value: string) => void;
  }) => (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.value)}
    >
      <option value="UTC">UTC</option>
      <option value="America/New_York">America/New_York</option>
      <option value="Europe/Paris">Europe/Paris</option>
    </select>
  ),
}));

import { AutomationScheduleDialog } from "./AutomationScheduleDialog.js";

function findButton(container: HTMLElement, text: string): HTMLButtonElement {
  const match = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.trim().startsWith(text),
  );
  if (!match) throw new Error(`no button starting with "${text}"`);
  return match as HTMLButtonElement;
}

function changeValue(
  element: HTMLInputElement | HTMLSelectElement,
  value: string,
) {
  const prototype =
    element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!setter) throw new Error("value setter unavailable");
  act(() => {
    setter.call(element, value);
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
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

  it("saves the automation's stored zone alongside a friendly schedule edit", () => {
    render({ schedule: "0 8 * * *", timezone: "America/New_York" });

    const time = document.querySelector<HTMLInputElement>("#automation-time");
    if (!time) throw new Error("time field unavailable");
    changeValue(time, "08:30");
    act(() => findButton(document.body, "Save").click());

    expect(onSave).toHaveBeenCalledWith({
      schedule: "30 8 * * *",
      timezone: "America/New_York",
    });
  });

  it("shows friendly controls and a live schedule summary", () => {
    render({ schedule: "0 9 * * 1-5", timezone: "Europe/Paris" });

    expect(document.body.textContent).toContain("Frequency");
    expect(document.body.textContent).toContain("Weekdays");
    expect(document.body.textContent).toContain(
      "Weekdays at 09:00 (Europe/Paris)",
    );
  });

  it("opens irregular valid cron in Advanced mode and preserves its bytes", () => {
    const irregular = "  */15 * * * *  ";
    render({ schedule: irregular, timezone: "UTC" });

    const cron = document.querySelector<HTMLInputElement>(
      "#automation-schedule",
    );
    expect(cron?.value).toBe(irregular);
    expect(document.body.textContent).toContain("custom cron pattern");

    const timezone = document.querySelector<HTMLSelectElement>(
      "#automation-timezone",
    );
    if (!timezone) throw new Error("timezone field unavailable");
    changeValue(timezone, "Europe/Paris");
    act(() => findButton(document.body, "Save").click());

    expect(onSave).toHaveBeenCalledWith({
      schedule: irregular,
      timezone: "Europe/Paris",
    });
  });

  it("keeps Advanced input synchronized with friendly edits", () => {
    render({ schedule: "0 8 * * *", timezone: "UTC" });
    act(() => findButton(document.body, "Advanced").click());

    const cron = document.querySelector<HTMLInputElement>(
      "#automation-schedule",
    );
    expect(cron?.value).toBe("0 8 * * *");

    const time = document.querySelector<HTMLInputElement>("#automation-time");
    if (!time) throw new Error("time field unavailable");
    changeValue(time, "17:45");
    expect(cron?.value).toBe("45 17 * * *");
  });

  it("keeps Save disabled until something actually changes", () => {
    // A legacy automation has no stored zone, so the picker defaults to the
    // browser's. That default is not an edit and must not arm the button.
    render({ schedule: "0 8 * * *", timezone: null });

    expect(findButton(document.body, "Save").disabled).toBe(true);
  });
});
