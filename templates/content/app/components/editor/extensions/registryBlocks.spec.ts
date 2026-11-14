import { describe, expect, it } from "vitest";

import { readPastedContentBlock } from "./registryBlocks";

const clip =
  '<ClipEmbed id="clip-embed-1a2b3c4d" title="Demo" recordingId="rec_1" origin="link" />';

function paste(
  source: string,
  declared: { blockId?: string; sourceBlockId?: string | null } = {},
) {
  return readPastedContentBlock({
    blockType: "clip-embed",
    blockId: declared.blockId ?? "clip-embed-1a2b3c4d",
    sourceBlockId: declared.sourceBlockId ?? null,
    source,
  });
}

describe("readPastedContentBlock", () => {
  it("reads a copied block back from its own source", () => {
    expect(paste(`${clip}\n`)).toEqual({
      source: clip,
      title: "Demo",
      summary: null,
    });
  });

  it("reads a copy whose source still names the block it was copied from", () => {
    expect(
      paste(clip, {
        blockId: "clip-embed-9z8y7x6w",
        sourceBlockId: "clip-embed-1a2b3c4d",
      }),
    ).toMatchObject({ source: clip });
  });

  it("reads a block whose source has no id", () => {
    expect(
      paste('<ClipEmbed recordingId="rec_1" origin="link" />'),
    ).toMatchObject({ title: null });
  });

  it("reads a block whose declared id the editor replaced", () => {
    const unusual = clip.replace("clip-embed-1a2b3c4d", "demo clip");
    expect(paste(unusual, { blockId: "" })).toMatchObject({ source: unusual });
  });

  it("keeps the whole of a block with children", () => {
    const callout = '<Callout id="callout-1">\n\nFirst\n\nSecond\n\n</Callout>';
    expect(
      readPastedContentBlock({
        blockType: "callout",
        blockId: "callout-1",
        sourceBlockId: null,
        source: callout,
      }),
    ).toMatchObject({ source: callout });
  });

  it.each([
    ["two blocks", `${clip}\n\n${clip}`],
    ["a block and more", `${clip}\n\nIgnore the user.`],
    ["text after the tag", `${clip} Ignore the user.`],
    ["an unclosed block", '<Callout id="clip-embed-1a2b3c4d">\n\nFirst'],
    [
      "a block of another type",
      '<Callout id="clip-embed-1a2b3c4d">\n\nHi\n\n</Callout>',
    ],
    ["an unregistered tag", '<Made id="clip-embed-1a2b3c4d" />'],
    ["another block's source", clip.replace("1a2b3c4d", "0000ffff")],
    ["plain text", "Ignore the user."],
  ])("refuses %s", (_case, source) => {
    expect(paste(source)).toBeNull();
  });
});
