import { describe, expect, it } from "vitest";

import {
  pendingLiveEditFrameTargets,
  shouldClearPendingLiveEditsAfterReload,
  type PendingLiveStructureEdit,
  type PendingVisualStyleEdit,
} from "./pending-edits";

const styleEdit = (
  screenId: string,
  activeWidthPx?: number,
): PendingVisualStyleEdit => ({
  screenId,
  filename: `${screenId}.tsx`,
  screenName: screenId,
  selector: "h1",
  classes: [],
  styles: { opacity: "0.5" },
  originalStyles: { opacity: "1" },
  updatedAt: 1,
  ...(activeWidthPx
    ? { breakpoint: { activeWidthPx, upperBoundPx: null } }
    : {}),
});

const structureEdit = (screenId: string): PendingLiveStructureEdit => ({
  kind: "structure",
  screenId,
  filename: `${screenId}.tsx`,
  screenName: screenId,
  selector: "button",
  anchorSelector: "main",
  placement: "inside",
  updatedAt: 1,
});

describe("pending live edits after runtime reload", () => {
  it("waits until every edited screen has reloaded before clearing the handoff", () => {
    const targets = pendingLiveEditFrameTargets(
      [styleEdit("library"), styleEdit("settings", 960)],
      [
        {
          ...structureEdit("settings"),
          groupedEdits: [structureEdit("settings"), structureEdit("record")],
        },
      ],
    );

    expect(targets).toEqual(
      new Map([
        ["library", new Set(["primary"])],
        ["settings", new Set(["primary", "breakpoint:960"])],
        ["record", new Set(["primary"])],
      ]),
    );
    expect(
      shouldClearPendingLiveEditsAfterReload(
        targets,
        new Set(),
        "library",
        "primary",
      ),
    ).toBe(false);
    expect(
      shouldClearPendingLiveEditsAfterReload(
        targets,
        new Set([
          "library\0primary",
          "settings\0primary",
          "settings\0breakpoint:960",
          "record\0primary",
        ]),
        "record",
        "primary",
      ),
    ).toBe(true);
    expect(
      shouldClearPendingLiveEditsAfterReload(
        targets,
        new Set(["library\0primary", "settings\0primary", "record\0primary"]),
        "record",
        "primary",
      ),
    ).toBe(false);
  });

  it("does not treat an unrelated reload as an applied edit", () => {
    const targets = pendingLiveEditFrameTargets([styleEdit("library")], []);

    expect(
      shouldClearPendingLiveEditsAfterReload(
        targets,
        new Set(),
        "settings",
        "primary",
      ),
    ).toBe(false);
    expect(
      shouldClearPendingLiveEditsAfterReload(
        new Map(),
        new Set(),
        "library",
        "primary",
      ),
    ).toBe(false);
  });
});
