import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { parsePptxPresentation } from "./pptx.js";

function buildFixture(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    "ppt/presentation.xml",
    `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <p:sldIdLst><p:sldId id="1" r:id="rId1" /></p:sldIdLst>
      <p:sldSz cx="12192000" cy="6858000" />
    </p:presentation>`,
  );
  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Target="slides/slide1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" />
    </Relationships>`,
  );
  zip.file(
    "ppt/slides/slide1.xml",
    `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <p:cSld><p:spTree>
        <p:sp><p:txBody>
          <a:p>
            <a:r><a:rPr b="1" sz="3200"><a:solidFill><a:srgbClr val="FF0000" /></a:solidFill></a:rPr><a:t>Title</a:t></a:r>
            <a:br />
            <a:r><a:rPr i="1" /><a:t>line</a:t></a:r>
          </a:p>
          <a:p><a:r><a:t>Second paragraph</a:t></a:r></a:p>
        </p:txBody></p:sp>
        <p:pic><p:blipFill><a:blip r:embed="rIdImage1" /></p:blipFill><p:spPr><a:xfrm><a:ext cx="6000000" cy="3000000" /></a:xfrm></p:spPr></p:pic>
        <p:pic><p:blipFill><a:blip r:embed="rIdImage2" /></p:blipFill><p:spPr><a:xfrm><a:ext cx="3000000" cy="3000000" /></a:xfrm></p:spPr></p:pic>
      </p:spTree></p:cSld>
    </p:sld>`,
  );
  zip.file(
    "ppt/slides/_rels/slide1.xml.rels",
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rIdImage1" Target="../media/image1.png" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" />
      <Relationship Id="rIdImage2" Target="../media/image2.png" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" />
    </Relationships>`,
  );
  zip.file("ppt/media/image1.png", new Uint8Array([1, 2, 3]));
  zip.file("ppt/media/image2.png", new Uint8Array([4, 5, 6]));
  return zip.generateAsync({ type: "uint8array" });
}

describe("PPTX ingestion", () => {
  it("preserves paragraph boundaries, explicit breaks, image order, and canvas size", async () => {
    const result = await parsePptxPresentation(await buildFixture());
    const slide = result.slides[0];

    expect(result.slideSize).toEqual({
      widthEmu: 12192000,
      heightEmu: 6858000,
    });
    expect(slide.texts.map((run) => run.content)).toEqual([
      "Title\n",
      "line",
      "Second paragraph",
    ]);
    expect(slide.texts.map((run) => run.paragraph)).toEqual([0, 0, 1]);
    expect(slide.texts[0]).toMatchObject({
      bold: true,
      fontSize: 32,
      color: "#FF0000",
    });
    expect(slide.texts[1].italic).toBe(true);
    expect(slide.images).toHaveLength(2);
    expect(slide.images.map((image) => image.name)).toEqual([
      "image1.png",
      "image2.png",
    ]);
  });
});
