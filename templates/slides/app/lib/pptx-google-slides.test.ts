// @vitest-environment happy-dom
// retargetPptxForGoogleSlides round-trips a real Blob through JSZip, which
// needs a FileReader to read a Blob back — absent in plain Node, provided by
// happy-dom (see export-pptx-client.test.ts's own JSZip/Blob round trips).
import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import {
  alignFirstBaselines,
  compensateRoundRectTextInsets,
  type FontMetrics,
  lineSpacingAsPercent,
  retargetPptxForGoogleSlides,
  retargetSlideXmlForGoogleSlides,
  softBreaksFromWrapMarks,
  widenTextBoxes,
  WRAP_MARK,
} from "./pptx-google-slides";

describe("softBreaksFromWrapMarks", () => {
  it("splits a run at a mid-run mark into two runs joined by an <a:br> with the same rPr, trimming the trailing space", () => {
    const rPr =
      '<a:rPr lang="en-US" sz="3999" b="1" spc="-160" kern="0" dirty="0"><a:solidFill><a:srgbClr val="FAF9F5"/></a:solidFill><a:latin typeface="Inter" pitchFamily="34" charset="0"/></a:rPr>';
    const input = `<a:r>${rPr}<a:t>Hello ${WRAP_MARK}World</a:t></a:r>`;
    const expected =
      `<a:r>${rPr}<a:t>Hello</a:t></a:r>` +
      `<a:br>${rPr}</a:br>` +
      `<a:r>${rPr}<a:t>World</a:t></a:r>`;

    expect(softBreaksFromWrapMarks(input)).toBe(expected);
  });

  it("splits a run at two marks into three runs joined by two breaks", () => {
    const rPr = '<a:rPr lang="en-US"/>';
    const input = `<a:r>${rPr}<a:t>One ${WRAP_MARK}Two ${WRAP_MARK}Three</a:t></a:r>`;
    const expected =
      `<a:r>${rPr}<a:t>One</a:t></a:r>` +
      `<a:br>${rPr}</a:br>` +
      `<a:r>${rPr}<a:t>Two</a:t></a:r>` +
      `<a:br>${rPr}</a:br>` +
      `<a:r>${rPr}<a:t>Three</a:t></a:r>`;

    expect(softBreaksFromWrapMarks(input)).toBe(expected);
  });

  it("drops the empty leading run when a mark opens the run, leaving just the break", () => {
    const rPr = '<a:rPr lang="en-US"/>';
    const input = `<a:r>${rPr}<a:t>${WRAP_MARK}Continued</a:t></a:r>`;
    const expected = `<a:br>${rPr}</a:br><a:r>${rPr}<a:t>Continued</a:t></a:r>`;

    const result = softBreaksFromWrapMarks(input);

    expect(result).toBe(expected);
    expect(result).not.toContain("<a:t></a:t>");
  });

  it("copies a self-closing rPr onto the inserted <a:br>", () => {
    const rPr = '<a:rPr lang="en-US"/>';
    const input = `<a:r>${rPr}<a:t>Left ${WRAP_MARK}Right</a:t></a:r>`;

    expect(softBreaksFromWrapMarks(input)).toContain(`<a:br>${rPr}</a:br>`);
  });

  it("returns the input unchanged when there is no wrap mark", () => {
    const input = '<a:r><a:rPr lang="en-US"/><a:t>No marks here</a:t></a:r>';

    expect(softBreaksFromWrapMarks(input)).toBe(input);
  });
});

const EMU_PER_POINT = 12_700;
const TEXT_WIDTH_TOLERANCE = 0.02;
const TEXT_WIDTH_SLACK_PT = 2;

function expectedGrowth(droppedTrackingPt: number, cx: number): number {
  return Math.round(
    droppedTrackingPt * EMU_PER_POINT +
      cx * TEXT_WIDTH_TOLERANCE +
      TEXT_WIDTH_SLACK_PT * EMU_PER_POINT,
  );
}

function expectedX(x: number, align: string, growth: number): number {
  const shift = align === "ctr" ? growth / 2 : align === "r" ? growth : 0;
  return Math.round(x - shift);
}

function textRun(text: string, spc: number): string {
  return (
    `<a:r><a:rPr lang="en-US" sz="3999" b="1" spc="${spc}" kern="0" dirty="0">` +
    `<a:solidFill><a:srgbClr val="FAF9F5"/></a:solidFill>` +
    `<a:latin typeface="Inter" pitchFamily="34" charset="0"/></a:rPr><a:t>${text}</a:t></a:r>`
  );
}

function textBoxShape({
  x = 812_597,
  y = 984_861,
  cx = 10_563_758,
  cy = 1_066_533,
  xfrmAttrs = "",
  algn = "l",
  bodyXml,
}: {
  x?: number;
  y?: number;
  cx?: number;
  cy?: number;
  xfrmAttrs?: string;
  algn?: string;
  bodyXml: string;
}): string {
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="5" name="TextBox 6"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm${xfrmAttrs}><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln/></p:spPr>` +
    `<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="t"><a:noAutofit/></a:bodyPr><a:lstStyle/>` +
    `<a:p><a:pPr algn="${algn}" indent="0" marL="0"><a:lnSpc><a:spcPts val="4199"/></a:lnSpc><a:buNone/></a:pPr>` +
    `${bodyXml}<a:endParaRPr lang="en-US" sz="3999" dirty="0"/></a:p></p:txBody></p:sp>`
  );
}

function widenedRect(xml: string) {
  return {
    cx: Number(xml.match(/<a:ext cx="(\d+)" cy="\d+"\/>/)?.[1]),
    x: Number(xml.match(/<a:off x="(-?\d+)" y="\d+"\/>/)?.[1]),
  };
}

describe("widenTextBoxes", () => {
  it("widens a left-aligned box by the longest line's dropped tracking, plus tolerance and slack, keeping x fixed", () => {
    const cx = 10_563_758;
    const xml = textBoxShape({
      algn: "l",
      bodyXml: textRun("1234567890", -160),
      cx,
    });

    const { cx: resultCx, x: resultX } = widenedRect(widenTextBoxes(xml));

    expect(resultCx).toBe(cx + expectedGrowth(10 * 1.6, cx));
    expect(resultX).toBe(812_597);
  });

  it("shifts the left edge by half the growth for center alignment", () => {
    const cx = 10_563_758;
    const xml = textBoxShape({
      algn: "ctr",
      bodyXml: textRun("1234567890", -160),
      cx,
    });
    const growth = expectedGrowth(16, cx);

    const { cx: resultCx, x: resultX } = widenedRect(widenTextBoxes(xml));

    expect(resultCx).toBe(cx + growth);
    expect(resultX).toBe(expectedX(812_597, "ctr", growth));
  });

  it("shifts the left edge by the full growth for right alignment", () => {
    const cx = 10_563_758;
    const xml = textBoxShape({
      algn: "r",
      bodyXml: textRun("1234567890", -160),
      cx,
    });
    const growth = expectedGrowth(16, cx);

    const { x: resultX } = widenedRect(widenTextBoxes(xml));

    expect(resultX).toBe(expectedX(812_597, "r", growth));
  });

  it("charges the widest line's dropped tracking, not the sum across lines", () => {
    const cx = 10_563_758;
    const xml = textBoxShape({
      algn: "l",
      bodyXml: `${textRun("LongLine12", -160)}<a:br/>${textRun("Hi", -160)}`,
      cx,
    });

    const { cx: resultCx } = widenedRect(widenTextBoxes(xml));

    expect(resultCx).toBe(cx + expectedGrowth(16, cx));
  });

  it("adds only tolerance and slack when tracking is positive", () => {
    const cx = 10_563_758;
    const xml = textBoxShape({
      algn: "l",
      bodyXml: textRun("1234567890", 160),
      cx,
    });

    const { cx: resultCx } = widenedRect(widenTextBoxes(xml));

    expect(resultCx).toBe(cx + expectedGrowth(0, cx));
  });

  it("widens a box whose paragraphs all share one alignment", () => {
    const cx = 10_563_758;
    const xml = textBoxShape({
      algn: "ctr",
      bodyXml: textRun("1234567890", -160),
      cx,
    }).replace(
      "</p:txBody>",
      `<a:p><a:pPr algn="ctr" indent="0" marL="0"><a:buNone/></a:pPr>${textRun("12345", -160)}</a:p></p:txBody>`,
    );
    const growth = expectedGrowth(16, cx);

    const { cx: resultCx, x: resultX } = widenedRect(widenTextBoxes(xml));

    expect(resultCx).toBe(cx + growth);
    expect(resultX).toBe(expectedX(812_597, "ctr", growth));
  });

  it("leaves a box whose paragraphs mix alignments untouched", () => {
    const xml = textBoxShape({
      algn: "l",
      bodyXml: textRun("1234567890", -160),
    }).replace(
      "</p:txBody>",
      `<a:p><a:pPr algn="ctr" indent="0" marL="0"><a:buNone/></a:pPr>${textRun("12345", -160)}</a:p></p:txBody>`,
    );

    expect(widenTextBoxes(xml)).toBe(xml);
  });

  it("leaves a rotated shape untouched", () => {
    const xml = textBoxShape({
      algn: "l",
      bodyXml: textRun("1234567890", -160),
      xfrmAttrs: ' rot="5400000"',
    });

    expect(widenTextBoxes(xml)).toBe(xml);
  });

  it.each(["just", "justLow", "dist", "thaiDist"])(
    "leaves a %s paragraph, which has no single edge to hold, untouched",
    (algn) => {
      const xml = textBoxShape({
        algn,
        bodyXml: textRun("1234567890", -160),
      });

      expect(widenTextBoxes(xml)).toBe(xml);
    },
  );

  it("leaves a shape with no text body untouched", () => {
    const xml =
      '<p:sp><p:spPr><a:xfrm><a:off x="812597" y="984861"/><a:ext cx="10563758" cy="1066533"/></a:xfrm></p:spPr></p:sp>';

    expect(widenTextBoxes(xml)).toBe(xml);
  });
});

describe("retargetPptxForGoogleSlides", () => {
  it("rewrites wrap marks into <a:br> inside every slide of a real pptx package and leaves other parts byte-identical", async () => {
    const shape = textBoxShape({
      algn: "l",
      bodyXml: textRun(`Hello ${WRAP_MARK}World`, -160),
    });
    const slideXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
      `<p:cSld><p:spTree>${shape}</p:spTree></p:cSld></p:sld>`;
    const presentationXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation/>';

    const zip = new JSZip();
    zip.file("ppt/slides/slide1.xml", slideXml);
    zip.file("ppt/presentation.xml", presentationXml);
    const blob = await zip.generateAsync({ type: "blob" });

    const outZip = await JSZip.loadAsync(
      await retargetPptxForGoogleSlides(blob),
    );
    const outSlide = await outZip
      .file("ppt/slides/slide1.xml")
      ?.async("string");
    const outPresentation = await outZip
      .file("ppt/presentation.xml")
      ?.async("string");

    expect(outSlide).toContain("<a:br>");
    expect(outSlide).not.toContain(WRAP_MARK);
    expect(outPresentation).toBe(presentationXml);
  });
});

describe("lineSpacingAsPercent", () => {
  it("converts exact spacing to the percent that gives the same pitch, pinning the exact rounding", () => {
    const xml =
      '<a:p><a:pPr><a:lnSpc><a:spcPts val="4199"/></a:lnSpc></a:pPr>' +
      '<a:r><a:rPr sz="3999"/><a:t>Hi</a:t></a:r>' +
      '<a:endParaRPr sz="3999"/></a:p>';

    expect(lineSpacingAsPercent(xml)).toContain('<a:spcPct val="87501"/>');
  });

  it("uses the largest run size in the paragraph, not the first or smallest", () => {
    const xml =
      '<a:p><a:pPr><a:lnSpc><a:spcPts val="4800"/></a:lnSpc></a:pPr>' +
      '<a:r><a:rPr sz="2000"/><a:t>Small </a:t></a:r>' +
      '<a:r><a:rPr sz="4000"/><a:t>Big</a:t></a:r></a:p>';

    expect(lineSpacingAsPercent(xml)).toContain('<a:spcPct val="100000"/>');
  });

  it("sizes endParaRPr to the paragraph's max run size, discarding its own original size", () => {
    const xml =
      '<a:p><a:pPr><a:lnSpc><a:spcPts val="3598"/></a:lnSpc></a:pPr>' +
      '<a:r><a:rPr sz="2999"/><a:t>Hi</a:t></a:r>' +
      '<a:endParaRPr sz="3999"/></a:p>';

    expect(lineSpacingAsPercent(xml)).toContain('<a:endParaRPr sz="2999"');
  });

  it("leaves a paragraph that already uses spcPct untouched", () => {
    const xml =
      '<a:p><a:pPr><a:lnSpc><a:spcPct val="150000"/></a:lnSpc></a:pPr>' +
      '<a:r><a:rPr sz="1800"/><a:t>Hi</a:t></a:r></a:p>';

    expect(lineSpacingAsPercent(xml)).toBe(xml);
  });

  it("leaves a paragraph with no line spacing at all untouched", () => {
    const xml = '<a:p><a:pPr/><a:r><a:rPr sz="1800"/><a:t>Hi</a:t></a:r></a:p>';

    expect(lineSpacingAsPercent(xml)).toBe(xml);
  });

  it("leaves a paragraph with no sized runs untouched, including its spcPts", () => {
    const xml =
      '<a:p><a:pPr><a:lnSpc><a:spcPts val="4199"/></a:lnSpc></a:pPr>' +
      "<a:r><a:t>Hi</a:t></a:r></a:p>";

    expect(lineSpacingAsPercent(xml)).toBe(xml);
  });

  it("still resizes a mismatched endParaRPr even when lnSpc already uses spcPct", () => {
    const xml =
      '<a:p><a:pPr><a:lnSpc><a:spcPct val="150000"/></a:lnSpc></a:pPr>' +
      '<a:r><a:rPr sz="1800"/><a:t>Hi</a:t></a:r>' +
      '<a:endParaRPr sz="9999"/></a:p>';

    const result = lineSpacingAsPercent(xml);

    expect(result).toContain('<a:lnSpc><a:spcPct val="150000"/></a:lnSpc>');
    expect(result).toContain('<a:endParaRPr sz="1800"');
  });
});

function baselineShape({
  anchor,
  x = 812_597,
  y = 984_861,
  lnSpcPts,
  sz,
  typeface = "Inter",
}: {
  anchor?: string;
  x?: number;
  y?: number;
  lnSpcPts?: number;
  sz?: number;
  typeface?: string;
}): string {
  const bodyPr =
    anchor === undefined
      ? '<a:bodyPr wrap="square">'
      : `<a:bodyPr wrap="square" anchor="${anchor}">`;
  const lnSpc =
    lnSpcPts === undefined
      ? ""
      : `<a:lnSpc><a:spcPts val="${lnSpcPts}"/></a:lnSpc>`;
  const rPr =
    sz === undefined
      ? "<a:rPr/>"
      : `<a:rPr sz="${sz}"><a:latin typeface="${typeface}"/></a:rPr>`;
  return (
    `<p:sp><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="1000" cy="1000"/></a:xfrm></p:spPr>` +
    `<p:txBody>${bodyPr}<a:noAutofit/></a:bodyPr><a:lstStyle/>` +
    `<a:p><a:pPr>${lnSpc}</a:pPr><a:r>${rPr}<a:t>Hi</a:t></a:r></a:p></p:txBody></p:sp>`
  );
}

function expectedBaselineShift(
  anchor: "t" | "ctr" | "b",
  size: number,
  lineHeight: number,
  metrics: FontMetrics,
): number {
  const spacing = Math.min(1, lineHeight / (1.2 * size));
  const leading = (size * (metrics.ascent - metrics.descent)) / 2;
  const shiftPt =
    anchor === "ctr"
      ? leading - 0.36 * size * spacing
      : anchor === "b"
        ? leading - lineHeight / 2 + 0.24 * size * spacing
        : leading + lineHeight / 2 - 0.96 * size * spacing;
  return Math.round(shiftPt * EMU_PER_POINT);
}

describe("alignFirstBaselines", () => {
  const metrics: Record<string, FontMetrics> = {
    Inter: { ascent: 0.96875, descent: 0.2421875 },
  };

  it("shifts y for the default (top) anchor by the measured leading/pitch offset", () => {
    const shape = baselineShape({ lnSpcPts: 4200, sz: 4000 });
    const expectedShift = expectedBaselineShift("t", 40, 42, metrics.Inter);

    const result = alignFirstBaselines(shape, metrics);

    expect(result).toContain(
      `<a:off x="812597" y="${984_861 + expectedShift}"/>`,
    );
  });

  it("shifts y for a center anchor by the measured leading/pitch offset", () => {
    const shape = baselineShape({ anchor: "ctr", lnSpcPts: 4200, sz: 4000 });
    const expectedShift = expectedBaselineShift("ctr", 40, 42, metrics.Inter);

    const result = alignFirstBaselines(shape, metrics);

    expect(result).toContain(
      `<a:off x="812597" y="${984_861 + expectedShift}"/>`,
    );
  });

  it("shifts y for a bottom anchor by the measured leading/pitch offset", () => {
    const shape = baselineShape({ anchor: "b", lnSpcPts: 4200, sz: 4000 });
    const expectedShift = expectedBaselineShift("b", 40, 42, metrics.Inter);

    const result = alignFirstBaselines(shape, metrics);

    expect(result).toContain(
      `<a:off x="812597" y="${984_861 + expectedShift}"/>`,
    );
  });

  it("leaves the shape unchanged for a typeface with no known metrics", () => {
    const shape = baselineShape({
      lnSpcPts: 4200,
      sz: 4000,
      typeface: "Comic Sans MS",
    });

    expect(alignFirstBaselines(shape, metrics)).toBe(shape);
  });

  it("leaves the shape unchanged when the paragraph has no exact line spacing", () => {
    const shape = baselineShape({ sz: 4000 });

    expect(alignFirstBaselines(shape, metrics)).toBe(shape);
  });
});

function roundRectShape({
  cx,
  cy,
  adjust,
  prst = "roundRect",
  includeTxBody = true,
  inset = 0,
}: {
  cx: number;
  cy: number;
  adjust: number;
  prst?: string;
  includeTxBody?: boolean;
  inset?: number;
}): string {
  const geom =
    prst === "roundRect"
      ? `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${adjust}"/></a:avLst></a:prstGeom>`
      : `<a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>`;
  const txBody = includeTxBody
    ? `<p:txBody><a:bodyPr lIns="${inset}" tIns="${inset}" rIns="${inset}" bIns="${inset}" wrap="square"><a:noAutofit/></a:bodyPr><a:lstStyle/><a:p><a:r><a:t>Card</a:t></a:r></a:p></p:txBody>`
    : "";
  return (
    `<p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `${geom}<a:noFill/><a:ln/></p:spPr>${txBody}</p:sp>`
  );
}

describe("compensateRoundRectTextInsets", () => {
  it("subtracts the measured text inset from every side, pinning the exact rounding", () => {
    const shape = roundRectShape({
      adjust: 8032,
      cx: 1_948_100,
      cy: 1_580_755,
      inset: 177_756,
    });

    const result = compensateRoundRectTextInsets(shape);

    for (const side of ["lIns", "tIns", "rIns", "bIns"]) {
      expect(result).toContain(`${side}="140569"`);
    }
  });

  it("computes a pill's inset at the top of the roundRect adjust range (adj=50000)", () => {
    const shape = roundRectShape({
      adjust: 50_000,
      cx: 200_000,
      cy: 200_000,
      inset: 50_000,
    });

    const result = compensateRoundRectTextInsets(shape);

    expect(result).toContain('lIns="20711"');
  });

  it("clamps an adjust value above 50000 instead of over-subtracting", () => {
    const shape = roundRectShape({
      adjust: 75_000,
      cx: 200_000,
      cy: 200_000,
      inset: 50_000,
    });

    const result = compensateRoundRectTextInsets(shape);

    expect(result).toContain('lIns="20711"');
  });

  it("floors an inset smaller than the computed compensation at 0", () => {
    const shape = roundRectShape({
      adjust: 50_000,
      cx: 200_000,
      cy: 200_000,
      inset: 10_000,
    });

    const result = compensateRoundRectTextInsets(shape);

    expect(result).toContain('lIns="0"');
  });

  it("leaves a plain rect untouched", () => {
    const shape = roundRectShape({
      adjust: 8032,
      cx: 1_948_100,
      cy: 1_580_755,
      prst: "rect",
    });

    expect(compensateRoundRectTextInsets(shape)).toBe(shape);
  });

  it("leaves a roundRect with no text body untouched", () => {
    const shape = roundRectShape({
      adjust: 8032,
      cx: 1_948_100,
      cy: 1_580_755,
      includeTxBody: false,
    });

    expect(compensateRoundRectTextInsets(shape)).toBe(shape);
  });
});

describe("retargetSlideXmlForGoogleSlides", () => {
  const metrics: Record<string, FontMetrics> = {
    Inter: { ascent: 0.96875, descent: 0.2421875 },
  };

  it("converts wrap marks, tracking-driven width, line spacing and baseline together", () => {
    const cx = 10_563_758;
    const y = 984_861;
    const shape = textBoxShape({
      algn: "l",
      bodyXml: textRun(`Hello ${WRAP_MARK}World`, -160),
      cx,
      y,
    });

    const result = retargetSlideXmlForGoogleSlides(shape, metrics);

    expect(result).toContain("<a:br>");
    expect(result).not.toContain(WRAP_MARK);
    expect(Number(result.match(/<a:ext cx="(\d+)" cy="\d+"\/>/)?.[1])).toBe(
      cx + expectedGrowth(8, cx),
    );
    expect(result).toContain('<a:spcPct val="87501"/>');
    const expectedShift = expectedBaselineShift(
      "t",
      3999 / 100,
      4199 / 100,
      metrics.Inter,
    );
    expect(result).toContain(`<a:off x="812597" y="${y + expectedShift}"/>`);
  });

  it("still converts spacing and width without font metrics, but leaves y unshifted", () => {
    const y = 984_861;
    const shape = textBoxShape({
      algn: "l",
      bodyXml: textRun(`Hello ${WRAP_MARK}World`, -160),
      y,
    });

    const result = retargetSlideXmlForGoogleSlides(shape);

    expect(result).toContain('<a:spcPct val="87501"/>');
    expect(result).toContain(`<a:off x="812597" y="${y}"/>`);
  });
});
