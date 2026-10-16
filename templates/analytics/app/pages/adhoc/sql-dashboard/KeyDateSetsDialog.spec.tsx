// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import type { KeyDate, KeyDateSet } from "@shared/key-dates";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rename: vi.fn(),
  sets: [] as KeyDateSet[],
  list: "loaded" as "loaded" | "loading" | "failed",
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({
    data: mocks.list === "loaded" ? { sets: mocks.sets } : undefined,
    isError: mocks.list === "failed",
  }),
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
    mocks.list = "loaded";
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

  it("says no key dates only once the list has loaded empty", () => {
    const text = () => document.body.textContent ?? "";

    mocks.list = "loading";
    render();
    expect(document.querySelector(".skeleton-shimmer")).not.toBeNull();
    expect(text()).not.toContain("No key dates yet");

    mocks.list = "failed";
    render();
    expect(text()).toContain("Couldn't load key dates");
    expect(text()).not.toContain("No key dates yet");

    mocks.list = "loaded";
    mocks.sets = [];
    render();
    expect(document.querySelector(".skeleton-shimmer")).toBeNull();
    expect(text()).toContain("No key dates yet");
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

  it("drops a typed name on Escape, though removing the field blurs it", () => {
    render();
    act(() => button("Rename Launches").click());
    const field = document.activeElement as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(field, "Launch posts");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Chrome blurs a focused element as it is removed. React ignores events
    // while it commits, so that blur must not reach onBlur's commit.
    const removeChild = Node.prototype.removeChild;
    const blurOnRemove = vi
      .spyOn(Node.prototype, "removeChild")
      .mockImplementation(function <T extends Node>(this: Node, child: T) {
        const node: Node = child;
        if (node === document.activeElement) {
          node.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
        }
        return removeChild.call(this, child) as T;
      });
    try {
      escape();
    } finally {
      blurOnRemove.mockRestore();
    }

    expect(button("Rename Launches")).toBeDefined();
    expect(mocks.rename).not.toHaveBeenCalled();
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
