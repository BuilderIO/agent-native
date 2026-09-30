import { describe, expect, it } from "vitest";

import {
  activeRuntimeReloadFrameId,
  pendingLiveEditFrameTargets,
  shouldClearReloadedVisualEditHandoff,
  shouldClearPendingLiveEditsAfterReload,
  shouldFinalizePendingLiveEditReload,
  shouldPublishVisualEditHandoff,
  shouldSuppressReloadedVisualEditHandoff,
  updateReloadedVisualEditHandoff,
  updateVisualEditHandoffPublication,
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
  it("tracks a reload against the selected breakpoint frame", () => {
    expect(activeRuntimeReloadFrameId(undefined)).toBe("primary");
    expect(activeRuntimeReloadFrameId(960)).toBe("breakpoint:960");
  });

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

  it("retains a ready handoff that is queued when its frame reloads", () => {
    const queued = updateVisualEditHandoffPublication(null, {
      status: "queued",
      designId: "design-1",
      publicationRevision: 4,
    });

    expect(queued).toEqual({
      designId: "design-1",
      publicationRevision: 4,
      serverRevision: null,
    });
    expect(
      shouldSuppressReloadedVisualEditHandoff({
        marker: queued,
        designId: "design-1",
        status: "ready",
        revision: 3,
      }),
    ).toBe(true);

    const published = updateVisualEditHandoffPublication(queued, {
      status: "ready",
      designId: "design-1",
      publicationRevision: 4,
      serverRevision: 5,
    });
    expect(published?.serverRevision).toBe(5);
    expect(
      shouldSuppressReloadedVisualEditHandoff({
        marker: published,
        designId: "design-1",
        status: "ready",
        revision: 5,
      }),
    ).toBe(true);
  });

  it("releases a queued reload marker when its durable publication fails", () => {
    const queued = updateVisualEditHandoffPublication(null, {
      status: "queued",
      designId: "design-1",
      publicationRevision: 4,
    });
    expect(queued).not.toBeNull();
    expect(
      shouldSuppressReloadedVisualEditHandoff({
        marker: queued,
        designId: "design-1",
        status: "ready",
        revision: 3,
      }),
    ).toBe(true);

    const afterFailure = updateReloadedVisualEditHandoff(queued, {
      status: "failed",
      designId: "design-1",
      publicationRevision: 4,
    });
    expect(afterFailure).toBeNull();
    expect(
      shouldSuppressReloadedVisualEditHandoff({
        marker: afterFailure,
        designId: "design-1",
        status: "ready",
        revision: 5,
      }),
    ).toBe(false);
  });

  it("keeps local edits through a reload until the durable handoff is confirmed", () => {
    const targets = pendingLiveEditFrameTargets([styleEdit("library")], []);
    const reloaded = new Set(["library\0primary"]);
    const queued = updateVisualEditHandoffPublication(null, {
      status: "queued",
      designId: "design-1",
      publicationRevision: 4,
    });

    expect(
      shouldFinalizePendingLiveEditReload({
        pendingTargets: targets,
        reloadedTargets: reloaded,
        handoff: queued,
        designId: "design-1",
      }),
    ).toBe(false);

    const afterFailure = updateVisualEditHandoffPublication(queued, {
      status: "failed",
      designId: "design-1",
      publicationRevision: 4,
    });
    expect(afterFailure).toEqual(queued);
    expect(
      shouldFinalizePendingLiveEditReload({
        pendingTargets: targets,
        reloadedTargets: reloaded,
        handoff: afterFailure,
        designId: "design-1",
      }),
    ).toBe(false);

    const afterConfirmation = updateVisualEditHandoffPublication(afterFailure, {
      status: "ready",
      designId: "design-1",
      publicationRevision: 4,
      serverRevision: 5,
    });
    expect(
      shouldFinalizePendingLiveEditReload({
        pendingTargets: targets,
        reloadedTargets: reloaded,
        handoff: afterConfirmation,
        designId: "design-1",
      }),
    ).toBe(true);
  });

  it("does not queue an empty handoff after a retained reload", () => {
    expect(
      shouldPublishVisualEditHandoff({
        designId: "design-1",
        pendingEditCount: 0,
        clearRequestedDesignId: null,
        hadPendingDesignId: null,
      }),
    ).toBe(false);
    expect(
      shouldPublishVisualEditHandoff({
        designId: "design-1",
        pendingEditCount: 0,
        clearRequestedDesignId: "design-1",
        hadPendingDesignId: "design-1",
      }),
    ).toBe(true);
  });

  it("does not let stale publications replace a newer retained handoff", () => {
    const latest = updateVisualEditHandoffPublication(null, {
      status: "queued",
      designId: "design-1",
      publicationRevision: 8,
    });
    const result = updateVisualEditHandoffPublication(latest, {
      status: "ready",
      designId: "design-1",
      publicationRevision: 7,
      serverRevision: 12,
    });

    expect(result).toEqual(latest);
  });

  it("clears reload suppression only for the acknowledged revision or a newer handoff", () => {
    const marker = {
      designId: "design-1",
      publicationRevision: 4,
      serverRevision: 5,
    };

    expect(
      shouldClearReloadedVisualEditHandoff({
        marker,
        designId: "design-1",
        status: "empty",
        revision: 4,
      }),
    ).toBe(false);
    expect(
      shouldClearReloadedVisualEditHandoff({
        marker,
        designId: "design-1",
        status: "empty",
        revision: 5,
      }),
    ).toBe(true);
    expect(
      shouldClearReloadedVisualEditHandoff({
        marker,
        designId: "design-1",
        status: "ready",
        revision: 6,
      }),
    ).toBe(true);
    expect(
      shouldSuppressReloadedVisualEditHandoff({
        marker,
        designId: "design-1",
        status: "ready",
        revision: 6,
      }),
    ).toBe(false);
    expect(
      shouldSuppressReloadedVisualEditHandoff({
        marker,
        designId: "design-1",
        status: "ready",
        revision: 4,
      }),
    ).toBe(true);
  });
});
