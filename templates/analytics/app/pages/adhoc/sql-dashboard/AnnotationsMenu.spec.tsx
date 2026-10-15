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
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (name: string) => ({
    data:
      name === "list-key-dates"
        ? { sets: mocks.sets }
        : name === "list-data-notes"
          ? { notes: mocks.notes }
          : undefined,
  }),
}));

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

  it("lets a viewer see the sets but not change what the dashboard hides", () => {
    render({ onAnnotationsChange: undefined });
    openMenu();
    expect(
      item("menuitemcheckbox", "Launches").getAttribute("aria-disabled"),
    ).toBe("true");
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
