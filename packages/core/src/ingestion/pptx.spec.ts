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
                    <a:tr h="1000">
                      <a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>A1</a:t></a:r></a:p></a:txBody></a:tc>
                      <a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>B1</a:t></a:r></a:p></a:txBody></a:tc>
                    </a:tr>
                    <a:tr h="1000">
                      <a:tc gridSpan="2"><a:txBody><a:bodyPr/><a:p><a:r><a:t>Merged</a:t></a:r></a:p></a:txBody></a:tc>
                      <a:tc hMerge="1"><a:txBody/></a:tc>
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

  it("approximates a gradient fill with its first stop's color instead of leaving the shape unfilled", async () => {
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
    expect(element?.fill).toBe("#112233");
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
});

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
