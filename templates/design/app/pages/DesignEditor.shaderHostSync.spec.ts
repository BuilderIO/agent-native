/**
 * Regression spec for the shader-apply white flash (r4 sweep2 step 11):
 * applying a shader fill (`apply-shader-fill` → onShaderFillApplied) or a
 * GLSL shader source edit (GlslShaderPanel persist → onApplied →
 * handleComponentPropApplied) on the ACTIVE screen used to pass
 * `refreshPreview: true` into applyFileContentUpdate. In
 * applyLocalContentUpdate, `refreshPreview: true` means "skip the in-place
 * replace and bump contentRenderRevision" — the active screen's contentKey is
 * `${fileId}:${contentRenderRevision}`, so the bump remounts the iframe
 * srcdoc: a real reload (second `load` event, white flash) of the screen the
 * user is looking at right as the "applied" toast fires, plus an onload
 * refire of screen measurement in the same gesture.
 *
 * The fix routes both host-sync paths through
 * getPersistedContentHostSyncOptions, which requests the bridge's in-place
 * full-document replace (`forcePreviewFullDocument`) and never sets
 * `refreshPreview`. applyLocalContentUpdate itself still falls back to the
 * srcdoc rebuild when the live bridge isn't registered — that fallback is the
 * gate's job, not the caller's.
 *
 * The a11y review-fix apply (`apply-a11y-fix` → onFixApplied →
 * handleReviewFixApplied) is the third persisted-content host sync routed
 * through the helper: the action persists the patched content server-side
 * before returning it, and its result carries no updatedAt stamp — the
 * "without updatedAt" cases below cover that shape.
 */
import { describe, expect, it } from "vitest";

import { getPersistedContentHostSyncOptions } from "./DesignEditor";

describe("getPersistedContentHostSyncOptions — shader apply host-sync routing", () => {
  it("routes an active-file apply through the in-place full-document replace", () => {
    const options = getPersistedContentHostSyncOptions({
      fileId: "screen-1",
      activeFileId: "screen-1",
      updatedAt: "2026-07-07T00:00:00.000Z",
    });
    expect(options).toStrictEqual({
      forcePreviewFullDocument: true,
      persist: false,
      updatedAt: "2026-07-07T00:00:00.000Z",
    });
  });

  it("NEVER requests refreshPreview — that flag forces the srcdoc rebuild (white flash)", () => {
    for (const activeFileId of ["screen-1", "screen-2", null, undefined]) {
      const options = getPersistedContentHostSyncOptions({
        fileId: "screen-1",
        activeFileId,
        updatedAt: "2026-07-07T00:00:00.000Z",
      });
      expect("refreshPreview" in options).toBe(false);
      // No sibling flag may re-open the forced-rebuild route either.
      expect(Object.keys(options).sort()).toStrictEqual([
        "forcePreviewFullDocument",
        "persist",
        "updatedAt",
      ]);
    }
  });

  it("does not force a preview route for a non-active file (cross-file branch owns its own sync)", () => {
    const options = getPersistedContentHostSyncOptions({
      fileId: "screen-2",
      activeFileId: "screen-1",
      updatedAt: "2026-07-07T00:00:00.000Z",
    });
    expect(options.forcePreviewFullDocument).toBe(false);
  });

  it("never treats a missing active file as a match", () => {
    expect(
      getPersistedContentHostSyncOptions({
        fileId: "screen-1",
        activeFileId: null,
      }).forcePreviewFullDocument,
    ).toBe(false);
    expect(
      getPersistedContentHostSyncOptions({
        fileId: "screen-1",
        activeFileId: undefined,
      }).forcePreviewFullDocument,
    ).toBe(false);
  });

  it("marks the content as server-persisted: persist false, updatedAt passed through verbatim", () => {
    const withStamp = getPersistedContentHostSyncOptions({
      fileId: "screen-1",
      activeFileId: "screen-1",
      updatedAt: "2026-07-07T12:34:56.789Z",
    });
    expect(withStamp.persist).toBe(false);
    expect(withStamp.updatedAt).toBe("2026-07-07T12:34:56.789Z");

    // apply-shader-fill returns no updatedAt when the deterministic editor
    // reported no change — the options must not invent one (an invented stamp
    // would corrupt the acked-hash base for guarded update-file saves).
    const withoutStamp = getPersistedContentHostSyncOptions({
      fileId: "screen-1",
      activeFileId: "screen-1",
    });
    expect(withoutStamp.persist).toBe(false);
    expect(withoutStamp.updatedAt).toBeUndefined();
  });
});
