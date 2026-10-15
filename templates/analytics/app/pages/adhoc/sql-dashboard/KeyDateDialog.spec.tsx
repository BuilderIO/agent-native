// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import type { KeyDate, KeyDateSet } from "@shared/key-dates";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  remove: vi.fn(),
  /** Undefined while the list loads. */
  sets: [] as KeyDateSet[] | undefined,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({
    data: mocks.sets && { sets: mocks.sets, editable: true },
  }),
}));

vi.mock("@/components/dashboard/annotation-mutations", async (actual) => ({
  ...(await actual<
    typeof import("@/components/dashboard/annotation-mutations")
  >()),
  useSaveKeyDate: () => ({ mutate: mocks.save }),
  useDeleteKeyDate: () => ({ mutate: mocks.remove }),
}));

import { TooltipProvider } from "@/components/ui/tooltip";

import { i18nCatalog } from "../../../i18n";
import { AnnotationsMenu } from "./AnnotationsMenu";
import { KeyDateDialog, type KeyDateDraft } from "./KeyDateDialog";

const LAUNCHES: KeyDateSet = {
  id: "launches",
  name: "Launches",
  createdBy: "alice@example.test",
  updatedAt: "2026-10-14T12:00:00.000Z",
  dates: [],
};

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
  const onClose = vi.fn();
  act(() => {
    root.render(
      <AgentNativeI18nProvider
        catalog={i18nCatalog}
        initialLocale="en-US"
        persistPreference={false}
      >
        <KeyDateDialog draft={draft} onClose={onClose} />
      </AgentNativeI18nProvider>,
    );
  });
  return { onClose };
}

/** The dashboard's Annotations menu, which opens the dialog. */
function MenuWithDialog() {
  const [draft, setDraft] = useState<KeyDateDraft | null>(null);
  return (
    <TooltipProvider>
      <AnnotationsMenu
        dashboardId="dash"
        panels={[]}
        onAddKeyDate={() => setDraft({})}
        onEditKeyDates={vi.fn()}
        onAddDataNote={vi.fn()}
        onEditDataNote={vi.fn()}
      />
      <KeyDateDialog draft={draft} onClose={() => setDraft(null)} />
    </TooltipProvider>
  );
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;

/** The Set label's field: its select, and the name input of a new set. */
const setField = () =>
  [...dialog().querySelectorAll("label")].find(
    (el) => el.textContent === "Set",
  )!.parentElement!;

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

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

/** A click on the overlay, beside the dialog. */
async function clickOverlay() {
  const overlay = dialog().previousElementSibling!;
  await act(async () => {
    // The dialog starts listening for outside clicks a tick after it opens.
    await new Promise((resolve) => setTimeout(resolve, 0));
    overlay.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        pointerType: "mouse",
      }),
    );
    overlay.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 10));
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
    mocks.sets = [LAUNCHES];
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

  it("sends null to clear a time taken off a key date, and its zone with it", () => {
    render({ keyDate: keyDate({ time: "00:01", timeZone: "Asia/Tokyo" }) });
    typeTime("");
    save();
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ time: null, timeZone: null }),
    );
  });

  it("starts a new key date's time in the viewer's zone", () => {
    render({ setId: LAUNCHES.id });
    typeTime("00:01");
    expect(zoneShown()).toBe(VIEWER_ZONE);
  });

  it("won't put a new date in a set the server hasn't confirmed yet", () => {
    mocks.sets = [
      { ...LAUNCHES, id: "pending-1", name: "Incidents" },
      LAUNCHES,
    ];
    render({});
    const setSelect = dialog().querySelector<HTMLElement>('[role="combobox"]')!;
    expect(setSelect.textContent).toBe("Launches");

    act(() => {
      setSelect.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    const option = (name: string) =>
      [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (el) => el.textContent === name,
      )!;
    expect(option("Incidents").getAttribute("aria-disabled")).toBe("true");
    expect(option("Launches").getAttribute("aria-disabled")).toBeNull();
  });

  it("waits for a set list that loads after it opens, then starts in its first confirmed set", () => {
    mocks.sets = undefined;
    const draft: KeyDateDraft = {};
    render(draft);
    expect(setField().querySelector('[role="combobox"]')).toBeNull();
    expect(setField().querySelector("input")).toBeNull();

    mocks.sets = [
      { ...LAUNCHES, id: "pending-1", name: "Incidents" },
      LAUNCHES,
    ];
    render(draft);
    expect(setField().querySelector('[role="combobox"]')?.textContent).toBe(
      "Launches",
    );
    expect(setField().querySelector("input")).toBeNull();
  });

  it("starts in Label when opened from the Annotations menu", async () => {
    act(() => {
      root.render(
        <AgentNativeI18nProvider
          catalog={i18nCatalog}
          initialLocale="en-US"
          persistPreference={false}
        >
          <MenuWithDialog />
        </AgentNativeI18nProvider>,
      );
    });
    act(() => {
      container.querySelector("button")!.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerType: "mouse",
        }),
      );
    });
    const addKeyDate = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].find((el) => el.textContent?.includes("Add key date"))!;
    act(() => addKeyDate.click());
    await settle();

    const label = [...dialog().querySelectorAll("label")].find(
      (el) => el.textContent === "Label",
    )!;
    expect(document.activeElement?.id).toBe(label.getAttribute("for"));
  });

  it("stays open for a click beside it once edited; Escape still discards", async () => {
    const { onClose } = render({ setId: LAUNCHES.id });
    await clickOverlay();
    expect(onClose).toHaveBeenCalledTimes(1);

    typeTime("09:30");
    await clickOverlay();
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
