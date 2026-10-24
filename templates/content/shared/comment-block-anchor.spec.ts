import { describe, expect, it } from "vitest";

import {
  derivedVideoBlockId,
  keepVideoBlockIds,
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

describe("keeping video ids through a copy that has none", () => {
  const video = (caption: string, id?: string) =>
    `<video src="https://example.com/a.mp4"${id ? ` id="${id}"` : ""}>${caption}</video>`;
  const local = L(
    video("First", "video-first"),
    video("Second", "video-second"),
  );

  it("keeps each video's id when another with its source is deleted", () => {
    expect(keepVideoBlockIds(local, video("Second"))).toBe(
      video("Second", "video-second"),
    );
  });

  it("keeps each video's id when videos with one source trade places", () => {
    expect(keepVideoBlockIds(local, L(video("Second"), video("First")))).toBe(
      L(video("Second", "video-second"), video("First", "video-first")),
    );
  });

  it("keeps the id of the one video with a source whose caption changed", () => {
    expect(
      keepVideoBlockIds(video("First", "video-first"), video("Opening")),
    ).toBe(video("Opening", "video-first"));
  });

  const ids = (nfm: string) =>
    [...nfm.matchAll(/ id="([^"]+)"/g)].map(([, id]) => id);

  it("gives a video it can't tell apart a new id, never another video's", () => {
    const twins = L(video("", "video-one"), video("", "video-two"));
    const [single] = ids(keepVideoBlockIds(twins, video("")));
    expect(single).toMatch(/^video-/);
    expect(["video-one", "video-two"]).not.toContain(single);
    const renamed = ids(
      keepVideoBlockIds(local, L(video("Opening"), video("Closing"))),
    );
    expect(renamed).toHaveLength(2);
    expect(renamed).not.toContain("video-first");
    expect(renamed).not.toContain("video-second");
  });

  it("keeps the id a video saved without one goes by", () => {
    const unsaved = L(video("First"), video("Second"));
    expect(keepVideoBlockIds(unsaved, video("Second"))).toBe(
      video("Second", derivedVideoBlockId("https://example.com/a.mp4", 1)),
    );
  });

  it("tells identical videos apart by the text around them", () => {
    const sections = L(
      "Intro",
      video("", "video-first"),
      "Outro",
      video("", "video-second"),
    );
    expect(
      ids(
        keepVideoBlockIds(sections, L("Outro", video(""), "Intro", video(""))),
      ),
    ).toEqual(["video-second", "video-first"]);
  });

  it("keeps identical videos' ids in order when nothing around them moved", () => {
    const twins = L(video("", "video-one"), video("", "video-two"));
    expect(keepVideoBlockIds(twins, L(video(""), video("")))).toBe(twins);
  });
});
