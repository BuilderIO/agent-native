import { describe, expect, it } from "vitest";

import {
  derivedVideoBlockId,
  nfmCommentAnchorBlocks,
} from "./comment-block-anchor";
import { nfmToDoc } from "./nfm";

const L = (...lines: string[]) => lines.join("\n");

describe("comment anchor blocks", () => {
  it("reads each video's id, and derives one for a video saved without", () => {
    const blocks = nfmCommentAnchorBlocks(
      nfmToDoc(
        L(
          '<video src="https://example.com/a.mp4" id="video-saved01"></video>',
          '<video src="https://example.com/b.mp4"></video>',
        ),
      ),
    );
    expect([...blocks]).toEqual([
      ["video-saved01", "video"],
      [derivedVideoBlockId("https://example.com/b.mp4", 0), "video"],
    ]);
  });

  it("derives the same id on every reader, and a different one per source and copy", () => {
    const id = derivedVideoBlockId("https://example.com/a.mp4", 0);
    expect(id).toMatch(/^video-[a-z0-9]{8}$/);
    expect(derivedVideoBlockId("https://example.com/a.mp4", 0)).toBe(id);
    expect(derivedVideoBlockId("https://example.com/a.mp4", 1)).not.toBe(id);
    expect(derivedVideoBlockId("https://example.com/b.mp4", 0)).not.toBe(id);

    const twice = nfmCommentAnchorBlocks(
      nfmToDoc(
        L(
          '<video src="https://example.com/a.mp4"></video>',
          '<video src="https://example.com/a.mp4"></video>',
        ),
      ),
    );
    expect([...twice.keys()]).toEqual([
      derivedVideoBlockId("https://example.com/a.mp4", 0),
      derivedVideoBlockId("https://example.com/a.mp4", 1),
    ]);
  });

  it("gives a copied id to its first block only", () => {
    const blocks = nfmCommentAnchorBlocks(
      nfmToDoc(
        L(
          '<video src="https://example.com/a.mp4" id="video-same0001">First</video>',
          '<video src="https://example.com/b.mp4" id="video-same0001">Copy</video>',
        ),
      ),
    );
    expect([...blocks]).toEqual([["video-same0001", "video"]]);
  });

  it("finds a video inside a toggle or a list item", () => {
    const blocks = nfmCommentAnchorBlocks(
      nfmToDoc(
        L(
          '<details summary="Clips">',
          '\t<video src="https://example.com/a.mp4" id="video-intoggl"></video>',
          "</details>",
          "- Item",
          '\t<video src="https://example.com/b.mp4" id="video-inlist1"></video>',
        ),
      ),
    );
    expect([...blocks.keys()]).toEqual(["video-intoggl", "video-inlist1"]);
  });
});
