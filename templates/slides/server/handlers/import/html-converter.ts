import { ASPECT_RATIOS } from "@shared/aspect-ratios";

import type {
  ParsedElement,
  ParsedParagraph,
  ParsedSlide,
  ParsedTextRun,
} from "./pptx-parser.js";

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildFullBleedImageSlideHtml(
  imageUrl: string,
  headingText?: string,
  subtitleText?: string,
): string {
  let overlay = "";
  if (headingText && subtitleText) {
    overlay = `\n    <div style="position: absolute; left: 0; right: 0; bottom: 0; background: linear-gradient(to top, rgba(12,10,8,0.95) 0%, rgba(12,10,8,0.88) 55%, rgba(12,10,8,0.4) 82%, rgba(12,10,8,0) 100%); padding: 56px 56px 60px; text-align: center; font-family: 'Poppins', sans-serif;">
      <div style="width: 72px; height: 3px; background: #d8b26a; margin: 0 auto 20px;"></div>
      <h2 style="font-size: 30px; font-weight: 800; color: #d8b26a; line-height: 1.25; margin: 0 0 14px;">${esc(headingText)}</h2>
      <p style="font-size: 19px; font-weight: 500; color: #fff; line-height: 1.5; margin: 0;">${esc(subtitleText)}</p>
    </div>`;
  } else if (headingText) {
    overlay = `\n    <div style="position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.15) 45%, rgba(0,0,0,0) 65%);"></div>
    <div style="position: absolute; left: 0; right: 0; bottom: 0; padding: 60px 70px; font-family: 'Poppins', sans-serif;">
      <h2 style="font-size: 40px; font-weight: 900; color: #fff; line-height: 1.15; letter-spacing: -1px; margin: 0;">${esc(headingText)}</h2>
    </div>`;
  }
  return `<div class="fmd-slide" style="position: relative; width: 100%; height: 100%; overflow: hidden;">
    <img src="${esc(imageUrl)}" alt="" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;" />${overlay}
</div>`;
}

export function buildFullPageImageSlideHtml(
  imageUrl: string,
  sourceWidth?: number,
  sourceHeight?: number,
): string {
  const sourceDimensions =
    Number.isFinite(sourceWidth) &&
    Number.isFinite(sourceHeight) &&
    sourceWidth! > 0 &&
    sourceHeight! > 0
      ? ` data-source-width="${sourceWidth}" data-source-height="${sourceHeight}"`
      : "";
  return `<div class="fmd-slide fmd-imported-pdf" data-imported-pdf="true"${sourceDimensions} style="position: relative; width: 100%; height: 100%; overflow: hidden; background: hsl(var(--background));">
    <img src="${esc(imageUrl)}" alt="" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain;" />
</div>`;
}

function formatRun(run: ParsedTextRun): string {
  let text = esc(run.content);
  if (run.color)
    text = `<span style="color: ${esc(run.color)};">${text}</span>`;
  if (run.bold) text = `<strong>${text}</strong>`;
  if (run.italic) text = `<em>${text}</em>`;
  return text;
}

const DEFAULT_IMPORT_FONT = "'Poppins', sans-serif";

const FONT_WEIGHT_SUFFIX =
  /[ _-](?:ultra|extra|semi|demi)?[ _-]?(?:black|heavy|bold|medium|regular|normal|roman|book|light|thin|italic|oblique)$/i;

function cssFontFamily(themeFont: string | undefined): string {
  if (!themeFont) return DEFAULT_IMPORT_FONT;
  const safeName = themeFont.replace(/["']/g, "").trim();
  if (!safeName) return DEFAULT_IMPORT_FONT;
  let base = safeName;
  while (FONT_WEIGHT_SUFFIX.test(base)) {
    const stripped = base.replace(FONT_WEIGHT_SUFFIX, "").trim();
    if (!stripped) break;
    base = stripped;
  }
  return base === safeName
    ? `'${safeName}', sans-serif`
    : `'${safeName}', '${base}', sans-serif`;
}

function groupIntoParagraphs(texts: ParsedTextRun[]): ParsedTextRun[][] {
  const paragraphs: ParsedTextRun[][] = [];
  let current: ParsedTextRun[] = [];

  for (const run of texts) {
    const parts = run.content.split(/\r?\n/);
    for (let i = 0; i < parts.length; i++) {
      if (i > 0 && current.length > 0) {
        paragraphs.push(current);
        current = [];
      }
      const text = parts[i].trim();
      if (text) {
        current.push({ ...run, content: text });
      }
    }
  }
  if (current.length > 0) {
    paragraphs.push(current);
  }

  return paragraphs;
}

export function convertToSlideHtml(
  slide: ParsedSlide,
  imageUrls?: string | Record<string, string>,
  themeFont?: string,
): string {
  if (slide.elements) {
    return buildFidelitySlide(slide, imageUrls, themeFont);
  }

  const paragraphs = groupIntoParagraphs(slide.texts);
  const fontFamily = cssFontFamily(themeFont);

  if (slide.images.length > 0) {
    return buildImageSlide(
      paragraphs,
      slide,
      typeof imageUrls === "string" ? imageUrls : undefined,
      fontFamily,
    );
  }

  if (slide.layoutHint === "title" || paragraphs.length <= 2) {
    return buildTitleSlide(paragraphs, slide, fontFamily);
  }

  return buildContentSlide(paragraphs, slide, fontFamily);
}

const DEFAULT_SLIDE_WIDTH_EMU = 9144000;
const DEFAULT_SLIDE_HEIGHT_EMU = 5143500;
const DEFAULT_PPTX_BACKGROUND = "#ffffff"; // guard:allow-raw-color - PPTX's own white default when no background is declared
// OOXML's own default run color when nothing in the run, the placeholder
// chain, or `<p:txStyles>` declares one. It has to be the value the file
// format states, not a readable-looking approximation: an invented near-black
// renders beside the deck's real black inside a single text box, which is
// visible as two different blacks in one paragraph.
const DEFAULT_PPTX_FOREGROUND = "#000000"; // guard:allow-raw-color - OOXML's declared default text color
/**
 * OOXML's own default run size, used only when the run, its placeholder
 * chain, and the deck's `<p:defaultTextStyle>` all fail to state one.
 * KNOWN GAP: the parser does not read `<p:defaultTextStyle>` or the master's
 * `<p:otherStyle>`, and real decks routinely declare 14pt there — an unsized
 * run in one of those decks renders 28% oversized and overflows its authored
 * box. Fixing that needs the parser to surface the deck's declared default,
 * not a different constant here.
 */
const DEFAULT_PPTX_FONT_SIZE_PT = 18;

function referenceBoxForSlide(
  widthEmu: number,
  heightEmu: number,
): { width: number; height: number } {
  const target = widthEmu / heightEmu;
  let best: { width: number; height: number } = ASPECT_RATIOS["16:9"];
  let bestDiff = Infinity;
  for (const preset of Object.values(ASPECT_RATIOS)) {
    const diff = Math.abs(preset.width / preset.height - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = preset;
    }
  }
  return { width: best.width, height: best.height };
}

function buildFidelitySlide(
  slide: ParsedSlide,
  imageUrls: string | Record<string, string> | undefined,
  themeFont: string | undefined,
): string {
  const widthEmu = slide.widthEmu || DEFAULT_SLIDE_WIDTH_EMU;
  const heightEmu = slide.heightEmu || DEFAULT_SLIDE_HEIGHT_EMU;
  const refBox = referenceBoxForSlide(widthEmu, heightEmu);
  const background = slide.backgroundColor ?? DEFAULT_PPTX_BACKGROUND;
  const gridStyle = slide.backgroundGrid
    ? `background-image:linear-gradient(to right, ${esc(slide.backgroundGrid.color)} 0 ${Math.max(0.5, toSlidePxX(slide.backgroundGrid.lineWidthEmu, widthEmu, refBox.width))}px, transparent ${Math.max(0.5, toSlidePxX(slide.backgroundGrid.lineWidthEmu, widthEmu, refBox.width))}px),linear-gradient(to bottom, ${esc(slide.backgroundGrid.color)} 0 ${Math.max(0.5, toSlidePxY(slide.backgroundGrid.lineWidthEmu, heightEmu, refBox.height))}px, transparent ${Math.max(0.5, toSlidePxY(slide.backgroundGrid.lineWidthEmu, heightEmu, refBox.height))}px);background-size:${toSlidePxX(slide.backgroundGrid.stepXEmu, widthEmu, refBox.width)}px ${toSlidePxY(slide.backgroundGrid.stepYEmu, heightEmu, refBox.height)}px;background-position:${toSlidePxX(slide.backgroundGrid.offsetXEmu, widthEmu, refBox.width)}px ${toSlidePxY(slide.backgroundGrid.offsetYEmu, heightEmu, refBox.height)}px;background-repeat:repeat;`
    : "";
  const elements = slide.elements ?? [];
  const html = elements
    .map((element, index) =>
      buildFidelityElement(
        element,
        index,
        widthEmu,
        heightEmu,
        refBox,
        imageUrls,
        themeFont,
      ),
    )
    .join("\n");

  return `<div class="fmd-slide fmd-imported-pptx" data-imported-pptx="true" data-slide-width-emu="${widthEmu}" data-slide-height-emu="${heightEmu}" style="position: relative; width: 100%; height: 100%; overflow: hidden; background: ${esc(background)};${gridStyle} font-family: ${cssFontFamily(themeFont)};">${html}
</div>`;
}

function buildFidelityElement(
  element: ParsedElement,
  index: number,
  widthEmu: number,
  heightEmu: number,
  refBox: { width: number; height: number },
  imageUrls: string | Record<string, string> | undefined,
  themeFont: string | undefined,
): string {
  const widthPx = toSlidePxX(element.width, widthEmu, refBox.width);
  const heightPx = toSlidePxY(element.height, heightEmu, refBox.height);
  const position = `position: absolute; left: ${toSlidePxX(element.x, widthEmu, refBox.width)}px; top: ${toSlidePxY(element.y, heightEmu, refBox.height)}px; width: ${widthPx}px; height: ${heightPx}px; z-index: ${index}; box-sizing: border-box;`;
  const rotation = element.rotation
    ? ` transform: rotate(${element.rotation}deg); transform-origin: center center;`
    : "";
  const objectId = ` data-slide-object-id="${esc(element.id)}"`;

  if (element.kind === "image") {
    const url = imageUrlForElement(element, imageUrls);
    const imageStyle = imageRenderStyle(element);
    const imagePath = customGeometryPath(element, widthPx, heightPx);
    const clip = imagePath
      ? `clip-path: path('${imagePath}');`
      : geometryCss(element, widthPx, heightPx);
    return `<div class="fmd-pptx-image" data-pptx-element-kind="image" data-pptx-image-name="${esc(element.image?.name ?? "image")}"${objectId} style="${position}${rotation} overflow: hidden;${clip}">${url ? `<img src="${esc(url)}" alt="" style="${imageStyle}" />` : `<div class="fmd-img-placeholder" style="width:100%;height:100%;">Imported image: ${esc(element.image?.name ?? "image")}</div>`}</div>`;
  }

  if (element.kind === "table") {
    return buildFidelityTable(
      element,
      widthEmu,
      refBox.width,
      themeFont,
      position,
      rotation,
      objectId,
    );
  }

  const customPath =
    element.kind === "shape"
      ? customGeometryPath(element, widthPx, heightPx)
      : undefined;
  const outlinePath =
    element.kind === "shape"
      ? (customPath ?? clippedPresetPath(element, widthPx, heightPx))
      : undefined;
  const decoration = shapeDecoration(
    element,
    widthEmu,
    refBox.width,
    widthPx,
    heightPx,
    customPath,
    outlinePath,
  );
  if (element.kind === "shape") {
    const stroke = outlinePath
      ? customGeometryStroke(
          element,
          outlinePath,
          widthEmu,
          refBox.width,
          widthPx,
          heightPx,
        )
      : "";
    const caps = lineEndCaps(
      element,
      widthEmu,
      refBox.width,
      widthPx,
      heightPx,
    );
    return `<div class="fmd-pptx-shape" data-pptx-element-kind="shape"${objectId} style="${position}${rotation}${decoration}">${stroke}${caps}</div>`;
  }

  const textStyle = textBoxStyle(
    element,
    widthEmu,
    heightEmu,
    refBox,
    themeFont,
  );
  const defaultFontWeight = element.placeholderType === "title" ? 700 : 400;
  const boxFontSizePt = firstDeclaredFontSizePt(element.paragraphs);
  const paragraphs = (element.paragraphs ?? [])
    .map((paragraph, paragraphIndex) =>
      buildFidelityParagraph(
        paragraph,
        paragraphIndex,
        widthEmu,
        refBox.width,
        themeFont,
        defaultFontWeight,
        boxFontSizePt,
      ),
    )
    .join("\n");
  return `<div class="fmd-pptx-text" data-pptx-element-kind="text"${objectId} style="${position}${rotation}${decoration}${textStyle}">${paragraphs}</div>`;
}

function toSlidePxX(
  valueEmu: number,
  slideWidthEmu: number,
  refWidthPx: number,
): number {
  return Math.round((valueEmu / slideWidthEmu) * refWidthPx * 1000) / 1000;
}

function toSlidePxY(
  valueEmu: number,
  slideHeightEmu: number,
  refHeightPx: number,
): number {
  return Math.round((valueEmu / slideHeightEmu) * refHeightPx * 1000) / 1000;
}

const EMU_PER_POINT = 12700;

function ptToSlidePx(
  valuePt: number,
  widthEmu: number,
  refWidthPx: number,
): number {
  return toSlidePxX(valuePt * EMU_PER_POINT, widthEmu, refWidthPx);
}

function imageUrlForElement(
  element: ParsedElement,
  imageUrls: string | Record<string, string> | undefined,
): string | undefined {
  if (typeof imageUrls === "string") return imageUrls;
  return imageUrls?.[element.id];
}

function imageRenderStyle(element: ParsedElement): string {
  const crop = element.image?.crop;
  if (!crop) return "display:block;width:100%;height:100%;object-fit:fill;";
  const visibleWidth = Math.max(0.001, 1 - crop.left - crop.right);
  const visibleHeight = Math.max(0.001, 1 - crop.top - crop.bottom);
  return `display:block;position:absolute;left:${(-crop.left / visibleWidth) * 100}%;top:${(-crop.top / visibleHeight) * 100}%;width:${(1 / visibleWidth) * 100}%;height:${(1 / visibleHeight) * 100}%;object-fit:fill;`;
}

type ParsedTableCell = NonNullable<
  ParsedElement["table"]
>["rows"][number][number];

const DEFAULT_TABLE_CELL_MARGIN_X_EMU = 91440;
const DEFAULT_TABLE_CELL_MARGIN_Y_EMU = 45720;

function buildFidelityTable(
  element: ParsedElement,
  widthEmu: number,
  refWidthPx: number,
  themeFont: string | undefined,
  position: string,
  rotation: string,
  objectId: string,
): string {
  const rows = element.table?.rows ?? [];
  const rowsHtml = rows
    .map(
      (row, rowIndex) =>
        `<tr${rowHeightStyle(element, rowIndex)}>${row
          .map((cell) =>
            buildFidelityTableCell(cell, widthEmu, refWidthPx, themeFont),
          )
          .join("")}</tr>`,
    )
    .join("");
  const columnWidths = element.table?.columnWidthsEmu ?? [];
  const totalColumnWidth = columnWidths.reduce(
    (total, width) => total + width,
    0,
  );
  const colgroup =
    totalColumnWidth > 0
      ? `<colgroup>${columnWidths
          .map(
            (width) =>
              `<col style="width:${(width / totalColumnWidth) * 100}%" />`,
          )
          .join("")}</colgroup>`
      : "";
  return `<div class="fmd-pptx-table" data-pptx-element-kind="table"${objectId} style="${position}${rotation} overflow: hidden;"><table style="width:100%;height:100%;border-collapse:collapse;table-layout:fixed;font-family:${cssFontFamily(themeFont)};">${colgroup}${rowsHtml}</table></div>`;
}

function rowHeightStyle(element: ParsedElement, rowIndex: number): string {
  const rowHeight = element.table?.rowHeightsEmu?.[rowIndex];
  if (!rowHeight || element.height <= 0) return "";
  return ` style="height:${(rowHeight / element.height) * 100}%"`;
}

function buildFidelityTableCell(
  cell: ParsedTableCell,
  widthEmu: number,
  refWidthPx: number,
  themeFont: string | undefined,
): string {
  const fill = cell.fill ? `background:${esc(cell.fill)};` : "";
  const paragraphsHtml = cell.paragraphs
    .map((paragraph, paragraphIndex) =>
      buildFidelityParagraph(
        paragraph,
        paragraphIndex,
        widthEmu,
        refWidthPx,
        themeFont,
        400,
      ),
    )
    .join("");
  const paddingY = toSlidePxX(
    DEFAULT_TABLE_CELL_MARGIN_Y_EMU,
    widthEmu,
    refWidthPx,
  );
  const paddingX = toSlidePxX(
    DEFAULT_TABLE_CELL_MARGIN_X_EMU,
    widthEmu,
    refWidthPx,
  );
  const borders = TABLE_CELL_SIDES.map((side) =>
    tableCellBorderCss(side, cell.borders?.[side], widthEmu, refWidthPx),
  ).join("");
  return `<td colspan="${cell.colSpan ?? 1}" rowspan="${cell.rowSpan ?? 1}" style="padding:${paddingY}px ${paddingX}px;vertical-align:top;${fill}${borders}">${paragraphsHtml}</td>`;
}

const TABLE_CELL_SIDES = ["top", "right", "bottom", "left"] as const;

function tableCellBorderCss(
  side: (typeof TABLE_CELL_SIDES)[number],
  border: NonNullable<ParsedTableCell["borders"]>["top"],
  widthEmu: number,
  refWidthPx: number,
): string {
  if (!border) return "";
  const width = Math.max(
    1,
    toSlidePxX(border.widthEmu ?? 9525, widthEmu, refWidthPx),
  );
  return `border-${side}:${round3(width)}px ${border.dash ?? "solid"} ${esc(border.color)};`;
}

const UNRENDERABLE_GEOMETRIES = new Set([
  "arc",
  "bentUpArrow",
  "bracePair",
  "bracketPair",
  "chord",
  "circularArrow",
  "corner",
  "curvedDownArrow",
  "curvedLeftArrow",
  "curvedRightArrow",
  "curvedUpArrow",
  "donut",
  "frame",
  "leftBrace",
  "leftBracket",
  "leftCircularArrow",
  "noSmoking",
  "rightBrace",
  "rightBracket",
]);

const DEFAULT_CORNER_ADJUSTMENT = 0.16667;

const diamondPoints = (w: number, h: number): [number, number][] => [
  [w / 2, 0],
  [w, h / 2],
  [w / 2, h],
  [0, h / 2],
];

const CLIP_PATH_GEOMETRIES: Record<
  string,
  (
    w: number,
    h: number,
    ss: number,
    adj?: Record<string, number>,
  ) => [number, number][]
> = {
  halfFrame: (w, h, ss, adj) => {
    const x1 = (ss * pin(0, adj?.adj2 ?? 33333, (100000 * w) / ss)) / 100000;
    const y1 =
      (ss * pin(0, adj?.adj1 ?? 33333, (100000 * (h - (h * x1) / w)) / ss)) /
      100000;
    return [
      [0, 0],
      [w, 0],
      [w - (y1 * w) / h, y1],
      [x1, y1],
      [x1, h - (x1 * h) / w],
      [0, h],
    ];
  },
  triangle: (w, h) => [
    [w / 2, 0],
    [w, h],
    [0, h],
  ],
  rtTriangle: (w, h) => [
    [0, 0],
    [w, h],
    [0, h],
  ],
  diamond: diamondPoints,
  flowChartDecision: diamondPoints,
  homePlate: (w, h, ss) => {
    const x = ss * 0.16667;
    return [
      [0, 0],
      [w - x, 0],
      [w, h / 2],
      [w - x, h],
      [0, h],
    ];
  },
  chevron: (w, h, ss) => {
    const x = ss * 0.5;
    return [
      [0, 0],
      [w - x, 0],
      [w, h / 2],
      [w - x, h],
      [0, h],
      [x, h / 2],
    ];
  },
  hexagon: (w, h, ss) => {
    const x = ss * 0.25;
    return [
      [x, 0],
      [w - x, 0],
      [w, h / 2],
      [w - x, h],
      [x, h],
      [0, h / 2],
    ];
  },
  trapezoid: (w, h, ss) => {
    const x = ss * 0.25;
    return [
      [x, 0],
      [w - x, 0],
      [w, h],
      [0, h],
    ];
  },
  parallelogram: (w, h, ss) => {
    const x = ss * 0.25;
    return [
      [x, 0],
      [w, 0],
      [w - x, h],
      [0, h],
    ];
  },
  octagon: (w, h, ss) => {
    const c = ss * 0.29289;
    return [
      [c, 0],
      [w - c, 0],
      [w, c],
      [w, h - c],
      [w - c, h],
      [c, h],
      [0, h - c],
      [0, c],
    ];
  },
  pentagon: (w, h) => [
    [w / 2, 0],
    [w, h * 0.38],
    [w * 0.82, h],
    [w * 0.18, h],
    [0, h * 0.38],
  ],
  plus: (w, h, ss) => {
    const a = ss * 0.25;
    return [
      [a, 0],
      [w - a, 0],
      [w - a, a],
      [w, a],
      [w, h - a],
      [w - a, h - a],
      [w - a, h],
      [a, h],
      [a, h - a],
      [0, h - a],
      [0, a],
      [a, a],
    ];
  },
  downArrow: (w, h, ss) => arrowPoints(w, h, ss, "down"),
  upArrow: (w, h, ss) => arrowPoints(w, h, ss, "up"),
  rightArrow: (w, h, ss) => arrowPoints(w, h, ss, "right"),
  leftArrow: (w, h, ss) => arrowPoints(w, h, ss, "left"),
};

function arrowPoints(
  w: number,
  h: number,
  ss: number,
  direction: "up" | "down" | "left" | "right",
): [number, number][] {
  const shaft = ss * 0.25;
  const head = ss * 0.5;
  if (direction === "down" || direction === "up") {
    const cx = w / 2;
    const base: [number, number][] = [
      [cx - shaft, 0],
      [cx + shaft, 0],
      [cx + shaft, h - head],
      [w, h - head],
      [cx, h],
      [0, h - head],
      [cx - shaft, h - head],
    ];
    return direction === "down"
      ? base
      : base.map(([x, y]) => [x, h - y] as [number, number]);
  }
  const cy = h / 2;
  const base: [number, number][] = [
    [0, cy - shaft],
    [w - head, cy - shaft],
    [w - head, 0],
    [w, cy],
    [w - head, h],
    [w - head, cy + shaft],
    [0, cy + shaft],
  ];
  return direction === "right"
    ? base
    : base.map(([x, y]) => [w - x, y] as [number, number]);
}

function toPercent(value: number, total: number): number {
  return Math.round((value / Math.max(total, 0.001)) * 10000) / 100;
}

function blockArcPath(
  adjustments: Record<string, number> | undefined,
  widthPx: number,
  heightPx: number,
): string | undefined {
  const startAngle = (adjustments?.adj1 ?? 10800000) / 60000;
  const endAngle = (adjustments?.adj2 ?? 0) / 60000;
  const thickness = Math.min(Math.max(adjustments?.adj3 ?? 25000, 0), 50000);
  let swing = endAngle - startAngle;
  while (swing <= 0) swing += 360;
  swing = Math.min(swing, 359.9);
  const outerX = widthPx / 2;
  const outerY = heightPx / 2;
  const inset = (Math.min(widthPx, heightPx) * thickness) / 100000;
  const innerX = outerX - inset;
  const innerY = outerY - inset;
  if (!(innerX > 0) || !(innerY > 0)) return undefined;
  // ponytail: parametric angles, exact for a circular block arc — which is
  // every one in the decks this was measured against. A markedly elliptical
  // one starts and ends a few degrees around from where PowerPoint puts it;
  // OOXML's `cat2`/`sat2` true-angle correction is the upgrade.
  const at = (radiusX: number, radiusY: number, degrees: number) => {
    const angle = (degrees * Math.PI) / 180;
    return `${round1(outerX + radiusX * Math.cos(angle))} ${round1(outerY + radiusY * Math.sin(angle))}`;
  };
  const large = swing > 180 ? 1 : 0;
  return [
    `M${at(outerX, outerY, startAngle)}`,
    `A${round1(outerX)} ${round1(outerY)} 0 ${large} 1 ${at(outerX, outerY, startAngle + swing)}`,
    `L${at(innerX, innerY, startAngle + swing)}`,
    `A${round1(innerX)} ${round1(innerY)} 0 ${large} 0 ${at(innerX, innerY, startAngle)}`,
    "Z",
  ].join(" ");
}

function pin(min: number, value: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function ellipseAngle(
  angle60k: number,
  radiusX: number,
  radiusY: number,
): number {
  const radians = (angle60k / 60000) * (Math.PI / 180);
  return Math.atan2(radiusX * Math.sin(radians), radiusY * Math.cos(radians));
}

function presetPen(
  widthPx: number,
  heightPx: number,
  flipH?: boolean,
  flipV?: boolean,
) {
  const parts: string[] = [];
  const toX = (x: number) => round1(flipH ? widthPx - x : x);
  const toY = (y: number) => round1(flipV ? heightPx - y : y);
  const mirrored = Boolean(flipH) !== Boolean(flipV);
  let currentX = 0;
  let currentY = 0;
  const emit = (command: string, points: [number, number][]) => {
    const last = points[points.length - 1]!;
    currentX = last[0];
    currentY = last[1];
    parts.push(
      `${command}${points.map(([x, y]) => `${toX(x)} ${toY(y)}`).join(" ")}`,
    );
  };
  return {
    move: (x: number, y: number) => emit("M", [[x, y]]),
    line: (x: number, y: number) => emit("L", [[x, y]]),
    cubic: (points: [number, number][]) => emit("C", points),
    arc: (
      radiusX: number,
      radiusY: number,
      start60k: number,
      swing60k: number,
    ) => {
      const start = ellipseAngle(start60k, radiusX, radiusY);
      const end = ellipseAngle(start60k + swing60k, radiusX, radiusY);
      const centerX = currentX - radiusX * Math.cos(start);
      const centerY = currentY - radiusY * Math.sin(start);
      currentX = centerX + radiusX * Math.cos(end);
      currentY = centerY + radiusY * Math.sin(end);
      const large = Math.abs(swing60k) > 180 * 60000 ? 1 : 0;
      const sweep = swing60k >= 0 !== mirrored ? 1 : 0;
      parts.push(
        `A${round1(radiusX)} ${round1(radiusY)} 0 ${large} ${sweep} ${toX(currentX)} ${toY(currentY)}`,
      );
    },
    close: () => parts.push("Z"),
    path: () => parts.join(" "),
  };
}

const PRESET_PATH_GEOMETRIES: Record<
  string,
  (
    pen: ReturnType<typeof presetPen>,
    w: number,
    h: number,
    adj: Record<string, number> | undefined,
  ) => void
> = {
  heart: (pen, w, h) => {
    const hc = w / 2;
    const quarter = h / 4;
    const dx1 = (w * 49) / 48;
    const dx2 = (w * 10) / 48;
    const y1 = -h / 3;
    pen.move(hc, quarter);
    pen.cubic([
      [hc + dx2, y1],
      [hc + dx1, quarter],
      [hc, h],
    ]);
    pen.cubic([
      [hc - dx1, quarter],
      [hc - dx2, y1],
      [hc, quarter],
    ]);
    pen.close();
  },
  pie: (pen, w, h, adj) => {
    const radiusX = w / 2;
    const radiusY = h / 2;
    const startAngle = pin(0, adj?.adj1 ?? 0, 21599999);
    const endAngle = pin(0, adj?.adj2 ?? 16200000, 21599999);
    const span = endAngle - startAngle;
    const swing = Math.min(span > 0 ? span : span + 21600000, 21594000);
    const start = ellipseAngle(startAngle, radiusX, radiusY);
    pen.move(
      radiusX + radiusX * Math.cos(start),
      radiusY + radiusY * Math.sin(start),
    );
    pen.arc(radiusX, radiusY, startAngle, swing);
    pen.line(radiusX, radiusY);
    pen.close();
  },
  uturnArrow: (pen, w, h, adj) => {
    const ss = Math.min(w, h);
    const a2 = pin(0, adj?.adj2 ?? 25000, 25000);
    const a1 = pin(0, adj?.adj1 ?? 25000, a2 * 2);
    const a3 = pin(0, adj?.adj3 ?? 25000, ((100000 - (a1 * ss) / h) * h) / ss);
    const a5 = pin(((a3 + a1) * ss) / h, adj?.adj5 ?? 75000, 100000);
    const th = (ss * a1) / 100000;
    const aw2 = (ss * a2) / 100000;
    const dh2 = aw2 - th / 2;
    const y5 = (h * a5) / 100000;
    const y4 = y5 - (ss * a3) / 100000;
    const x9 = w - dh2;
    const a4 = pin(0, adj?.adj4 ?? 43750, (Math.min(x9 / 2, y4) * 100000) / ss);
    const bd = (ss * a4) / 100000;
    const bd2 = Math.max(bd - th, 0);
    const x3 = th + bd2;
    const x8 = w - aw2;
    const x6 = x8 - aw2;
    const x7 = x6 + dh2;
    pen.move(0, h);
    pen.line(0, bd);
    pen.arc(bd, bd, 10800000, 5400000);
    pen.line(x9 - bd, 0);
    pen.arc(bd, bd, 16200000, 5400000);
    pen.line(x9, y4);
    pen.line(w, y4);
    pen.line(x8, y5);
    pen.line(x6, y4);
    pen.line(x7, y4);
    pen.line(x7, x3);
    pen.arc(bd2, bd2, 0, -5400000);
    pen.line(x3, th);
    pen.arc(bd2, bd2, 16200000, -5400000);
    pen.line(th, h);
    pen.close();
  },
  bentArrow: (pen, w, h, adj) => {
    const ss = Math.min(w, h);
    const a2 = pin(0, adj?.adj2 ?? 25000, 50000);
    const a1 = pin(0, adj?.adj1 ?? 25000, a2 * 2);
    const a3 = pin(0, adj?.adj3 ?? 25000, 50000);
    const th = (ss * a1) / 100000;
    const aw2 = (ss * a2) / 100000;
    const dh2 = aw2 - th / 2;
    const ah = (ss * a3) / 100000;
    const a4 = pin(
      0,
      adj?.adj4 ?? 43750,
      (100000 * Math.min(w - ah, h - dh2)) / ss,
    );
    const bd = (ss * a4) / 100000;
    const bd2 = Math.max(bd - th, 0);
    const x4 = w - ah;
    const y3 = dh2 + th;
    pen.move(0, h);
    pen.line(0, dh2 + bd);
    pen.arc(bd, bd, 10800000, 5400000);
    pen.line(x4, dh2);
    pen.line(x4, 0);
    pen.line(w, aw2);
    pen.line(x4, y3 + dh2);
    pen.line(x4, y3);
    pen.line(th + bd2, y3);
    pen.arc(bd2, bd2, 16200000, -5400000);
    pen.line(th, h);
    pen.close();
  },
};

function presetGeometryPath(
  element: ParsedElement,
  widthPx: number,
  heightPx: number,
): string | undefined {
  const build = element.shapeType
    ? PRESET_PATH_GEOMETRIES[element.shapeType]
    : undefined;
  if (!build) return undefined;
  if (!(widthPx > 0) || !(heightPx > 0)) return undefined;
  const pen = presetPen(widthPx, heightPx, element.flipH, element.flipV);
  build(pen, widthPx, heightPx, element.shapeAdjustments);
  return pen.path();
}

function geometryCss(
  element: ParsedElement,
  widthPx: number,
  heightPx: number,
): string {
  const shapeType = element.shapeType;
  const adjustments = element.shapeAdjustments;
  if (!shapeType) return "";
  const shortest = Math.min(widthPx, heightPx);
  const corner = round3(shortest * DEFAULT_CORNER_ADJUSTMENT);
  switch (shapeType) {
    case "ellipse":
    case "smileyFace":
      return "border-radius: 50%;";
    case "roundRect":
      return `border-radius: ${corner}px;`;
    case "round1Rect":
      return `border-radius: 0 ${corner}px 0 0;`;
    case "round2SameRect":
      return `border-radius: ${corner}px ${corner}px 0 0;`;
    case "round2DiagRect":
      return `border-radius: ${corner}px 0 ${corner}px 0;`;
    case "flowChartTerminator":
      return `border-radius: ${round3(shortest / 2)}px;`;
    case "blockArc": {
      const path = blockArcPath(adjustments, widthPx, heightPx);
      return path ? `clip-path: path('${path}');` : "";
    }
  }
  const presetPath = presetGeometryPath(element, widthPx, heightPx);
  if (presetPath) return `clip-path: path('${presetPath}');`;
  const points = CLIP_PATH_GEOMETRIES[shapeType]?.(
    widthPx,
    heightPx,
    shortest,
    adjustments,
  );
  if (!points) return "";
  const polygon = points
    .map(([x, y]) => `${toPercent(x, widthPx)}% ${toPercent(y, heightPx)}%`)
    .join(", ");
  return `clip-path: polygon(${polygon});`;
}

function clippedPresetPath(
  element: ParsedElement,
  widthPx: number,
  heightPx: number,
): string | undefined {
  const shapeType = element.shapeType;
  const adjustments = element.shapeAdjustments;
  if (!shapeType) return undefined;
  if (shapeType === "blockArc") {
    return blockArcPath(adjustments, widthPx, heightPx);
  }
  const presetPath = presetGeometryPath(element, widthPx, heightPx);
  if (presetPath) return presetPath;
  const points = CLIP_PATH_GEOMETRIES[shapeType]?.(
    widthPx,
    heightPx,
    Math.min(widthPx, heightPx),
    adjustments,
  );
  if (!points) return undefined;
  return `${points
    .map(
      ([x, y], index) => `${index === 0 ? "M" : "L"}${round1(x)} ${round1(y)}`,
    )
    .join(" ")} Z`;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function createPathWriter() {
  let out = "";
  let lastCommand = "";
  let afterLetter = false;
  let previousNumberHadPoint = false;
  let x = 0;
  let y = 0;
  let subpathX = 0;
  let subpathY = 0;

  const number = (value: number): number => {
    const rounded = round1(value);
    let text = String(rounded);
    if (text.startsWith("0.")) text = text.slice(1);
    else if (text.startsWith("-0.")) text = `-${text.slice(2)}`;
    const joins =
      afterLetter ||
      text.startsWith("-") ||
      (text.startsWith(".") && previousNumberHadPoint);
    out += joins ? text : ` ${text}`;
    afterLetter = false;
    previousNumberHadPoint = text.includes(".");
    return rounded;
  };

  const command = (letter: string) => {
    if (lastCommand === letter) return;
    out += letter;
    afterLetter = true;
    lastCommand = letter === "m" ? "l" : letter;
  };

  return {
    write(letter: string, points: { x: number; y: number }[]) {
      command(letter);
      const fromX = x;
      const fromY = y;
      for (const point of points) {
        x = fromX + number(point.x - fromX);
        y = fromY + number(point.y - fromY);
      }
      if (letter === "m") {
        subpathX = x;
        subpathY = y;
      }
    },
    arc(
      radiusX: number,
      radiusY: number,
      largeArc: number,
      sweep: number,
      toX: number,
      toY: number,
    ) {
      command("a");
      number(radiusX);
      number(radiusY);
      number(0);
      number(largeArc);
      number(sweep);
      const fromX = x;
      const fromY = y;
      x = fromX + number(toX - fromX);
      y = fromY + number(toY - fromY);
    },
    close() {
      out += "z";
      afterLetter = true;
      lastCommand = "";
      x = subpathX;
      y = subpathY;
    },
    result: () => out,
  };
}

function customGeometryPath(
  element: ParsedElement,
  widthPx: number,
  heightPx: number,
): string | undefined {
  const geometry = element.geometry;
  if (!geometry || geometry.kind !== "custom") return undefined;
  if (!(widthPx > 0) || !(heightPx > 0)) return undefined;
  const writer = createPathWriter();
  let wrote = false;
  for (const path of geometry.paths) {
    const scaleX = widthPx / path.w;
    const scaleY = heightPx / path.h;
    const toX = (x: number) =>
      element.flipH ? widthPx - x * scaleX : x * scaleX;
    const toY = (y: number) =>
      element.flipV ? heightPx - y * scaleY : y * scaleY;
    let currentX = 0;
    let currentY = 0;
    for (const command of path.commands) {
      wrote = true;
      if (command.kind === "close") {
        writer.close();
        continue;
      }
      if (command.kind === "arcTo") {
        const start = (command.stAng / 60000) * (Math.PI / 180);
        const swing = (command.swAng / 60000) * (Math.PI / 180);
        const centerX = currentX - command.wR * Math.cos(start);
        const centerY = currentY - command.hR * Math.sin(start);
        currentX = centerX + command.wR * Math.cos(start + swing);
        currentY = centerY + command.hR * Math.sin(start + swing);
        const largeArc = Math.abs(command.swAng) > 180 * 60000 ? 1 : 0;
        const sweep =
          command.swAng >= 0 !==
          (Boolean(element.flipH) !== Boolean(element.flipV))
            ? 1
            : 0;
        writer.arc(
          command.wR * scaleX,
          command.hR * scaleY,
          largeArc,
          sweep,
          toX(currentX),
          toY(currentY),
        );
        continue;
      }
      const last = command.points[command.points.length - 1]!;
      currentX = last.x;
      currentY = last.y;
      writer.write(
        { moveTo: "m", lnTo: "l", quadBezTo: "q", cubicBezTo: "c" }[
          command.kind
        ],
        command.points.map((point) => ({ x: toX(point.x), y: toY(point.y) })),
      );
    }
  }
  return wrote ? writer.result() : undefined;
}

function customGeometryStroke(
  element: ParsedElement,
  pathData: string,
  widthEmu: number,
  refWidthPx: number,
  widthPx: number,
  heightPx: number,
): string {
  if (!element.lineColor) return "";
  const stroke = Math.max(
    1,
    toSlidePxX(element.lineWidth ?? 12700, widthEmu, refWidthPx),
  );
  return `<svg viewBox="0 0 ${round3(widthPx)} ${round3(heightPx)}" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;"><path d="${esc(pathData)}" fill="none" stroke="${esc(element.lineColor)}" stroke-width="${stroke}" /></svg>`;
}

function strokeDecoration(
  element: ParsedElement,
  widthEmu: number,
  refWidthPx: number,
  widthPx: number,
  heightPx: number,
): string {
  if (!element.lineColor) return "";
  const stroke = strokeWidthPx(element, widthEmu, refWidthPx);
  const color = esc(element.lineColor);
  const axis = lineAxis(widthPx, heightPx, stroke);
  if (axis === "x") return `border-top: ${stroke}px solid ${color};`;
  if (axis === "y") return `border-left: ${stroke}px solid ${color};`;
  return `border: ${stroke}px solid ${color};`;
}

function strokeWidthPx(
  element: ParsedElement,
  widthEmu: number,
  refWidthPx: number,
): number {
  return Math.max(
    1,
    toSlidePxX(element.lineWidth ?? 12700, widthEmu, refWidthPx),
  );
}

function lineAxis(
  widthPx: number,
  heightPx: number,
  stroke: number,
): "x" | "y" | undefined {
  if (heightPx < stroke * 2 && widthPx > heightPx) return "x";
  if (widthPx < stroke * 2 && heightPx > widthPx) return "y";
  return undefined;
}

const LINE_END_SCALE: Record<string, number> = { sm: 2, med: 3, lg: 5 };

function lineEndCaps(
  element: ParsedElement,
  widthEmu: number,
  refWidthPx: number,
  widthPx: number,
  heightPx: number,
): string {
  const head = ovalCapRadius(element.lineHeadEnd);
  const tail = ovalCapRadius(element.lineTailEnd);
  if (!element.lineColor || (!head && !tail)) return "";
  const stroke = strokeWidthPx(element, widthEmu, refWidthPx);
  const axis = lineAxis(widthPx, heightPx, stroke);
  if (!axis) return "";
  const along = axis === "x" ? widthPx : heightPx;
  const flipped = axis === "x" ? element.flipH : element.flipV;
  const point = (distance: number, radius: number) => ({
    radius: radius * stroke,
    x: axis === "x" ? distance : stroke / 2,
    y: axis === "x" ? stroke / 2 : distance,
  });
  const caps = [
    head ? point(flipped ? along : 0, head) : undefined,
    tail ? point(flipped ? 0 : along, tail) : undefined,
  ].filter((cap) => cap !== undefined);
  const pad = Math.max(...caps.map((cap) => cap.radius));
  const boxWidth = round3(widthPx + pad * 2);
  const boxHeight = round3(heightPx + pad * 2);
  const circles = caps
    .map(
      (cap) =>
        `<circle cx="${round3(cap.x + pad)}" cy="${round3(cap.y + pad)}" r="${round3(cap.radius)}" fill="${esc(element.lineColor ?? "")}" />`,
    )
    .join("");
  return `<svg viewBox="0 0 ${boxWidth} ${boxHeight}" style="position:absolute;left:${round3(-pad)}px;top:${round3(-pad)}px;width:${boxWidth}px;height:${boxHeight}px;overflow:visible;pointer-events:none;">${circles}</svg>`;
}

function ovalCapRadius(end: ParsedElement["lineHeadEnd"]): number | undefined {
  if (end?.type !== "oval") return undefined;
  return (LINE_END_SCALE[end.w ?? "med"] ?? LINE_END_SCALE.med) / 2;
}

function shapeDecoration(
  element: ParsedElement,
  widthEmu: number,
  refWidthPx: number,
  widthPx: number,
  heightPx: number,
  customPath: string | undefined,
  outlinePath: string | undefined,
): string {
  if (
    !customPath &&
    element.shapeType &&
    UNRENDERABLE_GEOMETRIES.has(element.shapeType)
  ) {
    return "";
  }
  const fill = element.fill ? `background: ${esc(element.fill)};` : "";
  if (customPath) {
    return fill ? `${fill}clip-path: path('${customPath}');` : "";
  }
  const line = outlinePath
    ? ""
    : strokeDecoration(element, widthEmu, refWidthPx, widthPx, heightPx);
  return `${fill}${line}${geometryCss(element, widthPx, heightPx)}`;
}

function textBoxStyle(
  element: ParsedElement,
  widthEmu: number,
  heightEmu: number,
  refBox: { width: number; height: number },
  themeFont: string | undefined,
): string {
  const padding = element.padding;
  const left = padding ? toSlidePxX(padding.left, widthEmu, refBox.width) : 0;
  const right = padding ? toSlidePxX(padding.right, widthEmu, refBox.width) : 0;
  const top = padding ? toSlidePxY(padding.top, heightEmu, refBox.height) : 0;
  const bottom = padding
    ? toSlidePxY(padding.bottom, heightEmu, refBox.height)
    : 0;
  const align = element.paragraphs?.[0]?.alignment ?? "left";
  const vertical =
    element.verticalAlign === "middle"
      ? "justify-content:center;"
      : element.verticalAlign === "bottom"
        ? "justify-content:flex-end;"
        : "justify-content:flex-start;";
  return `display:flex;flex-direction:column;${vertical}padding:${top}px ${right}px ${bottom}px ${left}px;font-family:${cssFontFamily(themeFont)};text-align:${align};overflow:visible;`;
}

const DEFAULT_LINE_SPACING = 1.2;

function firstDeclaredFontSizePt(
  paragraphs: ParsedParagraph[] | undefined,
): number | undefined {
  for (const paragraph of paragraphs ?? []) {
    for (const run of paragraph.runs) {
      if (run.fontSize !== undefined) return run.fontSize;
    }
  }
  return undefined;
}

function buildFidelityParagraph(
  paragraph: ParsedParagraph,
  paragraphIndex: number,
  widthEmu: number,
  refWidthPx: number,
  themeFont: string | undefined,
  defaultFontWeight: number,
  boxFontSizePt?: number,
): string {
  const firstRun = paragraph.runs[0];
  const paragraphFontSizePt =
    firstRun?.fontSize ??
    (paragraph.runs.length === 0 ? boxFontSizePt : undefined) ??
    DEFAULT_PPTX_FONT_SIZE_PT;
  const fontSize = ptToSlidePx(paragraphFontSizePt, widthEmu, refWidthPx);
  const lineHeight = paragraph.lineSpacing ?? DEFAULT_LINE_SPACING;
  const bulletFontSize = ptToSlidePx(
    paragraph.bulletSize ?? paragraphFontSizePt,
    widthEmu,
    refWidthPx,
  );
  const bullet = paragraph.bulletChar
    ? `<span aria-hidden="true" style="display:inline-block;min-width:${fontSize * 0.75}px;white-space:nowrap;margin-right:${fontSize * 0.65}px;color:${esc(paragraph.bulletColor ?? firstRun?.color ?? DEFAULT_PPTX_FOREGROUND)};font-family:${cssFontFamily(paragraph.bulletFontFamily ?? themeFont)};font-size:${bulletFontSize}px;">${esc(paragraph.bulletChar)}</span>`
    : "";
  const marginLeft = paragraph.marginLeftEmu
    ? toSlidePxX(paragraph.marginLeftEmu, widthEmu, refWidthPx)
    : 0;
  const indent = paragraph.indentEmu
    ? toSlidePxX(paragraph.indentEmu, widthEmu, refWidthPx)
    : 0;
  const spacingBefore = paragraph.spaceBeforePt ?? 0;
  const spacingAfter = paragraph.spaceAfterPt ?? 0;
  const bulletMargin = paragraph.bulletChar ? `margin-left:${indent}px;` : "";
  const marginBefore = ptToSlidePx(spacingBefore, widthEmu, refWidthPx);
  const marginAfter = ptToSlidePx(spacingAfter, widthEmu, refWidthPx);
  const text = paragraph.runs
    .map((run) =>
      formatFidelityRun(
        run,
        widthEmu,
        refWidthPx,
        themeFont,
        defaultFontWeight,
      ),
    )
    .join("");
  const direction = paragraph.rtl ? ` dir="rtl"` : "";
  const directionCss = paragraph.rtl ? "direction:rtl;" : "";
  return `<p data-pptx-paragraph="${paragraphIndex}"${direction} style="${directionCss}display:block;flex:0 0 auto;text-align:${paragraph.alignment ?? (paragraph.rtl ? "right" : "left")};white-space:pre-wrap;margin:${marginBefore}px 0 ${marginAfter}px;line-height:${lineHeight};font-size:${fontSize}px;min-height:${fontSize * lineHeight}px;padding-left:${marginLeft}px;text-indent:${paragraph.bulletChar ? 0 : indent}px;">${bullet.replace("display:inline-block;", `display:inline-block;${bulletMargin}`)}${text}</p>`;
}

function formatFidelityRun(
  run: ParsedTextRun,
  widthEmu: number,
  refWidthPx: number,
  themeFont: string | undefined,
  defaultFontWeight = 400,
): string {
  const styles = [
    `font-size:${ptToSlidePx(run.fontSize ?? DEFAULT_PPTX_FONT_SIZE_PT, widthEmu, refWidthPx)}px`,
    `font-family:${cssFontFamily(run.fontFamily ?? themeFont)}`,
    `color:${esc(run.color ?? DEFAULT_PPTX_FOREGROUND)}`,
    `font-weight:${run.bold ? 700 : fontWeightForFamily(run.fontFamily, defaultFontWeight)}`,
    `font-style:${run.italic ? "italic" : "normal"}`,
    `text-decoration:${run.underline ? "underline" : "none"}`,
  ].join(";");
  const href = run.href && isSafeLinkHref(run.href) ? run.href : undefined;
  if (href) {
    return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer" style="${styles};">${esc(run.content)}</a>`;
  }
  return `<span style="${styles};">${esc(run.content)}</span>`;
}

function isSafeLinkHref(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href);
}

function fontWeightForFamily(
  fontFamily: string | undefined,
  fallback: number,
): number {
  const normalized = fontFamily?.toLowerCase() ?? "";
  if (!normalized) return fallback;
  if (/(?:semi|demi)bold|semibold/.test(normalized)) return 600;
  if (/black|heavy/.test(normalized)) return 900;
  if (/extra[- ]?bold|ultra[- ]?bold/.test(normalized)) return 800;
  if (/bold/.test(normalized)) return 700;
  if (/medium/.test(normalized)) return 500;
  if (/light|thin/.test(normalized)) return 300;
  return 400;
}

function buildTitleSlide(
  paragraphs: ParsedTextRun[][],
  slide: ParsedSlide,
  fontFamily: string,
): string {
  const titlePara = paragraphs[0] ?? [];
  const subtitlePara = paragraphs[1] ?? [];

  const titleText = titlePara.map(formatRun).join(" ") || "Untitled Slide";
  const subtitleText = subtitlePara.map(formatRun).join(" ");

  return `<div class="fmd-slide" style="padding: 80px 110px; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; font-family: ${fontFamily};">
    <h1 style="font-size: 64px; font-weight: 900; color: #fff; line-height: 1.1; letter-spacing: -2px; margin: 0 0 24px 0;">${titleText}</h1>${subtitleText ? `\n    <p style="font-size: 22px; color: rgba(255,255,255,0.55); margin: 0;">${subtitleText}</p>` : ""}
</div>`;
}

function buildContentSlide(
  paragraphs: ParsedTextRun[][],
  slide: ParsedSlide,
  fontFamily: string,
): string {
  const headingPara = paragraphs[0] ?? [];
  const bulletParas = paragraphs.slice(1);

  const headingText = headingPara.map(formatRun).join(" ") || "Slide";

  let bulletsHtml = "";
  if (bulletParas.length > 0) {
    const bulletItems = bulletParas
      .map((para) => {
        const text = para.map(formatRun).join(" ");
        return `      <div style="display: flex; align-items: flex-start; gap: 16px;">
        <span style="font-size: 8px; color: #fff; margin-top: 8px; flex-shrink: 0;">&#x25CF;</span>
        <span style="font-size: 22px; color: rgba(255,255,255,0.85); line-height: 1.5;">${text}</span>
      </div>`;
      })
      .join("\n");

    bulletsHtml = `\n    <div class="fmd-animation-container" style="display: flex; flex-direction: column; gap: 20px;">
${bulletItems}
    </div>`;
  }

  return `<div class="fmd-slide" style="padding: 80px 110px; display: flex; flex-direction: column; justify-content: flex-start; font-family: ${fontFamily};">
    <div style="font-size: 14px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: #00E5FF; margin-bottom: 16px;">IMPORTED</div>
    <h2 style="font-size: 40px; font-weight: 900; color: #fff; line-height: 1.15; letter-spacing: -1px; margin: 0 0 48px 0;">${headingText}</h2>${bulletsHtml}
</div>`;
}

function imageOrPlaceholder(
  imageUrl: string | undefined,
  imageName: string,
  style: string,
  objectFit: "cover" | "contain" = "contain",
): string {
  if (imageUrl) {
    return `<img src="${esc(imageUrl)}" alt="" style="${style} object-fit: ${objectFit};" />`;
  }
  return `<div class="fmd-img-placeholder" style="${style}">Imported image: ${esc(imageName)}</div>`;
}

function buildImageSlide(
  paragraphs: ParsedTextRun[][],
  slide: ParsedSlide,
  imageUrl: string | undefined,
  fontFamily: string,
): string {
  if (imageUrl && slide.images[0]?.fullBleed) {
    return buildOverlayImageSlide(paragraphs, imageUrl, fontFamily);
  }
  return buildStackedImageSlide(paragraphs, slide, imageUrl, fontFamily);
}

function buildOverlayImageSlide(
  paragraphs: ParsedTextRun[][],
  imageUrl: string,
  fontFamily: string,
): string {
  const headingPara = paragraphs[0] ?? [];
  const headingHtml = headingPara.map(formatRun).join(" ") || "Slide";

  const captionParas = paragraphs.slice(1);
  const captionHtml = captionParas.length
    ? `<div class="fmd-animation-container" style="display: flex; flex-direction: column; gap: 8px;">${captionParas
        .map(
          (para) =>
            `<p style="font-size: 18px; color: rgba(255,255,255,0.75); /* guard:allow-raw-color - standalone imported slide HTML uses fixed contrast colors */ line-height: 1.5; margin: 0;">${para.map(formatRun).join(" ")}</p>`,
        )
        .join("\n")}</div>`
    : "";

  return `<div class="fmd-slide" style="position: relative; width: 100%; height: 100%; overflow: hidden;">
    <img src="${esc(imageUrl)}" alt="" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;" />
    <div style="position: absolute; inset: 0; background: linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.35) 55%, rgba(0,0,0,0) 80%);"></div>
    <div style="position: absolute; left: 0; right: 0; bottom: 0; padding: 56px 70px; font-family: ${fontFamily};">
      <h2 style="font-size: 40px; font-weight: 900; color: #fff; /* guard:allow-raw-color - standalone imported slide HTML uses fixed contrast colors */ line-height: 1.15; letter-spacing: -1px; margin: 0 0 ${captionHtml ? "12px" : "0"} 0;">${headingHtml}</h2>${captionHtml ? `\n      ${captionHtml}` : ""}
    </div>
</div>`;
}

function buildStackedImageSlide(
  paragraphs: ParsedTextRun[][],
  slide: ParsedSlide,
  imageUrl: string | undefined,
  fontFamily: string,
): string {
  const headingPara = paragraphs[0] ?? [];
  const headingText = headingPara.map(formatRun).join(" ") || "Slide";

  const captionParas = paragraphs.slice(1);
  const captionText = captionParas.length
    ? `<div class="fmd-animation-container" style="display: flex; flex-direction: column; gap: 8px;">${captionParas
        .map(
          (para) =>
            `<p style="font-size: 16px; color: rgba(255,255,255,0.7); /* guard:allow-raw-color - standalone imported slide HTML uses fixed contrast colors */ line-height: 1.5; margin: 0;">${para.map(formatRun).join(" ")}</p>`,
        )
        .join("\n")}</div>`
    : "";

  const imageName = slide.images[0]?.name ?? "image";
  const aspectRatio = slide.images[0]?.aspectRatio ?? 16 / 9;
  const imageHtml = imageOrPlaceholder(
    imageUrl,
    imageName,
    `display: block; max-width: 100%; max-height: 320px; aspect-ratio: ${aspectRatio}; border-radius: 12px; margin: 0 auto 24px;`,
  );

  return `<div class="fmd-slide" style="padding: 64px 90px; display: flex; flex-direction: column; justify-content: flex-start; font-family: ${fontFamily};">
    ${imageHtml}
    <h2 style="font-size: 32px; font-weight: 900; color: #fff; /* guard:allow-raw-color - standalone imported slide HTML uses fixed contrast colors */ line-height: 1.2; letter-spacing: -0.5px; margin: 0 0 12px 0;">${headingText}</h2>${captionText ? `\n    ${captionText}` : ""}
</div>`;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

export function convertSectionsToSlides(
  sections: { heading: string; content: string }[],
): string[] {
  const slides: string[] = [];

  for (const section of sections) {
    const heading = section.heading || "Section";
    const plainContent = stripTags(section.content).trim();

    if (!plainContent && !section.heading) continue;

    const lines = plainContent
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      slides.push(
        `<div class="fmd-slide" style="padding: 80px 110px; display: flex; flex-direction: column; justify-content: center; align-items: flex-start; font-family: 'Poppins', sans-serif;">
    <div style="font-size: 16px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: #00E5FF; margin-bottom: 20px;">${String(slides.length + 1).padStart(2, "0")}</div>
    <h2 style="font-size: 72px; font-weight: 900; color: #fff; line-height: 1.05; letter-spacing: -2px; margin: 0;">${esc(heading)}</h2>
</div>`,
      );
      continue;
    }

    const LINES_PER_SLIDE = 5;
    for (let i = 0; i < lines.length; i += LINES_PER_SLIDE) {
      const chunk = lines.slice(i, i + LINES_PER_SLIDE);
      const bulletItems = chunk
        .map(
          (
            line,
          ) => `      <div style="display: flex; align-items: flex-start; gap: 16px;">
        <span style="font-size: 8px; color: #fff; margin-top: 8px; flex-shrink: 0;">&#x25CF;</span>
        <span style="font-size: 22px; color: rgba(255,255,255,0.85); line-height: 1.5;">${esc(line)}</span>
      </div>`,
        )
        .join("\n");

      slides.push(
        `<div class="fmd-slide" style="padding: 80px 110px; display: flex; flex-direction: column; justify-content: flex-start; font-family: 'Poppins', sans-serif;">
    <div style="font-size: 14px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: #00E5FF; margin-bottom: 16px;">IMPORTED</div>
    <h2 style="font-size: 40px; font-weight: 900; color: #fff; line-height: 1.15; letter-spacing: -1px; margin: 0 0 48px 0;">${esc(heading)}</h2>
    <div style="display: flex; flex-direction: column; gap: 20px;">
${bulletItems}
    </div>
</div>`,
      );
    }
  }

  return slides;
}
