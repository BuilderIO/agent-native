import { type AspectRatio, getAspectRatioDims } from "./aspect-ratios";
import { importExportModule } from "./dynamic-import";
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

const IMAGE_SETTLE_TIMEOUT_MS = 5_000;

function waitForImageToSettle(image: HTMLImageElement): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let decodeStarted = false;
    let settled = false;
    let timeoutId: number | undefined;

    const cleanup = () => {
      image.removeEventListener("error", handleLoad);
      image.removeEventListener("load", handleLoad);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const decode = () => {
      if (decodeStarted) return;
      decodeStarted = true;
      if (!image.complete || image.naturalWidth <= 0) {
        console.warn(
          `[export-pptx] image could not be loaded for export: ${image.src}`,
        );
        finish();
        return;
      }
      Promise.resolve()
        .then(() => image.decode())
        .then(finish, (error: unknown) => {
          if (error instanceof Error && error.name === "EncodingError") {
            finish();
            return;
          }
          fail(error);
        });
    };
    const handleLoad = () => decode();

    timeoutId = window.setTimeout(finish, IMAGE_SETTLE_TIMEOUT_MS);
    image.addEventListener("error", handleLoad);
    image.addEventListener("load", handleLoad);
    // The image can finish between the initial state read and listener setup.
    if (image.complete) decode();
  });
}

async function waitForImagesToSettle(root: HTMLElement) {
  const images = Array.from(root.querySelectorAll<HTMLImageElement>("img"));
  await Promise.all(images.map((image) => waitForImageToSettle(image)));
  if (typeof window.requestAnimationFrame === "function") {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() =>
        window.requestAnimationFrame(() => resolve()),
      );
    });
  }
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

const EMU_PER_INCH = 914_400;

export async function addSpeakerNotesToPptxBlob(
  blob: Blob,
  slides: PptxExportSlide[],
  pptxInches: { w: number; h: number },
): Promise<Blob> {
  const hasNotes = slides.some((slide) => slide.notes?.trim());
  if (!hasNotes) return blob;

  const { default: JSZip } = await importExportModule(() => import("jszip"));
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
    // The notes page is a portrait rotation of the slide, so its cx/cy swap
    // the slide's own width/height (matches PowerPoint's own notesMaster
    // output, e.g. a 13.33x7.5in 16:9 slide gets a 7.5x13.33in notes page).
    const notesCx = Math.round(pptxInches.h * EMU_PER_INCH);
    const notesCy = Math.round(pptxInches.w * EMU_PER_INCH);
    presentationXml = presentationXml.replace(
      "<p:defaultTextStyle>",
      `<p:notesSz cx="${notesCx}" cy="${notesCy}"/><p:defaultTextStyle>`,
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
  const sourceRect = source.getBoundingClientRect();
  const imageGeometry = collectImageGeometry(source);
  const textGeometry = collectTextGeometry(source);
  const positionedGeometry = collectPositionedGeometry(source);

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
    imageGeometry,
    positionedGeometry,
    textGeometry,
    sourceRect,
  };
}

interface ElementPathRecord {
  path: number[];
}

interface PositionedGeometryRecord extends ElementPathRecord {
  rect: DOMRect;
}

interface ImageGeometryRecord extends ElementPathRecord {
  position: string;
  rect: DOMRect;
}

interface TextGeometryRecord extends ElementPathRecord {
  fontSize: number;
  heading: boolean;
  letterSpacing: number;
  lineHeight: number;
  position: string;
  rect: DOMRect;
  scaleX: number;
  scaleY: number;
  singleLine: boolean;
}

function getElementPath(root: HTMLElement, element: HTMLElement) {
  const path: number[] = [];
  let current: HTMLElement | null = element;

  while (current && current !== root) {
    const parent: HTMLElement | null = current.parentElement;
    if (!parent) return null;
    const index = Array.prototype.indexOf.call(parent.children, current);
    if (index < 0) return null;
    path.unshift(index);
    current = parent;
  }

  return current === root ? path : null;
}

function getElementAtPath(root: HTMLElement, path: number[]) {
  let current: Element = root;
  for (const index of path) {
    const child = current.children[index];
    if (!(child instanceof HTMLElement)) return null;
    current = child;
  }
  return current instanceof HTMLElement ? current : null;
}

function isPositionedElement(element: HTMLElement) {
  const position = window.getComputedStyle(element).position;
  return position === "absolute" || position === "fixed";
}

function hasPositionedAncestor(element: HTMLElement, root: HTMLElement) {
  let parent = element.parentElement;
  while (parent && parent !== root) {
    if (isPositionedElement(parent)) return true;
    parent = parent.parentElement;
  }
  return false;
}

function isTextGeometryCandidate(element: HTMLElement) {
  if (!element.textContent?.trim()) return false;
  if (element.querySelector("img,svg,video,canvas")) return false;
  if (element.closest('[aria-hidden="true"]')) return false;
  if (
    element.tagName === "LI" ||
    element.tagName === "UL" ||
    element.tagName === "OL"
  ) {
    return false;
  }
  const isHeading = /^H[1-3]$/.test(element.tagName);
  const isTextBlock = element.tagName === "P";
  const isLeafText =
    element.tagName === "DIV" &&
    (element.children.length === 0 ||
      element.hasAttribute("data-slide-object-id"));
  if (!isHeading && !isTextBlock && !isLeafText) {
    return false;
  }

  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function computedLength(value: string, fallback: number) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function collectImageGeometry(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLImageElement>("img")).flatMap(
    (element): ImageGeometryRecord[] => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const path = getElementPath(root, element);
      if (
        !path ||
        style.display === "none" ||
        style.visibility === "hidden" ||
        !rect.width ||
        !rect.height
      ) {
        return [];
      }
      return [{ path, position: style.position, rect }];
    },
  );
}

function collectTextGeometry(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>("h1,h2,h3,p,div"))
    .filter(isTextGeometryCandidate)
    .flatMap((element): TextGeometryRecord[] => {
      const path = getElementPath(root, element);
      if (!path) return [];

      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const layoutWidth = computedLength(style.width, rect.width);
      const layoutHeight = computedLength(style.height, rect.height);
      const fontSize = computedLength(style.fontSize, 16);
      const lineHeight = computedLength(
        style.lineHeight,
        Math.max(16, fontSize * 1.2),
      );
      return [
        {
          fontSize,
          heading: /^H[1-3]$/.test(element.tagName),
          letterSpacing: computedLength(style.letterSpacing, 0),
          lineHeight,
          path,
          position: style.position,
          rect,
          scaleX: rect.width / Math.max(1, layoutWidth),
          scaleY: rect.height / Math.max(1, layoutHeight),
          singleLine: rect.height <= lineHeight * 1.35,
        },
      ];
    });
}

/**
 * The live slide is nested inside a positioned presentation wrapper, but the
 * export clone is not. Record only the outermost positioned descendants so
 * the clone can keep its source-space geometry without flattening nested
 * objects or changing the editable object hierarchy.
 */
function collectPositionedGeometry(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>("*"))
    .filter((element) => {
      if (!isPositionedElement(element)) return false;
      if (hasPositionedAncestor(element, root)) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    })
    .flatMap((element): PositionedGeometryRecord[] => {
      const path = getElementPath(root, element);
      return path ? [{ path, rect: element.getBoundingClientRect() }] : [];
    });
}

function restorePositionedGeometry(
  clone: HTMLElement,
  sourceRect: DOMRect,
  records: PositionedGeometryRecord[],
  dims: { width: number; height: number },
) {
  const cloneRect = clone.getBoundingClientRect();
  if (
    !sourceRect.width ||
    !sourceRect.height ||
    !cloneRect.width ||
    !cloneRect.height
  ) {
    return;
  }

  const scaleX = dims.width / sourceRect.width;
  const scaleY = dims.height / sourceRect.height;

  for (const record of records) {
    const element = getElementAtPath(clone, record.path);
    if (!element) continue;

    const currentRect = element.getBoundingClientRect();
    const desiredLeft = (record.rect.left - sourceRect.left) * scaleX;
    const desiredTop = (record.rect.top - sourceRect.top) * scaleY;
    const currentLeft = currentRect.left - cloneRect.left;
    const currentTop = currentRect.top - cloneRect.top;
    const currentStyle = window.getComputedStyle(element);
    const currentCssLeft = Number.parseFloat(currentStyle.left);
    const currentCssTop = Number.parseFloat(currentStyle.top);

    element.style.position = "absolute";
    element.style.right = "auto";
    element.style.bottom = "auto";
    element.style.left = `${(Number.isFinite(currentCssLeft)
      ? currentCssLeft + (desiredLeft - currentLeft)
      : desiredLeft
    ).toFixed(3)}px`;
    element.style.top = `${(Number.isFinite(currentCssTop)
      ? currentCssTop + (desiredTop - currentTop)
      : desiredTop
    ).toFixed(3)}px`;
  }
}

function resetAutofitTransforms(root: HTMLElement) {
  for (const layer of root.querySelectorAll<HTMLElement>(
    "[data-fmd-autofit-content]",
  )) {
    layer.style.transform = "none";
  }
}

function restoreTextGeometry(
  clone: HTMLElement,
  sourceRect: DOMRect,
  records: TextGeometryRecord[],
  dims: { width: number; height: number },
) {
  if (!sourceRect.width || !sourceRect.height) return;

  const scaleX = dims.width / sourceRect.width;
  const scaleY = dims.height / sourceRect.height;
  for (const record of records) {
    const element = getElementAtPath(clone, record.path);
    if (!element) continue;

    let ancestor = element.parentElement;
    while (ancestor && ancestor !== clone) {
      if (window.getComputedStyle(ancestor).transform !== "none") {
        ancestor.style.transform = "none";
      }
      ancestor = ancestor.parentElement;
    }

    const cloneRect = clone.getBoundingClientRect();
    const desiredLeft = (record.rect.left - sourceRect.left) * scaleX;
    const desiredTop = (record.rect.top - sourceRect.top) * scaleY;
    const currentRect = element.getBoundingClientRect();
    const currentLeft = currentRect.left - cloneRect.left;
    const currentTop = currentRect.top - cloneRect.top;
    const translateX = desiredLeft - currentLeft;
    const translateY = desiredTop - currentTop;

    if (record.position === "static" || record.position === "relative") {
      element.dataset.exportTextGeometry = "true";
      if (record.singleLine) element.style.whiteSpace = "nowrap";
      element.style.left = `${translateX.toFixed(3)}px`;
      element.style.position = "relative";
      element.style.top = `${translateY.toFixed(3)}px`;
      element.style.transform = "none";
      if (Math.abs(record.scaleY - 1) >= 0.01) {
        element.style.fontSize = `${Math.max(1, record.fontSize * record.scaleY)}px`;
        element.style.letterSpacing = `${(record.letterSpacing * record.scaleX).toFixed(3)}px`;
        element.style.lineHeight = record.lineHeight
          ? `${(record.lineHeight * record.scaleY).toFixed(3)}px`
          : "normal";
      }
      continue;
    }

    element.dataset.exportTextGeometry = "true";
    if (record.singleLine) element.style.whiteSpace = "nowrap";
    element.style.boxSizing = "border-box";
    element.style.bottom = "auto";
    element.style.display = "block";
    element.style.fontSize = `${Math.max(1, record.fontSize * record.scaleY)}px`;
    element.style.height = `${Math.max(1, record.rect.height * scaleY)}px`;
    element.style.left = `${desiredLeft.toFixed(3)}px`;
    element.style.letterSpacing = `${(record.letterSpacing * record.scaleX).toFixed(3)}px`;
    element.style.lineHeight = record.lineHeight
      ? `${(record.lineHeight * record.scaleY).toFixed(3)}px`
      : "normal";
    element.style.margin = "0";
    element.style.maxHeight = "none";
    element.style.maxWidth = "none";
    element.style.minHeight = "0";
    element.style.minWidth = "0";
    element.style.position = "absolute";
    element.style.right = "auto";
    element.style.top = `${desiredTop.toFixed(3)}px`;
    element.style.transform = "none";
    element.style.width = `${Math.max(1, record.rect.width * scaleX)}px`;
  }
}

function restoreImageGeometry(
  clone: HTMLElement,
  sourceRect: DOMRect,
  records: ImageGeometryRecord[],
  dims: { width: number; height: number },
) {
  if (!sourceRect.width || !sourceRect.height) return;

  const cloneRect = clone.getBoundingClientRect();
  const scaleX = dims.width / sourceRect.width;
  const scaleY = dims.height / sourceRect.height;
  for (const record of records) {
    const element = getElementAtPath(
      clone,
      record.path,
    ) as HTMLImageElement | null;
    if (!element) continue;

    const desiredLeft = (record.rect.left - sourceRect.left) * scaleX;
    const desiredTop = (record.rect.top - sourceRect.top) * scaleY;
    const desiredWidth = record.rect.width * scaleX;
    const desiredHeight = record.rect.height * scaleY;
    element.style.boxSizing = "border-box";
    element.style.height = `${Math.max(1, desiredHeight)}px`;
    element.style.maxHeight = "none";
    element.style.maxWidth = "none";
    element.style.width = `${Math.max(1, desiredWidth)}px`;

    if (record.position === "absolute" || record.position === "fixed") {
      element.style.bottom = "auto";
      element.style.left = `${desiredLeft.toFixed(3)}px`;
      element.style.position = "absolute";
      element.style.right = "auto";
      element.style.top = `${desiredTop.toFixed(3)}px`;
      element.style.transform = "none";
      continue;
    }

    const currentRect = element.getBoundingClientRect();
    const currentLeft = currentRect.left - cloneRect.left;
    const currentTop = currentRect.top - cloneRect.top;
    element.style.transform = `translate(${(desiredLeft - currentLeft).toFixed(3)}px, ${(desiredTop - currentTop).toFixed(3)}px)`;
  }
}

function normalizeSingleLineText(
  clone: HTMLElement,
  records: TextGeometryRecord[],
) {
  const cloneRect = clone.getBoundingClientRect();
  for (const record of records) {
    if (!record.singleLine) continue;
    const element = getElementAtPath(clone, record.path);
    if (!element) continue;

    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;

    element.dataset.exportSingleLineText = "true";
    if (element.dataset.exportTextGeometry === "true") continue;
    element.style.boxSizing = "border-box";
    element.style.whiteSpace = "nowrap";
    if (record.heading) {
      element.style.maxWidth = "none";
      element.style.width = `${Math.max(1, Math.ceil(cloneRect.right - rect.left))}px`;
      continue;
    }

    const buffer = Math.max(24, rect.width * 0.25);
    const available = Math.max(rect.width, cloneRect.right - rect.left);
    element.style.width = `${Math.max(
      1,
      Math.ceil(Math.min(rect.width + buffer, available)),
    )}px`;
  }
}

const CSS_PX_PER_INCH = 96;

/**
 * dom-to-pptx fits the rendered clone into the requested slide size and
 * scales every measurement it takes by this same factor (dist/dom-to-pptx.mjs
 * `processSlide`). The bullet indent patched in afterward must match that
 * scale or it drifts off the deck's actual aspect ratio.
 */
export function pptxExportScale(dims: {
  width: number;
  height: number;
  pptxInches: { w: number; h: number };
}) {
  return Math.min(
    dims.pptxInches.w / (dims.width / CSS_PX_PER_INCH),
    dims.pptxInches.h / (dims.height / CSS_PX_PER_INCH),
  );
}

/**
 * CSS markers live outside the LI box, so dom-to-pptx cannot infer the gap
 * between a bullet and its text from getBoundingClientRect alone. Add that
 * source-visible gap only on the export clone; the source DOM stays editable.
 */
function normalizeListsForPptx(
  root: HTMLElement,
  dims: { width: number; height: number; pptxInches: { w: number; h: number } },
) {
  const bulletIndents: number[] = [];
  const scale = pptxExportScale(dims);

  for (const list of root.querySelectorAll<HTMLElement>("ul,ol")) {
    const listStyle = window.getComputedStyle(list);
    const listStyleType = listStyle.listStyleType || "disc";
    const paddingLeft = Number.parseFloat(listStyle.paddingLeft) || 0;
    if (
      paddingLeft > 0 &&
      listStyle.listStylePosition === "inside" &&
      listStyle.transform === "none"
    ) {
      list.style.transform = `translateX(${paddingLeft}px)`;
    }

    for (const item of list.children) {
      if (!(item instanceof HTMLElement) || item.tagName !== "LI") continue;
      const itemStyle = window.getComputedStyle(item);
      const currentMarginLeft = Number.parseFloat(itemStyle.marginLeft) || 0;
      const markerStyle = window.getComputedStyle(item, "::marker");
      const markerSize = Number.parseFloat(markerStyle.fontSize) || 20;
      const markerGap = Math.max(24, markerSize * 1.2);
      if (currentMarginLeft < markerGap) {
        item.style.marginLeft = `${markerGap}px`;
      }
    }

    if (listStyleType === "none") continue;
    const firstItem = Array.from(list.children).find(
      (item): item is HTMLElement =>
        item instanceof HTMLElement && item.tagName === "LI",
    );
    if (!firstItem) continue;

    const listRect = list.getBoundingClientRect();
    const itemRect = firstItem.getBoundingClientRect();
    if (!listRect.width || !itemRect.width) continue;

    const visualIndentPx = itemRect.left - listRect.left;
    bulletIndents.push(
      Math.max(0, (visualIndentPx - paddingLeft) * 0.75 * scale),
    );
  }

  return bulletIndents;
}

const EMU_PER_POINT = 12_700;

/**
 * dom-to-pptx prepends a bullet run, then PptxGenJS lets the following text
 * run overwrite the paragraph properties. Restore the measured indent at the
 * package boundary so Google Slides receives both the marker and its gap.
 */
function patchBulletIndentsInXml(xml: string, indentPoints: number[]) {
  let result = "";
  let cursor = 0;
  let listIndex = 0;

  while (true) {
    const shapeStart = xml.indexOf("<p:sp>", cursor);
    if (shapeStart < 0) {
      result += xml.slice(cursor);
      break;
    }

    const shapeEnd = xml.indexOf("</p:sp>", shapeStart);
    if (shapeEnd < 0) {
      result += xml.slice(cursor);
      break;
    }

    result += xml.slice(cursor, shapeStart);
    let shapeXml = xml.slice(shapeStart, shapeEnd + "</p:sp>".length);
    if (
      shapeXml.includes("<a:buChar") &&
      indentPoints[listIndex] !== undefined
    ) {
      const indent = Math.max(
        0,
        Math.round(indentPoints[listIndex] * EMU_PER_POINT),
      );
      let patchedShape = "";
      let shapeCursor = 0;

      while (true) {
        const bulletStart = shapeXml.indexOf("<a:buChar", shapeCursor);
        if (bulletStart < 0) {
          patchedShape += shapeXml.slice(shapeCursor);
          break;
        }

        const paragraphStart = shapeXml.lastIndexOf("<a:pPr", bulletStart);
        const paragraphEnd = shapeXml.indexOf("</a:pPr>", bulletStart);
        if (paragraphStart < shapeCursor || paragraphEnd < 0) {
          patchedShape += shapeXml.slice(shapeCursor);
          break;
        }

        patchedShape += shapeXml.slice(shapeCursor, paragraphStart);
        const paragraphXml = shapeXml.slice(
          paragraphStart,
          paragraphEnd + "</a:pPr>".length,
        );
        const openingEnd = paragraphXml.indexOf(">");
        const openingTag = paragraphXml
          .slice(0, openingEnd)
          .replace(/\s(?:marL|indent)="[^"]*"/g, "");
        patchedShape +=
          `${openingTag} marL="${indent}" indent="-${indent}"` +
          paragraphXml.slice(openingEnd);
        shapeCursor = paragraphEnd + "</a:pPr>".length;
      }

      shapeXml = patchedShape;
      listIndex += 1;
    }

    result += shapeXml;
    cursor = shapeEnd + "</p:sp>".length;
  }

  return result;
}

export async function patchBulletIndentsInPptxBlob(
  blob: Blob,
  slideBulletIndents: number[][],
) {
  if (!slideBulletIndents.some((indents) => indents.length > 0)) return blob;

  const { default: JSZip } = await importExportModule(() => import("jszip"));
  const zip = await JSZip.loadAsync(blob);

  for (let i = 0; i < slideBulletIndents.length; i++) {
    const indents = slideBulletIndents[i];
    if (!indents.length) continue;

    const slideFile = zip.file(`ppt/slides/slide${i + 1}.xml`);
    if (!slideFile) continue;

    const slideXml = await slideFile.async("string");
    zip.file(
      `ppt/slides/slide${i + 1}.xml`,
      patchBulletIndentsInXml(slideXml, indents),
    );
  }

  return zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
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
    if (element.dataset.exportSingleLineText === "true") continue;
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

/**
 * dom-to-pptx serializes CSS gradients as one malformed diagonal SVG. Imported
 * slides use a repeated master grid, so materialize that grid as a transparent
 * image before handing the clone to the exporter and leave the real text and
 * image objects editable.
 */
function materializeImportedBackgroundGrid(root: HTMLElement) {
  const slideRoot = root.matches(".fmd-imported-pptx")
    ? root
    : root.querySelector<HTMLElement>(".fmd-imported-pptx");
  if (!slideRoot) return;
  const computed = window.getComputedStyle(slideRoot);
  if (!computed.backgroundImage.includes("linear-gradient")) return;

  const color = computed.backgroundImage.match(/rgb\([^)]*\)/)?.[0];
  const size = computed.backgroundSize
    .split(",")[0]
    ?.trim()
    .split(/\s+/)
    .map((value) => Number.parseFloat(value));
  const position = computed.backgroundPosition
    .split(",")[0]
    ?.trim()
    .split(/\s+/)
    .map((value) => Number.parseFloat(value));
  const declaredLineWidth = computed.backgroundImage.match(
    /\b0(?:px)?\s+([\d.]+)px\b/i,
  )?.[1];
  const lineWidth = declaredLineWidth
    ? Number.parseFloat(declaredLineWidth)
    : Number.NaN;
  if (
    !color ||
    !size ||
    size.length < 2 ||
    !Number.isFinite(size[0]) ||
    !Number.isFinite(size[1]) ||
    size[0] <= 0 ||
    size[1] <= 0 ||
    !position ||
    position.length < 2 ||
    !Number.isFinite(position[0]) ||
    !Number.isFinite(position[1]) ||
    !Number.isFinite(lineWidth)
  ) {
    return;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(slideRoot.clientWidth));
  canvas.height = Math.max(1, Math.round(slideRoot.clientHeight));
  const context = canvas.getContext("2d");
  if (!context) return;
  context.strokeStyle = color;
  context.lineWidth = Math.max(0.5, lineWidth);

  for (let x = position[0]; x < canvas.width; x += size[0]) {
    context.beginPath();
    context.moveTo(x + context.lineWidth / 2, 0);
    context.lineTo(x + context.lineWidth / 2, canvas.height);
    context.stroke();
  }
  for (let y = position[1]; y < canvas.height; y += size[1]) {
    context.beginPath();
    context.moveTo(0, y + context.lineWidth / 2);
    context.lineTo(canvas.width, y + context.lineWidth / 2);
    context.stroke();
  }

  const gridImage = document.createElement("img");
  gridImage.alt = "";
  gridImage.src = canvas.toDataURL("image/png");
  Object.assign(gridImage.style, {
    height: "100%",
    left: "0",
    pointerEvents: "none",
    position: "absolute",
    top: "0",
    width: "100%",
    zIndex: "0",
  });
  slideRoot.insertBefore(gridImage, slideRoot.firstChild);
  slideRoot.style.backgroundImage = "none";
  slideRoot.style.backgroundSize = "auto";
  slideRoot.style.backgroundPosition = "0 0";
  slideRoot.style.backgroundRepeat = "no-repeat";
}

export async function buildDeckPptxBlob(
  deckTitle: string,
  slides: PptxExportSlide[],
  aspectRatio?: AspectRatio,
): Promise<{ blob: Blob; filename: string }> {
  const { exportToPptx } = await importExportModule(
    () => import("dom-to-pptx"),
  );

  if (typeof document !== "undefined" && document.fonts?.ready) {
    await document.fonts.ready;
  }

  const dims = getAspectRatioDims(aspectRatio);
  const exportClones: Array<{
    element: HTMLElement;
    cleanup: () => void;
  }> = [];
  const slideBulletIndents: number[][] = [];

  try {
    for (let i = 0; i < slides.length; i++) {
      const exportSlide = slides[i];
      const source = findSlideExportSource(exportSlide.id, i, slides.length);
      await waitForImagesToSettle(source);
      const clone = createUnscaledExportClone(source, {
        width: dims.width,
        height: dims.height,
      });
      exportClones.push(clone);
      await preloadImagesWithCors(clone.element);
      resetAutofitTransforms(clone.element);
      slideBulletIndents.push(normalizeListsForPptx(clone.element, dims));
      restorePositionedGeometry(
        clone.element,
        clone.sourceRect,
        clone.positionedGeometry,
        dims,
      );
      restoreTextGeometry(
        clone.element,
        clone.sourceRect,
        clone.textGeometry,
        dims,
      );
      normalizeSingleLineText(clone.element, clone.textGeometry);
      materializeImportedBackgroundGrid(clone.element);
      widenNoWrapTextElements(clone.element);
      await replaceInlineSvgsWithImages(clone.element);
      await preloadImagesWithCors(clone.element);
      restoreImageGeometry(
        clone.element,
        clone.sourceRect,
        clone.imageGeometry,
        dims,
      );
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

    const bulletPatchedBlob = await patchBulletIndentsInPptxBlob(
      initialBlob,
      slideBulletIndents,
    );
    const blob = await addSpeakerNotesToPptxBlob(
      bulletPatchedBlob,
      slides,
      dims.pptxInches,
    );
    return { blob, filename: safePptxName(deckTitle) };
  } finally {
    for (const clone of exportClones) {
      clone.cleanup();
    }
  }
}

export async function exportDeckAsPptx(
  deckTitle: string,
  slides: PptxExportSlide[],
  aspectRatio?: AspectRatio,
): Promise<void> {
  const { blob, filename } = await buildDeckPptxBlob(
    deckTitle,
    slides,
    aspectRatio,
  );
  triggerBlobDownload(blob, filename);
}
