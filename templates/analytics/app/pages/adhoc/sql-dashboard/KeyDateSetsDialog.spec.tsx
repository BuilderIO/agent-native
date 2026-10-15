// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import type { KeyDate, KeyDateSet } from "@shared/key-dates";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rename: vi.fn(),
  sets: [] as KeyDateSet[],
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({ data: { sets: mocks.sets } }),
}));

vi.mock("@/components/dashboard/annotation-mutations", async (actual) => ({
  ...(await actual<
    typeof import("@/components/dashboard/annotation-mutations")
  >()),
  useRenameKeyDateSet: () => ({ mutate: mocks.rename }),
  useDeleteKeyDate: () => ({ mutate: vi.fn() }),
  useDeleteKeyDateSet: () => ({ mutate: vi.fn() }),
}));

import { TooltipProvider } from "@/components/ui/tooltip";

import { i18nCatalog } from "../../../i18n";
import { KeyDateSetsDialog } from "./KeyDateSetsDialog";

const keyDate = (id: string, setId: string, label: string): KeyDate => ({
  id,
  setId,
  date: "2026-10-01",
  label,
  addedBy: "alice@example.test",
  updatedAt: "2026-10-14T12:00:00.000Z",
});

const keyDateSet = (id: string, name: string, dates: KeyDate[]) => ({
  id,
  name,
  createdBy: "alice@example.test",
  updatedAt: "2026-10-14T12:00:00.000Z",
  dates,
});

const LAUNCHES = keyDateSet("launches", "Launches", [
  keyDate("launch", "launches", "Product Hunt launch"),
]);

let container: HTMLDivElement;
let root: Root;

function render() {
  const handlers = {
    onOpenChange: vi.fn(),
    onEditKeyDate: vi.fn(),
    onAddKeyDate: vi.fn(),
  };
  act(() => {
    root.render(
      <AgentNativeI18nProvider
        catalog={i18nCatalog}
        initialLocale="en-US"
        persistPreference={false}
      >
        <TooltipProvider>
          <KeyDateSetsDialog open {...handlers} />
        </TooltipProvider>
      </AgentNativeI18nProvider>,
    );
  });
  return handlers;
}

const button = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (el) =>
      el.getAttribute("aria-label") === name || el.textContent?.includes(name),
  )!;

const escape = () =>
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
  });

describe("KeyDateSetsDialog", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.sets = [LAUNCHES];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("takes Escape back from a rename without closing; the next one closes", () => {
    const { onOpenChange } = render();
    act(() => button("Rename Launches").click());
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Set name");

    escape();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(button("Rename Launches")).toBeDefined();
    expect(mocks.rename).not.toHaveBeenCalled();

    escape();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("holds a just-added set's and date's controls until the server confirms them", () => {
    mocks.sets = [
      keyDateSet("pending-1", "Incidents", [
        keyDate("pending-2", "pending-1", "Setup outage"),
      ]),
      LAUNCHES,
    ];
    const { onEditKeyDate, onAddKeyDate } = render();
    const [addToIncidents, addToLaunches] = [
      ...document.querySelectorAll<HTMLButtonElement>(
        'button[aria-label="Add key date"]',
      ),
    ];

    for (const control of [
      button("Rename Incidents"),
      addToIncidents,
      button("Delete Incidents"),
      button("Setup outage"),
      button("Delete Setup outage"),
    ]) {
      expect(control.disabled).toBe(true);
      act(() => control.click());
    }
    expect(onAddKeyDate).not.toHaveBeenCalled();
    expect(onEditKeyDate).not.toHaveBeenCalled();
    expect(document.activeElement?.getAttribute("aria-label")).not.toBe(
      "Set name",
    );

    expect(addToLaunches.disabled).toBe(false);
    expect(button("Product Hunt launch").disabled).toBe(false);
  });
});
