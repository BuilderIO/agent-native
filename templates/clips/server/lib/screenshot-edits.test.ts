import { describe, expect, it } from "vitest";

import {
  editorScreenshotEditsJson,
  hasDeleteClaim,
  isClaimedForDelete,
  screenshotLeftoverUrls,
  viewerScreenshotEditsJson,
  withDeleteClaim,
  withoutDeleteClaim,
} from "./screenshot-edits";

const midBurn = JSON.stringify({
  annotations: [{ id: "old" }],
  overlays: [{ kind: "redact", id: "r1" }],
  unreclaimedUrls: ["https://store.example/copy.png"],
  burnInProgress: {
    staleUrls: ["https://store.example/original.png"],
    editsJson: JSON.stringify({
      annotations: [{ id: "new" }],
      overlays: [],
      redactions: [{ x: 1, y: 1, width: 5, height: 5 }],
      crop: { x: 0, y: 0, width: 10, height: 10 },
    }),
  },
});

describe("screenshot-edits", () => {
  it("hands an editor the edits a stuck burn finishes with", () => {
    // Starting from the pre-burn top level, the next save would put the
    // burned boxes back as pending and drop the burn's marks.
    const edits = JSON.parse(editorScreenshotEditsJson(midBurn));
    expect(edits.annotations).toEqual([{ id: "new" }]);
    expect(edits.overlays).toEqual([]);
    expect(edits.burnInProgress).toBeUndefined();
    expect(edits.unreclaimedUrls).toBeUndefined();
  });

  it("gives a viewer no file URLs and no record of what was hidden", () => {
    const json = viewerScreenshotEditsJson(midBurn);
    expect(json).not.toContain("store.example");
    const edits = JSON.parse(json);
    expect(edits.redactions).toBeUndefined();
    expect(edits.annotations).toBeUndefined();
    expect(edits.overlays).toBeUndefined();
    expect(edits.crop).toBeUndefined();
  });

  it("lists every leftover file for deletion", () => {
    expect(screenshotLeftoverUrls(midBurn)!.sort()).toEqual([
      "https://store.example/copy.png",
      "https://store.example/original.png",
    ]);
    // Unknown is not the same as none: a caller must not delete the row.
    expect(screenshotLeftoverUrls("{not json")).toBeNull();
  });

  it("keeps the delete claim server-side", () => {
    const claimed = withDeleteClaim("{}", new Date().toISOString())!;
    expect(isClaimedForDelete(claimed)).toBe(true);
    expect(editorScreenshotEditsJson(claimed)).toBe("{}");
    expect(withDeleteClaim("{not json", "x")).toBeNull();
  });

  it("lets a claim left by a delete that died expire", () => {
    // Otherwise a timeout mid-delete would leave the screenshot refusing
    // every save for good.
    const claimed = withDeleteClaim("{}", "2026-09-26T00:00:00Z")!;
    expect(
      isClaimedForDelete(claimed, Date.parse("2026-09-26T00:10:00Z")),
    ).toBe(true);
    expect(
      isClaimedForDelete(claimed, Date.parse("2026-09-26T00:20:00Z")),
    ).toBe(false);
    expect(withoutDeleteClaim(claimed)).toBe("{}");
  });

  it("still sees an expired claim, so restore can refuse a part-deleted row", () => {
    const claimed = withDeleteClaim("{}", "2020-01-01T00:00:00Z")!;
    expect(isClaimedForDelete(claimed)).toBe(false);
    expect(hasDeleteClaim(claimed)).toBe(true);
    expect(hasDeleteClaim("{}")).toBe(false);
  });

  it("gives a viewer nothing from edits it cannot read", () => {
    expect(viewerScreenshotEditsJson("{not json")).toBe("{}");
  });
});
