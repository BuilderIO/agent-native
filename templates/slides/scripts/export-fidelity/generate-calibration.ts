import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const templateFlag = process.argv.indexOf("--template");
const TEMPLATE_PPTX =
  templateFlag === -1 ? "" : (process.argv[templateFlag + 1] ?? "");
if (!TEMPLATE_PPTX) {
  throw new Error(
    "Pass --template <deck.pptx>: a real exported deck whose package parts this generator reuses, such as the deck.pptx written by export.ts --out <dir>.",
  );
}
const OUT_PPTX = path.join(HERE, "calibration.pptx");
const OUT_CASES = path.join(HERE, "cases.json");

const EMU_PER_POINT = 12700;
const SLIDE_W_PT = 960;
const SLIDE_H_PT = 540;
const emu = (pt: number) => Math.round(pt * EMU_PER_POINT);


type LnSpc =
  | { kind: "pts"; val: number }
  | { kind: "pct"; val: number }
  | { kind: "none" };
type Anchor = "t" | "ctr" | "b";
type Autofit = "noAutofit" | "spAutoFit" | "normAutofit";
type BreakType = "br" | "p";

interface BoxDef {
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  font: string;
  sizePt: number;
  lnSpc: LnSpc;
  anchor: Anchor;
  tIns: number;
  lIns: number;
  autofit: Autofit;
  spc?: number;
  lines: string[];
  breakType: BreakType;
  spcBefLines?: boolean[];
}

const lnSpcStr = (l: LnSpc) =>
  l.kind === "none" ? "none" : `${l.kind}:${l.val}`;
const threeLineBr = (label: string) => [
  `${label} L1 Alpha`,
  "L2 Bravo",
  "L3 Charlie",
];
const twoLineBr = (label: string) => [`${label} L1 Alpha`, "L2 Bravo"];
const oneLine = (label: string, text: string) => [`${label} ${text}`];


const GRID_A = [
  { x: 20, y: 60 },
  { x: 330, y: 60 },
  { x: 640, y: 60 },
  { x: 20, y: 280 },
  { x: 330, y: 280 },
  { x: 640, y: 280 },
];
const GRID_A_SIZE = { w: 300, h: 200 };

const GRID_B = [
  { x: 20, y: 100 },
  { x: 330, y: 100 },
  { x: 640, y: 100 },
  { x: 20, y: 320 },
  { x: 330, y: 320 },
  { x: 640, y: 320 },
];
const GRID_B_SIZE = { w: 300, h: 120 };

function gridBoxes(
  grid: { x: number; y: number }[],
  size: { w: number; h: number },
  common: Omit<BoxDef, "label" | "x" | "y" | "w" | "h" | "lnSpc" | "lines"> & {
    labelPrefix: string;
  },
  perBox: { lnSpc: LnSpc; lines: string[] }[],
): BoxDef[] {
  return grid.map((pos, i) => {
    const label = `${common.labelPrefix}B${i + 1}`;
    return {
      label,
      x: pos.x,
      y: pos.y,
      w: size.w,
      h: size.h,
      font: common.font,
      sizePt: common.sizePt,
      lnSpc: perBox[i].lnSpc,
      anchor: common.anchor,
      tIns: common.tIns,
      lIns: common.lIns,
      autofit: common.autofit,
      spc: common.spc,
      lines: perBox[i].lines,
      breakType: common.breakType,
    };
  });
}

function slide1(): BoxDef[] {
  const font = "Inter";
  const sizePt = 40;
  const lnSpcs: LnSpc[] = [
    { kind: "pts", val: 4000 },
    { kind: "pts", val: 4200 },
    { kind: "pts", val: 6000 },
    { kind: "pct", val: 100000 },
    { kind: "pct", val: 125000 },
    { kind: "none" },
  ];
  const labelPrefix = "S1";
  return gridBoxes(
    GRID_A,
    GRID_A_SIZE,
    {
      font,
      sizePt,
      anchor: "t",
      tIns: 0,
      lIns: 0,
      autofit: "noAutofit",
      breakType: "br",
      labelPrefix,
    },
    lnSpcs.map((lnSpc, i) => ({
      lnSpc,
      lines: threeLineBr(`${labelPrefix}B${i + 1}`),
    })),
  );
}

function slide2(): BoxDef[] {
  const font = "Inter";
  const sizePt = 16;
  const lnSpcs: LnSpc[] = [
    { kind: "pts", val: 1600 },
    { kind: "pts", val: 2400 },
    { kind: "pts", val: 3200 },
    { kind: "pct", val: 100000 },
    { kind: "pct", val: 150000 },
    { kind: "none" },
  ];
  const labelPrefix = "S2";
  return gridBoxes(
    GRID_A,
    GRID_A_SIZE,
    {
      font,
      sizePt,
      anchor: "t",
      tIns: 0,
      lIns: 0,
      autofit: "noAutofit",
      breakType: "br",
      labelPrefix,
    },
    lnSpcs.map((lnSpc, i) => ({
      lnSpc,
      lines: threeLineBr(`${labelPrefix}B${i + 1}`),
    })),
  );
}

function slide3(): BoxDef[] {
  const font = "Geist Mono";
  const sizePt = 12;
  const labelPrefix = "S3";
  const brLnSpcs: LnSpc[] = [
    { kind: "pts", val: 1200 },
    { kind: "pts", val: 1800 },
    { kind: "pct", val: 100000 },
    { kind: "pct", val: 150000 },
    { kind: "none" },
  ];
  const boxes: BoxDef[] = brLnSpcs.map((lnSpc, i) => {
    const label = `${labelPrefix}B${i + 1}`;
    const pos = GRID_A[i];
    return {
      label,
      x: pos.x,
      y: pos.y,
      w: GRID_A_SIZE.w,
      h: GRID_A_SIZE.h,
      font,
      sizePt,
      lnSpc,
      anchor: "t",
      tIns: 0,
      lIns: 0,
      autofit: "noAutofit",
      lines: threeLineBr(label),
      breakType: "br",
    };
  });
  const label6 = `${labelPrefix}B6`;
  const pos6 = GRID_A[5];
  boxes.push({
    label: label6,
    x: pos6.x,
    y: pos6.y,
    w: GRID_A_SIZE.w,
    h: GRID_A_SIZE.h,
    font,
    sizePt,
    lnSpc: { kind: "pts", val: 1800 },
    anchor: "t",
    tIns: 0,
    lIns: 0,
    autofit: "noAutofit",
    lines: threeLineBr(label6),
    breakType: "p",
  });
  return boxes;
}

function slide4(): BoxDef[] {
  const sizePt = 20;
  const labelPrefix = "S4";
  const arialLnSpcs: LnSpc[] = [
    { kind: "pts", val: 2000 },
    { kind: "pts", val: 3000 },
    { kind: "pct", val: 100000 },
    { kind: "pct", val: 150000 },
    { kind: "none" },
  ];
  const boxes: BoxDef[] = arialLnSpcs.map((lnSpc, i) => {
    const label = `${labelPrefix}B${i + 1}`;
    const pos = GRID_A[i];
    return {
      label,
      x: pos.x,
      y: pos.y,
      w: GRID_A_SIZE.w,
      h: GRID_A_SIZE.h,
      font: "Arial",
      sizePt,
      lnSpc,
      anchor: "t",
      tIns: 0,
      lIns: 0,
      autofit: "noAutofit",
      lines: oneLine(label, "Sample Text"),
      breakType: "br",
    };
  });
  const label6 = `${labelPrefix}B6`;
  const pos6 = GRID_A[5];
  boxes.push({
    label: label6,
    x: pos6.x,
    y: pos6.y,
    w: GRID_A_SIZE.w,
    h: GRID_A_SIZE.h,
    font: "Inter",
    sizePt,
    lnSpc: { kind: "pts", val: 3000 },
    anchor: "t",
    tIns: 0,
    lIns: 0,
    autofit: "noAutofit",
    lines: oneLine(label6, "Sample Text"),
    breakType: "br",
  });
  return boxes;
}

function slide5(): BoxDef[] {
  const font = "Inter";
  const sizePt = 18;
  const lnSpc: LnSpc = { kind: "pts", val: 2700 };
  const labelPrefix = "S5";
  const variants: Array<Pick<BoxDef, "anchor" | "tIns" | "lIns" | "autofit">> =
    [
      { anchor: "t", tIns: 0, lIns: 0, autofit: "noAutofit" }, // (a)
      { anchor: "t", tIns: 10, lIns: 20, autofit: "noAutofit" }, // (b) 127000/254000 EMU
      { anchor: "ctr", tIns: 0, lIns: 0, autofit: "noAutofit" }, // (c)
      { anchor: "b", tIns: 0, lIns: 0, autofit: "noAutofit" }, // (d)
      { anchor: "t", tIns: 0, lIns: 0, autofit: "spAutoFit" }, // (e)
      { anchor: "t", tIns: 0, lIns: 0, autofit: "normAutofit" }, // (f)
    ];
  return GRID_B.map((pos, i) => {
    const label = `${labelPrefix}B${i + 1}`;
    return {
      label,
      x: pos.x,
      y: pos.y,
      w: GRID_B_SIZE.w,
      h: GRID_B_SIZE.h,
      font,
      sizePt,
      lnSpc,
      ...variants[i],
      lines: twoLineBr(label),
      breakType: "br" as const,
    };
  });
}

function slide6(): BoxDef[] {
  const labelPrefix = "S6";
  const interText = "Hamburgefonstiv Quarterly";
  const monoText = "HAMBURGEFONSTIV QUARTERLY";
  const rowY = [10, 74, 138, 202, 266];
  const common = {
    w: 800,
    h: 60,
    x: 80,
    anchor: "t" as const,
    tIns: 0,
    lIns: 0,
    autofit: "noAutofit" as const,
  };

  const b1 = `${labelPrefix}B1`;
  const b2 = `${labelPrefix}B2`;
  const b3 = `${labelPrefix}B3`;
  const b4 = `${labelPrefix}B4`;
  const b5 = `${labelPrefix}B5`;
  const b6 = `${labelPrefix}B6`;

  const boxes: BoxDef[] = [
    {
      label: b1,
      y: rowY[0],
      font: "Inter",
      sizePt: 40,
      lnSpc: { kind: "none" },
      lines: oneLine(b1, interText),
      breakType: "br",
      ...common,
    },
    {
      label: b2,
      y: rowY[1],
      font: "Inter",
      sizePt: 40,
      lnSpc: { kind: "none" },
      spc: -160,
      lines: oneLine(b2, interText),
      breakType: "br",
      ...common,
    },
    {
      label: b3,
      y: rowY[2],
      font: "Inter",
      sizePt: 40,
      lnSpc: { kind: "none" },
      spc: 400,
      lines: oneLine(b3, interText),
      breakType: "br",
      ...common,
    },
    {
      label: b4,
      y: rowY[3],
      font: "Geist Mono",
      sizePt: 13,
      lnSpc: { kind: "none" },
      lines: oneLine(b4, monoText),
      breakType: "br",
      ...common,
    },
    {
      label: b5,
      y: rowY[4],
      font: "Geist Mono",
      sizePt: 13,
      lnSpc: { kind: "none" },
      spc: 156,
      lines: oneLine(b5, monoText),
      breakType: "br",
      ...common,
    },
    {
      label: b6,
      x: 280,
      y: 330,
      w: 400,
      h: 200,
      font: "Inter",
      sizePt: 16,
      lnSpc: { kind: "pts", val: 2400 },
      anchor: "t",
      tIns: 0,
      lIns: 0,
      autofit: "noAutofit",
      lines: threeLineBr(b6),
      breakType: "p",
      spcBefLines: [false, true, true],
    },
  ];
  return boxes;
}

const SLIDES: BoxDef[][] = [
  slide1(),
  slide2(),
  slide3(),
  slide4(),
  slide5(),
  slide6(),
];

function assertNoOverlaps() {
  SLIDES.forEach((boxes, slideIdx) => {
    for (const b of boxes) {
      if (
        b.x < 0 ||
        b.y < 0 ||
        b.x + b.w > SLIDE_W_PT ||
        b.y + b.h > SLIDE_H_PT
      ) {
        throw new Error(
          `Slide ${slideIdx + 1} box ${b.label} out of bounds: (${b.x},${b.y})-(${b.x + b.w},${b.y + b.h})`,
        );
      }
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const c = boxes[j];
        const overlap =
          a.x < c.x + c.w &&
          c.x < a.x + a.w &&
          a.y < c.y + c.h &&
          c.y < a.y + a.h;
        if (overlap) {
          throw new Error(
            `Slide ${slideIdx + 1} boxes ${a.label} and ${c.label} overlap`,
          );
        }
      }
    }
  });
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function lnSpcXml(l: LnSpc): string {
  if (l.kind === "none") return "";
  if (l.kind === "pts") return `<a:lnSpc><a:spcPts val="${l.val}"/></a:lnSpc>`;
  return `<a:lnSpc><a:spcPct val="${l.val}"/></a:lnSpc>`;
}

function runXml(box: BoxDef, text: string): string {
  const sz = Math.round(box.sizePt * 100);
  const spcAttr = box.spc !== undefined ? ` spc="${box.spc}"` : "";
  return `<a:r><a:rPr lang="en-US" sz="${sz}"${spcAttr}><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:latin typeface="${esc(box.font)}"/></a:rPr><a:t>${esc(text)}</a:t></a:r>`;
}

function paragraphsXml(box: BoxDef): string {
  if (box.breakType === "br") {
    const pPr = `<a:pPr algn="l">${lnSpcXml(box.lnSpc)}</a:pPr>`;
    const runs = box.lines
      .map((text, i) =>
        i === 0 ? runXml(box, text) : `<a:br/>${runXml(box, text)}`,
      )
      .join("");
    return `<a:p>${pPr}${runs}</a:p>`;
  }
  return box.lines
    .map((text, i) => {
      const spcBef = box.spcBefLines?.[i]
        ? `<a:spcBef><a:spcPts val="1200"/></a:spcBef>`
        : "";
      const pPr = `<a:pPr algn="l">${lnSpcXml(box.lnSpc)}${spcBef}</a:pPr>`;
      return `<a:p>${pPr}${runXml(box, text)}</a:p>`;
    })
    .join("");
}

function buildBoxXml(id: number, box: BoxDef): string {
  const name = `CAL ${box.label}`;
  const autofitXml = `<a:${box.autofit}/>`;
  return (
    `<p:sp>` +
    `<p:nvSpPr><p:cNvPr id="${id}" name="${esc(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr>` +
    `<a:xfrm><a:off x="${emu(box.x)}" y="${emu(box.y)}"/><a:ext cx="${emu(box.w)}" cy="${emu(box.h)}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
    `<a:noFill/>` +
    `</p:spPr>` +
    `<p:txBody>` +
    `<a:bodyPr wrap="square" lIns="${emu(box.lIns)}" tIns="${emu(box.tIns)}" rIns="0" bIns="0" anchor="${box.anchor}">${autofitXml}</a:bodyPr>` +
    `<a:lstStyle/>` +
    paragraphsXml(box) +
    `</p:txBody>` +
    `</p:sp>`
  );
}

function buildBgXml(
  id: number,
  slideCxEmu: number,
  slideCyEmu: number,
): string {
  return (
    `<p:sp>` +
    `<p:nvSpPr><p:cNvPr id="${id}" name="Background"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr>` +
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${slideCxEmu}" cy="${slideCyEmu}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
    `<a:solidFill><a:srgbClr val="000000"/></a:solidFill>` +
    `<a:ln><a:noFill/></a:ln>` +
    `</p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody>` +
    `</p:sp>`
  );
}

function buildSlideXml(
  boxes: BoxDef[],
  slideCxEmu: number,
  slideCyEmu: number,
): string {
  let id = 2;
  const bg = buildBgXml(id++, slideCxEmu, slideCyEmu);
  const shapes = boxes.map((b) => buildBoxXml(id++, b)).join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
    `<p:cSld><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    bg +
    shapes +
    `</p:spTree></p:cSld>` +
    `<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>` +
    `</p:sld>`
  );
}

const SLIDE_RELS_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
  `</Relationships>`;

const STRIP_PREFIXES = [
  "ppt/slides/",
  "ppt/notesSlides/",
  "ppt/media/",
  "ppt/charts/",
  "ppt/embeddings/",
  "ppt/fonts/",
];

async function main() {
  assertNoOverlaps();

  const templateBuf = await fs.readFile(TEMPLATE_PPTX);
  const zip = await JSZip.loadAsync(templateBuf);

  const presentationBefore = await zip
    .file("ppt/presentation.xml")!
    .async("string");
  const sldSzMatch = /<p:sldSz cx="(\d+)" cy="(\d+)"/.exec(presentationBefore);
  if (!sldSzMatch)
    throw new Error("Could not find <p:sldSz> in ppt/presentation.xml");
  const slideCxEmu = Number(sldSzMatch[1]);
  const slideCyEmu = Number(sldSzMatch[2]);

  for (const relPath of Object.keys(zip.files)) {
    if (STRIP_PREFIXES.some((p) => relPath.startsWith(p))) {
      zip.remove(relPath);
    }
  }

  SLIDES.forEach((boxes, i) => {
    const n = i + 1;
    zip.file(
      `ppt/slides/slide${n}.xml`,
      buildSlideXml(boxes, slideCxEmu, slideCyEmu),
    );
    zip.file(`ppt/slides/_rels/slide${n}.xml.rels`, SLIDE_RELS_XML);
  });

  let contentTypes = await zip.file("[Content_Types].xml")!.async("string");
  contentTypes = contentTypes
    .replace(/<Override PartName="\/ppt\/slides\/slide\d+\.xml"[^>]*\/>/g, "")
    .replace(
      /<Override PartName="\/ppt\/notesSlides\/notesSlide\d+\.xml"[^>]*\/>/g,
      "",
    )
    .replace(/<Default Extension="fntdata"[^>]*\/>/g, "");
  const newSlideOverrides = SLIDES.map(
    (_, i) =>
      `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
  ).join("");
  contentTypes = contentTypes.replace(
    "</Types>",
    `${newSlideOverrides}</Types>`,
  );
  zip.file("[Content_Types].xml", contentTypes);

  let presRels = await zip
    .file("ppt/_rels/presentation.xml.rels")!
    .async("string");
  presRels = presRels
    .replace(
      /<Relationship Id="rId\d+" Type="[^"]*\/relationships\/slide" Target="slides\/slide\d+\.xml"\/>/g,
      "",
    )
    .replace(/<Relationship Id="rId201314"[^>]*\/>/g, "");
  const firstSlideRel =
    Math.max(
      0,
      ...[...presRels.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1])),
    ) + 1;
  const newSlideRels = SLIDES.map(
    (_, i) =>
      `<Relationship Id="rId${firstSlideRel + i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`,
  ).join("");
  presRels = presRels.replace(
    "</Relationships>",
    `${newSlideRels}</Relationships>`,
  );
  zip.file("ppt/_rels/presentation.xml.rels", presRels);

  let presentation = await zip.file("ppt/presentation.xml")!.async("string");
  const newSldIdLst =
    "<p:sldIdLst>" +
    SLIDES.map(
      (_, i) => `<p:sldId id="${256 + i}" r:id="rId${firstSlideRel + i}"/>`,
    ).join("") +
    "</p:sldIdLst>";
  presentation = presentation
    .replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, newSldIdLst)
    .replace(/<p:embeddedFontLst>[\s\S]*?<\/p:embeddedFontLst>/, "");
  zip.file("ppt/presentation.xml", presentation);

  const outBuf = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
  await fs.writeFile(OUT_PPTX, outBuf);

  const cases = SLIDES.flatMap((boxes, i) =>
    boxes.map((b) => ({
      slide: i + 1,
      label: b.label,
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
      font: b.font,
      sizePt: b.sizePt,
      lnSpc: lnSpcStr(b.lnSpc),
      anchor: b.anchor,
      tIns: b.tIns,
      lIns: b.lIns,
      autofit: b.autofit,
      spc: b.spc ?? null,
      lines: b.lines.length,
      breakType: b.breakType,
    })),
  );
  await fs.writeFile(OUT_CASES, JSON.stringify(cases, null, 2));

  const errors = await validatePackage(OUT_PPTX);
  if (errors.length > 0) {
    console.error(`VALIDATION FAILED (${errors.length} issue(s)):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  const stat = await fs.stat(OUT_PPTX);
  console.log(`OK: wrote ${SLIDES.length} slides, ${cases.length} boxes.`);
  console.log(`PPTX: ${OUT_PPTX} (${stat.size} bytes)`);
  console.log(`Cases: ${OUT_CASES}`);
}

async function validatePackage(pptxPath: string): Promise<string[]> {
  const errors: string[] = [];
  const buf = await fs.readFile(pptxPath);
  const zip = await JSZip.loadAsync(buf);
  const allPaths = Object.keys(zip.files).filter((p) => !zip.files[p].dir);
  const partSet = new Set(allPaths);

  const resolveTarget = (baseDir: string, target: string): string => {
    if (target.startsWith("/")) return path.posix.normalize(target.slice(1));
    return path.posix.normalize(path.posix.join(baseDir, target));
  };

  for (const p of allPaths) {
    if (!p.endsWith(".rels")) continue;
    const xml = await zip.files[p].async("string");
    const relsDir = p.slice(0, p.lastIndexOf("/"));
    const baseDir = relsDir.replace(/(^|\/)_rels$/, "");
    const relTagRe = /<Relationship\b[^>]*\/>/g;
    let m: RegExpExecArray | null;
    while ((m = relTagRe.exec(xml))) {
      const tag = m[0];
      const targetMatch = /Target="([^"]+)"/.exec(tag);
      const modeMatch = /TargetMode="([^"]+)"/.exec(tag);
      if (!targetMatch || (modeMatch && modeMatch[1] === "External")) continue;
      const resolved = resolveTarget(baseDir, targetMatch[1]);
      if (!partSet.has(resolved)) {
        errors.push(
          `${p}: target "${targetMatch[1]}" -> missing part "${resolved}"`,
        );
      }
    }
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    allowBooleanAttributes: true,
  });
  for (const p of allPaths) {
    if (!p.endsWith(".xml")) continue;
    const xml = await zip.files[p].async("string");
    try {
      parser.parse(xml);
    } catch (err) {
      errors.push(`${p}: XML parse error: ${(err as Error).message}`);
    }
  }

  const contentTypes = await zip.file("[Content_Types].xml")!.async("string");
  const slideOverrideCount = (
    contentTypes.match(
      /ContentType="application\/vnd\.openxmlformats-officedocument\.presentationml\.slide\+xml"/g,
    ) || []
  ).length;
  if (slideOverrideCount !== SLIDES.length) {
    errors.push(
      `[Content_Types].xml: expected ${SLIDES.length} slide overrides, found ${slideOverrideCount}`,
    );
  }
  const presentation = await zip.file("ppt/presentation.xml")!.async("string");
  const sldIdCount = (presentation.match(/<p:sldId\b/g) || []).length;
  if (sldIdCount !== SLIDES.length) {
    errors.push(
      `presentation.xml: expected ${SLIDES.length} sldId entries, found ${sldIdCount}`,
    );
  }
  if (presentation.includes("embeddedFontLst")) {
    errors.push(`presentation.xml: embeddedFontLst was not removed`);
  }
  if (partSet.has("ppt/fonts/201314.fntdata")) {
    errors.push(`ppt/fonts/201314.fntdata still present in package`);
  }

  return errors;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
