// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import {
  CONNECT_UNDERCOUNT,
  SETUP_INCIDENT,
} from "@shared/annotation-fixtures";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sets: [] as unknown[],
  notes: [] as unknown[],
  /** False on a dashboard shared from another organization. */
  editable: true,
  loading: false,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: vi.fn((name: string) => ({
    data: mocks.loading
      ? undefined
      : name === "list-key-dates"
        ? { sets: mocks.sets, editable: mocks.editable }
        : name === "list-data-notes"
          ? { notes: mocks.notes, editable: mocks.editable }
          : undefined,
  })),
}));

import { useActionQuery } from "@agent-native/core/client/hooks";

import { TooltipProvider } from "@/components/ui/tooltip";

import { i18nCatalog } from "../../../i18n";
import { AnnotationsMenu } from "./AnnotationsMenu";
import type { DashboardAnnotations, SqlPanel } from "./types";

const set = (id: string, name: string) => ({
  id,
  name,
  createdBy: "alice@example.test",
  updatedAt: "2026-10-14T00:00:00.000Z",
  dates: [],
});

const panels: SqlPanel[] = [
  {
    id: "failures",
    title: "Setup failures per day",
    sql: "SELECT day, count(*) FROM events WHERE event = 'builder_connect_failed'",
    source: "first-party",
    chartType: "line",
    width: 1,
  },
];

let container: HTMLDivElement;
let root: Root;

function render(
  props: Partial<Parameters<typeof AnnotationsMenu>[0]> & {
    annotations?: DashboardAnnotations;
  } = {},
) {
  const handlers = {
    onAnnotationsChange: vi.fn(),
    onAddKeyDate: vi.fn(),
    onEditKeyDates: vi.fn(),
    onAddDataNote: vi.fn(),
    onEditDataNote: vi.fn(),
  };
  act(() => {
    root.render(
      <AgentNativeI18nProvider
        catalog={i18nCatalog}
        initialLocale="en-US"
        persistPreference={false}
      >
        <TooltipProvider>
          <AnnotationsMenu
            dashboardId="dash"
            panels={panels}
            {...handlers}
            {...props}
          />
        </TooltipProvider>
      </AgentNativeI18nProvider>,
    );
  });
  return handlers;
}

function openMenu() {
  const trigger = container.querySelector("button")!;
  act(() => {
    trigger.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        pointerType: "mouse",
      }),
    );
  });
}

const item = (role: string, text: string) =>
  [...document.querySelectorAll<HTMLElement>(`[role="${role}"]`)].find((el) =>
    el.textContent?.includes(text),
  )!;

describe("AnnotationsMenu", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.sets = [
      set("launches", "Launches"),
      set("changes", "Product changes"),
    ];
    mocks.notes = [SETUP_INCIDENT, CONNECT_UNDERCOUNT];
    mocks.editable = true;
    mocks.loading = false;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("shows which key-date sets this dashboard hides, and saves a change", () => {
    const { onAnnotationsChange } = render({
      annotations: { hiddenKeyDateSets: ["changes"] },
    });
    openMenu();

    const launches = item("menuitemcheckbox", "Launches");
    const changes = item("menuitemcheckbox", "Product changes");
    expect(launches.getAttribute("aria-checked")).toBe("true");
    expect(changes.getAttribute("aria-checked")).toBe("false");

    act(() => changes.click());
    expect(onAnnotationsChange).toHaveBeenLastCalledWith({});
    act(() => launches.click());
    expect(onAnnotationsChange).toHaveBeenLastCalledWith({
      hiddenKeyDateSets: ["changes", "launches"],
    });
  });

  it("keeps the other hidden lists when a set is toggled", () => {
    const hiddenDataNotes = [{ noteId: SETUP_INCIDENT.id, panelId: "x" }];
    const { onAnnotationsChange } = render({
      annotations: { hiddenDataNotes },
    });
    openMenu();
    act(() => item("menuitemcheckbox", "Launches").click());
    expect(onAnnotationsChange).toHaveBeenLastCalledWith({
      hiddenDataNotes,
      hiddenKeyDateSets: ["launches"],
    });
  });

  it("lists the dashboard's own key dates and notes", () => {
    render();
    for (const list of ["list-key-dates", "list-data-notes"]) {
      expect(useActionQuery).toHaveBeenCalledWith(
        list,
        { dashboardId: "dash" },
        expect.anything(),
      );
    }
  });

  it("keeps another organization's key dates and notes read-only, while an editor still hides sets", () => {
    mocks.editable = false;
    const { onAnnotationsChange } = render();
    openMenu();

    for (const label of ["Add key date", "Edit key dates", "Add data note"]) {
      expect(item("menuitem", label), label).toBeUndefined();
    }
    expect(
      item("menuitem", SETUP_INCIDENT.title).getAttribute("aria-disabled"),
    ).toBe("true");
    act(() => item("menuitemcheckbox", "Launches").click());
    expect(onAnnotationsChange).toHaveBeenLastCalledWith({
      hiddenKeyDateSets: ["launches"],
    });
  });

  it("holds adding and editing until the lists say whose they are", () => {
    mocks.loading = true;
    render();
    openMenu();

    for (const label of ["Add key date", "Edit key dates", "Add data note"]) {
      expect(item("menuitem", label), label).toBeUndefined();
    }
  });

  it("lets a viewer see the sets but not change what the dashboard hides", () => {
    render({ onAnnotationsChange: undefined });
    openMenu();
    expect(
      item("menuitemcheckbox", "Launches").getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("shows a just-added set and note but holds their controls until the server confirms them", () => {
    mocks.sets = [...mocks.sets, set("pending-1", "Incidents")];
    mocks.notes = [
      ...mocks.notes,
      { ...SETUP_INCIDENT, id: "pending-2", title: "Signup form outage" },
    ];
    const { onAnnotationsChange, onEditDataNote } = render();
    openMenu();

    const incidents = item("menuitemcheckbox", "Incidents");
    const outage = item("menuitem", "Signup form outage");
    expect(incidents.getAttribute("aria-disabled")).toBe("true");
    expect(outage.getAttribute("aria-disabled")).toBe("true");
    act(() => incidents.click());
    act(() => outage.click());
    expect(onAnnotationsChange).not.toHaveBeenCalled();
    expect(onEditDataNote).not.toHaveBeenCalled();

    expect(
      item("menuitemcheckbox", "Launches").getAttribute("aria-disabled"),
    ).toBeNull();
    expect(
      item("menuitem", SETUP_INCIDENT.title).getAttribute("aria-disabled"),
    ).toBeNull();
  });

  it("returns focus to its button on Escape without popping the button's tooltip", async () => {
    render();
    const trigger = container.querySelector("button")!;
    openMenu();
    // The rest of a click: until the pointer is up, the tooltip ignores focus.
    act(() => {
      trigger.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, pointerType: "mouse" }),
      );
    });
    expect(item("menuitem", "Add key date")).toBeDefined();

    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(document.querySelector('[role="tooltip"]')).toBeNull();
  });

  it("lists the data notes on this dashboard's charts and opens one to edit", () => {
    const { onEditDataNote, onAddDataNote } = render();
    openMenu();

    expect(item("menuitem", SETUP_INCIDENT.title)).toBeDefined();
    expect(item("menuitem", CONNECT_UNDERCOUNT.title)).toBeUndefined();

    act(() => item("menuitem", SETUP_INCIDENT.title).click());
    expect(onEditDataNote).toHaveBeenCalledWith(SETUP_INCIDENT);

    openMenu();
    act(() => item("menuitem", "Add data note").click());
    expect(onAddDataNote).toHaveBeenCalled();
  });
});
