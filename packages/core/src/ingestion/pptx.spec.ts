import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { parsePptxPresentation, parsePptxSlideMetadata } from "./pptx.js";

describe("parsePptxSlideMetadata", () => {
  it.each([
    ["p:fade", "fade"],
    ["p:zoom", "zoom"],
    ["p:push", "slide"],
    ["p:wipe", "slide"],
    ["p:split", "slide"],
    ["p:cut", "instant"],
  ] as const)("maps %s transitions into %s", (transitionTag, expected) => {
    expect(
      parsePptxSlideMetadata({
        "p:sld": {
          "p:transition": {
            [transitionTag]: {},
          },
        },
      }),
    ).toEqual({ transition: expected });
  });

  it("marks click-driven paragraph ranges as splitByParagraph", () => {
    expect(
      parsePptxSlideMetadata({
        "p:sld": {
          "p:timing": {
            "p:tnLst": {
              "p:par": {
                "p:cTn": {
                  "@_nodeType": "clickEffect",
                  "p:childTnLst": {
                    "p:par": [
                      {
                        "p:cTn": {
                          "p:tgtEl": {
                            "p:spTgt": {
                              "p:txEl": {
                                "p:pRg": {
                                  "@_st": "0",
                                  "@_end": "0",
                                },
                              },
                            },
                          },
                        },
                      },
                      {
                        "p:cTn": {
                          "p:tgtEl": {
                            "p:spTgt": {
                              "p:txEl": {
                                "p:pRg": {
                                  "@_st": "1",
                                  "@_end": "1",
                                },
                              },
                            },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      }),
    ).toEqual({ splitByParagraph: true });
  });

  it("ignores a single clicked paragraph range", () => {
    expect(
      parsePptxSlideMetadata({
        "p:sld": {
          "p:timing": {
            "p:tnLst": {
              "p:par": {
                "p:cTn": {
                  "@_nodeType": "clickEffect",
                  "p:tgtEl": {
                    "p:spTgt": {
                      "p:txEl": {
                        "p:pRg": {
                          "@_st": "0",
                          "@_end": "0",
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    ).toEqual({});
  });
});

describe("parsePptxPresentation", () => {
  it("preserves paragraph boundaries between a:p elements", async () => {
    const presentation = await parsePptxPresentation(
      await buildMinimalPptxBuffer(`
        <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
        <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld>
            <p:spTree>
              <p:sp>
                <p:nvSpPr>
                  <p:cNvPr id="2" name="Body"/>
                  <p:cNvSpPr/>
                  <p:nvPr/>
                </p:nvSpPr>
                <p:spPr/>
                <p:txBody>
                  <a:bodyPr/>
                  <a:lstStyle/>
                  <a:p>
                    <a:r>
                      <a:t>First</a:t>
                    </a:r>
                  </a:p>
                  <a:p>
                    <a:r>
                      <a:t>Second</a:t>
                    </a:r>
                  </a:p>
                </p:txBody>
              </p:sp>
              <p:sp>
                <p:nvSpPr>
                  <p:cNvPr id="3" name="Second shape"/>
                  <p:cNvSpPr/>
                  <p:nvPr/>
                </p:nvSpPr>
                <p:spPr/>
                <p:txBody>
                  <a:bodyPr/>
                  <a:lstStyle/>
                  <a:p>
                    <a:r>
                      <a:t>Third shape</a:t>
                    </a:r>
                  </a:p>
                </p:txBody>
              </p:sp>
            </p:spTree>
          </p:cSld>
        </p:sld>
      `),
    );

    expect(presentation.slides[0]?.texts.map((run) => run.content)).toEqual([
      "First",
      "\n",
      "Second",
      "\n",
      "Third shape",
    ]);
  });

  it("preserves spaces at run boundaries", async () => {
    const presentation = await parsePptxPresentation(
      await buildMinimalPptxBuffer(`
        <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld><p:spTree>
            <p:sp>
              <p:nvSpPr><p:cNvPr id="2" name="Body"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
              <p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>
                <a:p><a:r><a:t>before </a:t></a:r><a:r><a:t>after</a:t></a:r></a:p>
              </p:txBody>
            </p:sp>
          </p:spTree></p:cSld>
        </p:sld>
      `),
    );

    expect(presentation.slides[0]?.texts.map((run) => run.content)).toEqual([
      "before ",
      "after",
    ]);
  });

  it("applies a schemeClr's lumMod transform instead of returning the raw theme color", async () => {
    const presentation = await parsePptxPresentation(
      await buildPptxBufferWithMaster(`
        <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld><p:spTree>
            <p:sp>
              <p:nvSpPr><p:cNvPr id="2" name="Body"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
              <p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>
                <a:p><a:r>
                  <a:rPr><a:solidFill><a:schemeClr val="accent1"><a:lumMod val="50000"/></a:schemeClr></a:solidFill></a:rPr>
                  <a:t>Darker accent</a:t>
                </a:r></a:p>
              </p:txBody>
            </p:sp>
          </p:spTree></p:cSld>
        </p:sld>
      `),
    );

    expect(presentation.slides[0]?.texts[0]?.color).toBe("#19334d");
  });

  it("resolves a nested bullet level's own master color instead of reusing level 1's", async () => {
    const presentation = await parsePptxPresentation(
      await buildPptxBufferWithMaster(`
        <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld><p:spTree>
            <p:sp>
              <p:nvSpPr><p:cNvPr id="2" name="Body"/><p:cNvSpPr/><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr>
              <p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>
                <a:p><a:r><a:t>Level one</a:t></a:r></a:p>
                <a:p><a:pPr lvl="1"/><a:r><a:t>Level two</a:t></a:r></a:p>
              </p:txBody>
            </p:sp>
          </p:spTree></p:cSld>
        </p:sld>
      `),
    );

    const texts = presentation.slides[0]?.texts ?? [];
    const levelOne = texts.find((run) => run.content === "Level one");
    const levelTwo = texts.find((run) => run.content === "Level two");
    expect(levelOne?.color).toBe("#111111");
    expect(levelTwo?.color).toBe("#222222");
  });

  it("resolves each slide's schemeClr against its own layout's master/theme, not the deck's first master", async () => {
    const slideXml = (label: string) =>
      `
      <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:cSld><p:spTree>
          <p:sp>
            <p:nvSpPr><p:cNvPr id="2" name="Body"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
            <p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>
              <a:p><a:r>
                <a:rPr><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:rPr>
                <a:t>${label}</a:t>
              </a:r></a:p>
            </p:txBody>
          </p:sp>
        </p:spTree></p:cSld>
      </p:sld>
    `.trim();

    const presentation = await parsePptxPresentation(
      await buildPptxBufferWithTwoMasters(
        slideXml("First"),
        slideXml("Second"),
      ),
    );

    const firstText = presentation.slides[0]?.texts.find(
      (run) => run.content === "First",
    );
    const secondText = presentation.slides[1]?.texts.find(
      (run) => run.content === "Second",
    );
    expect(firstText?.color).toBe("#111111");
    expect(secondText?.color).toBe("#222222");
  });

  it("inherits a title run's color from the master's own title placeholder shape, not the master's generic txStyles boilerplate", async () => {
    // Reproduces a real Google Slides export: the title run has no rPr
    // solidFill at all, the layout has no placeholder shapes (blank custom
    // layout), and the master's <p:txStyles><p:titleStyle> is a black
    // boilerplate stub — the real default (white) lives on the master's own
    // <p:sp><p:ph type="title"> shape's <a:lstStyle>, which must win.
    const slideXml = `
      <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:cSld><p:spTree>
          <p:sp>
            <p:nvSpPr><p:cNvPr id="337" name="Title"/><p:cNvSpPr txBox="1"/>
              <p:nvPr><p:ph idx="4294967295" type="title"/></p:nvPr>
            </p:nvSpPr>
            <p:spPr/>
            <p:txBody><a:bodyPr/><a:lstStyle/>
              <a:p>
                <a:pPr lvl="0"/>
                <a:r><a:rPr lang="en" sz="3900"/><a:t>The Path Forward</a:t></a:r>
                <a:endParaRPr sz="3900"><a:solidFill><a:srgbClr val="28E2FA"/></a:solidFill></a:endParaRPr>
              </a:p>
            </p:txBody>
          </p:sp>
        </p:spTree></p:cSld>
      </p:sld>
    `.trim();

    const presentation = await parsePptxPresentation(
      await buildPptxBufferWithLayoutAndMaster(slideXml),
    );

    const run = presentation.slides[0]?.texts.find(
      (text) => text.content === "The Path Forward",
    );
    // Not black (the txStyles boilerplate) and not the endParaRPr's cursor
    // color (#28E2FA) — the master placeholder shape's own white default.
    expect(run?.color).toBe("#FFFFFF");
  });

  it("keeps a run's own explicit color instead of overriding it with the inherited placeholder default", async () => {
    const slideXml = `
      <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:cSld><p:spTree>
          <p:sp>
            <p:nvSpPr><p:cNvPr id="337" name="Title"/><p:cNvSpPr txBox="1"/>
              <p:nvPr><p:ph idx="4294967295" type="title"/></p:nvPr>
            </p:nvSpPr>
            <p:spPr/>
            <p:txBody><a:bodyPr/><a:lstStyle/>
              <a:p>
                <a:pPr lvl="0"/>
                <a:r><a:rPr lang="en" sz="3900"><a:solidFill><a:srgbClr val="112233"/></a:solidFill></a:rPr><a:t>Explicit color</a:t></a:r>
              </a:p>
            </p:txBody>
          </p:sp>
        </p:spTree></p:cSld>
      </p:sld>
    `.trim();

    const presentation = await parsePptxPresentation(
      await buildPptxBufferWithLayoutAndMaster(slideXml),
    );

    const run = presentation.slides[0]?.texts.find(
      (text) => text.content === "Explicit color",
    );
    expect(run?.color).toBe("#112233");
  });

  it("converts a graphicFrame table into a table element with rows/cells and merges instead of dropping it", async () => {
    const presentation = await parsePptxPresentation(
      await buildMinimalPptxBuffer(`
        <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld><p:spTree>
            <p:graphicFrame>
              <p:nvGraphicFramePr><p:cNvPr id="20" name="Table 1"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
              <p:xfrm><a:off x="100" y="200"/><a:ext cx="4000" cy="2000"/></p:xfrm>
              <a:graphic>
                  <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
                    <a:tbl>
                    <a:tblGrid><a:gridCol w="1500"/><a:gridCol w="2500"/></a:tblGrid>
                    <a:tr h="1000">
                      <a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>A1</a:t></a:r></a:p></a:txBody></a:tc>
                      <a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>B1</a:t></a:r></a:p></a:txBody></a:tc>
                    </a:tr>
                    <a:tr h="1000">
                      <a:tc gridSpan="2"><a:txBody><a:bodyPr/><a:p><a:r><a:t>Merged</a:t></a:r></a:p></a:txBody></a:tc>
                      <a:tc hMerge="true"><a:txBody/></a:tc>
                    </a:tr>
                  </a:tbl>
                </a:graphicData>
              </a:graphic>
            </p:graphicFrame>
          </p:spTree></p:cSld>
        </p:sld>
      `),
    );

    const element = presentation.slides[0]?.elements[0];
    expect(element?.kind).toBe("table");
    expect(element?.x).toBe(100);
    expect(element?.y).toBe(200);
    expect(element?.width).toBe(4000);
    expect(element?.height).toBe(2000);
    expect(element?.table?.rows).toHaveLength(2);
    expect(
      element?.table?.rows[0].map(
        (cell) => cell.paragraphs[0]?.runs[0]?.content,
      ),
    ).toEqual(["A1", "B1"]);
    // The hMerge continuation cell is dropped — its content is already
    // represented by the spanning cell's colSpan.
    expect(element?.table?.rows[1]).toHaveLength(1);
    expect(element?.table?.rows[1][0]?.colSpan).toBe(2);
    expect(element?.table?.rows[1][0]?.paragraphs[0]?.runs[0]?.content).toBe(
      "Merged",
    );
    expect(element?.table?.columnWidthsEmu).toEqual([1500, 2500]);
    expect(element?.table?.rowHeightsEmu).toEqual([1000, 1000]);
    expect(presentation.slides[0]?.tablesDegraded).toBeUndefined();
  });

  it("counts a non-table graphicFrame (chart/SmartArt/OLE) as a fidelity signal instead of silently dropping it", async () => {
    const presentation = await parsePptxPresentation(
      await buildMinimalPptxBuffer(`
        <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld><p:spTree>
            <p:graphicFrame>
              <p:nvGraphicFramePr><p:cNvPr id="21" name="Chart 1"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
              <p:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></p:xfrm>
              <a:graphic>
                <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
                  <c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId1"/>
                </a:graphicData>
              </a:graphic>
            </p:graphicFrame>
          </p:spTree></p:cSld>
        </p:sld>
      `),
    );

    expect(presentation.slides[0]?.elements).toHaveLength(0);
    expect(presentation.slides[0]?.tablesDegraded).toBe(1);
  });

  it("keeps every gradient stop instead of collapsing the fill to its first color", async () => {
    const presentation = await parsePptxPresentation(
      await buildMinimalPptxBuffer(`
        <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld><p:spTree>
            <p:sp>
              <p:nvSpPr><p:cNvPr id="2" name="Grad"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
              <p:spPr>
                <a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm>
                <a:gradFill>
                  <a:gsLst>
                    <a:gs pos="0"><a:srgbClr val="112233"/></a:gs>
                    <a:gs pos="100000"><a:srgbClr val="445566"/></a:gs>
                  </a:gsLst>
                </a:gradFill>
              </p:spPr>
            </p:sp>
          </p:spTree></p:cSld>
        </p:sld>
      `),
    );

    const element = presentation.slides[0]?.elements[0];
    expect(element?.kind).toBe("shape");
    expect(element?.fill).toBe(
      "linear-gradient(180deg, #112233 0%, #445566 100%)",
    );
  });

  it("reads a:alpha and encodes it as trailing hex alpha digits on the resolved color", async () => {
    const presentation = await parsePptxPresentation(
      await buildMinimalPptxBuffer(`
        <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld><p:spTree>
            <p:sp>
              <p:nvSpPr><p:cNvPr id="2" name="Body"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
              <p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>
                <a:p><a:r>
                  <a:rPr><a:solidFill><a:srgbClr val="ff0000"><a:alpha val="50000"/></a:srgbClr></a:solidFill></a:rPr>
                  <a:t>Half opaque</a:t>
                </a:r></a:p>
              </p:txBody>
            </p:sp>
          </p:spTree></p:cSld>
        </p:sld>
      `),
    );

    expect(presentation.slides[0]?.texts[0]?.color).toBe("#ff000080");
  });

  it("synthesizes sequential bullet numbers for buAutoNum paragraphs instead of dropping them", async () => {
    const presentation = await parsePptxPresentation(
      await buildMinimalPptxBuffer(`
        <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld><p:spTree>
            <p:sp>
              <p:nvSpPr><p:cNvPr id="2" name="Body"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
              <p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>
                <a:p><a:pPr><a:buAutoNum type="arabicPeriod"/></a:pPr><a:r><a:t>First</a:t></a:r></a:p>
                <a:p><a:pPr><a:buAutoNum type="arabicPeriod"/></a:pPr><a:r><a:t>Second</a:t></a:r></a:p>
              </p:txBody>
            </p:sp>
          </p:spTree></p:cSld>
        </p:sld>
      `),
    );

    const paragraphs = presentation.slides[0]?.elements[0]?.paragraphs ?? [];
    expect(paragraphs.map((p) => p.bulletChar)).toEqual(["1.", "2."]);
  });

  it("sweeps a rotated group's child position around the group's own pivot instead of only spinning it in place", async () => {
    const presentation = await parsePptxPresentation(
      await buildMinimalPptxBuffer(`
        <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld><p:spTree>
            <p:grpSp>
              <p:nvGrpSpPr><p:cNvPr id="10" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
              <p:grpSpPr>
                <a:xfrm rot="5400000">
                  <a:off x="0" y="0"/>
                  <a:ext cx="200" cy="100"/>
                  <a:chOff x="0" y="0"/>
                  <a:chExt cx="200" cy="100"/>
                </a:xfrm>
              </p:grpSpPr>
              <p:sp>
                <p:nvSpPr><p:cNvPr id="11" name="Child"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
                <p:spPr>
                  <a:xfrm><a:off x="0" y="0"/><a:ext cx="50" cy="20"/></a:xfrm>
                  <a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>
                </p:spPr>
              </p:sp>
            </p:grpSp>
          </p:spTree></p:cSld>
        </p:sld>
      `),
    );

    const element = presentation.slides[0]?.elements[0];
    // Group box is 200x100 at the origin (pivot at 100,50), rotated 90°
    // clockwise. The child's own un-rotated center (25,10) is 75 left and 40
    // above the pivot; swept 90° clockwise it lands 40 right and 75 above the
    // pivot — center (140,-25) — not just spun in place around its own
    // center (which is what summing rotation degrees alone would produce).
    expect(element?.x).toBeCloseTo(115, 5);
    expect(element?.y).toBeCloseTo(-35, 5);
    expect(element?.width).toBeCloseTo(50, 5);
    expect(element?.height).toBeCloseTo(20, 5);
    expect(element?.rotation).toBeCloseTo(90, 5);
  });

  it("scales a connector/line shape's own width by the enclosing group's chExt-to-ext ratio instead of leaving it at its unscaled child-space size", async () => {
    // `a:chExt` (like `a:ext`) carries `cx`/`cy` attributes, not `x`/`y`.
    // Reading it with the `x`/`y` point reader silently produced a 0 child
    // extent, which fell back to an identity scale for every group whose
    // placed size (`a:ext`) differs from its child coordinate space
    // (`a:chExt`) — most visibly on a `p:cxnSp` connector/divider line,
    // whose width came out at its full unscaled child-space size and
    // overflowed the slide canvas.
    const presentation = await parsePptxPresentation(
      await buildMinimalPptxBuffer(`
        <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld><p:spTree>
            <p:grpSp>
              <p:nvGrpSpPr><p:cNvPr id="10" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
              <p:grpSpPr>
                <a:xfrm>
                  <a:off x="100" y="0"/>
                  <a:ext cx="400" cy="200"/>
                  <a:chOff x="0" y="0"/>
                  <a:chExt cx="500" cy="200"/>
                </a:xfrm>
              </p:grpSpPr>
              <p:cxnSp>
                <p:nvCxnSpPr><p:cNvPr id="11" name="Divider"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>
                <p:spPr>
                  <a:xfrm><a:off x="0" y="100"/><a:ext cx="500" cy="0"/></a:xfrm>
                  <a:ln><a:solidFill><a:srgbClr val="222222"/></a:solidFill></a:ln>
                </p:spPr>
              </p:cxnSp>
            </p:grpSp>
          </p:spTree></p:cSld>
        </p:sld>
      `),
    );

    const element = presentation.slides[0]?.elements[0];
    // Group scales child-space (500x200) down to its placed size (400x200):
    // scaleX 0.8, scaleY 1. The connector's own child-space width (500) must
    // scale by 0.8 to 400 — not pass through unscaled.
    expect(element?.x).toBeCloseTo(100, 5);
    expect(element?.width).toBeCloseTo(400, 5);
    expect(element?.height).toBeCloseTo(0, 5);
  });

  it("normalizes an absolute-point line spacing (a:spcPts) into a font-size-relative ratio instead of leaving it as a raw point count", async () => {
    // Our own PPTX export writes absolute-point line spacing (dom-to-pptx's
    // spcPts), so re-importing an exported deck hits this exact shape: a
    // 52pt line spacing on 52pt text is single spacing (ratio ~1), not a
    // ~52x line-height that would push the paragraph thousands of px off
    // the slide.
    const presentation = await parsePptxPresentation(
      await buildMinimalPptxBuffer(`
        <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld><p:spTree>
            <p:sp>
              <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
              <p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>
                <a:p>
                  <a:pPr><a:lnSpc><a:spcPts val="5200"/></a:lnSpc></a:pPr>
                  <a:r><a:rPr sz="5200"/><a:t>Title</a:t></a:r>
                </a:p>
              </p:txBody>
            </p:sp>
          </p:spTree></p:cSld>
        </p:sld>
      `),
    );

    const paragraph = presentation.slides[0]?.elements[0]?.paragraphs?.[0];
    expect(paragraph?.lineSpacing).toBeCloseTo(1, 5);
  });

  it("resolves a percent line spacing (a:spcPct) against single line spacing, not the em size", async () => {
    const presentation = await parsePptxPresentation(
      await buildMinimalPptxBuffer(`
        <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld><p:spTree>
            <p:sp>
              <p:nvSpPr><p:cNvPr id="2" name="Body"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
              <p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>
                <a:p>
                  <a:pPr><a:lnSpc><a:spcPct val="150000"/></a:lnSpc></a:pPr>
                  <a:r><a:rPr sz="1800"/><a:t>Body</a:t></a:r>
                </a:p>
              </p:txBody>
            </p:sp>
          </p:spTree></p:cSld>
        </p:sld>
      `),
    );

    const paragraph = presentation.slides[0]?.elements[0]?.paragraphs?.[0];
    // 150% of the font's own line height (~1.2em), not 1.5em.
    expect(paragraph?.lineSpacing).toBeCloseTo(1.8, 5);
  });

  it("clamps an implausibly tight spcPts/font-size ratio instead of rendering overlapping lines", async () => {
    // Real repro from a round-tripped export: our own export wrote
    // spcPts="989" (9.89pt) on 57.99pt title text — a ratio of ~0.17, which
    // stacks a wrapped second line almost directly on top of the first
    // instead of below it. No real deck design intends line spacing this
    // tight; this is an export measurement bug, not authored intent.
    const presentation = await parsePptxPresentation(
      await buildMinimalPptxBuffer(`
        <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld><p:spTree>
            <p:sp>
              <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
              <p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>
                <a:p>
                  <a:pPr><a:lnSpc><a:spcPts val="989"/></a:lnSpc></a:pPr>
                  <a:r><a:rPr sz="5799"/><a:t>PLG-first approach</a:t></a:r>
                </a:p>
              </p:txBody>
            </p:sp>
          </p:spTree></p:cSld>
        </p:sld>
      `),
    );

    const paragraph = presentation.slides[0]?.elements[0]?.paragraphs?.[0];
    expect(paragraph?.lineSpacing).toBeGreaterThanOrEqual(0.8);
  });

  it("divides an absolute spcPts by the renderer's default font size when the run declares none, instead of emitting the raw point count", async () => {
    // Without a declared `sz`, html-converter puts DEFAULT_PPTX_FONT_SIZE_PT
    // (18pt) on the paragraph. Falling through with the raw point count made
    // an 18pt line spacing read as an 18x ratio, clamped to the 3x ceiling —
    // a triple-height line box on text that is exactly single-spaced.
    const presentation = await parsePptxPresentation(
      await buildMinimalPptxBuffer(`
        <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld><p:spTree>
            <p:sp>
              <p:nvSpPr><p:cNvPr id="2" name="Body"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
              <p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>
                <a:p>
                  <a:pPr><a:lnSpc><a:spcPts val="1800"/></a:lnSpc></a:pPr>
                  <a:r><a:rPr/><a:t>Body</a:t></a:r>
                </a:p>
              </p:txBody>
            </p:sp>
          </p:spTree></p:cSld>
        </p:sld>
      `),
    );

    const paragraph = presentation.slides[0]?.elements[0]?.paragraphs?.[0];
    expect(paragraph?.lineSpacing).toBeCloseTo(1, 5);
  });

  it("reads a right-to-left paragraph's base direction from a:pPr/@rtl", async () => {
    const presentation = await parsePptxPresentation(
      await buildMinimalPptxBuffer(`
        <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld><p:spTree>
            <p:sp>
              <p:nvSpPr><p:cNvPr id="2" name="Body"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
              <p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>
                <a:p>
                  <a:pPr rtl="1"/>
                  <a:r><a:rPr sz="1800"/><a:t>مرحبا Builder 2026</a:t></a:r>
                </a:p>
                <a:p>
                  <a:pPr rtl="0"/>
                  <a:r><a:rPr sz="1800"/><a:t>Latin</a:t></a:r>
                </a:p>
                <a:p>
                  <a:r><a:rPr sz="1800"/><a:t>Inherited</a:t></a:r>
                </a:p>
              </p:txBody>
            </p:sp>
          </p:spTree></p:cSld>
        </p:sld>
      `),
    );

    const paragraphs = presentation.slides[0]?.elements[0]?.paragraphs;
    expect(paragraphs?.[0]?.rtl).toBe(true);
    expect(paragraphs?.[1]?.rtl).toBeUndefined();
    expect(paragraphs?.[2]?.rtl).toBeUndefined();
  });

  it("positions two placeholders missing their own xfrm at their distinct layout-defined positions instead of both landing on the same full-slide fallback box", async () => {
    const slideXml = `
      <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:cSld><p:spTree>
          <p:sp>
            <p:nvSpPr><p:cNvPr id="1" name="Title"/><p:cNvSpPr txBox="1"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
            <p:spPr/>
            <p:txBody><a:bodyPr/><a:lstStyle/>
              <a:p><a:r><a:rPr lang="en"/><a:t>Title text</a:t></a:r></a:p>
            </p:txBody>
          </p:sp>
          <p:sp>
            <p:nvSpPr><p:cNvPr id="2" name="Body"/><p:cNvSpPr txBox="1"/><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr>
            <p:spPr/>
            <p:txBody><a:bodyPr/><a:lstStyle/>
              <a:p><a:r><a:rPr lang="en"/><a:t>Body text</a:t></a:r></a:p>
            </p:txBody>
          </p:sp>
        </p:spTree></p:cSld>
      </p:sld>
    `.trim();

    const presentation = await parsePptxPresentation(
      await buildPptxBufferWithLayoutPlaceholderGeometry(slideXml),
    );

    const elements = presentation.slides[0]?.elements ?? [];
    const title = elements.find(
      (element) => element.placeholderType === "title",
    );
    const body = elements.find((element) => element.placeholderType === "body");
    expect(title).toMatchObject({
      x: 500_000,
      y: 300_000,
      width: 8_000_000,
      height: 1_000_000,
    });
    expect(body).toMatchObject({
      x: 500_000,
      y: 1_600_000,
      width: 8_000_000,
      height: 4_000_000,
    });
  });

  it("falls back to a visible full-slide box, not 0×0, when a placeholder has no geometry anywhere in the slide/layout/master chain", async () => {
    const slideXml = `
      <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:cSld><p:spTree>
          <p:sp>
            <p:nvSpPr><p:cNvPr id="337" name="Title"/><p:cNvSpPr txBox="1"/>
              <p:nvPr><p:ph idx="4294967295" type="title"/></p:nvPr>
            </p:nvSpPr>
            <p:spPr/>
            <p:txBody><a:bodyPr/><a:lstStyle/>
              <a:p><a:r><a:rPr lang="en"/><a:t>The Path Forward</a:t></a:r></a:p>
            </p:txBody>
          </p:sp>
        </p:spTree></p:cSld>
      </p:sld>
    `.trim();

    const presentation = await parsePptxPresentation(
      await buildPptxBufferWithLayoutAndMaster(slideXml),
    );

    const title = presentation.slides[0]?.elements.find(
      (element) => element.placeholderType === "title",
    );
    expect(title?.width).toBeGreaterThan(0);
    expect(title?.height).toBeGreaterThan(0);
    expect(title).toMatchObject({
      x: 0,
      y: 0,
      width: 12_192_000,
      height: 6_858_000,
    });
  });

  it("inherits the master's gradient background when neither slide nor layout declares one", async () => {
    const presentation = await parsePptxPresentation(
      await buildPptxBufferWithParts({
        slides: [textSlideXml("Great Idea!")],
        master: masterXml({
          background: `<p:bg><p:bgPr><a:gradFill><a:gsLst>
            <a:gs pos="0"><a:srgbClr val="013445"/></a:gs>
            <a:gs pos="100000"><a:srgbClr val="018589"/></a:gs>
          </a:gsLst><a:path path="circle"><a:fillToRect b="100%" l="0%" r="100%" t="0%"/></a:path></a:gradFill></p:bgPr></p:bg>`,
        }),
      }),
    );

    expect(presentation.slides[0]?.backgroundColor).toBe(
      "radial-gradient(circle at 0% 0%, #013445 0%, #018589 100%)",
    );
  });

  it("prefers the layout's own background over the master's, and the slide's over both", async () => {
    const master = masterXml({
      background: `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="9CCB5A"/></a:solidFill></p:bgPr></p:bg>`,
    });
    const layout = layoutXml({
      background: `<p:bg><p:bgPr><a:gradFill><a:gsLst>
        <a:gs pos="0"><a:srgbClr val="038DAF"/></a:gs>
        <a:gs pos="100000"><a:srgbClr val="57308B"/></a:gs>
      </a:gsLst><a:lin ang="13500000"/></a:gradFill></p:bgPr></p:bg>`,
    });

    const inherited = await parsePptxPresentation(
      await buildPptxBufferWithParts({
        slides: [textSlideXml("Layout background")],
        master,
        layout,
      }),
    );
    expect(inherited.slides[0]?.backgroundColor).toBe(
      "linear-gradient(315deg, #038DAF 0%, #57308B 100%)",
    );

    const own = await parsePptxPresentation(
      await buildPptxBufferWithParts({
        slides: [
          textSlideXml("Own background", {
            background: `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="242424"/></a:solidFill></p:bgPr></p:bg>`,
          }),
        ],
        master,
        layout,
      }),
    );
    expect(own.slides[0]?.backgroundColor).toBe("#242424");
  });

  it("renders the layout's and master's own non-placeholder shapes behind the slide's, honouring showMasterSp", async () => {
    const master = masterXml({
      shapes: `<p:sp>
        <p:nvSpPr><p:cNvPr id="85" name="Master band"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="400000"/></a:xfrm>
          <a:solidFill><a:srgbClr val="013445"/></a:solidFill></p:spPr>
      </p:sp>`,
    });
    const layout = layoutXml({
      shapes: `<p:sp>
        <p:nvSpPr><p:cNvPr id="86" name="Layout band"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="0" y="6458000"/><a:ext cx="12192000" cy="400000"/></a:xfrm>
          <a:solidFill><a:srgbClr val="00FFFF"/></a:solidFill></p:spPr>
      </p:sp>`,
    });

    const withMaster = await parsePptxPresentation(
      await buildPptxBufferWithParts({
        slides: [textSlideXml("Great Idea!")],
        master,
        layout,
      }),
    );
    expect(withMaster.slides[0]?.elements.map((element) => element.id)).toEqual(
      ["master-85", "layout-86", "2"],
    );
    expect(withMaster.slides[0]?.elements[0]?.fill).toBe("#013445");

    const hidingMaster = await parsePptxPresentation(
      await buildPptxBufferWithParts({
        slides: [textSlideXml("Great Idea!")],
        master,
        layout: layoutXml({
          shapes: `<p:sp>
            <p:nvSpPr><p:cNvPr id="86" name="Layout band"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
            <p:spPr><a:xfrm><a:off x="0" y="6458000"/><a:ext cx="12192000" cy="400000"/></a:xfrm>
              <a:solidFill><a:srgbClr val="00FFFF"/></a:solidFill></p:spPr>
          </p:sp>`,
          attributes: ` showMasterSp="0"`,
        }),
      }),
    );
    expect(
      hidingMaster.slides[0]?.elements.map((element) => element.id),
    ).toEqual(["layout-86", "2"]);
  });

  it("imports a layout's own picture as a background-layer image", async () => {
    const presentation = await parsePptxPresentation(
      await buildPptxBufferWithParts({
        slides: [textSlideXml("Great Idea!")],
        layout: layoutXml({
          shapes: `<p:pic>
            <p:nvPicPr><p:cNvPr id="90" name="Brand mark"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
            <p:blipFill><a:blip r:embed="rId9"/></p:blipFill>
            <p:spPr><a:xfrm><a:off x="100" y="200"/><a:ext cx="300" cy="400"/></a:xfrm></p:spPr>
          </p:pic>`,
        }),
        layoutRels: [
          { id: "rId9", type: "image", target: "../media/image1.png" },
        ],
        files: { "ppt/media/image1.png": TINY_PNG },
      }),
    );

    expect(presentation.slides[0]?.images.map((image) => image.name)).toEqual([
      "image1.png",
    ]);
    expect(presentation.slides[0]?.elements[0]).toMatchObject({
      id: "layout-90",
      kind: "image",
    });
  });

  it("inherits size, typeface and bold from the layout placeholder's lstStyle, not just its color", async () => {
    const presentation = await parsePptxPresentation(
      await buildPptxBufferWithParts({
        slides: [titlePlaceholderSlideXml("Great Idea!", "title")],
        layout: layoutXml({
          shapes: `<p:sp>
            <p:nvSpPr><p:cNvPr id="10" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
            <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9000000" cy="1000000"/></a:xfrm></p:spPr>
            <p:txBody><a:bodyPr/><a:lstStyle>
              <a:lvl1pPr><a:defRPr sz="12800" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:latin typeface="Poppins"/></a:defRPr></a:lvl1pPr>
            </a:lstStyle></p:txBody>
          </p:sp>`,
        }),
      }),
    );

    expect(presentation.slides[0]?.texts[0]).toEqual({
      content: "Great Idea!",
      fontSize: 128,
      bold: true,
      color: "#FFFFFF",
      fontFamily: "Poppins",
    });
  });

  it("resolves a slide's ctrTitle against the master's title placeholder shape", async () => {
    const presentation = await parsePptxPresentation(
      await buildPptxBufferWithParts({
        slides: [titlePlaceholderSlideXml("HERE GOES YOUR", "ctrTitle")],
        master: masterXml({
          shapes: `<p:sp>
            <p:nvSpPr><p:cNvPr id="42" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
            <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9000000" cy="1000000"/></a:xfrm></p:spPr>
            <p:txBody><a:bodyPr/><a:lstStyle>
              <a:lvl1pPr><a:defRPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:defRPr></a:lvl1pPr>
            </a:lstStyle></p:txBody>
          </p:sp>`,
          txStyles: `<p:txStyles><p:titleStyle>
            <a:lvl1pPr><a:defRPr><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:defRPr></a:lvl1pPr>
          </p:titleStyle></p:txStyles>`,
        }),
      }),
    );

    expect(presentation.slides[0]?.texts[0]?.color).toBe("#FFFFFF");
  });

  it("reads the deck palette from the slide master's own theme, not ppt/theme/theme1.xml", async () => {
    const presentation = await parsePptxPresentation(
      await buildPptxBufferWithParts({
        slides: [textSlideXml("Great Idea!")],
      }),
    );

    // theme1.xml is the notes master's theme in every Google Slides export.
    expect(presentation.theme?.colors).toContain("#00FFFF");
    expect(presentation.theme?.colors).not.toContain("#058DC7");
  });

  it("resolves a:hlinkClick into the run's href", async () => {
    const presentation = await parsePptxPresentation(
      await buildPptxBufferWithParts({
        slides: [
          textSlideXml("Click here for edit files", {
            runProperties: `<a:rPr lang="en-GB"><a:hlinkClick r:id="rId7"/></a:rPr>`,
          }),
        ],
        slideRels: [
          {
            id: "rId7",
            type: "hyperlink",
            target: "https://example.com/edit-files",
          },
        ],
      }),
    );

    expect(presentation.slides[0]?.texts[0]?.href).toBe(
      "https://example.com/edit-files",
    );
  });

  it("substitutes a slidenum field with the slide's own number, including on a layout", async () => {
    const presentation = await parsePptxPresentation(
      await buildPptxBufferWithParts({
        slides: [
          textSlideXml("First"),
          `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
            <p:cSld><p:spTree>
              <p:sp>
                <p:nvSpPr><p:cNvPr id="3" name="Footer"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
                <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr>
                <p:txBody><a:bodyPr/><a:lstStyle/><a:p>
                  <a:fld id="{0}" type="slidenum"><a:t>&#8249;#&#8250;</a:t></a:fld>
                </a:p></p:txBody>
              </p:sp>
            </p:spTree></p:cSld>
          </p:sld>`,
        ],
        layout: layoutXml({
          shapes: `<p:sp>
            <p:nvSpPr><p:cNvPr id="70" name="Page number"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
            <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr>
            <p:txBody><a:bodyPr/><a:lstStyle/><a:p>
              <a:fld id="{1}" type="slidenum"><a:t>&#8249;#&#8250;</a:t></a:fld>
            </a:p></p:txBody>
          </p:sp>`,
        }),
      }),
    );

    const contents = presentation.slides.map((slide) =>
      slide.texts.map((run) => run.content).join("|"),
    );
    expect(contents[0]).toBe("1|\n|First");
    expect(contents[1]).toBe("2|\n|2");
  });

  it("reads spcBef/spcAft from their nested a:spcPts value", async () => {
    const presentation = await parsePptxPresentation(
      await buildMinimalPptxBuffer(`
        <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld><p:spTree>
            <p:sp>
              <p:nvSpPr><p:cNvPr id="2" name="Body"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
              <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr>
              <p:txBody><a:bodyPr/><a:lstStyle/>
                <a:p>
                  <a:pPr><a:spcBef><a:spcPts val="1600"/></a:spcBef><a:spcAft><a:spcPts val="300"/></a:spcAft></a:pPr>
                  <a:r><a:t>Highlight 1</a:t></a:r>
                </a:p>
              </p:txBody>
            </p:sp>
          </p:spTree></p:cSld>
        </p:sld>
      `),
    );

    expect(presentation.slides[0]?.elements[0]?.paragraphs?.[0]).toMatchObject({
      spaceBeforePt: 16,
      spaceAfterPt: 3,
    });
  });

  it("keeps numeric-looking text as text, leading zeros intact", async () => {
    const presentation = await parsePptxPresentation(
      await buildMinimalPptxBuffer(`
        <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld><p:spTree>
            <p:sp>
              <p:nvSpPr><p:cNvPr id="2" name="Specimen"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
              <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr>
              <p:txBody><a:bodyPr/><a:lstStyle/>
                <a:p><a:r><a:t>0123456789</a:t></a:r></a:p>
                <a:p><a:r><a:t>CMYK: 00, 00, 00, 00</a:t></a:r></a:p>
              </p:txBody>
            </p:sp>
          </p:spTree></p:cSld>
        </p:sld>
      `),
    );

    expect(presentation.slides[0]?.texts.map((run) => run.content)).toEqual([
      "0123456789",
      "\n",
      "CMYK: 00, 00, 00, 00",
    ]);
  });

  it("keeps a:br hard line breaks in document order between runs", async () => {
    const presentation = await parsePptxPresentation(
      await buildMinimalPptxBuffer(`
        <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld><p:spTree>
            <p:sp>
              <p:nvSpPr><p:cNvPr id="2" name="Heading"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
              <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr>
              <p:txBody><a:bodyPr/><a:lstStyle/>
                <a:p>
                  <a:r><a:rPr sz="2400"/><a:t>IMAGE GUIDELINES</a:t></a:r>
                  <a:br/>
                  <a:r><a:rPr sz="2400"/><a:t>FOR SOCIAL MEDIA</a:t></a:r>
                </a:p>
              </p:txBody>
            </p:sp>
          </p:spTree></p:cSld>
        </p:sld>
      `),
    );

    const runs = presentation.slides[0]?.elements[0]?.paragraphs?.[0]?.runs;
    expect(runs?.map((run) => run.content)).toEqual([
      "IMAGE GUIDELINES",
      "\n",
      "FOR SOCIAL MEDIA",
    ]);
    // The break inherits its neighbour's size, or it collapses the line it makes.
    expect(runs?.[1]?.fontSize).toBe(24);
  });

  it("sizes a table from its tblGrid instead of the graphicFrame's sentinel ext", async () => {
    const presentation = await parsePptxPresentation(
      await buildMinimalPptxBuffer(`
        <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld><p:spTree>
            <p:graphicFrame>
              <p:nvGraphicFramePr><p:cNvPr id="140" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
              <p:xfrm><a:off x="310725" y="976513"/><a:ext cx="3000000" cy="3000000"/></p:xfrm>
              <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
                <a:tbl>
                  <a:tblGrid>
                    <a:gridCol w="4000000"/>
                    <a:gridCol w="4097950"/>
                  </a:tblGrid>
                  <a:tr h="600000">
                    <a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>KPI (USA)</a:t></a:r></a:p></a:txBody></a:tc>
                    <a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>ARPPU</a:t></a:r></a:p></a:txBody></a:tc>
                  </a:tr>
                </a:tbl>
              </a:graphicData></a:graphic>
            </p:graphicFrame>
          </p:spTree></p:cSld>
        </p:sld>
      `),
    );

    expect(presentation.slides[0]?.elements[0]).toMatchObject({
      kind: "table",
      width: 8_097_950,
      height: 600_000,
    });
  });

  it("resolves cell borders from ppt/tableStyles.xml when the cells declare none of their own", async () => {
    const presentation = await parsePptxPresentation(
      await buildPptxBufferWithParts({
        slides: [tableStyleSlideXml()],
        files: { "ppt/tableStyles.xml": tableStylesXml() },
      }),
    );

    const rows = presentation.slides[0]?.elements[0]?.table?.rows;
    // Outer edges take the style's left/right/top/bottom; the rules shared
    // between two cells take insideV/insideH.
    expect(rows?.[0]?.[0]?.borders).toEqual({
      left: { color: "#111111", widthEmu: 19050 },
      right: { color: "#9E9E9E", widthEmu: 9525 },
      top: { color: "#111111", widthEmu: 19050 },
      bottom: { color: "#9E9E9E", widthEmu: 9525 },
    });
    expect(rows?.[1]?.[1]?.borders).toEqual({
      left: { color: "#9E9E9E", widthEmu: 9525 },
      right: { color: "#111111", widthEmu: 19050 },
      top: { color: "#9E9E9E", widthEmu: 9525 },
      bottom: { color: "#111111", widthEmu: 19050 },
    });
    // `firstRow="1"` opts the header row into the style's firstRow fill.
    expect(rows?.[0]?.[0]?.fill).toBe("#DDEEFF");
    expect(rows?.[1]?.[0]?.fill).toBeUndefined();
  });

  it("lets a cell's own a:lnL/R/T/B beat the table style, including an explicit noFill that draws nothing", async () => {
    const presentation = await parsePptxPresentation(
      await buildPptxBufferWithParts({
        slides: [
          tableStyleSlideXml(
            `<a:lnL w="28575"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:prstDash val="dash"/></a:lnL><a:lnB><a:noFill/></a:lnB>`,
          ),
        ],
        files: { "ppt/tableStyles.xml": tableStylesXml() },
      }),
    );

    const cell = presentation.slides[0]?.elements[0]?.table?.rows[0]?.[0];
    expect(cell?.borders?.left).toEqual({
      color: "#FFFFFF",
      widthEmu: 28575,
      dash: "dashed",
    });
    // The style's insideH rule must not come back for a side the cell
    // explicitly switched off.
    expect(cell?.borders?.bottom).toBeUndefined();
    expect(cell?.borders?.top).toEqual({ color: "#111111", widthEmu: 19050 });
  });

  it("leaves a table with no style and no cell lines borderless instead of stamping a grid on it", async () => {
    const presentation = await parsePptxPresentation(
      await buildPptxBufferWithParts({ slides: [tableStyleSlideXml()] }),
    );

    const rows = presentation.slides[0]?.elements[0]?.table?.rows;
    expect(rows?.flat().every((cell) => cell.borders === undefined)).toBe(true);
  });

  it("applies a normAutofit fontScale to the text the author let PowerPoint shrink", async () => {
    const presentation = await parsePptxPresentation(
      await buildMinimalPptxBuffer(`
        <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld><p:spTree>
            <p:sp>
              <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
              <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr>
              <p:txBody>
                <a:bodyPr><a:normAutofit fontScale="90000" lnSpcReduction="10000"/></a:bodyPr>
                <a:lstStyle/>
                <a:p>
                  <a:pPr><a:lnSpc><a:spcPct val="100000"/></a:lnSpc></a:pPr>
                  <a:r><a:rPr sz="4000"/><a:t>Overflowing title</a:t></a:r>
                </a:p>
              </p:txBody>
            </p:sp>
          </p:spTree></p:cSld>
        </p:sld>
      `),
    );

    const paragraph = presentation.slides[0]?.elements[0]?.paragraphs?.[0];
    expect(paragraph?.runs[0]?.fontSize).toBe(36);
    // 100% single spacing (1.2) reduced by the 10% PowerPoint already baked in.
    expect(paragraph?.lineSpacing).toBe(1.08);
  });

  it("skips slides the author removed from the deck flow with show=0", async () => {
    const presentation = await parsePptxPresentation(
      await buildPptxBufferWithParts({
        slides: [
          textSlideXml("Kept"),
          textSlideXml("Cut", { attributes: ` show="0"` }),
          textSlideXml("Also kept"),
        ],
      }),
    );

    expect(presentation.slides.map((slide) => slide.texts[0]?.content)).toEqual(
      ["Kept", "Also kept"],
    );
    expect(presentation.hiddenSlideCount).toBe(1);
  });

  it("fails loudly instead of importing short when a p:sldId resolves to no slide part", async () => {
    await expect(
      parsePptxPresentation(
        await buildPptxBufferWithParts({
          slides: [textSlideXml("Kept"), textSlideXml("Lost")],
          files: {
            // The deck still lists both slides, but rId2 is unresolvable — the
            // shape that used to drop a slide with no error at all.
            "ppt/_rels/presentation.xml.rels": pptxRelsXml([
              { id: "rId1", type: "slide", target: "slides/slide1.xml" },
              {
                id: "rId3",
                type: "slideMaster",
                target: "slideMasters/slideMaster1.xml",
              },
            ]),
          },
        }),
      ),
    ).rejects.toThrow(/expected 2 slides but parsed 1.*rId2/s);
  });

  it("keeps a cxnSp connector's authored id stable across imports", async () => {
    const slideXml = `
      <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:cSld><p:spTree>
          <p:cxnSp>
            <p:nvCxnSpPr><p:cNvPr id="152" name="Rule"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>
            <p:spPr>
              <a:xfrm><a:off x="0" y="0"/><a:ext cx="3959400" cy="8400"/></a:xfrm>
              <a:ln w="38100"><a:solidFill><a:srgbClr val="00FFFF"/></a:solidFill></a:ln>
            </p:spPr>
          </p:cxnSp>
        </p:spTree></p:cSld>
      </p:sld>`;
    const first = await parsePptxPresentation(
      await buildMinimalPptxBuffer(slideXml),
    );
    const second = await parsePptxPresentation(
      await buildMinimalPptxBuffer(slideXml),
    );

    expect(first.slides[0]?.elements[0]?.id).toBe("152");
    expect(second.slides[0]?.elements[0]?.id).toBe("152");
  });

  it("reads a connector's headEnd/tailEnd decorations", async () => {
    // Real `a:ln` from a chevron timeline: each rule terminates in a round dot
    // at both ends, and dropping the two `End` elements is the whole reason
    // the imported deck drew bare lines where the source has dotted ones.
    const presentation = await parsePptxPresentation(
      await buildMinimalPptxBuffer(`
        <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld><p:spTree>
            <p:cxnSp>
              <p:nvCxnSpPr><p:cNvPr id="153" name="Rule"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>
              <p:spPr>
                <a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="921775"/></a:xfrm>
                <a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom>
                <a:ln cap="flat" cmpd="sng" w="19050">
                  <a:solidFill><a:srgbClr val="3A3838"/></a:solidFill>
                  <a:headEnd len="med" w="med" type="oval"/>
                  <a:tailEnd type="triangle"/>
                </a:ln>
              </p:spPr>
            </p:cxnSp>
          </p:spTree></p:cSld>
        </p:sld>
      `),
    );

    const connector = presentation.slides[0]?.elements[0];
    expect(connector?.lineHeadEnd).toEqual({
      type: "oval",
      w: "med",
      len: "med",
    });
    expect(connector?.lineTailEnd).toEqual({ type: "triangle" });
  });

  it("reads a custGeom path's commands in document order, not grouped by tag name", async () => {
    // The command sequence is the whole shape: a tree built without
    // `preserveOrder` groups the two `a:lnTo`s together and would replay this
    // outline as move/line/line/curve, which is a different shape.
    const presentation = await parsePptxPresentation(
      await buildMinimalPptxBuffer(`
        <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld><p:spTree>
            <p:sp>
              <p:nvSpPr><p:cNvPr id="7" name="Freeform"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
              <p:spPr>
                <a:xfrm flipH="1"><a:off x="0" y="0"/><a:ext cx="4000" cy="2000"/></a:xfrm>
                <a:custGeom>
                  <a:pathLst>
                    <a:path w="200" h="100">
                      <a:moveTo><a:pt x="0" y="0"/></a:moveTo>
                      <a:lnTo><a:pt x="200" y="0"/></a:lnTo>
                      <a:cubicBezTo>
                        <a:pt x="180" y="40"/><a:pt x="120" y="80"/><a:pt x="60" y="100"/>
                      </a:cubicBezTo>
                      <a:lnTo><a:pt x="0" y="50"/></a:lnTo>
                      <a:close/>
                    </a:path>
                  </a:pathLst>
                </a:custGeom>
                <a:solidFill><a:srgbClr val="112233"/></a:solidFill>
              </p:spPr>
            </p:sp>
          </p:spTree></p:cSld>
        </p:sld>
      `),
    );

    const element = presentation.slides[0]?.elements[0];
    expect(element?.kind).toBe("shape");
    expect(element?.flipH).toBe(true);
    expect(element?.geometry?.kind).toBe("custom");
    const path = element?.geometry?.paths[0];
    expect(path?.w).toBe(200);
    expect(path?.h).toBe(100);
    expect(path?.commands.map((command) => command.kind)).toEqual([
      "moveTo",
      "lnTo",
      "cubicBezTo",
      "lnTo",
      "close",
    ]);
    expect(path?.commands[2]).toEqual({
      kind: "cubicBezTo",
      points: [
        { x: 180, y: 40 },
        { x: 120, y: 80 },
        { x: 60, y: 100 },
      ],
    });
  });

  it("drops a custGeom path it cannot fully read rather than emitting a shorter outline", async () => {
    // `x="wd2"` is a guide reference, not a number. A path missing one of its
    // segments is not a simpler shape, it is a wrong one, so the whole
    // geometry is dropped and the shape falls back to its plain box.
    const presentation = await parsePptxPresentation(
      await buildMinimalPptxBuffer(`
        <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld><p:spTree>
            <p:sp>
              <p:nvSpPr><p:cNvPr id="8" name="Freeform"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
              <p:spPr>
                <a:xfrm><a:off x="0" y="0"/><a:ext cx="4000" cy="2000"/></a:xfrm>
                <a:custGeom>
                  <a:pathLst>
                    <a:path w="200" h="100">
                      <a:moveTo><a:pt x="0" y="0"/></a:moveTo>
                      <a:lnTo><a:pt x="wd2" y="0"/></a:lnTo>
                    </a:path>
                  </a:pathLst>
                </a:custGeom>
                <a:solidFill><a:srgbClr val="112233"/></a:solidFill>
              </p:spPr>
            </p:sp>
          </p:spTree></p:cSld>
        </p:sld>
      `),
    );

    const element = presentation.slides[0]?.elements[0];
    expect(element?.kind).toBe("shape");
    expect(element?.fill).toBe("#112233");
    expect(element?.geometry).toBeUndefined();
  });

  it("records a preset's authored avLst adjustments instead of leaving the default in force", async () => {
    const presentation = await parsePptxPresentation(
      await buildMinimalPptxBuffer(`
        <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
          <p:cSld><p:spTree>
            <p:sp>
              <p:nvSpPr><p:cNvPr id="9" name="Arc"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
              <p:spPr>
                <a:xfrm><a:off x="0" y="0"/><a:ext cx="4000" cy="4000"/></a:xfrm>
                <a:prstGeom prst="blockArc">
                  <a:avLst>
                    <a:gd fmla="val 8786043" name="adj1"/>
                    <a:gd fmla="val 12102207" name="adj2"/>
                    <a:gd fmla="pin 0 adj3 50000" name="adj3"/>
                  </a:avLst>
                </a:prstGeom>
                <a:solidFill><a:srgbClr val="FECF4F"/></a:solidFill>
              </p:spPr>
            </p:sp>
          </p:spTree></p:cSld>
        </p:sld>
      `),
    );

    // The `pin` guide is a formula, not a value — reproducing it would mean
    // shipping OOXML's whole guide language, so it is left out.
    expect(presentation.slides[0]?.elements[0]?.shapeAdjustments).toEqual({
      adj1: 8786043,
      adj2: 12102207,
    });
  });

  it("keeps a picture's own frame geometry, which is what makes a portrait a circle", async () => {
    const presentation = await parsePptxPresentation(
      await buildPptxBufferWithParts({
        slides: [
          `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
            <p:cSld><p:spTree>
              <p:pic>
                <p:nvPicPr><p:cNvPr id="116" name="Portrait"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
                <p:blipFill><a:blip r:embed="rId9"/></p:blipFill>
                <p:spPr>
                  <a:xfrm><a:off x="0" y="0"/><a:ext cx="2450400" cy="2439900"/></a:xfrm>
                  <a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>
                </p:spPr>
              </p:pic>
            </p:spTree></p:cSld>
          </p:sld>`,
        ],
        slideRels: [
          { id: "rId9", type: "image", target: "../media/image1.png" },
        ],
        files: { "ppt/media/image1.png": TINY_PNG },
      }),
    );

    expect(presentation.slides[0]?.elements[0]).toMatchObject({
      kind: "image",
      shapeType: "ellipse",
    });
  });
});

/** A 1×1 transparent PNG — real bytes, so `loadPptxImage` produces a browser-renderable image. */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function textSlideXml(
  content: string,
  options: {
    attributes?: string;
    background?: string;
    runProperties?: string;
  } = {},
): string {
  return `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"${options.attributes ?? ""}>
    <p:cSld>${options.background ?? ""}<p:spTree>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Body"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100" cy="100"/></a:xfrm></p:spPr>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p>
          <a:r>${options.runProperties ?? ""}<a:t>${content}</a:t></a:r>
        </a:p></p:txBody>
      </p:sp>
    </p:spTree></p:cSld>
  </p:sld>`;
}

function titlePlaceholderSlideXml(content: string, type: string): string {
  return `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
    <p:cSld><p:spTree>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="${type}"/></p:nvPr></p:nvSpPr>
        <p:spPr/>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p>
          <a:r><a:rPr lang="en-GB"/><a:t>${content}</a:t></a:r>
        </a:p></p:txBody>
      </p:sp>
    </p:spTree></p:cSld>
  </p:sld>`;
}

function masterXml(
  options: { background?: string; shapes?: string; txStyles?: string } = {},
): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
      <p:cSld>${options.background ?? ""}<p:spTree>${options.shapes ?? ""}</p:spTree></p:cSld>
      <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
      ${options.txStyles ?? ""}
    </p:sldMaster>`;
}

function layoutXml(
  options: { background?: string; shapes?: string; attributes?: string } = {},
): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"${options.attributes ?? ""}>
      <p:cSld>${options.background ?? ""}<p:spTree>${options.shapes ?? ""}</p:spTree></p:cSld>
    </p:sldLayout>`;
}

function themeXml(name: string, accent1: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="${name}">
      <a:themeElements>
        <a:clrScheme name="${name}">
          <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
          <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
          <a:dk2><a:srgbClr val="000000"/></a:dk2>
          <a:lt2><a:srgbClr val="FFFFFF"/></a:lt2>
          <a:accent1><a:srgbClr val="${accent1}"/></a:accent1>
          <a:accent2><a:srgbClr val="013445"/></a:accent2>
          <a:accent3><a:srgbClr val="018589"/></a:accent3>
          <a:accent4><a:srgbClr val="336699"/></a:accent4>
          <a:accent5><a:srgbClr val="336699"/></a:accent5>
          <a:accent6><a:srgbClr val="336699"/></a:accent6>
          <a:hlink><a:srgbClr val="0000FF"/></a:hlink>
          <a:folHlink><a:srgbClr val="800080"/></a:folHlink>
        </a:clrScheme>
        <a:fontScheme name="${name}">
          <a:majorFont><a:latin typeface="Arial"/></a:majorFont>
          <a:minorFont><a:latin typeface="Arial"/></a:minorFont>
        </a:fontScheme>
      </a:themeElements>
    </a:theme>`;
}

/**
 * A real slide → slideLayout → slideMaster → theme package with every part
 * overridable, so a test can put a background, a decorative shape or a picture
 * on the layout/master the way a real template does. `ppt/theme/theme1.xml`
 * is deliberately a *different* palette than the master's own theme2 — that is
 * exactly the Google Slides shape where theme1 belongs to the notes master.
 */
/** A 2x2 table whose `a:tblPr` references the style in `tableStylesXml()` below — the shape a Google Slides export writes, where the cells carry no line properties at all and every rule lives in the deck's table style. */
function tableStyleSlideXml(cellProperties = ""): string {
  const cell = (text: string, properties = "") =>
    `<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></a:txBody><a:tcPr marT="91425">${properties}</a:tcPr></a:tc>`;
  return `
    <p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
      <p:cSld><p:spTree>
        <p:graphicFrame>
          <p:nvGraphicFramePr><p:cNvPr id="30" name="KPI table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
          <p:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="1200000"/></p:xfrm>
          <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
            <a:tbl>
              <a:tblPr firstRow="1"><a:noFill/><a:tableStyleId>{DDFDE955-DE5E-4019-A6DC-C6A011EEF9D1}</a:tableStyleId></a:tblPr>
              <a:tblGrid><a:gridCol w="2000000"/><a:gridCol w="2000000"/></a:tblGrid>
              <a:tr h="600000">${cell("Ret D1", cellProperties)}${cell("Ret D7")}</a:tr>
              <a:tr h="600000">${cell("41%")}${cell("18%")}</a:tr>
            </a:tbl>
          </a:graphicData></a:graphic>
        </p:graphicFrame>
      </p:spTree></p:cSld>
    </p:sld>
  `.trim();
}

/** Distinct outer (`#111111`) and interior (`#9E9E9E`) rules so a cell that mixed the two up is visible in the assertion, plus a `firstRow` header fill. */
function tableStylesXml(): string {
  const line = (color: string, width: number) =>
    `<a:ln w="${width}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:prstDash val="solid"/></a:ln>`;
  const outer = line("111111", 19050);
  const inner = line("9E9E9E", 9525);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{DDFDE955-DE5E-4019-A6DC-C6A011EEF9D1}">
      <a:tblStyle styleId="{DDFDE955-DE5E-4019-A6DC-C6A011EEF9D1}" styleName="Table_0">
        <a:wholeTbl><a:tcStyle><a:tcBdr>
          <a:left>${outer}</a:left><a:right>${outer}</a:right>
          <a:top>${outer}</a:top><a:bottom>${outer}</a:bottom>
          <a:insideH>${inner}</a:insideH><a:insideV>${inner}</a:insideV>
        </a:tcBdr></a:tcStyle></a:wholeTbl>
        <a:firstRow><a:tcStyle><a:fill><a:solidFill><a:srgbClr val="DDEEFF"/></a:solidFill></a:fill></a:tcStyle></a:firstRow>
      </a:tblStyle>
    </a:tblStyleLst>`;
}

async function buildPptxBufferWithParts(parts: {
  slides: string[];
  layout?: string;
  master?: string;
  slideRels?: { id: string; type: string; target: string }[];
  layoutRels?: { id: string; type: string; target: string }[];
  files?: Record<string, string | Buffer>;
}): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                      xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:sldIdLst>
          ${parts.slides.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`).join("\n")}
        </p:sldIdLst>
        <p:sldSz cx="12192000" cy="6858000"/>
      </p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    pptxRelsXml([
      ...parts.slides.map((_, index) => ({
        id: `rId${index + 1}`,
        type: "slide",
        target: `slides/slide${index + 1}.xml`,
      })),
      {
        id: `rId${parts.slides.length + 1}`,
        type: "slideMaster",
        target: "slideMasters/slideMaster1.xml",
      },
    ]),
  );
  zip.file("ppt/theme/theme1.xml", themeXml("Notes master", "058DC7"));
  zip.file("ppt/theme/theme2.xml", themeXml("Real template", "00FFFF"));
  zip.file("ppt/slideMasters/slideMaster1.xml", parts.master ?? masterXml());
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    pptxRelsXml([{ id: "rId1", type: "theme", target: "../theme/theme2.xml" }]),
  );
  zip.file("ppt/slideLayouts/slideLayout1.xml", parts.layout ?? layoutXml());
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    pptxRelsXml([
      {
        id: "rId1",
        type: "slideMaster",
        target: "../slideMasters/slideMaster1.xml",
      },
      ...(parts.layoutRels ?? []),
    ]),
  );
  for (const [index, slideXml] of parts.slides.entries()) {
    zip.file(`ppt/slides/slide${index + 1}.xml`, slideXml);
    zip.file(
      `ppt/slides/_rels/slide${index + 1}.xml.rels`,
      pptxRelsXml([
        {
          id: "rId1",
          type: "slideLayout",
          target: "../slideLayouts/slideLayout1.xml",
        },
        ...(parts.slideRels ?? []),
      ]),
    );
  }
  for (const [path, content] of Object.entries(parts.files ?? {})) {
    zip.file(path, content);
  }
  return zip.generateAsync({ type: "uint8array" });
}

async function buildMinimalPptxBuffer(slideXml: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                      xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:sldIdLst>
          <p:sldId id="256" r:id="rId1"/>
        </p:sldIdLst>
        <p:sldSz cx="12192000" cy="6858000"/>
      </p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1"
          Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"
          Target="slides/slide1.xml"/>
      </Relationships>`,
  );
  zip.file("ppt/slides/slide1.xml", slideXml.trim());
  return zip.generateAsync({ type: "uint8array" });
}

/** Same shape as `buildMinimalPptxBuffer`, but with a theme + slide master wired up so `schemeClr`/placeholder-default-color resolution has something real to resolve against. */
async function buildPptxBufferWithMaster(
  slideXml: string,
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                      xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:sldIdLst>
          <p:sldId id="256" r:id="rId1"/>
        </p:sldIdLst>
        <p:sldSz cx="12192000" cy="6858000"/>
      </p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1"
          Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"
          Target="slides/slide1.xml"/>
        <Relationship Id="rId2"
          Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster"
          Target="slideMasters/slideMaster1.xml"/>
      </Relationships>`,
  );
  zip.file(
    "ppt/theme/theme1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Test">
        <a:themeElements>
          <a:clrScheme name="Test">
            <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
            <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
            <a:dk2><a:srgbClr val="000000"/></a:dk2>
            <a:lt2><a:srgbClr val="FFFFFF"/></a:lt2>
            <a:accent1><a:srgbClr val="336699"/></a:accent1>
            <a:accent2><a:srgbClr val="336699"/></a:accent2>
            <a:accent3><a:srgbClr val="336699"/></a:accent3>
            <a:accent4><a:srgbClr val="336699"/></a:accent4>
            <a:accent5><a:srgbClr val="336699"/></a:accent5>
            <a:accent6><a:srgbClr val="336699"/></a:accent6>
            <a:hlink><a:srgbClr val="0000FF"/></a:hlink>
            <a:folHlink><a:srgbClr val="800080"/></a:folHlink>
          </a:clrScheme>
          <a:fontScheme name="Test">
            <a:majorFont><a:latin typeface="Arial"/></a:majorFont>
            <a:minorFont><a:latin typeface="Arial"/></a:minorFont>
          </a:fontScheme>
        </a:themeElements>
      </a:theme>`,
  );
  zip.file(
    "ppt/slideMasters/slideMaster1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:cSld><p:spTree/></p:cSld>
        <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
        <p:txStyles>
          <p:titleStyle>
            <a:lvl1pPr><a:defRPr><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:defRPr></a:lvl1pPr>
          </p:titleStyle>
          <p:bodyStyle>
            <a:lvl1pPr><a:defRPr><a:solidFill><a:srgbClr val="111111"/></a:solidFill></a:defRPr></a:lvl1pPr>
            <a:lvl2pPr><a:defRPr><a:solidFill><a:srgbClr val="222222"/></a:solidFill></a:defRPr></a:lvl2pPr>
          </p:bodyStyle>
        </p:txStyles>
      </p:sldMaster>`,
  );
  zip.file("ppt/slides/slide1.xml", slideXml.trim());
  return zip.generateAsync({ type: "uint8array" });
}

/** Two slides, each on its own layout → master → theme chain, with different `accent1` colors — reproduces a presentation combining more than one template, where the deck's first master must not leak into the second slide's color resolution. */
async function buildPptxBufferWithTwoMasters(
  slide1Xml: string,
  slide2Xml: string,
): Promise<Uint8Array> {
  const zip = new JSZip();
  const bodyStyleWithAccent1 = () => `
    <p:txStyles>
      <p:bodyStyle>
        <a:lvl1pPr><a:defRPr/></a:lvl1pPr>
      </p:bodyStyle>
    </p:txStyles>`;
  const theme = (accent1Hex: string) => `
    <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Test">
      <a:themeElements>
        <a:clrScheme name="Test">
          <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
          <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
          <a:dk2><a:srgbClr val="000000"/></a:dk2>
          <a:lt2><a:srgbClr val="FFFFFF"/></a:lt2>
          <a:accent1><a:srgbClr val="${accent1Hex}"/></a:accent1>
          <a:accent2><a:srgbClr val="${accent1Hex}"/></a:accent2>
          <a:accent3><a:srgbClr val="${accent1Hex}"/></a:accent3>
          <a:accent4><a:srgbClr val="${accent1Hex}"/></a:accent4>
          <a:accent5><a:srgbClr val="${accent1Hex}"/></a:accent5>
          <a:accent6><a:srgbClr val="${accent1Hex}"/></a:accent6>
          <a:hlink><a:srgbClr val="0000FF"/></a:hlink>
          <a:folHlink><a:srgbClr val="800080"/></a:folHlink>
        </a:clrScheme>
        <a:fontScheme name="Test">
          <a:majorFont><a:latin typeface="Arial"/></a:majorFont>
          <a:minorFont><a:latin typeface="Arial"/></a:minorFont>
        </a:fontScheme>
      </a:themeElements>
    </a:theme>`;
  const master = () => `
    <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
      <p:cSld><p:spTree/></p:cSld>
      <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
      ${bodyStyleWithAccent1()}
    </p:sldMaster>`;
  const layout = () => `
    <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
      <p:cSld><p:spTree/></p:cSld>
    </p:sldLayout>`;
  const relsXml = (entries: { id: string; type: string; target: string }[]) => `
    <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      ${entries
        .map(
          (entry) =>
            `<Relationship Id="${entry.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${entry.type}" Target="${entry.target}"/>`,
        )
        .join("\n")}
    </Relationships>`;

  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                      xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:sldIdLst>
          <p:sldId id="256" r:id="rId1"/>
          <p:sldId id="257" r:id="rId2"/>
        </p:sldIdLst>
        <p:sldSz cx="12192000" cy="6858000"/>
      </p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    relsXml([
      { id: "rId1", type: "slide", target: "slides/slide1.xml" },
      { id: "rId2", type: "slide", target: "slides/slide2.xml" },
      {
        id: "rId3",
        type: "slideMaster",
        target: "slideMasters/slideMaster1.xml",
      },
    ]),
  );
  zip.file("ppt/theme/theme1.xml", theme("111111"));
  zip.file("ppt/theme/theme2.xml", theme("222222"));
  zip.file("ppt/slideMasters/slideMaster1.xml", master());
  zip.file("ppt/slideMasters/slideMaster2.xml", master());
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    relsXml([{ id: "rId1", type: "theme", target: "../theme/theme1.xml" }]),
  );
  zip.file(
    "ppt/slideMasters/_rels/slideMaster2.xml.rels",
    relsXml([{ id: "rId1", type: "theme", target: "../theme/theme2.xml" }]),
  );
  zip.file("ppt/slideLayouts/slideLayout1.xml", layout());
  zip.file("ppt/slideLayouts/slideLayout2.xml", layout());
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    relsXml([
      {
        id: "rId1",
        type: "slideMaster",
        target: "../slideMasters/slideMaster1.xml",
      },
    ]),
  );
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout2.xml.rels",
    relsXml([
      {
        id: "rId1",
        type: "slideMaster",
        target: "../slideMasters/slideMaster2.xml",
      },
    ]),
  );
  zip.file("ppt/slides/slide1.xml", slide1Xml);
  zip.file("ppt/slides/slide2.xml", slide2Xml);
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    relsXml([
      {
        id: "rId1",
        type: "slideLayout",
        target: "../slideLayouts/slideLayout1.xml",
      },
    ]),
  );
  zip.file(
    "ppt/slides/_rels/slide2.xml.rels",
    relsXml([
      {
        id: "rId1",
        type: "slideLayout",
        target: "../slideLayouts/slideLayout2.xml",
      },
    ]),
  );
  return zip.generateAsync({ type: "uint8array" });
}

function pptxRelsXml(
  entries: { id: string; type: string; target: string }[],
): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      ${entries
        .map(
          (entry) =>
            `<Relationship Id="${entry.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${entry.type}" Target="${entry.target}"/>`,
        )
        .join("\n")}
    </Relationships>`;
}

/** A single slide → (blank) slideLayout → slideMaster → theme chain, with the master's own `<p:sp><p:ph type="title">` placeholder shape carrying a real `<a:lstStyle>` default distinct from its `<p:txStyles><p:titleStyle>` boilerplate — reproduces the real Google Slides export structure where the layout has no placeholders of its own and the master's placeholder *shape* (not its generic txStyles) is where a placeholder run's real inherited color lives. */
async function buildPptxBufferWithLayoutAndMaster(
  slideXml: string,
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                      xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:sldIdLst>
          <p:sldId id="256" r:id="rId1"/>
        </p:sldIdLst>
        <p:sldSz cx="12192000" cy="6858000"/>
      </p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    pptxRelsXml([{ id: "rId1", type: "slide", target: "slides/slide1.xml" }]),
  );
  zip.file(
    "ppt/theme/theme1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Test">
        <a:themeElements>
          <a:clrScheme name="Test">
            <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
            <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
            <a:dk2><a:srgbClr val="000000"/></a:dk2>
            <a:lt2><a:srgbClr val="FFFFFF"/></a:lt2>
            <a:accent1><a:srgbClr val="336699"/></a:accent1>
            <a:accent2><a:srgbClr val="336699"/></a:accent2>
            <a:accent3><a:srgbClr val="336699"/></a:accent3>
            <a:accent4><a:srgbClr val="336699"/></a:accent4>
            <a:accent5><a:srgbClr val="336699"/></a:accent5>
            <a:accent6><a:srgbClr val="336699"/></a:accent6>
            <a:hlink><a:srgbClr val="0000FF"/></a:hlink>
            <a:folHlink><a:srgbClr val="800080"/></a:folHlink>
          </a:clrScheme>
          <a:fontScheme name="Test">
            <a:majorFont><a:latin typeface="Arial"/></a:majorFont>
            <a:minorFont><a:latin typeface="Arial"/></a:minorFont>
          </a:fontScheme>
        </a:themeElements>
      </a:theme>`,
  );
  zip.file(
    "ppt/slideMasters/slideMaster1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:cSld><p:spTree>
          <p:sp>
            <p:nvSpPr><p:cNvPr id="42" name="Title Placeholder"/><p:cNvSpPr txBox="1"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
            <p:spPr/>
            <p:txBody><a:bodyPr/>
              <a:lstStyle>
                <a:lvl1pPr><a:defRPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:defRPr></a:lvl1pPr>
              </a:lstStyle>
            </p:txBody>
          </p:sp>
        </p:spTree></p:cSld>
        <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
        <p:txStyles>
          <p:titleStyle>
            <a:lvl1pPr><a:defRPr><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:defRPr></a:lvl1pPr>
          </p:titleStyle>
        </p:txStyles>
      </p:sldMaster>`,
  );
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    pptxRelsXml([{ id: "rId1", type: "theme", target: "../theme/theme1.xml" }]),
  );
  zip.file(
    "ppt/slideLayouts/slideLayout1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:cSld><p:spTree/></p:cSld>
      </p:sldLayout>`,
  );
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    pptxRelsXml([
      {
        id: "rId1",
        type: "slideMaster",
        target: "../slideMasters/slideMaster1.xml",
      },
    ]),
  );
  zip.file("ppt/slides/slide1.xml", slideXml);
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    pptxRelsXml([
      {
        id: "rId1",
        type: "slideLayout",
        target: "../slideLayouts/slideLayout1.xml",
      },
    ]),
  );
  return zip.generateAsync({ type: "uint8array" });
}

/** Same slide → slideLayout → slideMaster → theme chain as `buildPptxBufferWithLayoutAndMaster`, but the layout itself defines two distinct, non-overlapping `<a:xfrm>` placeholder shapes (title, body) — reproduces the geometry side of placeholder inheritance the way that helper reproduces the color side. */
async function buildPptxBufferWithLayoutPlaceholderGeometry(
  slideXml: string,
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                      xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:sldIdLst>
          <p:sldId id="256" r:id="rId1"/>
        </p:sldIdLst>
        <p:sldSz cx="12192000" cy="6858000"/>
      </p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    pptxRelsXml([{ id: "rId1", type: "slide", target: "slides/slide1.xml" }]),
  );
  zip.file(
    "ppt/theme/theme1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Test">
        <a:themeElements>
          <a:clrScheme name="Test">
            <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
            <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
            <a:dk2><a:srgbClr val="000000"/></a:dk2>
            <a:lt2><a:srgbClr val="FFFFFF"/></a:lt2>
            <a:accent1><a:srgbClr val="336699"/></a:accent1>
            <a:accent2><a:srgbClr val="336699"/></a:accent2>
            <a:accent3><a:srgbClr val="336699"/></a:accent3>
            <a:accent4><a:srgbClr val="336699"/></a:accent4>
            <a:accent5><a:srgbClr val="336699"/></a:accent5>
            <a:accent6><a:srgbClr val="336699"/></a:accent6>
            <a:hlink><a:srgbClr val="0000FF"/></a:hlink>
            <a:folHlink><a:srgbClr val="800080"/></a:folHlink>
          </a:clrScheme>
          <a:fontScheme name="Test">
            <a:majorFont><a:latin typeface="Arial"/></a:majorFont>
            <a:minorFont><a:latin typeface="Arial"/></a:minorFont>
          </a:fontScheme>
        </a:themeElements>
      </a:theme>`,
  );
  zip.file(
    "ppt/slideMasters/slideMaster1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:cSld><p:spTree/></p:cSld>
        <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
      </p:sldMaster>`,
  );
  zip.file(
    "ppt/slideMasters/_rels/slideMaster1.xml.rels",
    pptxRelsXml([{ id: "rId1", type: "theme", target: "../theme/theme1.xml" }]),
  );
  zip.file(
    "ppt/slideLayouts/slideLayout1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
      <p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
        <p:cSld><p:spTree>
          <p:sp>
            <p:nvSpPr><p:cNvPr id="10" name="Title Placeholder"/><p:cNvSpPr txBox="1"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
            <p:spPr><a:xfrm><a:off x="500000" y="300000"/><a:ext cx="8000000" cy="1000000"/></a:xfrm></p:spPr>
            <p:txBody><a:bodyPr/><a:lstStyle/></p:txBody>
          </p:sp>
          <p:sp>
            <p:nvSpPr><p:cNvPr id="11" name="Body Placeholder"/><p:cNvSpPr txBox="1"/><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr>
            <p:spPr><a:xfrm><a:off x="500000" y="1600000"/><a:ext cx="8000000" cy="4000000"/></a:xfrm></p:spPr>
            <p:txBody><a:bodyPr/><a:lstStyle/></p:txBody>
          </p:sp>
        </p:spTree></p:cSld>
      </p:sldLayout>`,
  );
  zip.file(
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
    pptxRelsXml([
      {
        id: "rId1",
        type: "slideMaster",
        target: "../slideMasters/slideMaster1.xml",
      },
    ]),
  );
  zip.file("ppt/slides/slide1.xml", slideXml);
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    pptxRelsXml([
      {
        id: "rId1",
        type: "slideLayout",
        target: "../slideLayouts/slideLayout1.xml",
      },
    ]),
  );
  return zip.generateAsync({ type: "uint8array" });
}
