// @vitest-environment happy-dom

import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { DashboardRevision } from "@/hooks/use-dashboard-revisions";

import { i18nCatalog } from "../../i18n";
import { DashboardHistoryPanel } from "./DashboardHistoryPanel";

const revisions = vi.hoisted(() => ({ current: [] as unknown[] }));
vi.mock("@/hooks/use-dashboard-revisions", () => ({
  useDashboardRevisions: () => ({
    data: revisions.current,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useRestoreDashboardRevision: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

let container: HTMLDivElement;
let root: Root;

function revision(
  id: string,
  changes: Partial<DashboardRevision>,
): DashboardRevision {
  return {
    id,
    dashboardId: "growth",
    kind: "sql",
    title: "Growth",
    createdAt: new Date().toISOString(),
    createdBy: "alice@example.com",
    changesStatus: "absent",
    ...changes,
  } as DashboardRevision;
}

function renderPanel(rows: DashboardRevision[]) {
  revisions.current = rows;
  act(() => {
    root.render(
      <AgentNativeI18nProvider
        catalog={i18nCatalog}
        initialLocale="en-US"
        persistPreference={false}
      >
        <TooltipProvider>
          <DashboardHistoryPanel
            dashboardId="growth"
            open
            onOpenChange={() => {}}
          />
        </TooltipProvider>
      </AgentNativeI18nProvider>,
    );
  });
}

/** Each entry's text, found from its title line. */
function entryTexts(): string[] {
  return [...document.body.querySelectorAll("p")]
    .filter((line) => line.textContent === "Growth")
    .map((title) => title.parentElement?.textContent ?? "");
}

describe("DashboardHistoryPanel", () => {
  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("names what each save changed, with a count of the rest", () => {
    renderPanel([
      revision("widened", {
        changesStatus: "valid",
        changes: [
          {
            kind: "column-resized",
            title: "Signups by Template",
            columns: 1,
            direction: "wider",
          },
          { kind: "panel-query-changed", title: "WAU" },
          { kind: "layout-changed" },
        ],
        omittedChanges: 0,
      }),
      revision("added", {
        changesStatus: "valid",
        changes: [{ kind: "panel-added", title: "DAU by Template" }],
        omittedChanges: 0,
      }),
      revision("capped", {
        changesStatus: "valid",
        changes: [
          { kind: "dashboard-renamed", from: "Growth", to: "Growth v2" },
        ],
        omittedChanges: 4,
      }),
      revision("legacy", { changesStatus: "absent" }),
      revision("corrupt", { changesStatus: "unreadable" }),
    ]);

    const [widened, added, capped, legacy, corrupt] = entryTexts();
    expect(widened).toContain(
      "Widened a column in “Signups by Template”+2 more",
    );
    expect(added).toContain("Added “DAU by Template”");
    expect(added).not.toContain("more");
    expect(capped).toContain("Renamed the dashboard to “Growth v2”+4 more");
    expect(legacy).toMatch(/^GrowthJust now by alice@example\.com$/);
    expect(corrupt).toContain("Couldn't read what changed");

    const more = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "+2 more",
    );
    if (!more) throw new Error("+2 more is not a button");
    act(() => more.focus());
    const tooltip = document.body.querySelector('[role="tooltip"]');
    expect(tooltip?.textContent).toBe(
      "Changed the query in “WAU”Rearranged the panels",
    );
  });

  it("says a restore goes back to before the entry's change", () => {
    renderPanel([
      revision("added", {
        changesStatus: "valid",
        changes: [{ kind: "panel-added", title: "DAU by Template" }],
        omittedChanges: 0,
      }),
      revision("legacy", { changesStatus: "absent" }),
    ]);
    const restoreButtons = () =>
      [...document.body.querySelectorAll("button")].filter(
        (button) => button.textContent === "Restore",
      );
    const dialogText = () =>
      document.body.querySelector('[role="alertdialog"]')?.textContent ?? "";

    act(() => restoreButtons()[0].click());
    expect(dialogText()).toContain(
      "This goes back to before this change, so every later change is undone too.",
    );

    act(() => restoreButtons()[1].click());
    expect(dialogText()).toContain(
      "This replaces the current dashboard layout",
    );
  });
});
