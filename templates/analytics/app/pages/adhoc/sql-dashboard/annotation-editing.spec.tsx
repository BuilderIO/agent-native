// @vitest-environment happy-dom

import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({ data: undefined }),
  useActionMutation: () => ({ mutate: vi.fn() }),
}));

import { useAnnotationEditing } from "./annotation-editing";
import type { DashboardAnnotations, SqlDashboardConfig } from "./types";

const dashboard: SqlDashboardConfig = { name: "Setup", panels: [] };
type AnnotationChange = (next: DashboardAnnotations) => void;

let container: HTMLDivElement;
let root: Root;

function render(
  persist: (
    update: (current: SqlDashboardConfig) => SqlDashboardConfig,
  ) => void,
  editing = true,
  dashboardConfig = dashboard,
) {
  let result: ReturnType<typeof useAnnotationEditing> | undefined;
  function Editor() {
    result = useAnnotationEditing({
      dashboardId: "dash",
      dashboard: dashboardConfig,
      editing,
      persist,
    });
    return null;
  }
  act(() => root.render(<Editor />));
  const menu = result?.menu as ReactElement<{
    onAnnotationsChange?: AnnotationChange;
  }> | null;
  return {
    actions: result?.dataNoteActions,
    onAnnotationsChange: menu?.props.onAnnotationsChange,
  };
}

describe("useAnnotationEditing", () => {
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

  it("refuses to save a note the server hasn't confirmed into the dashboard", () => {
    const persist = vi.fn();
    const actions = render(persist).actions!;

    expect(() => actions.hide!("pending-1", "signups")).toThrow(/pending-1/);
    expect(persist).not.toHaveBeenCalled();

    actions.hide!("note-setup-incident", "signups");
    expect(persist).toHaveBeenCalledWith(expect.any(Function));
    const update = persist.mock.calls[0][0];
    expect(update(dashboard)).toEqual({
      ...dashboard,
      annotations: {
        hiddenDataNotes: [
          { noteId: "note-setup-incident", panelId: "signups" },
        ],
      },
    });
  });

  it("preserves concurrent hidden-note additions against the latest dashboard", () => {
    const persist = vi.fn();
    const { actions } = render(persist);

    actions!.hide!("note-a", "signups");
    actions!.hide!("note-b", "signups");

    const updates = persist.mock.calls.map(([update]) => update);
    const afterFirstUpdate = updates[0](dashboard);
    const afterSecondUpdate = updates[1](afterFirstUpdate);
    expect(afterSecondUpdate.annotations?.hiddenDataNotes).toEqual([
      { noteId: "note-a", panelId: "signups" },
      { noteId: "note-b", panelId: "signups" },
    ]);
  });

  it("preserves a concurrent note addition when removing a hidden key-date set", () => {
    const note = { noteId: "note-existing", panelId: "signups" };
    const nextNote = { noteId: "note-new", panelId: "signups" };
    const initial: SqlDashboardConfig = {
      ...dashboard,
      annotations: {
        hiddenKeyDateSets: ["set-a"],
        hiddenDataNotes: [note],
      },
    };
    const persist = vi.fn();
    const { onAnnotationsChange } = render(persist, true, initial);

    onAnnotationsChange!({
      hiddenKeyDateSets: ["set-a"],
      hiddenDataNotes: [note, nextNote],
    });
    onAnnotationsChange!({ hiddenDataNotes: [note] });

    const updates = persist.mock.calls.map(([update]) => update);
    const afterFirstUpdate = updates[0](initial);
    const afterSecondUpdate = updates[1](afterFirstUpdate);
    expect(afterSecondUpdate.annotations).toEqual({
      hiddenDataNotes: [note, nextNote],
    });
  });

  it("removes only the hidden-note placement from the edit snapshot", () => {
    const noteOnFirstPanel = { noteId: "note-a", panelId: "first-panel" };
    const concurrentPlacement = { noteId: "note-a", panelId: "second-panel" };
    const initial: SqlDashboardConfig = {
      ...dashboard,
      annotations: { hiddenDataNotes: [noteOnFirstPanel] },
    };
    const persist = vi.fn();
    const { onAnnotationsChange } = render(persist, true, initial);

    onAnnotationsChange!({
      hiddenDataNotes: [noteOnFirstPanel, concurrentPlacement],
    });
    onAnnotationsChange!({});

    const updates = persist.mock.calls.map(([update]) => update);
    const afterFirstUpdate = updates[0](initial);
    const afterSecondUpdate = updates[1](afterFirstUpdate);
    expect(afterSecondUpdate.annotations?.hiddenDataNotes).toEqual([
      concurrentPlacement,
    ]);
  });

  it("gives charts no note actions in View mode", () => {
    expect(render(vi.fn(), false).actions).toBeUndefined();
  });
});
