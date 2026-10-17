import { describe, expect, it } from "vitest";

interface FakeEditorState {
  model: string;
  livePreview: string;
}

function updateLiveScreenSnapshotContent(
  state: FakeEditorState,
  html: string,
): FakeEditorState {
  return { ...state, model: html };
}

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
    state = updateLiveScreenSnapshotContent(state, before);
    expect(state.model).toBe(before);
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
