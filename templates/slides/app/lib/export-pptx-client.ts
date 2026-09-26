import { type AspectRatio, getAspectRatioDims } from "./aspect-ratios";
import { importExportModule } from "./dynamic-import";
import {
  findSlideExportSource,
  preloadImagesWithCors,
} from "./export-pdf-client";
import {
  type FontMetrics,
  retargetPptxForGoogleSlides,
  WRAP_MARK,
} from "./pptx-google-slides";

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
  const textGeometry = collectTextGeometry(source, {
    x: sourceRect.width / dims.width || 1,
    y: sourceRect.height / dims.height || 1,
  });
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

function collectTextGeometry(
  root: HTMLElement,
  slideScale: { x: number; y: number },
) {
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
          scaleX: rect.width / Math.max(1, layoutWidth) / slideScale.x,
          scaleY: rect.height / Math.max(1, layoutHeight) / slideScale.y,
          singleLine: rect.height / slideScale.y <= lineHeight * 1.35,
        },
      ];
    });
}

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

function noWrapWhiteSpace(element: HTMLElement) {
  return window.getComputedStyle(element).whiteSpace.startsWith("pre")
    ? "pre"
    : "nowrap";
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
      if (record.singleLine) {
        element.style.whiteSpace = noWrapWhiteSpace(element);
      }
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
    if (record.singleLine) {
      element.style.whiteSpace = noWrapWhiteSpace(element);
    }
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

    const currentRect = element.getBoundingClientRect();
    const deltaX = desiredLeft - (currentRect.left - cloneRect.left);
    const deltaY = desiredTop - (currentRect.top - cloneRect.top);

    if (record.position === "absolute" || record.position === "fixed") {
      const style = window.getComputedStyle(element);
      const cssLeft = Number.parseFloat(style.left);
      const cssTop = Number.parseFloat(style.top);
      element.style.bottom = "auto";
      element.style.left = `${(Number.isFinite(cssLeft)
        ? cssLeft + deltaX
        : desiredLeft
      ).toFixed(3)}px`;
      element.style.position = "absolute";
      element.style.right = "auto";
      element.style.top = `${(Number.isFinite(cssTop)
        ? cssTop + deltaY
        : desiredTop
      ).toFixed(3)}px`;
      element.style.transform = "none";
      continue;
    }

    element.style.transform = `translate(${deltaX.toFixed(3)}px, ${deltaY.toFixed(3)}px)`;
  }
}

export function widenInPlace(element: HTMLElement, width: number) {
  const rect = element.getBoundingClientRect();
  const extra = width - rect.width;
  if (!(extra > 0)) return;
  const style = window.getComputedStyle(element);
  const rightToLeft = style.direction === "rtl";
  const align =
    style.textAlign === "start" || style.textAlign === "justify"
      ? rightToLeft
        ? "right"
        : "left"
      : style.textAlign === "end"
        ? rightToLeft
          ? "left"
          : "right"
        : style.textAlign;
  const share =
    align === "center" || align === "-webkit-center"
      ? 0.5
      : align === "right"
        ? 1
        : 0;
  const marginLeft = Number.parseFloat(style.marginLeft) || 0;
  const marginRight = Number.parseFloat(style.marginRight) || 0;
  element.style.boxSizing = "border-box";
  element.style.maxWidth = "none";
  element.style.width = `${width}px`;
  element.style.marginLeft = `${marginLeft - extra * share}px`;
  element.style.marginRight = `${marginRight - extra * (1 - share)}px`;
  const drift =
    element.getBoundingClientRect().left - (rect.left - extra * share);
  if (Math.abs(drift) > 0.5) {
    element.style.marginLeft = `${marginLeft - extra * share - drift}px`;
    element.style.marginRight = `${marginRight - extra * (1 - share) + drift}px`;
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
    element.style.boxSizing = "border-box";
    element.style.whiteSpace = noWrapWhiteSpace(element);
    if (record.heading) {
      widenInPlace(
        element,
        Math.max(rect.width, Math.ceil(cloneRect.right - rect.left)),
      );
      continue;
    }

    const buffer = Math.max(24, rect.width * 0.25);
    const available = Math.max(rect.width, cloneRect.right - rect.left);
    widenInPlace(
      element,
      Math.max(1, Math.ceil(Math.min(rect.width + buffer, available))),
    );
  }
}

const CSS_PX_PER_INCH = 96;

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

function ensureBulletMarkerSpacing(root: HTMLElement) {
  for (const marker of root.querySelectorAll<HTMLElement>(
    'p[data-pptx-paragraph] > span[aria-hidden="true"]:first-child',
  )) {
    const next = marker.nextSibling;
    if (
      next?.nodeType === Node.TEXT_NODE &&
      /^\s/.test(next.textContent ?? "")
    ) {
      continue;
    }
    marker.after(document.createTextNode(" "));
  }
}

const EMU_PER_POINT = 12_700;

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

const FONT_RESOLVE_TIMEOUT_MS = 4_000;

interface ResolvedExportFont {
  name: string;
  urls: string[];
}

export function usedFontFamilies(roots: HTMLElement[]): string[] {
  const weight = new Map<string, number>();
  for (const root of roots) {
    for (const node of [root, ...Array.from(root.querySelectorAll("*"))]) {
      if (!(node instanceof HTMLElement)) continue;
      if (NON_RENDERING_TAGS.has(node.tagName)) continue;
      const own = Array.from(node.childNodes)
        .filter((child) => child.nodeType === Node.TEXT_NODE)
        .map((child) => child.nodeValue ?? "")
        .join("")
        .trim();
      if (!own) continue;
      const primary = window
        .getComputedStyle(node)
        .fontFamily.split(",")[0]
        .trim()
        .replace(/^["']|["']$/g, "");
      if (
        !primary ||
        primary.startsWith("-") ||
        GENERIC_FAMILIES.has(primary)
      ) {
        continue;
      }
      weight.set(primary, (weight.get(primary) ?? 0) + own.length);
    }
  }
  return Array.from(weight.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([family]) => family);
}

const NON_RENDERING_TAGS = new Set(["SCRIPT", "STYLE", "TEMPLATE", "TITLE"]);

const GENERIC_FAMILIES = new Set([
  "cursive",
  "fantasy",
  "monospace",
  "sans-serif",
  "serif",
  "system-ui",
  "ui-monospace",
  "ui-rounded",
  "ui-sans-serif",
  "ui-serif",
]);

function romanFaceUrls(cssText: string, family: string): string[] {
  const urls: string[] = [];
  for (const block of cssText.split("@font-face")) {
    if (!block.includes("font-family")) continue;
    const name = block
      .match(/font-family:\s*(?:"([^"]+)"|'([^']+)'|([^;]+))/)
      ?.slice(1)
      .find(Boolean)
      ?.trim();
    if (name !== family) continue;
    if (/font-style:\s*italic/.test(block)) continue;
    const url = block.match(/url\(\s*["']?([^"')]+)["']?\s*\)/)?.[1];
    if (url) urls.push(url);
  }
  return urls;
}

function localFaceUrls(family: string): string[] {
  const urls: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | undefined;
    try {
      rules = sheet.cssRules ?? undefined;
    } catch {
      // coercion-ok: a cross-origin sheet is unreadable by design. The Google
      continue;
    }
    for (const rule of Array.from(rules ?? [])) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const name = rule.style
        .getPropertyValue("font-family")
        .trim()
        .replace(/^["']|["']$/g, "");
      if (name !== family) continue;
      if (rule.style.getPropertyValue("font-style").trim() === "italic")
        continue;
      const url = rule.style
        .getPropertyValue("src")
        .match(/url\(\s*["']?([^"')]+)["']?\s*\)/)?.[1];
      if (url) urls.push(url);
    }
  }
  return urls;
}

function isLoadedWebFont(family: string): boolean {
  let found = false;
  document.fonts?.forEach?.((face) => {
    if (face.family.replace(/^["']|["']$/g, "") === family) found = true;
  });
  return found;
}

async function resolveExportFonts(
  roots: HTMLElement[],
): Promise<ResolvedExportFont[]> {
  const pending = usedFontFamilies(roots).map(
    async (family): Promise<ResolvedExportFont | undefined> => {
      const local = localFaceUrls(family);
      if (local.length) return { name: family, urls: local };
      if (!isLoadedWebFont(family)) return undefined;
      try {
        const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(
          family,
        ).replace(/%20/g, "+")}:wght@400;500;600;700&display=swap`;
        const response = await fetch(href, {
          mode: "cors",
          signal: AbortSignal.timeout(FONT_RESOLVE_TIMEOUT_MS),
        });
        if (!response.ok) return undefined;
        const urls = romanFaceUrls(await response.text(), family);
        if (!urls.length) return undefined;
        return { name: family, urls };
      } catch (err) {
        console.warn(
          `[export-pptx] could not resolve "${family}" for embedding; the receiving app will substitute it`,
          err,
        );
        return undefined;
      }
    },
  );
  return (await Promise.all(pending)).filter(
    (font): font is ResolvedExportFont => font !== undefined,
  );
}

export async function pinTextBoxesForImport(
  blob: Blob,
  themeFont?: string,
): Promise<Blob> {
  const { default: JSZip } = await importExportModule(() => import("jszip"));
  const zip = await JSZip.loadAsync(blob);

  const slideNames = Object.keys(zip.files).filter((name) =>
    /^ppt\/slides\/slide\d+\.xml$/.test(name),
  );
  for (const name of slideNames) {
    const xml = await zip.file(name)!.async("string");
    zip.file(name, pinTextBoxesInXml(xml));
  }

  if (themeFont) {
    for (const name of Object.keys(zip.files).filter((file) =>
      /^ppt\/theme\/theme\d+\.xml$/.test(file),
    )) {
      const xml = await zip.file(name)!.async("string");
      zip.file(name, retypeThemeFonts(xml, themeFont));
    }
  }

  return zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

export function retypeThemeFonts(xml: string, family: string): string {
  const escaped = family.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return xml.replace(
    /(<a:(?:majorFont|minorFont)>\s*<a:latin typeface=")[^"]*"/g,
    `$1${escaped}"`,
  );
}

export function pinTextBoxesInXml(xml: string): string {
  return xml
    .replace(/(<a:bodyPr\b[^>]*?)\swrap="none"/g, '$1 wrap="square"')
    .replace(/<a:spAutoFit\s*\/>/g, "<a:noAutofit/>");
}

const SVG_PLACEMENT_PROPERTIES = [
  "bottom",
  "left",
  "position",
  "right",
  "top",
  "transform",
];

function svgDataUrl(svg: SVGSVGElement) {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  if (!copy.getAttribute("xmlns")) {
    copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  }
  for (const property of SVG_PLACEMENT_PROPERTIES) {
    copy.style.removeProperty(property);
  }
  const serialized = new XMLSerializer().serializeToString(copy);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;
}

export function blankRasterResult(
  data: Uint8ClampedArray | undefined,
): boolean | undefined {
  if (!data || data.length === 0) return undefined;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 0) return false;
  }
  return true;
}

async function rasterizeSvgElement(
  svg: SVGSVGElement,
  width: number,
  height: number,
): Promise<{ dataUrl: string; blank: boolean | undefined }> {
  const fallback = svgDataUrl(svg);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx || typeof Image === "undefined") {
    return { dataUrl: fallback, blank: undefined };
  }

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
    let pixels: Uint8ClampedArray | undefined;
    try {
      pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    } catch {
      console.warn(
        "[export-pptx] rasterized shape could not be inspected; it may be missing from the export",
      );
      pixels = undefined;
    }
    return {
      dataUrl: canvas.toDataURL("image/png"),
      blank: blankRasterResult(pixels),
    };
  } catch {
    return { dataUrl: fallback, blank: undefined };
  }
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function clipPathOutline(
  clipPath: string,
  width: number,
  height: number,
): string | undefined {
  const path = clipPath.match(/^path\(\s*["']?([^"')]*)["']?\s*\)$/i)?.[1];
  if (path) return path;
  const polygon = clipPath.match(/^polygon\(([^)]*)\)$/i)?.[1];
  if (!polygon) return undefined;
  const points = polygon.split(",").map((pair) => {
    const [rawX, rawY] = pair.trim().split(/\s+/);
    const x = clipPathPixels(rawX, width);
    const y = clipPathPixels(rawY, height);
    return x == null || y == null ? null : `${x} ${y}`;
  });
  if (points.length < 3 || points.some((point) => point == null)) {
    return undefined;
  }
  return `M${points.join(" L")} Z`;
}

let gradientId = 0;

const GRADIENT_SIDE_ANGLES: Record<string, number> = {
  "to top": 0,
  "to right": 90,
  "to bottom": 180,
  "to left": 270,
};

function splitTopLevel(list: string): string[] | undefined {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of list) {
    if (character === "(") depth++;
    else if (character === ")") depth--;
    if (depth < 0) return undefined;
    if (character === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  if (depth !== 0) return undefined;
  parts.push(current.trim());
  return parts;
}

const round3 = (value: number) => `${Math.round(value * 1000) / 1000}`;

function stopPaint(color: string): { color: string; opacity?: string } {
  const hex8 = color.match(/^#([\da-f]{6})([\da-f]{2})$/i);
  if (!hex8) return { color };
  return {
    color: `#${hex8[1]}`,
    opacity: round3(Number.parseInt(hex8[2], 16) / 255),
  };
}

function appendGradientStops(
  gradient: SVGElement,
  stopParts: string[],
): SVGElement {
  stopParts.forEach((part, index) => {
    const position = part.match(/\s(-?[\d.]+)%$/)?.[1];
    const raw = position == null ? part : part.slice(0, -position.length - 1);
    const paint = stopPaint(raw.trim());
    const stop = document.createElementNS(SVG_NAMESPACE, "stop");
    stop.setAttribute(
      "offset",
      position != null
        ? `${position}%`
        : `${(index / (stopParts.length - 1)) * 100}%`,
    );
    stop.setAttribute("stop-color", paint.color);
    if (paint.opacity) stop.setAttribute("stop-opacity", paint.opacity);
    gradient.appendChild(stop);
  });
  return gradient;
}

export function gradientPaint(
  backgroundImage: string,
  width: number,
  height: number,
  id: string,
): SVGElement | undefined {
  const declaration = backgroundImage
    .trim()
    .match(/^(linear|radial)-gradient\(([\s\S]*)\)$/i);
  if (!declaration) return undefined;
  const parts = splitTopLevel(declaration[2]);
  if (!parts || parts.length < 2) return undefined;
  const head = parts[0].toLowerCase();

  if (declaration[1].toLowerCase() === "radial") {
    const focus = head.match(
      /^(?:circle|ellipse)?\s*at\s+(-?[\d.]+)%\s+(-?[\d.]+)%$/,
    );
    if (!focus && head !== "circle" && head !== "ellipse") return undefined;
    const stopParts = parts.slice(1);
    if (stopParts.length < 2) return undefined;
    const cx = focus ? (Number.parseFloat(focus[1]) / 100) * width : width / 2;
    const cy = focus
      ? (Number.parseFloat(focus[2]) / 100) * height
      : height / 2;
    const gradient = document.createElementNS(SVG_NAMESPACE, "radialGradient");
    gradient.setAttribute("id", id);
    gradient.setAttribute("gradientUnits", "userSpaceOnUse");
    gradient.setAttribute("cx", round3(cx));
    gradient.setAttribute("cy", round3(cy));
    gradient.setAttribute(
      "r",
      round3(
        Math.max(
          Math.hypot(cx, cy),
          Math.hypot(width - cx, cy),
          Math.hypot(cx, height - cy),
          Math.hypot(width - cx, height - cy),
        ),
      ),
    );
    return appendGradientStops(gradient, stopParts);
  }

  const declaredAngle = head.match(/^(-?[\d.]+)deg$/)?.[1];
  const sideAngle = GRADIENT_SIDE_ANGLES[head];
  const hasDirection = declaredAngle != null || sideAngle !== undefined;
  if (
    !hasDirection &&
    /^(to\b|calc\(|-?[\d.]+(deg|rad|grad|turn))/.test(head)
  ) {
    return undefined;
  }
  const angle =
    declaredAngle != null
      ? Number.parseFloat(declaredAngle)
      : (sideAngle ?? 180);
  const stopParts = hasDirection ? parts.slice(1) : parts;
  if (stopParts.length < 2) return undefined;

  const radians = ((angle - 90) * Math.PI) / 180;
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);
  const lineLength = Math.abs(width * dx) + Math.abs(height * dy);
  const gradient = document.createElementNS(SVG_NAMESPACE, "linearGradient");
  gradient.setAttribute("id", id);
  gradient.setAttribute("gradientUnits", "userSpaceOnUse");
  gradient.setAttribute("x1", round3(width / 2 - (dx * lineLength) / 2));
  gradient.setAttribute("y1", round3(height / 2 - (dy * lineLength) / 2));
  gradient.setAttribute("x2", round3(width / 2 + (dx * lineLength) / 2));
  gradient.setAttribute("y2", round3(height / 2 + (dy * lineLength) / 2));
  return appendGradientStops(gradient, stopParts);
}

function clipPathPixels(raw: string | undefined, side: number) {
  if (!raw) return undefined;
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return undefined;
  return raw.endsWith("%") ? (value / 100) * side : value;
}

export function materializeClipPathShapes(root: HTMLElement) {
  for (const element of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
    const style = window.getComputedStyle(element);
    const width = computedLength(style.width, 0);
    const height = computedLength(style.height, 0);
    if (!(width > 0) || !(height > 0)) continue;
    const outline = clipPathOutline(style.clipPath, width, height);
    if (!outline) continue;
    const overlay = element.firstElementChild;
    if (
      element.childElementCount > (overlay instanceof SVGSVGElement ? 1 : 0)
    ) {
      continue;
    }

    const svg = document.createElementNS(SVG_NAMESPACE, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.style.cssText = element.style.cssText;
    Object.assign(svg.style, {
      background: "none",
      border: "0",
      clipPath: "none",
      height: `${height}px`,
      overflow: "visible",
      width: `${width}px`,
    });

    const path = document.createElementNS(SVG_NAMESPACE, "path");
    path.setAttribute("d", outline);
    const gradient = gradientPaint(
      style.backgroundImage,
      width,
      height,
      `fmd-grad-${gradientId++}`,
    );
    if (gradient) {
      const defs = document.createElementNS(SVG_NAMESPACE, "defs");
      defs.appendChild(gradient);
      svg.appendChild(defs);
      path.setAttribute("fill", `url(#${gradient.id})`);
    } else {
      path.setAttribute("fill", style.backgroundColor);
    }
    const strokeWidth = computedLength(style.borderTopWidth, 0);
    if (strokeWidth > 0) {
      path.setAttribute("stroke", style.borderTopColor);
      path.setAttribute("stroke-width", `${strokeWidth}`);
    }
    svg.appendChild(path);
    if (overlay instanceof SVGSVGElement) {
      svg.append(...Array.from(overlay.childNodes));
    }
    element.replaceWith(svg);
  }
}

const BORDER_SIDES = ["top", "right", "bottom", "left"] as const;
const BORDER_CORNERS = [
  "top-left",
  "top-right",
  "bottom-right",
  "bottom-left",
] as const;
const TRANSPARENT_COLOR = /^(?:transparent|rgba\([^)]*,\s*0(?:\.0+)?\))$/;

export function materializeCompositeBorders(root: HTMLElement) {
  for (const element of [
    root,
    ...Array.from(root.querySelectorAll<HTMLElement>("*")),
  ]) {
    const style = window.getComputedStyle(element);
    const edges = BORDER_SIDES.map((side) => ({
      color: style.getPropertyValue(`border-${side}-color`),
      side,
      stroke: style.getPropertyValue(`border-${side}-style`),
      width: computedLength(style.getPropertyValue(`border-${side}-width`), 0),
    }));
    const [first] = edges;
    if (!edges.some((edge) => edge.width > 0)) continue;
    if (
      edges.every(
        (edge) =>
          edge.width === first.width &&
          edge.stroke === first.stroke &&
          edge.color === first.color,
      )
    ) {
      continue;
    }
    if (edges.some((edge) => edge.width > 0 && edge.stroke !== "solid")) {
      continue;
    }
    if (
      BORDER_CORNERS.some(
        (corner) =>
          computedLength(style.getPropertyValue(`border-${corner}-radius`), 0) >
          0,
      )
    ) {
      continue;
    }
    if (
      edges.some((edge, index) => {
        const next = edges[(index + 1) % edges.length];
        return (
          edge.width > 0 &&
          next.width > 0 &&
          (edge.width !== next.width || edge.color !== next.color)
        );
      })
    ) {
      continue;
    }
    const positioned = Array.from(
      element.querySelectorAll<HTMLElement>("*"),
    ).some((child) => {
      const position = window.getComputedStyle(child).position;
      return position === "absolute" || position === "fixed";
    });
    if (positioned) continue;
    if (style.position === "static") element.style.position = "relative";

    for (const edge of edges) {
      if (!(edge.width > 0)) continue;
      const padding = computedLength(
        style.getPropertyValue(`padding-${edge.side}`),
        0,
      );
      element.style.setProperty(
        `padding-${edge.side}`,
        `${padding + edge.width}px`,
      );
      element.style.setProperty(`border-${edge.side}-width`, "0");
      if (TRANSPARENT_COLOR.test(edge.color)) continue;
      const bar = element.ownerDocument.createElement("div");
      bar.style.position = "absolute";
      bar.style.backgroundColor = edge.color;
      bar.style.setProperty(edge.side, "0");
      if (edge.side === "top" || edge.side === "bottom") {
        bar.style.left = "0";
        bar.style.right = "0";
        bar.style.height = `${edge.width}px`;
      } else {
        bar.style.top = "0";
        bar.style.bottom = "0";
        bar.style.width = `${edge.width}px`;
      }
      element.append(bar);
    }
  }
}

export async function replaceInlineSvgsWithImages(
  root: HTMLElement,
  slideNumber = 1,
): Promise<number> {
  const svgs = Array.from(root.querySelectorAll<SVGSVGElement>("svg"));
  let blankCount = 0;
  for (const [index, svg] of svgs.entries()) {
    const rect = svg.getBoundingClientRect();
    const viewBox = svg.viewBox?.baseVal;
    const style = window.getComputedStyle(svg);
    const width =
      computedLength(style.width, rect.width) ||
      Number(svg.getAttribute("width")) ||
      viewBox?.width ||
      1;
    const height =
      computedLength(style.height, rect.height) ||
      Number(svg.getAttribute("height")) ||
      viewBox?.height ||
      1;
    const { dataUrl, blank } = await rasterizeSvgElement(svg, width, height);
    if (blank) {
      blankCount++;
      const outline =
        svg.querySelector("path")?.getAttribute("d")?.slice(0, 48) ?? "no path";
      console.warn(
        `[export-pptx] slide ${slideNumber} shape ${index + 1} rasterized empty and will be missing from the export (${Math.round(width)}x${Math.round(height)}, ${outline})`,
      );
    }
    const img = document.createElement("img");
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
  return blankCount;
}

async function flattenCroppedImages(root: HTMLElement) {
  for (const image of Array.from(root.querySelectorAll("img"))) {
    const clip = image.parentElement;
    if (!clip) continue;
    const clipStyle = window.getComputedStyle(clip);
    if (
      clipStyle.overflowX === "visible" ||
      clipStyle.overflowY === "visible"
    ) {
      continue;
    }

    const imageRect = image.getBoundingClientRect();
    const clipRect = clip.getBoundingClientRect();
    const left = Math.max(imageRect.left, clipRect.left);
    const top = Math.max(imageRect.top, clipRect.top);
    const width = Math.min(imageRect.right, clipRect.right) - left;
    const height = Math.min(imageRect.bottom, clipRect.bottom) - top;
    if (width <= 0 || height <= 0) continue;
    if (
      width >= imageRect.width - 0.5 &&
      height >= imageRect.height - 0.5 &&
      left <= imageRect.left + 0.5 &&
      top <= imageRect.top + 0.5
    ) {
      continue;
    }

    if ((window.getComputedStyle(image).objectFit || "fill") !== "fill") {
      console.warn(
        `[export-pptx] cropped image uses object-fit and exports uncropped: ${image.src}`,
      );
      continue;
    }
    await waitForImageToSettle(image);
    if (!image.complete || image.naturalWidth <= 0) {
      console.warn(
        `[export-pptx] cropped image is not decoded and exports uncropped: ${image.src}`,
      );
      continue;
    }

    const scaleX = image.naturalWidth / imageRect.width;
    const scaleY = image.naturalHeight / imageRect.height;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scaleX));
    canvas.height = Math.max(1, Math.round(height * scaleY));
    const context = canvas.getContext("2d");
    if (!context) {
      console.warn(
        `[export-pptx] no 2d canvas to crop with; image exports uncropped: ${image.src}`,
      );
      continue;
    }
    context.drawImage(
      image,
      (left - imageRect.left) * scaleX,
      (top - imageRect.top) * scaleY,
      canvas.width,
      canvas.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );

    let cropped: string;
    try {
      cropped = canvas.toDataURL("image/png");
    } catch (error) {
      console.warn(
        `[export-pptx] cropped image could not be rasterized and exports uncropped: ${image.src}`,
        error,
      );
      continue;
    }

    image.src = cropped;
    image.style.height = `${height}px`;
    image.style.maxHeight = "none";
    image.style.maxWidth = "none";
    image.style.width = `${width}px`;

    const shrunkRect = image.getBoundingClientRect();
    const deltaX = left - shrunkRect.left;
    const deltaY = top - shrunkRect.top;
    const imageStyle = window.getComputedStyle(image);
    if (imageStyle.position === "absolute" || imageStyle.position === "fixed") {
      const cssLeft = Number.parseFloat(imageStyle.left);
      const cssTop = Number.parseFloat(imageStyle.top);
      image.style.bottom = "auto";
      image.style.right = "auto";
      if (Number.isFinite(cssLeft)) {
        image.style.left = `${(cssLeft + deltaX).toFixed(3)}px`;
      }
      if (Number.isFinite(cssTop)) {
        image.style.top = `${(cssTop + deltaY).toFixed(3)}px`;
      }
      continue;
    }
    image.style.transform = `translate(${deltaX.toFixed(3)}px, ${deltaY.toFixed(3)}px)`;
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
    if (style.display === "inline") {
      element.style.display = "inline-block";
    }
    widenInPlace(element, Math.ceil(rect.width + buffer));
  }
}

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

export type PptxExportTarget = "powerpoint" | "google-slides";

function measureFontMetrics(roots: HTMLElement[]): Record<string, FontMetrics> {
  const context = document.createElement("canvas").getContext?.("2d");
  if (!context || typeof context.measureText !== "function") return {};
  const metrics: Record<string, FontMetrics> = {};
  for (const family of usedFontFamilies(roots)) {
    context.font = `100px "${family.replace(/["\\]/g, "\\$&")}"`;
    const { fontBoundingBoxAscent, fontBoundingBoxDescent } =
      context.measureText("Hg");
    if (fontBoundingBoxAscent > 0 && fontBoundingBoxDescent >= 0) {
      metrics[family] = {
        ascent: fontBoundingBoxAscent / 100,
        descent: fontBoundingBoxDescent / 100,
      };
    }
  }
  return metrics;
}

const FONT_PROBE_TEXT = "mmmmmmmmmmlli 0123 WwQq";

const GENERIC_EXPORT_FACES: Record<string, string> = {
  "sans-serif": "Arial",
  "system-ui": "Arial",
  "ui-sans-serif": "Arial",
  "ui-rounded": "Arial",
  "-apple-system": "Arial",
  blinkmacsystemfont: "Arial",
  serif: "Times New Roman",
  "ui-serif": "Times New Roman",
  monospace: "Courier New",
  "ui-monospace": "Courier New",
};

const GOOGLE_SLIDES_FACE_EQUIVALENTS: Record<string, string> = {
  helvetica: "Arial",
  "helvetica neue": "Arial",
  "segoe ui": "Arial",
  "sf pro": "Arial",
  "sf pro text": "Arial",
  "sf pro display": "Arial",
  times: "Times New Roman",
  courier: "Courier New",
  menlo: "Courier New",
  monaco: "Courier New",
  consolas: "Courier New",
  "sf mono": "Courier New",
};

function createFontRenderProbe(): ((family: string) => boolean) | undefined {
  const context = document.createElement("canvas").getContext?.("2d");
  if (!context || typeof context.measureText !== "function") return undefined;
  const width = (font: string) => {
    context.font = font;
    return context.measureText(FONT_PROBE_TEXT).width;
  };
  if (width("72px monospace") === width("72px serif")) return undefined;
  const cache = new Map<string, boolean>();
  return (family) => {
    const key = family.toLowerCase();
    if (key in GENERIC_EXPORT_FACES) return true;
    let rendered = cache.get(key);
    if (rendered === undefined) {
      const quoted = `"${family.replace(/["\\]/g, "\\$&")}"`;
      rendered = ["monospace", "serif"].some(
        (generic) =>
          width(`72px ${quoted}, ${generic}`) !== width(`72px ${generic}`),
      );
      cache.set(key, rendered);
    }
    return rendered;
  };
}

export function pinRenderedFontFamilies(
  root: HTMLElement,
  target: PptxExportTarget,
) {
  const isRendered = createFontRenderProbe();
  if (!isRendered) return;
  for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
    if (!(element instanceof HTMLElement)) continue;
    if (NON_RENDERING_TAGS.has(element.tagName)) continue;
    const ownText = Array.from(element.childNodes).some(
      (child) => child.nodeType === Node.TEXT_NODE && child.nodeValue?.trim(),
    );
    if (!ownText) continue;
    const stack = window
      .getComputedStyle(element)
      .fontFamily.split(",")
      .map((family) => family.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
    const painted = stack.find((family) => isRendered(family));
    if (!painted) continue;
    const key = painted.toLowerCase();
    const face =
      GENERIC_EXPORT_FACES[key] ??
      (target === "google-slides"
        ? GOOGLE_SLIDES_FACE_EQUIVALENTS[key]
        : undefined) ??
      painted;
    if (face !== stack[0]) element.style.fontFamily = `"${face}"`;
  }
}

function hasRotatedAncestor(
  element: Element,
  root: HTMLElement,
  cache: Map<Element, boolean>,
): boolean {
  const cached = cache.get(element);
  if (cached !== undefined) return cached;
  const transform = window.getComputedStyle(element).transform;
  const matrix = transform.match(/^matrix\(([^)]*)\)$/)?.[1].split(",");
  const rotated =
    (matrix !== undefined &&
      (Math.abs(Number(matrix[1])) > 1e-6 ||
        Math.abs(Number(matrix[2])) > 1e-6)) ||
    transform.startsWith("matrix3d") ||
    (element !== root &&
      element.parentElement !== null &&
      hasRotatedAncestor(element.parentElement, root, cache));
  cache.set(element, rotated);
  return rotated;
}

const PRESERVED_NEWLINE_WHITE_SPACE = /^(pre|pre-wrap|pre-line|break-spaces)$/;

export function markWrappedLines(root: HTMLElement): number {
  const displays = new Map<Element, string>();
  const display = (element: Element) => {
    let value = displays.get(element);
    if (value === undefined) {
      value = window.getComputedStyle(element).display;
      displays.set(element, value);
    }
    return value;
  };
  const containerOf = (node: Node): Element => {
    let element = node.parentElement;
    while (
      element &&
      element !== root &&
      (display(element) === "inline" || display(element) === "contents")
    ) {
      element = element.parentElement;
    }
    return element ?? root;
  };

  const rotation = new Map<Element, boolean>();
  const lineBottoms = new Map<Element, number>();
  const previousGlyphs = new Map<Element, DOMRect>();
  const marks: Array<{ node: Text; offset: number }> = [];
  const range = document.createRange();
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Element) {
      const value = display(node);
      if (
        node.tagName === "BR" ||
        (value !== "inline" && value !== "contents")
      ) {
        const container = containerOf(node);
        lineBottoms.delete(container);
        previousGlyphs.delete(container);
      }
      continue;
    }
    if (!(node instanceof Text)) continue;
    const parent = node.parentElement;
    if (!parent || NON_RENDERING_TAGS.has(parent.tagName)) continue;
    const hidden = parent.closest('[aria-hidden="true"]');
    if (hidden && hidden !== root && root.contains(hidden)) continue;
    const container = containerOf(node);
    if (hasRotatedAncestor(container, root, rotation)) continue;
    const keepsNewlines = PRESERVED_NEWLINE_WHITE_SPACE.test(
      window.getComputedStyle(parent).whiteSpace,
    );
    const rightToLeft = window.getComputedStyle(container).direction === "rtl";
    const text = node.data;
    for (let offset = 0; offset < text.length; offset++) {
      const character = text[offset];
      if (character === "\n" && keepsNewlines) {
        lineBottoms.delete(container);
        previousGlyphs.delete(container);
        continue;
      }
      if (/\s/.test(character)) continue;
      range.setStart(node, offset);
      range.setEnd(node, offset + 1);
      const rect = range.getClientRects()[0];
      if (!rect || (!rect.width && !rect.height)) continue;
      const bottom = lineBottoms.get(container);
      const previous = previousGlyphs.get(container);
      const wrapped =
        bottom !== undefined &&
        (rect.top + rect.height / 2 > bottom ||
          (previous !== undefined &&
            rect.top > previous.top + 0.5 &&
            (rightToLeft
              ? rect.right > previous.right + 0.5
              : rect.left < previous.left - 0.5)));
      if (wrapped) {
        marks.push({ node, offset });
        lineBottoms.set(container, rect.bottom);
      } else {
        lineBottoms.set(
          container,
          Math.max(bottom ?? rect.bottom, rect.bottom),
        );
      }
      previousGlyphs.set(container, rect);
    }
  }
  for (const { node, offset } of marks.reverse()) {
    node.insertData(offset, WRAP_MARK);
  }
  return marks.length;
}

export async function buildDeckPptxBlob(
  deckTitle: string,
  slides: PptxExportSlide[],
  aspectRatio?: AspectRatio,
  { target = "powerpoint" }: { target?: PptxExportTarget } = {},
): Promise<{ blob: Blob; filename: string; blankShapes: number }> {
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
  let blankShapes = 0;

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
      ensureBulletMarkerSpacing(clone.element);
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
      widenNoWrapTextElements(clone.element);
      materializeClipPathShapes(clone.element);
      blankShapes += await replaceInlineSvgsWithImages(clone.element, i + 1);
      await preloadImagesWithCors(clone.element);
      restoreImageGeometry(
        clone.element,
        clone.sourceRect,
        clone.imageGeometry,
        dims,
      );
      await flattenCroppedImages(clone.element);
      materializeCompositeBorders(clone.element);
      materializeImportedBackgroundGrid(clone.element);
      pinRenderedFontFamilies(clone.element, target);
      if (target === "google-slides") markWrappedLines(clone.element);
    }

    const cloneElements = exportClones.map((clone) => clone.element);
    const [dominantFamily] = usedFontFamilies(cloneElements);
    const fonts = await resolveExportFonts(cloneElements);
    const initialBlob = await exportToPptx(cloneElements, {
      autoEmbedFonts: false,
      fonts,
      fileName: safePptxName(deckTitle),
      height: dims.pptxInches.h,
      skipDownload: true,
      svgAsVector: false,
      width: dims.pptxInches.w,
    });

    const pinnedBlob = await pinTextBoxesForImport(initialBlob, dominantFamily);
    const bulletPatchedBlob = await patchBulletIndentsInPptxBlob(
      pinnedBlob,
      slideBulletIndents,
    );
    const notedBlob = await addSpeakerNotesToPptxBlob(
      bulletPatchedBlob,
      slides,
      dims.pptxInches,
    );
    const blob =
      target === "google-slides"
        ? await retargetPptxForGoogleSlides(
            notedBlob,
            measureFontMetrics(cloneElements),
          )
        : notedBlob;
    if (blankShapes > 0) {
      console.warn(
        `[export-pptx] ${blankShapes} shape(s) rendered empty and are missing from ${deckTitle}`,
      );
    }
    return { blankShapes, blob, filename: safePptxName(deckTitle) };
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
): Promise<{ blankShapes: number }> {
  const { blankShapes, blob, filename } = await buildDeckPptxBlob(
    deckTitle,
    slides,
    aspectRatio,
  );
  triggerBlobDownload(blob, filename);
  return { blankShapes };
}
