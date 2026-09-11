// @vitest-environment happy-dom

import type { CalendarEvent } from "@shared/api";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkingLocationEditor } from "./WorkingLocationEditor";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT:
    () =>
    (key: string, _values?: Record<string, unknown>): string =>
      key,
}));

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "google-home",
    title: "Home",
    description: "",
    start: "2026-08-13",
    end: "2026-08-14",
    location: "",
    allDay: true,
    source: "google",
    eventType: "workingLocation",
    workingLocationProperties: { type: "homeOffice", homeOffice: {} },
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:00:00.000Z",
    ...overrides,
  };
}

describe("WorkingLocationEditor", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("keeps Save on existing events and allows an unlabeled office", () => {
    const onSave = vi.fn();

    act(() => {
      root.render(
        <WorkingLocationEditor
          event={event()}
          isRecurring={false}
          onSave={onSave}
        />,
      );
    });

    const save = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "eventForm.save",
    );
    expect(save).toBeTruthy();
    expect(save?.disabled).toBe(true);

    act(() => {
      container
        .querySelector<HTMLInputElement>(
          "#working-location-google-home-officeLocation",
        )
        ?.click();
    });

    const saveAfterOffice = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent === "eventForm.save");
    expect(saveAfterOffice?.disabled).toBe(false);

    act(() => {
      saveAfterOffice?.click();
    });

    expect(onSave).toHaveBeenCalledWith({
      type: "officeLocation",
      label: "",
      scope: undefined,
    });
  });

  it("does not show Save on drafts and commits the selected type immediately", () => {
    const onSave = vi.fn();

    act(() => {
      root.render(
        <WorkingLocationEditor
          event={event({
            id: "working-location-draft",
            source: "local",
          })}
          isRecurring={false}
          isDraft
          onSave={onSave}
        />,
      );
    });

    expect(
      Array.from(container.querySelectorAll("button")).some(
        (button) => button.textContent === "eventForm.save",
      ),
    ).toBe(false);

    act(() => {
      container
        .querySelector<HTMLInputElement>(
          "#working-location-working-location-draft-officeLocation",
        )
        ?.click();
    });

    expect(onSave).toHaveBeenCalledWith({
      type: "officeLocation",
      label: "",
    });
  });
});
