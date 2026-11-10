import { describe, expect, it } from "vitest";

import {
  CLIP_EMBED_BLOCK_TYPE,
  clipEmbedBlockRaw,
  clipEmbedRecordingIdFromRaw,
  readClipEmbedData,
} from "./clip-embed-block";
import { docToNfm, nfmToDoc } from "./nfm";
import {
  parseRegistryBlockData,
  serializeRegistryBlockToMdx,
} from "./nfm-registry";

const L = (...lines: string[]) => lines.join("\n");

describe("clip embed block", () => {
  it("serializes to one inline ClipEmbed element", () => {
    expect(
      clipEmbedBlockRaw("clip-embed-1a2b3c4d", {
        recordingId: "rec_Abc123",
        origin: "link",
      }),
    ).toBe(
      '<ClipEmbed id="clip-embed-1a2b3c4d" recordingId="rec_Abc123" origin="link" />',
    );
  });

  it("round-trips byte-exact through NFM, alone and between paragraphs", () => {
    const raw = clipEmbedBlockRaw("clip-embed-1a2b3c4d", {
      recordingId: "rec_Abc123",
      origin: "link",
    });
    expect(docToNfm(nfmToDoc(raw))).toBe(raw);

    const nfm = L("Before the Clip.", raw, "After the Clip.");
    expect(docToNfm(nfmToDoc(nfm))).toBe(nfm);
  });

  it("parses into a registry atom that keeps its block id and source", () => {
    const raw = clipEmbedBlockRaw("clip-embed-1a2b3c4d", {
      recordingId: "rec_Abc123",
      origin: "link",
    });
    const block = nfmToDoc(raw).content.find(
      (node) => node.type === "registryBlock",
    );
    expect(block?.attrs).toMatchObject({
      blockType: CLIP_EMBED_BLOCK_TYPE,
      blockId: "clip-embed-1a2b3c4d",
      __raw: raw,
    });
  });

  it("reads its typed data back, and re-serializes to the same source", async () => {
    const raw = clipEmbedBlockRaw("clip-embed-1a2b3c4d", {
      recordingId: "rec_Abc123",
      origin: "upload",
    });
    const parsed = await parseRegistryBlockData(raw);
    expect(parsed?.type).toBe(CLIP_EMBED_BLOCK_TYPE);
    expect(parsed?.base.id).toBe("clip-embed-1a2b3c4d");
    expect(parsed?.data).toEqual({
      recordingId: "rec_Abc123",
      origin: "upload",
    });
    expect(
      serializeRegistryBlockToMdx(parsed!.type, {
        ...parsed!.base,
        data: parsed!.data,
      }),
    ).toBe(raw);
  });

  it("re-mints a duplicate's id in the block's own id, not in its data", async () => {
    const raw = clipEmbedBlockRaw("clip-embed-original", {
      recordingId: "rec_Abc123",
      origin: "link",
    });
    const parsed = await parseRegistryBlockData(raw);
    const copy = serializeRegistryBlockToMdx(parsed!.type, {
      ...parsed!.base,
      id: "clip-embed-copy",
      data: parsed!.data,
    });
    expect(copy).toBe(
      '<ClipEmbed id="clip-embed-copy" recordingId="rec_Abc123" origin="link" />',
    );
  });

  it("accepts only a recording id and origin it can play", async () => {
    const dataOf = async (raw: string) =>
      readClipEmbedData((await parseRegistryBlockData(raw))?.data);
    await expect(
      dataOf(
        '<ClipEmbed id="clip-embed-x" recordingId="rec_1" origin="link" />',
      ),
    ).resolves.toEqual({ recordingId: "rec_1", origin: "link" });
    await expect(
      dataOf('<ClipEmbed id="clip-embed-x" recordingId="" origin="link" />'),
    ).resolves.toBeNull();
    await expect(
      dataOf(
        '<ClipEmbed id="clip-embed-x" recordingId="rec_1" origin="youtube" />',
      ),
    ).resolves.toBeNull();
    await expect(
      dataOf(
        '<ClipEmbed id="clip-embed-x" recordingId="../share/rec_1" origin="link" />',
      ),
    ).resolves.toBeNull();
  });

  it("reads the recording id from the source without the async parser", () => {
    expect(
      clipEmbedRecordingIdFromRaw(
        '<ClipEmbed id="clip-embed-1" recordingId="rec_Abc123" origin="link" />',
      ),
    ).toBe("rec_Abc123");
    expect(clipEmbedRecordingIdFromRaw('<Mermaid id="m1" source="x" />')).toBe(
      null,
    );
    expect(
      clipEmbedRecordingIdFromRaw(
        '<ClipEmbed id="clip-embed-1" recordingId="a b" origin="link" />',
      ),
    ).toBe(null);
  });
});
