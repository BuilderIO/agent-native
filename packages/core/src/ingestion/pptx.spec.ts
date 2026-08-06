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
