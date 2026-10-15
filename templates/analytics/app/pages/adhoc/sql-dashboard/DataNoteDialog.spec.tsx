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
  save: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/components/dashboard/annotation-mutations", () => ({
  useSaveDataNote: () => ({ mutate: mocks.save }),
  useDeleteDataNote: () => ({ mutate: mocks.remove }),
}));

import { TooltipProvider } from "@/components/ui/tooltip";

import { i18nCatalog } from "../../../i18n";
import { DataNoteDialog, type DataNoteDraft } from "./DataNoteDialog";
import type { DashboardAnnotations, SqlPanel } from "./types";

const panels: SqlPanel[] = [
  {
    id: "failures",
    title: "Setup failures per day",
    sql: "SELECT day, count(*) FROM events WHERE event = 'builder_connect_failed'",
    source: "first-party",
    chartType: "line",
    width: 1,
  },
  {
    id: "signups",
    title: "Signups per day",
    sql: "SELECT day, count(*) FROM signups",
    source: "first-party",
    chartType: "line",
    width: 1,
  },
];

let container: HTMLDivElement;
let root: Root;

function render(
  draft: DataNoteDraft,
  props: {
    annotations?: DashboardAnnotations;
    onAnnotationsChange?: (next: DashboardAnnotations) => void;
  } = {},
) {
  const onClose = vi.fn();
  act(() => {
    root.render(
      <AgentNativeI18nProvider
        catalog={i18nCatalog}
        initialLocale="en-US"
        persistPreference={false}
      >
        <TooltipProvider>
          <DataNoteDialog
            draft={draft}
            onClose={onClose}
            dashboardId="dash"
            panels={panels}
            {...props}
          />
        </TooltipProvider>
      </AgentNativeI18nProvider>,
    );
  });
  return { onClose };
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;

const button = (text: string) =>
  [...dialog().querySelectorAll("button")].find(
    (el) => el.textContent?.trim() === text,
  )!;

const field = (label: string) => {
  const id = [...dialog().querySelectorAll("label")]
    .find((el) => el.textContent === label)
    ?.getAttribute("for");
  return dialog().querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `#${CSS.escape(id ?? "")}`,
  )!;
};

function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(el),
    "value",
  )!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const today = () => new Date().toLocaleDateString("en-CA");

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

describe("DataNoteDialog", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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

  it("starts a note from a chart pinned to it, and saves only once it has a title and text", () => {
    const { onClose } = render({
      initial: { panels: [{ dashboardId: "dash", panelId: "signups" }] },
    });
    expect(dialog().textContent).toContain("Signups per day");
    expect(dialog().textContent).toContain("Shows on 1 of 2 charts here");
    expect(button("Save").disabled).toBe(true);
    expect(document.activeElement).toBe(field("Title"));

    type(field("Title"), "Signup form outage");
    type(field("Note"), "The signup form failed to load for most visitors.");
    act(() => button("Save").click());

    expect(onClose).toHaveBeenCalled();
    // Only the input: the save hook reports failures, since per-call callbacks
    // never run once this dialog has closed.
    expect(mocks.save).toHaveBeenCalledWith({
      kind: "incident",
      title: "Signup form outage",
      note: "The signup form failed to load for most visitors.",
      startDate: null,
      endDate: null,
      status: "open",
      fix: null,
      matchEvents: [],
      unlessEvents: [],
      panels: [{ dashboardId: "dash", panelId: "signups" }],
    });
  });

  it("counts the charts here that a note's events reach", () => {
    render({ note: SETUP_INCIDENT });
    expect(dialog().textContent).toContain("Shows on 1 of 2 charts here");
    type(field("Events it affects"), "builder_connect_failed, signup");
    expect(dialog().textContent).toContain("Shows on 1 of 2 charts here");
    type(field("Events it affects"), "");
    expect(button("Save").disabled).toBe(true);
  });

  it("marks an open note fixed as of today, keeping its other fields", () => {
    render({ note: CONNECT_UNDERCOUNT, markFixed: true });
    const fixed = dialog().querySelector<HTMLElement>('[role="checkbox"]')!;
    expect(fixed.getAttribute("aria-checked")).toBe("true");
    const fix = dialog().querySelector<HTMLInputElement>(
      'input[placeholder="What fixed it"]',
    )!;
    expect(document.activeElement).toBe(fix);

    type(fix, "Both event names are counted from Oct 15.");
    act(() => button("Save").click());

    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: CONNECT_UNDERCOUNT.id,
        title: CONNECT_UNDERCOUNT.title,
        startDate: "2026-10-02",
        endDate: today(),
        status: "fixed",
        fix: "Both event names are counted from Oct 15.",
        matchEvents: CONNECT_UNDERCOUNT.matchEvents,
        unlessEvents: CONNECT_UNDERCOUNT.unlessEvents,
      }),
    );
  });

  it("takes back the end date Fixed filled in when Fixed is unchecked", () => {
    render({ note: CONNECT_UNDERCOUNT, markFixed: true });
    const fixed = dialog().querySelector<HTMLElement>('[role="checkbox"]')!;
    act(() => fixed.click());
    expect(fixed.getAttribute("aria-checked")).toBe("false");
    act(() => button("Save").click());

    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ endDate: null, status: "open", fix: null }),
    );
  });

  it("keeps an open note's own end date when Fixed goes on and off again", () => {
    render({ note: { ...CONNECT_UNDERCOUNT, endDate: "2026-10-12" } });
    const fixed = dialog().querySelector<HTMLElement>('[role="checkbox"]')!;
    act(() => fixed.click());
    act(() => fixed.click());
    act(() => button("Save").click());

    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ endDate: "2026-10-12", status: "open" }),
    );
  });

  it("reopens a fixed note as ongoing, without the end date it was fixed on", () => {
    render({ note: SETUP_INCIDENT });
    const fixed = dialog().querySelector<HTMLElement>('[role="checkbox"]')!;
    expect(fixed.getAttribute("aria-checked")).toBe("true");
    act(() => fixed.click());
    act(() => button("Save").click());

    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: SETUP_INCIDENT.id,
        startDate: SETUP_INCIDENT.startDate,
        endDate: null,
        status: "open",
        fix: null,
      }),
    );
  });

  it("stays open for a click beside an edited note; Escape still discards it", async () => {
    const { onClose } = render({ note: SETUP_INCIDENT });
    await clickOverlay();
    expect(onClose).toHaveBeenCalledTimes(1);

    type(field("Note"), "Setup failed for every workspace on SSO.");
    await clickOverlay();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mocks.save).not.toHaveBeenCalled();

    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("shows where a note is hidden and brings it back on those charts", () => {
    const onAnnotationsChange = vi.fn();
    render(
      { note: SETUP_INCIDENT },
      {
        annotations: {
          hiddenKeyDateSets: ["launches"],
          hiddenDataNotes: [
            { noteId: SETUP_INCIDENT.id, panelId: "failures" },
            { noteId: "other", panelId: "failures" },
          ],
        },
        onAnnotationsChange,
      },
    );
    expect(dialog().textContent).toContain("Hidden on Setup failures per day");
    expect(dialog().textContent).toContain("Shows on 0 of 2 charts here");

    act(() => button("Show again").click());
    expect(onAnnotationsChange).toHaveBeenCalledWith({
      hiddenKeyDateSets: ["launches"],
      hiddenDataNotes: [{ noteId: "other", panelId: "failures" }],
    });
  });

  it("asks before deleting a note", () => {
    render({ note: SETUP_INCIDENT });
    act(() => button("Delete").click());
    expect(mocks.remove).not.toHaveBeenCalled();

    const confirm = [
      ...document.querySelectorAll<HTMLButtonElement>(
        '[role="alertdialog"] button',
      ),
    ].find((el) => el.textContent === "Delete")!;
    act(() => confirm.click());
    expect(mocks.remove).toHaveBeenCalledWith({ id: SETUP_INCIDENT.id });
  });
});
