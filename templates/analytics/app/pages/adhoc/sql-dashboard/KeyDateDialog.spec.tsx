// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import type { KeyDate, KeyDateSet } from "@shared/key-dates";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  remove: vi.fn(),
  sets: [
    {
      id: "launches",
      name: "Launches",
      createdBy: "alice@example.test",
      updatedAt: "2026-10-14T12:00:00.000Z",
      dates: [],
    },
  ] satisfies KeyDateSet[],
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({ data: { sets: mocks.sets } }),
}));

vi.mock("@/components/dashboard/annotation-mutations", () => ({
  useSaveKeyDate: () => ({ mutate: mocks.save }),
  useDeleteKeyDate: () => ({ mutate: mocks.remove }),
}));

import { i18nCatalog } from "../../../i18n";
import { KeyDateDialog, type KeyDateDraft } from "./KeyDateDialog";

const [LAUNCHES] = mocks.sets;

const keyDate = (fields: Partial<KeyDate>): KeyDate => ({
  id: "launch",
  setId: LAUNCHES.id,
  date: "2026-10-01",
  label: "Product Hunt launch",
  addedBy: "alice@example.test",
  updatedAt: "2026-10-14T12:00:00.000Z",
  ...fields,
});

const VIEWER_ZONE = "America/Los_Angeles";

let container: HTMLDivElement;
let root: Root;

function render(draft: KeyDateDraft) {
  act(() => {
    root.render(
      <AgentNativeI18nProvider
        catalog={i18nCatalog}
        initialLocale="en-US"
        persistPreference={false}
      >
        <KeyDateDialog draft={draft} onClose={vi.fn()} />
      </AgentNativeI18nProvider>,
    );
  });
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;

const zoneShown = () => {
  const selects = dialog().querySelectorAll('[role="combobox"]');
  return selects[selects.length - 1]?.textContent;
};

const timeField = () => {
  const id = [...dialog().querySelectorAll("label")]
    .find((el) => el.textContent === "Time")
    ?.getAttribute("for");
  return dialog().querySelector<HTMLInputElement>(`#${CSS.escape(id ?? "")}`)!;
};

function typeTime(value: string) {
  const el = timeField();
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function save() {
  const button = [...dialog().querySelectorAll("button")].find(
    (el) => el.textContent?.trim() === "Save",
  )!;
  act(() => button.click());
}

describe("KeyDateDialog", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const resolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
    vi.spyOn(
      Intl.DateTimeFormat.prototype,
      "resolvedOptions",
    ).mockImplementation(function (this: Intl.DateTimeFormat) {
      return { ...resolvedOptions.call(this), timeZone: VIEWER_ZONE };
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("keeps a time saved without a zone in UTC, so editing does not move it", () => {
    render({ keyDate: keyDate({ time: "09:00" }) });
    expect(zoneShown()).toBe("UTC");

    save();
    expect(mocks.save).toHaveBeenCalledWith({
      id: "launch",
      setId: LAUNCHES.id,
      date: "2026-10-01",
      label: "Product Hunt launch",
      time: "09:00",
      timeZone: "UTC",
    });
  });

  it("keeps the zone a time was saved in", () => {
    render({ keyDate: keyDate({ time: "00:01", timeZone: "Asia/Tokyo" }) });
    save();
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ time: "00:01", timeZone: "Asia/Tokyo" }),
    );
  });

  it("starts a time added here in the viewer's zone", () => {
    render({ keyDate: keyDate({}) });
    typeTime("14:30");
    expect(zoneShown()).toBe(VIEWER_ZONE);

    save();
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ time: "14:30", timeZone: VIEWER_ZONE }),
    );
  });

  it("starts a new key date's time in the viewer's zone", () => {
    render({ setId: LAUNCHES.id });
    typeTime("00:01");
    expect(zoneShown()).toBe(VIEWER_ZONE);
  });
});
