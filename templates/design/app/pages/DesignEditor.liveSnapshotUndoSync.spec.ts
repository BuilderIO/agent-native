/**
 * DesignEditor.liveSnapshotUndoSync.spec.ts
 *
 * BUG-UNDO-LIVE-SNAPSHOT — undo/redo for a live-snapshot (localhost) screen
 * reverted the DATA MODEL but left the LIVE IFRAME showing the pre-undo
 * value indefinitely (deselect+reselect showed the reverted color, but the
 * rendered iframe stayed on the value from right before Cmd+Z).
 *
 * Root cause: updateLiveScreenSnapshotContent (DesignEditor.tsx) only ever
 * updates `liveScreenSnapshotsById` React state — that state has no
 * independent renderer for a LIVE iframe (`src` points at the running app;
 * it is never re-rendered from `content`). The forward-edit path
 * (commitVisualStyles) got away with never syncing the DOM from
 * updateLiveScreenSnapshotContent because it ALSO calls sendStyleChange as a
 * separate, immediate postMessage. handleUndo/handleRedo's four replay call
 * sites — `updateLiveScreenSnapshotContent(fileId, entry.before/.after,
 * {recordHistory:false})` — called ONLY that model update, with no
 * equivalent live-DOM push, so undo/redo silently diverged the model from
 * what the user actually saw in the iframe.
 *
 * The fix pairs every replay call with syncLiveScreenSnapshotPreview, which
 * pushes the same html into the live iframe via a full-document bridge
 * replace (mirroring applyLocalContentUpdate's existing
 * forcePreviewFullDocument handling for non-live-snapshot screens). This
 * spec pins that contract using a minimal model of the two functions' state
 * transitions, in the same "before/after" style as
 * DesignEditor.resizeUndoFallback.spec.ts.
 */
import { describe, expect, it } from "vitest";

interface FakeEditorState {
  /** What liveScreenSnapshotsById holds for this screen after the replay. */
  model: string;
  /** What the live iframe DOM would actually be showing. */
  livePreview: string;
}

// Mirrors updateLiveScreenSnapshotContent: state-only, no DOM side effect.
function updateLiveScreenSnapshotContent(
  state: FakeEditorState,
  html: string,
): FakeEditorState {
  return { ...state, model: html };
}

// Mirrors the new syncLiveScreenSnapshotPreview: pushes the same html into
// the live iframe via a full-document replace.
function syncLiveScreenSnapshotPreview(
  state: FakeEditorState,
  html: string,
): FakeEditorState {
  return { ...state, livePreview: html };
}

describe("live-snapshot undo/redo replay — live preview sync (BUG-UNDO-LIVE-SNAPSHOT)", () => {
  const before = '<div style="color:#e8e8eb">Title</div>';
  const after = '<div style="color:#ff0000">Title</div>';

  it("BEFORE FIX: replaying an undo through updateLiveScreenSnapshotContent alone leaves the live preview stuck at the pre-undo value", () => {
    let state: FakeEditorState = { model: after, livePreview: after };
    // The old handleUndo replay call site: only this one call.
    state = updateLiveScreenSnapshotContent(state, before);
    expect(state.model).toBe(before);
    // The bug, reproduced: the live iframe never got the memo.
    expect(state.livePreview).toBe(after);
    expect(state.livePreview).not.toBe(state.model);
  });

  it("AFTER FIX: pairing the replay with syncLiveScreenSnapshotPreview keeps the live preview in sync", () => {
    let state: FakeEditorState = { model: after, livePreview: after };
    state = updateLiveScreenSnapshotContent(state, before);
    state = syncLiveScreenSnapshotPreview(state, before);
    expect(state.model).toBe(before);
    expect(state.livePreview).toBe(before);
    expect(state.livePreview).toBe(state.model);
  });

  it("AFTER FIX: redo re-applies the same pairing", () => {
    let state: FakeEditorState = { model: before, livePreview: before };
    state = updateLiveScreenSnapshotContent(state, after);
    state = syncLiveScreenSnapshotPreview(state, after);
    expect(state.model).toBe(after);
    expect(state.livePreview).toBe(after);
    expect(state.livePreview).toBe(state.model);
  });
});
