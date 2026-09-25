import { createCornerNode, serializePenPath } from "@shared/pen-path";
import { describe, expect, it } from "vitest";

import { DEFAULT_SHAPE_FILL } from "../canvas-primitive-style";
import {
  createDraftPrimitive,
  createPenDraftPrimitive,
  draftPrimitiveToInsert,
} from "./draft-primitives";
import type {
  DraftPrimitive,
  FrameGeometry,
  ResolvedScreenMetadata,
} from "./types";

function frame(
  x: number,
  y: number,
  width: number,
  height: number,
): FrameGeometry {
  return { x, y, width, height };
}

function rectDraft(geometry: FrameGeometry): DraftPrimitive {
  return { id: "draft-rect", kind: "rectangle", geometry } as DraftPrimitive;
}

describe("draftPrimitiveToInsert node id", () => {
  it("never reuses the draft's own bookkeeping id as the committed node id", () => {
    // draft.id ("draft-rect-<timestamp>-<random>") is host-side-only
    // bookkeeping (the overlay's data-draft-id, selectedDraftIds, …). Reusing
    // it as the insert's nodeId writes that literal "draft-" string into the
    // saved document as the element's PERMANENT data-agent-native-node-id —
    // it never becomes a stable, non-draft id, so anything keyed on it
    // (selection, the layers row, a follow-up drag) waits forever or breaks.
    const draft = rectDraft(frame(10, 10, 100, 80));
    const result = draftPrimitiveToInsert(draft, frame(0, 0, 400, 400));
    expect(result.nodeId).toBeDefined();
    expect(result.nodeId).not.toBe(draft.id);
    expect(result.nodeId).not.toMatch(/^draft-/);
  });

  it("mints a different id for two drafts created back to back", () => {
    const geometry = frame(0, 0, 100, 100);
    const first = draftPrimitiveToInsert(
      rectDraft(geometry),
      frame(0, 0, 400, 400),
    );
    const second = draftPrimitiveToInsert(
      rectDraft(geometry),
      frame(0, 0, 400, 400),
    );
    expect(first.nodeId).not.toBe(second.nodeId);
  });
});

describe("draftPrimitiveToInsert Pen paths", () => {
  it("carries the same screen-local PenPath that it serializes for persistence", () => {
    const draft = createPenDraftPrimitive(
      {
        closed: false,
        nodes: [
          createCornerNode({ x: 20, y: 30 }),
          createCornerNode({ x: 70, y: 60 }),
        ],
      },
      { id: "draft-pen" },
    );
    const inserted = draftPrimitiveToInsert(draft, frame(10, 20, 100, 80));

    expect(inserted.penPath?.nodes.map((node) => node.point)).toEqual([
      { x: 10, y: 10 },
      { x: 60, y: 40 },
    ]);
    expect(inserted.pathData).toBe(serializePenPath(inserted.penPath!));
  });
});

describe("createDraftPrimitive default fill", () => {
  const start = { x: 0, y: 0 };
  const end = { x: 100, y: 100 };

  it("gives a freshly drawn ellipse a real, removable default fill", () => {
    const draft = createDraftPrimitive({
      tool: "ellipse",
      start,
      end,
      moved: true,
    });
    expect(draft.fill).toBe(DEFAULT_SHAPE_FILL);
  });

  it("gives a freshly drawn rectangle a real, removable default fill", () => {
    const draft = createDraftPrimitive({
      tool: "rect",
      start,
      end,
      moved: true,
    });
    expect(draft.fill).toBe(DEFAULT_SHAPE_FILL);
  });

  it("keeps an explicitly chosen tool fill instead of overriding it", () => {
    const draft = createDraftPrimitive({
      tool: "rect",
      start,
      end,
      moved: true,
      toolProps: { fill: "rgb(1 2 3)" },
    });
    expect(draft.fill).toBe("rgb(1 2 3)");
  });

  it("leaves a freshly drawn frame transparent (no default fill)", () => {
    const draft = createDraftPrimitive({
      tool: "frame",
      start,
      end,
      moved: true,
    });
    expect(draft.fill).toBeUndefined();
  });
});

describe("draftPrimitiveToInsert draw scaling", () => {
  it("keeps a drawn rectangle the exact size it was dragged on a landscape inline frame", () => {
    // Regression: a blank inline screen carries the 1280×2560 metadata default;
    // on a landscape frame that stretched a dragged box into a tall ribbon.
    // Inline reflows to the frame, so the draw must land 1:1.
    const landscapeFrame = frame(-528, 179, 578, 398);
    const draft = rectDraft({ x: -400, y: 250, width: 200, height: 150 });
    const inlineDefault = {
      source: "inline",
      previewState: "preview",
      width: 1280,
      height: 2560,
    } as ResolvedScreenMetadata;

    const result = draftPrimitiveToInsert(draft, landscapeFrame, inlineDefault);

    expect(result.geometry.width).toBe(200);
    expect(result.geometry.height).toBe(150);
    // Positioned relative to the frame origin (no per-axis stretch).
    expect(result.geometry.x).toBe(128);
    expect(result.geometry.y).toBe(71);
  });

  it("falls back to 1:1 when an inline screen has no metadata at all", () => {
    const landscapeFrame = frame(0, 0, 800, 500);
    const draft = rectDraft({ x: 100, y: 80, width: 260, height: 180 });

    const result = draftPrimitiveToInsert(draft, landscapeFrame, undefined);

    expect(result.geometry.width).toBe(260);
    expect(result.geometry.height).toBe(180);
  });

  it("still scales a fixed-viewport (localhost) screen by its metadata", () => {
    // localhost/fusion screens render at their own viewport and are scaled to
    // fit the frame, so their draw scale must remain metadata-driven.
    const displayFrame = frame(0, 0, 640, 400);
    const draft = rectDraft({ x: 100, y: 50, width: 100, height: 50 });
    const localhost = {
      source: "localhost",
      previewState: "live",
      width: 1280,
      height: 800,
    } as ResolvedScreenMetadata;

    const result = draftPrimitiveToInsert(draft, displayFrame, localhost);

    // scaleX = 1280/640 = 2, scaleY = 800/400 = 2 (uniform) → 100×50 → 200×100.
    expect(result.geometry.width).toBe(200);
    expect(result.geometry.height).toBe(100);
  });

  it("scales the draw for a K-scaled inline screen (frame matches the metadata aspect but is larger)", () => {
    // A resized-with-aspect inline screen scales its content instead of
    // reflowing, so the draw maps through the metadata scale, not 1:1.
    const resizedFrame = frame(0, 0, 892, 748); // 2× natural, same aspect
    const draft = rectDraft({ x: 0, y: 0, width: 446, height: 374 });
    const natural = {
      source: "inline",
      previewState: "preview",
      width: 446,
      height: 374,
    } as ResolvedScreenMetadata;

    const result = draftPrimitiveToInsert(draft, resizedFrame, natural);

    // scaleX = 446/892 = 0.5, scaleY = 374/748 = 0.5.
    expect(result.geometry.width).toBe(223);
    expect(result.geometry.height).toBe(187);
  });

  it("scales the draw for a '+'-added inline screen carrying the 1280×2560 default at a matching aspect", () => {
    const portraitFrame = frame(0, 0, 640, 1280); // aspect 0.5 matches the default
    const draft = rectDraft({ x: 0, y: 0, width: 320, height: 640 });
    const defaultMeta = {
      source: "inline",
      previewState: "preview",
      width: 1280,
      height: 2560,
    } as ResolvedScreenMetadata;

    const result = draftPrimitiveToInsert(draft, portraitFrame, defaultMeta);

    // scaleX = 1280/640 = 2, scaleY = 2560/1280 = 2.
    expect(result.geometry.width).toBe(640);
    expect(result.geometry.height).toBe(1280);
  });
});
