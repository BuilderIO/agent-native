// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: () => ({ data: undefined }),
  useActionMutation: () => ({ mutate: vi.fn() }),
}));

import type { DataNoteActions } from "@/components/dashboard/dashboard-annotations-context";

import { useAnnotationEditing } from "./annotation-editing";
import type { SqlDashboardConfig } from "./types";

const dashboard: SqlDashboardConfig = { name: "Setup", panels: [] };

let container: HTMLDivElement;
let root: Root;

function render(
  persist: (
    update: (current: SqlDashboardConfig) => SqlDashboardConfig,
  ) => void,
  editing = true,
) {
  let actions: DataNoteActions | undefined;
  function Editor() {
    actions = useAnnotationEditing({
      dashboardId: "dash",
      dashboard,
      editing,
      persist,
    }).dataNoteActions;
    return null;
  }
  act(() => root.render(<Editor />));
  return actions;
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
    const actions = render(persist)!;

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

  it("gives charts no note actions in View mode", () => {
    expect(render(vi.fn(), false)).toBeUndefined();
  });
});
