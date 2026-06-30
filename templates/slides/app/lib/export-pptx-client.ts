import { type AspectRatio, getAspectRatioDims } from "./aspect-ratios";
import {
  findSlideExportSource,
  preloadImagesWithCors,
} from "./export-pdf-client";

interface PptxExportSlide {
  id: string;
  notes?: string;
}

function safePptxName(title: string) {
  const safeName = title.replace(/[^a-zA-Z0-9]/g, "-") || "deck";
  return `${safeName}.pptx`;
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function addRelationship(xml: string, relationship: string) {
  if (xml.includes(relationship)) return xml;
  return xml.replace("</Relationships>", `${relationship}</Relationships>`);
}

function addContentTypeOverride(xml: string, partName: string, type: string) {
  if (xml.includes(`PartName="${partName}"`)) return xml;
  return xml.replace(
    "</Types>",
    `<Override PartName="${partName}" ContentType="${type}"/></Types>`,
  );
}

function nextRelationshipId(xml: string) {
  const ids = Array.from(xml.matchAll(/\bId="rId(\d+)"/g)).map((match) =>
    Number(match[1]),
  );
  return `rId${Math.max(0, ...ids) + 1}`;
}

function notesTextBody(notes: string) {
  const lines = notes.split(/\r?\n/);
  return lines
    .map(
      (line) =>
        `<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>${escapeXml(line)}</a:t></a:r><a:endParaRPr lang="en-US" dirty="0"/></a:p>`,
    )
    .join("");
}

function notesSlideXml(notes: string, slideNumber: number) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${notesTextBody(notes)}</p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="4" name="Slide Number Placeholder 3"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldNum" sz="quarter" idx="10"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:fld id="{F7021451-1387-4CA6-816F-3879F97B5CBC}" type="slidenum"><a:rPr lang="en-US"/><a:t>${slideNumber}</a:t></a:fld><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
}

const NOTES_MASTER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notesMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:notesStyle><a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1200" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr></p:notesStyle></p:notesMaster>`;

const NOTES_MASTER_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`;

export async function addSpeakerNotesToPptxBlob(
  blob: Blob,
  slides: PptxExportSlide[],
): Promise<Blob> {
  const hasNotes = slides.some((slide) => slide.notes?.trim());
  if (!hasNotes) return blob;

  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(blob);

  const contentTypesFile = zip.file("[Content_Types].xml");
  const presentationFile = zip.file("ppt/presentation.xml");
  const presentationRelsFile = zip.file("ppt/_rels/presentation.xml.rels");

  if (!contentTypesFile || !presentationFile || !presentationRelsFile) {
    return blob;
  }

  let contentTypes = await contentTypesFile.async("string");
  let presentationXml = await presentationFile.async("string");
  let presentationRels = await presentationRelsFile.async("string");

  if (!zip.file("ppt/notesMasters/notesMaster1.xml")) {
    zip.file("ppt/notesMasters/notesMaster1.xml", NOTES_MASTER_XML);
  }
  if (!zip.file("ppt/notesMasters/_rels/notesMaster1.xml.rels")) {
    zip.file(
      "ppt/notesMasters/_rels/notesMaster1.xml.rels",
      NOTES_MASTER_RELS_XML,
    );
  }

  contentTypes = addContentTypeOverride(
    contentTypes,
    "/ppt/notesMasters/notesMaster1.xml",
    "application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml",
  );

  if (!presentationRels.includes("relationships/notesMaster")) {
    const relId = nextRelationshipId(presentationRels);
    presentationRels = addRelationship(
      presentationRels,
      `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="notesMasters/notesMaster1.xml"/>`,
    );
    if (!presentationXml.includes("<p:notesMasterIdLst>")) {
      presentationXml = presentationXml.replace(
        "</p:sldIdLst>",
        `</p:sldIdLst><p:notesMasterIdLst><p:notesMasterId r:id="${relId}"/></p:notesMasterIdLst>`,
      );
    }
  }

  if (!presentationXml.includes("<p:notesSz")) {
    presentationXml = presentationXml.replace(
      "<p:defaultTextStyle>",
      '<p:notesSz cx="6858000" cy="12192000"/><p:defaultTextStyle>',
    );
  }

  for (let i = 0; i < slides.length; i++) {
    const notes = slides[i].notes?.trim();
    if (!notes) continue;

    const slideNumber = i + 1;
    const slideRelsPath = `ppt/slides/_rels/slide${slideNumber}.xml.rels`;
    const slideRelsFile = zip.file(slideRelsPath);
    if (!slideRelsFile) continue;

    let slideRels = await slideRelsFile.async("string");
    if (!slideRels.includes("relationships/notesSlide")) {
      const relId = nextRelationshipId(slideRels);
      slideRels = addRelationship(
        slideRels,
        `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${slideNumber}.xml"/>`,
      );
      zip.file(slideRelsPath, slideRels);
    }

    zip.file(
      `ppt/notesSlides/notesSlide${slideNumber}.xml`,
      notesSlideXml(notes, slideNumber),
    );
    zip.file(
      `ppt/notesSlides/_rels/notesSlide${slideNumber}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="../notesMasters/notesMaster1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../slides/slide${slideNumber}.xml"/></Relationships>`,
    );
    contentTypes = addContentTypeOverride(
      contentTypes,
      `/ppt/notesSlides/notesSlide${slideNumber}.xml`,
      "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml",
    );
  }

  zip.file("[Content_Types].xml", contentTypes);
  zip.file("ppt/presentation.xml", presentationXml);
  zip.file("ppt/_rels/presentation.xml.rels", presentationRels);

  return zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

function createUnscaledExportClone(
  source: HTMLElement,
  dims: { width: number; height: number },
) {
  const stage = document.createElement("div");
  stage.setAttribute("aria-hidden", "true");
  Object.assign(stage.style, {
    height: `${dims.height}px`,
    left: "-100000px",
    overflow: "hidden",
    pointerEvents: "none",
    position: "fixed",
    top: "0",
    width: `${dims.width}px`,
    zIndex: "-1",
  });

  const clone = source.cloneNode(true) as HTMLElement;
  Object.assign(clone.style, {
    height: `${dims.height}px`,
    maxHeight: `${dims.height}px`,
    maxWidth: `${dims.width}px`,
    position: "relative",
    transform: "none",
    width: `${dims.width}px`,
  });

  stage.appendChild(clone);
  document.body.appendChild(stage);

  return {
    element: clone,
    cleanup: () => stage.remove(),
  };
}

function svgDataUrl(svg: SVGSVGElement) {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  if (!copy.getAttribute("xmlns")) {
    copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  }
  const serialized = new XMLSerializer().serializeToString(copy);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
}

async function rasterizeSvgElement(
  svg: SVGSVGElement,
  width: number,
  height: number,
) {
  const fallback = svgDataUrl(svg);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx || typeof Image === "undefined") return fallback;

  const scale = Math.max(2, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.ceil(width * scale));
  canvas.height = Math.max(1, Math.ceil(height * scale));

  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Could not rasterize SVG"));
  });
  image.src = fallback;

  try {
    await loaded;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } catch {
    return fallback;
  }
}

async function replaceInlineSvgsWithImages(root: HTMLElement) {
  const svgs = Array.from(root.querySelectorAll<SVGSVGElement>("svg"));
  for (const svg of svgs) {
    const rect = svg.getBoundingClientRect();
    const viewBox = svg.viewBox?.baseVal;
    const width =
      rect.width || Number(svg.getAttribute("width")) || viewBox?.width || 1;
    const height =
      rect.height || Number(svg.getAttribute("height")) || viewBox?.height || 1;
    const dataUrl = await rasterizeSvgElement(svg, width, height);
    const img = document.createElement("img");
    const style = window.getComputedStyle(svg);
    img.src = dataUrl;
    img.alt = svg.getAttribute("aria-label") ?? "";
    Object.assign(img.style, {
      alignSelf: style.alignSelf,
      display: style.display === "inline" ? "inline-block" : style.display,
      flex: style.flex,
      height: `${height}px`,
      justifySelf: style.justifySelf,
      left: style.left,
      marginBottom: style.marginBottom,
      marginLeft: style.marginLeft,
      marginRight: style.marginRight,
      marginTop: style.marginTop,
      objectFit: "contain",
      opacity: style.opacity,
      position: style.position,
      right: style.right,
      top: style.top,
      transform: style.transform === "none" ? "" : style.transform,
      width: `${width}px`,
      zIndex: style.zIndex,
    });
    svg.replaceWith(img);
  }
}

function widenNoWrapTextElements(root: HTMLElement) {
  const elements = Array.from(root.querySelectorAll<HTMLElement>("*"));
  for (const element of elements) {
    if (!element.textContent?.trim()) continue;
    if (element.querySelector("img,svg,video,canvas")) continue;
    const style = window.getComputedStyle(element);
    if (style.whiteSpace !== "nowrap" && style.whiteSpace !== "pre") continue;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const buffer = Math.max(24, rect.width * 0.25);
    element.style.boxSizing = "border-box";
    if (style.display === "inline") {
      element.style.display = "inline-block";
    }
    element.style.width = `${Math.ceil(rect.width + buffer)}px`;
  }
}

export async function exportDeckAsPptx(
  deckTitle: string,
  slides: PptxExportSlide[],
  aspectRatio?: AspectRatio,
): Promise<void> {
  const { exportToPptx } = await import("dom-to-pptx");

  if (typeof document !== "undefined" && document.fonts?.ready) {
    await document.fonts.ready;
  }

  const dims = getAspectRatioDims(aspectRatio);
  const exportClones: Array<{
    element: HTMLElement;
    cleanup: () => void;
  }> = [];

  try {
    for (let i = 0; i < slides.length; i++) {
      const exportSlide = slides[i];
      const source = findSlideExportSource(exportSlide.id, i, slides.length);
      const clone = createUnscaledExportClone(source, {
        width: dims.width,
        height: dims.height,
      });
      exportClones.push(clone);
      widenNoWrapTextElements(clone.element);
      await replaceInlineSvgsWithImages(clone.element);
      await preloadImagesWithCors(clone.element);
    }

    const initialBlob = await exportToPptx(
      exportClones.map((clone) => clone.element),
      {
        autoEmbedFonts: true,
        fileName: safePptxName(deckTitle),
        height: dims.pptxInches.h,
        skipDownload: true,
        svgAsVector: false,
        width: dims.pptxInches.w,
      },
    );

    const blob = await addSpeakerNotesToPptxBlob(initialBlob, slides);
    triggerBlobDownload(blob, safePptxName(deckTitle));
  } finally {
    for (const clone of exportClones) {
      clone.cleanup();
    }
  }
}
