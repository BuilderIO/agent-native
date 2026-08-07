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
