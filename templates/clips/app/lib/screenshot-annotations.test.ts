import { describe, expect, it } from "vitest";

import {
  annotationFontSize,
  annotationHandlePoints,
  annotationLineWidth,
  arrowHeadLength,
  hitTestAnnotation,
  layoutText,
  moveAnnotation,
  redactionsOf,
  resizeAnnotation,
  textFontSize,
  textLineOffset,
  isDarkColor,
  duplicateAnnotation,
  parseCrop,
  fitRedaction,
  fromPendingOverlays,
  keepRedactionInside,
  toPendingOverlays,
  wrapTextLines,
  type Annotation,
} from "./screenshot-annotations";

const RETINA = { width: 4046, height: 1950 };
const SMALL = { width: 800, height: 600 };

describe("annotation sizing", () => {
  it("scales with the image so marks read the same on any capture", () => {
    // A 3px line and 16px text are clear on a small screenshot and almost
    // invisible on a 4K one; fixed sizes would make the tools useless there.
    expect(annotationLineWidth(RETINA)).toBeGreaterThan(
      annotationLineWidth(SMALL),
    );
    expect(annotationFontSize(RETINA)).toBeGreaterThan(
      annotationFontSize(SMALL),
    );
    expect(arrowHeadLength(RETINA)).toBeGreaterThan(arrowHeadLength(SMALL));
  });

  it("applies the text size steps on top of the image-derived size", () => {
    const base = annotationFontSize(RETINA);
    expect(annotationFontSize(RETINA, 0.7)).toBeLessThan(base);
    expect(annotationFontSize(RETINA, 1.6)).toBeGreaterThan(base);
  });

  it("keeps a floor so marks stay visible on a tiny image", () => {
    const tiny = { width: 120, height: 90 };
    expect(annotationLineWidth(tiny)).toBe(2);
    expect(annotationFontSize(tiny)).toBe(12);
  });
});

describe("redactionsOf", () => {
  it("reports only the redactions, never the drawn marks", () => {
    // What gets recorded on the row is where content was removed. A box or a
    // label is part of the picture and has nothing to record.
    const annotations: Annotation[] = [
      {
        kind: "box",
        id: "a",
        x: 1,
        y: 2,
        width: 3,
        height: 4,
        color: "#ef4444",
      },
      { kind: "redact", id: "b", x: 10, y: 20, width: 30, height: 40 },
      {
        kind: "text",
        id: "c",
        x: 5,
        y: 5,
        text: "here",
        color: "#ef4444",
        scale: 1,
      },
    ];

    expect(redactionsOf(annotations, { width: 1000, height: 800 })).toEqual([
      { x: 10, y: 20, width: 30, height: 40 },
    ]);
  });
});

describe("hitTestAnnotation", () => {
  const size = { width: 1000, height: 800 };
  const box: Annotation = {
    kind: "box",
    id: "box",
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    color: "#ef4444",
  };
  const redaction: Annotation = {
    kind: "redact",
    id: "red",
    x: 100,
    y: 100,
    width: 200,
    height: 100,
  };

  it("picks the mark under the point", () => {
    expect(hitTestAnnotation([box], { x: 150, y: 150 }, size)?.kind).toBe(
      "box",
    );
    expect(hitTestAnnotation([box], { x: 10, y: 10 }, size)).toBeNull();
  });

  it("picks the topmost when marks overlap", () => {
    const upper: Annotation = { ...box, id: "upper" };
    const hit = hitTestAnnotation([box, upper], { x: 150, y: 150 }, size);
    expect(hit && "id" in hit ? hit.id : null).toBe("upper");
  });

  it("selects a redaction that is not burned in yet", () => {
    expect(hitTestAnnotation([redaction], { x: 150, y: 150 }, size)?.kind).toBe(
      "redact",
    );
  });

  it("prefers a mark over the redaction it sits on, whatever the order", () => {
    // Redactions are drawn under every mark, so the mark is what you see.
    expect(
      hitTestAnnotation([box, redaction], { x: 150, y: 150 }, size)?.kind,
    ).toBe("box");
  });
});

describe("moveAnnotation", () => {
  it("moves both ends of an arrow together", () => {
    const moved = moveAnnotation(
      {
        kind: "arrow",
        id: "a",
        fromX: 10,
        fromY: 10,
        toX: 50,
        toY: 40,
        color: "#ef4444",
      },
      5,
      -5,
    );
    expect(moved).toMatchObject({ fromX: 15, fromY: 5, toX: 55, toY: 35 });
  });
});

describe("resizeAnnotation", () => {
  it("resizes a box from the opposite corner", () => {
    const resized = resizeAnnotation(
      {
        kind: "box",
        id: "b",
        x: 100,
        y: 100,
        width: 100,
        height: 100,
        color: "#ef4444",
      },
      "end",
      { x: 400, y: 300 },
    );
    expect(resized).toMatchObject({ x: 100, y: 100, width: 300, height: 200 });
  });

  it("keeps a box positive when dragged past its own corner", () => {
    const resized = resizeAnnotation(
      {
        kind: "box",
        id: "b",
        x: 100,
        y: 100,
        width: 100,
        height: 100,
        color: "#ef4444",
      },
      "end",
      { x: 20, y: 20 },
    );
    expect(resized).toMatchObject({ x: 20, y: 20, width: 80, height: 80 });
  });
});

describe("annotationHandlePoints", () => {
  // An arrow drawn up-and-right has its tail at the bottom-left of its bounds
  // and its point at the top-right, so the bounding box's top-left corner is a
  // place the arrow never touches. Handing that corner to the user as the
  // "start" handle moved the wrong end and flipped the arrow.
  const upRight: Annotation = {
    kind: "arrow",
    id: "a",
    fromX: 100,
    fromY: 400,
    toX: 500,
    toY: 100,
    color: "#ef4444",
  };

  it("puts an arrow's handles on its own ends, not on its bounding box", () => {
    expect(annotationHandlePoints(upRight, SMALL)).toEqual({
      start: { x: 100, y: 400 },
      end: { x: 500, y: 100 },
    });
  });

  it("drags an arrow's point without moving its tail", () => {
    const handles = annotationHandlePoints(upRight, SMALL);
    expect(handles).not.toBeNull();
    // Grab the handle sitting on the point, and pull it further out.
    const lengthened = resizeAnnotation(upRight, "end", { x: 700, y: 50 });
    expect(lengthened).toMatchObject({
      fromX: 100,
      fromY: 400,
      toX: 700,
      toY: 50,
    });
  });

  it("uses opposite corners for a box", () => {
    expect(
      annotationHandlePoints(
        {
          kind: "box",
          id: "b",
          x: 100,
          y: 100,
          width: 300,
          height: 200,
          color: "#ef4444",
        },
        SMALL,
      ),
    ).toEqual({ start: { x: 100, y: 100 }, end: { x: 400, y: 300 } });
  });

  it("gives text a width handle on each side, halfway down", () => {
    const points = annotationHandlePoints(
      {
        kind: "text",
        id: "t",
        x: 10,
        y: 10,
        text: "hi",
        color: "#fff",
        fontSize: 20,
        width: 200,
      },
      SMALL,
    );
    expect(points).toEqual({
      start: { x: 10, y: 10 + 12.5 },
      end: { x: 210, y: 10 + 12.5 },
    });
  });

  it("sizes a redaction by its corners, like a box", () => {
    expect(
      annotationHandlePoints(
        { kind: "redact", id: "r", x: 0, y: 0, width: 10, height: 10 },
        SMALL,
      ),
    ).toEqual({ start: { x: 0, y: 0 }, end: { x: 10, y: 10 } });
  });
});

describe("text layout", () => {
  // Every character 10px wide, so widths are easy to reason about.
  const measure = (line: string) => line.length * 10;

  it("breaks a line at every Return", () => {
    expect(wrapTextLines("one\ntwo\n\nfour", undefined, measure)).toEqual([
      "one",
      "two",
      "",
      "four",
    ]);
  });

  it("wraps words to a set width", () => {
    expect(wrapTextLines("the quick brown fox", 110, measure)).toEqual([
      "the quick",
      "brown fox",
    ]);
  });

  it("breaks a word longer than the whole box instead of overflowing it", () => {
    expect(wrapTextLines("abcdefghij", 40, measure)).toEqual([
      "abcd",
      "efgh",
      "ij",
    ]);
  });

  it("sizes a box without a width to its longest line", () => {
    const text: Annotation = {
      kind: "text",
      id: "t",
      x: 0,
      y: 0,
      text: "ab\nabcdef",
      color: "#fff",
      fontSize: 20,
    };
    const layout = layoutText(text, SMALL, measure);
    expect(layout.width).toBe(60);
    expect(layout.height).toBe(2 * 20 * 1.25);
  });

  it("uses an exact font size, and still reads the old size steps", () => {
    const base = {
      kind: "text",
      id: "t",
      x: 0,
      y: 0,
      text: "x",
      color: "#fff",
    } as const;
    expect(textFontSize({ ...base, fontSize: 31 }, RETINA)).toBe(31);
    expect(textFontSize({ ...base, scale: 1.6 }, RETINA)).toBe(
      annotationFontSize(RETINA, 1.6),
    );
  });

  it("changes only the width when a text's side is dragged", () => {
    const text: Annotation = {
      kind: "text",
      id: "t",
      x: 100,
      y: 50,
      text: "hello",
      color: "#fff",
      fontSize: 20,
      width: 200,
    };
    expect(
      resizeAnnotation(text, "end", { x: 250, y: 999 }, SMALL),
    ).toMatchObject({
      x: 100,
      y: 50,
      width: 150,
    });
    // The left side moves the left edge and keeps the right one still.
    expect(
      resizeAnnotation(text, "start", { x: 150, y: 0 }, SMALL),
    ).toMatchObject({
      x: 150,
      width: 150,
    });
    // Never narrower than two characters' worth.
    expect(resizeAnnotation(text, "end", { x: 90, y: 0 }, SMALL)).toMatchObject(
      {
        width: 40,
      },
    );
  });
});

describe("text alignment", () => {
  it("starts each line where its alignment puts it in the box", () => {
    expect(textLineOffset(undefined, 200, 50)).toBe(0);
    expect(textLineOffset("left", 200, 50)).toBe(0);
    expect(textLineOffset("center", 200, 50)).toBe(75);
    expect(textLineOffset("right", 200, 50)).toBe(150);
  });
});

describe("pending redactions", () => {
  it("are stored the way the video editor stores them, so the hold sees them", async () => {
    const { countPendingRedactions } =
      await import("../../server/lib/pending-redactions");
    const overlays = toPendingOverlays(
      [
        {
          kind: "redact",
          id: "r1",
          x: 80,
          y: 60,
          width: 160,
          height: 120,
          style: "solid",
          color: "#ffffff",
        },
        {
          kind: "box",
          id: "b",
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          color: "#ef4444",
        },
      ],
      SMALL,
    );
    expect(overlays).toHaveLength(1);
    expect(countPendingRedactions(JSON.stringify({ overlays }))).toBe(1);
  });

  it("come back in image pixels exactly as they were drawn", () => {
    const drawn: Annotation = {
      kind: "redact",
      id: "r1",
      x: 80,
      y: 60,
      width: 160,
      height: 120,
      style: "solid",
      color: "#ffffff",
    };
    expect(
      fromPendingOverlays(toPendingOverlays([drawn], SMALL), SMALL),
    ).toEqual([drawn]);
  });
});

describe("text outline", () => {
  it("treats black as dark and the light palette colours as light", () => {
    expect(isDarkColor("#000000")).toBe(true);
    expect(isDarkColor("#ffffff")).toBe(false);
    expect(isDarkColor("#f59e0b")).toBe(false);
  });
});

describe("parseCrop", () => {
  it("reads a crop and keeps it inside the picture", () => {
    expect(parseCrop({ x: 700, y: 10, width: 400, height: 50 }, SMALL)).toEqual(
      {
        x: 700,
        y: 10,
        width: 100,
        height: 50,
      },
    );
  });

  it("treats a missing, broken or whole-picture crop as no crop", () => {
    expect(parseCrop(undefined, SMALL)).toBeNull();
    expect(parseCrop({ x: "a" }, SMALL)).toBeNull();
    expect(
      parseCrop({ x: 0, y: 0, width: 800, height: 600 }, SMALL),
    ).toBeNull();
  });
});

describe("duplicateAnnotation", () => {
  it("makes a new mark with its own id, offset from the original", () => {
    const box: Annotation = {
      kind: "box",
      id: "b",
      x: 10,
      y: 10,
      width: 50,
      height: 50,
      color: "#000000",
      fill: true,
    };
    const copy = duplicateAnnotation(box, SMALL);
    expect(copy.id).not.toBe("b");
    expect(copy).toMatchObject({
      kind: "box",
      x: 23,
      y: 23,
      width: 50,
      fill: true,
    });
  });
});

describe("fitRedaction", () => {
  const UHD = { width: 3840, height: 2160 };

  it("grows a box too small to be stored, instead of letting it be dropped", () => {
    // The review's case: a 15px box over a short token on a 4K capture is
    // under the stored minimum, and used to vanish from the pending list
    // while the served copy still showed it drawn in.
    const tiny: Annotation = {
      kind: "redact",
      id: "r",
      x: 1000,
      y: 500,
      width: 15,
      height: 12,
    };
    const overlays = toPendingOverlays([tiny], UHD);
    expect(fromPendingOverlays(overlays, UHD)).toHaveLength(1);
    const fitted = fitRedaction(tiny, UHD);
    // Still covers everything it was placed over.
    expect(fitted.x).toBeLessThanOrEqual(1000);
    expect(fitted.x + fitted.width).toBeGreaterThanOrEqual(1015);
    expect(fitted.y).toBeLessThanOrEqual(500);
    expect(fitted.y + fitted.height).toBeGreaterThanOrEqual(512);
  });

  it("keeps a grown box inside the picture at a corner", () => {
    const corner: Annotation = {
      kind: "redact",
      id: "r",
      x: 3838,
      y: 2158,
      width: 2,
      height: 2,
    };
    const fitted = fitRedaction(corner, UHD);
    expect(fitted.x + fitted.width).toBe(3840);
    expect(fitted.y + fitted.height).toBe(2160);
    expect(
      fromPendingOverlays(toPendingOverlays([corner], UHD), UHD),
    ).toHaveLength(1);
  });

  it("cuts off the part past an edge rather than shifting what it covers", () => {
    const over: Annotation = {
      kind: "redact",
      id: "r",
      x: -40,
      y: 10,
      width: 200,
      height: 100,
    };
    expect(fitRedaction(over, UHD)).toMatchObject({
      x: 0,
      y: 10,
      width: 160,
      height: 100,
    });
  });

  it("turns a box shrunk to nothing into one the burn will accept", () => {
    const flat: Annotation = {
      kind: "redact",
      id: "r",
      x: 100,
      y: 100,
      width: 0,
      height: 0,
    };
    const [rect] = redactionsOf([flat], UHD);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.width).toBeGreaterThanOrEqual(1);
    expect(rect.height).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(rect.x) && Number.isInteger(rect.width)).toBe(true);
  });

  it("gives the burn whole, non-negative pixels for a box dragged off the edge", () => {
    const off = moveAnnotation(
      { kind: "redact", id: "r", x: 10, y: 10, width: 100, height: 50 },
      -60.4,
      0,
    );
    const [rect] = redactionsOf([off], UHD);
    expect(rect).toEqual({ x: 0, y: 10, width: 50, height: 50 });
  });
});

describe("keepRedactionInside", () => {
  it("stops a dragged redaction at the edge, the same size", () => {
    const box: Annotation = {
      kind: "redact",
      id: "r",
      x: -40,
      y: 790,
      width: 100,
      height: 50,
    };
    expect(keepRedactionInside(box, SMALL)).toMatchObject({
      x: 0,
      y: 550,
      width: 100,
      height: 50,
    });
  });
});
