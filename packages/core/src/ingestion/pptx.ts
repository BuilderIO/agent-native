export interface ParsedPptxTextRun {
  content: string;
  bold?: boolean;
  italic?: boolean;
  fontSize?: number;
  color?: string;
  fontFamily?: string;
  underline?: boolean;
  href?: string;
}

export interface ParsedPptxParagraph {
  runs: ParsedPptxTextRun[];
  alignment?: "left" | "center" | "right" | "justify";
  bulletChar?: string;
  bulletColor?: string;
  bulletFontFamily?: string;
  bulletSize?: number;
  level?: number;
  marginLeftEmu?: number;
  indentEmu?: number;
  lineSpacing?: number;
  spaceBeforePt?: number;
  spaceAfterPt?: number;
}

export interface ParsedPptxElement {
  id: string;
  name?: string;
  placeholderType?: string;
  kind: "text" | "image" | "shape";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  shapeType?: string;
  fill?: string;
  lineColor?: string;
  lineWidth?: number;
  padding?: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  };
  verticalAlign?: "top" | "middle" | "bottom";
  paragraphs?: ParsedPptxParagraph[];
  image?: ParsedPptxImage;
}

export type ParsedPptxTransition =
  | "instant"
  | "none"
  | "fade"
  | "slide"
  | "zoom";

export interface ParsedPptxImage {
  data: Uint8Array;
  mimeType: string;
  name: string;
  /** Width / height of the picture shape on the slide, from its own placed size (not the source file's pixel dimensions). */
  aspectRatio?: number;
  /** True when the picture shape covers at least ~85% of the slide's width and height — a full-bleed background photo rather than an inset card image. */
  fullBleed?: boolean;
  crop?: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
}

export interface ParsedPptxSlide {
  texts: ParsedPptxTextRun[];
  images: ParsedPptxImage[];
  elements: ParsedPptxElement[];
  widthEmu?: number;
  heightEmu?: number;
  backgroundColor?: string;
  /** A decorative grid inherited from the slide master, when one is present. */
  backgroundGrid?: ParsedPptxGrid;
  notes?: string;
  layoutHint?: string;
  transition?: ParsedPptxTransition;
  splitByParagraph?: boolean;
}

export interface ParsedPptxGrid {
  color: string;
  stepXEmu: number;
  stepYEmu: number;
  offsetXEmu: number;
  offsetYEmu: number;
  lineWidthEmu: number;
}

export interface ParsedPptxSlideMetadata {
  transition?: ParsedPptxTransition;
  splitByParagraph?: boolean;
}

export interface ParsedPptxPresentation {
  title: string;
  slides: ParsedPptxSlide[];
  theme?: { colors: string[]; fonts: string[] };
}

interface ZipFile {
  async(type: "string"): Promise<string>;
  async(type: "nodebuffer"): Promise<Buffer>;
}

interface ZipArchive {
  files: Record<string, unknown>;
  file(path: string): ZipFile | null;
}

export async function parsePptxPresentation(
  fileBuffer: Uint8Array,
): Promise<ParsedPptxPresentation> {
  const { loadZip, parseXml } = await loadPptxDependencies();
  const zip = await loadZip(fileBuffer);
  const presentationXml = await zip
    .file("ppt/presentation.xml")
    ?.async("string");
  if (!presentationXml)
    throw new Error("Invalid PPTX: missing ppt/presentation.xml");
  const presentation = parseXml(presentationXml);
  const presentationRoot = record(record(presentation)?.["p:presentation"]);
  const slideIds = asArray(
    record(presentationRoot?.["p:sldIdLst"])?.["p:sldId"],
  ).map((entry) => stringValue(record(entry)?.["@_r:id"]) ?? "");
  const sldSz = record(presentationRoot?.["p:sldSz"]);
  const slideWidthEmu = Number(sldSz?.["@_cx"]) || undefined;
  const slideHeightEmu = Number(sldSz?.["@_cy"]) || undefined;
  const relationshipsXml = await zip
    .file("ppt/_rels/presentation.xml.rels")
    ?.async("string");
  const relationships = relationshipsXml
    ? parseRelationships(parseXml(relationshipsXml))
    : new Map<string, { target: string; type: string }>();
  const slideMasterRelationship = [...relationships.values()].find((value) =>
    value.type.endsWith("/slideMaster"),
  );
  const backgroundGrid = slideMasterRelationship
    ? await parseMasterGrid({
        zip,
        target: slideMasterRelationship.target,
      })
    : undefined;
  const slidePaths = slideIds.flatMap((id) => {
    const relationship = relationships.get(id);
    if (!relationship) return [];
    return [
      relationship.target.startsWith("/")
        ? relationship.target.slice(1)
        : `ppt/${relationship.target}`,
    ];
  });
  if (slidePaths.length === 0) {
    slidePaths.push(
      ...Object.keys(zip.files)
        .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
        .sort((a, b) => slideNumber(a) - slideNumber(b)),
    );
  }
  const theme = await parseTheme(zip, parseXml);
  const slides: ParsedPptxSlide[] = [];
  for (const slidePath of slidePaths) {
    const xml = await zip.file(slidePath)?.async("string");
    if (!xml) continue;
    let slide: unknown;
    try {
      slide = parseXml(xml);
    } catch {
      continue;
    }
    const metadata = parsePptxSlideMetadata(slide);
    let elements: ParsedPptxElement[] = [];
    const images: ParsedPptxImage[] = [];
    const relationshipPath = slidePath.replace(
      /slides\/(slide\d+\.xml)/,
      "slides/_rels/$1.rels",
    );
    const slideRelationshipsXml = await zip
      .file(relationshipPath)
      ?.async("string");
    const slideRelationships = slideRelationshipsXml
      ? parseRelationships(parseXml(slideRelationshipsXml))
      : new Map<string, { target: string; type: string }>();
    elements = await parseSlideElements({
      xml,
      parseXml,
      slide,
      zip,
      slideRelationships,
      slideWidthEmu,
      slideHeightEmu,
      images,
    });
    const texts = flattenElementText(elements);
    const number = slideNumber(slidePath);
    const notesXml = await zip
      .file(`ppt/notesSlides/notesSlide${number}.xml`)
      ?.async("string");
    let notes: string | undefined;
    if (notesXml) {
      const runs: ParsedPptxTextRun[] = [];
      collectTextRuns(parseXml(notesXml), runs);
      const value = runs
        .map((run) => run.content)
        .join(" ")
        .trim();
      if (value.length > 1) notes = value;
    }
    slides.push({
      texts,
      images,
      elements,
      widthEmu: slideWidthEmu,
      heightEmu: slideHeightEmu,
      backgroundColor: extractSlideBackgroundColor(slide),
      ...(backgroundGrid ? { backgroundGrid } : {}),
      notes,
      layoutHint: guessLayoutHint(texts, images.length > 0),
      ...metadata,
    });
  }
  const firstSlide = slides[0]?.texts ?? [];
  const title =
    [...firstSlide]
      .sort((a, b) => (b.fontSize ?? 0) - (a.fontSize ?? 0))[0]
      ?.content.trim()
      .slice(0, 200) || "Imported Presentation";
  return { title, slides, theme };
}

/**
 * Google Slides exports decorative grids as connector shapes on the slide
 * master instead of as a slide background. Preserve the repeated geometry as
 * metadata so the HTML renderer can reproduce it without making the lines
 * editable slide objects.
 */
async function parseMasterGrid(args: {
  zip: ZipArchive;
  target: string;
}): Promise<ParsedPptxGrid | undefined> {
  const path = args.target.startsWith("/")
    ? args.target.slice(1)
    : `ppt/${args.target.replace(/^\.\.\//, "")}`;
  const xml = await args.zip.file(path)?.async("string");
  if (!xml) return undefined;

  const connectors = xml.match(/<p:cxnSp\b[\s\S]*?<\/p:cxnSp>/gi) ?? [];
  const candidates = connectors.flatMap((fragment) => {
    const color = fragment.match(
      /<a:solidFill>\s*<a:srgbClr\s+val="([0-9a-f]{6})"/i,
    )?.[1];
    const transform = fragment.match(
      /<a:xfrm[^>]*>\s*<a:off\s+x="(-?\d+)"\s+y="(-?\d+)"\s*\/>\s*<a:ext\s+cx="(-?\d+)"\s+cy="(-?\d+)"/i,
    );
    const lineWidth = fragment.match(/<a:ln[^>]*\bw="(\d+)"/i)?.[1];
    if (!color || !transform || !lineWidth) return [];
    return [
      {
        color: color.toLowerCase(),
        x: Number(transform[1]),
        y: Number(transform[2]),
        width: Number(transform[3]),
        height: Number(transform[4]),
        lineWidth: Number(lineWidth),
      },
    ];
  });
  if (candidates.length < 20) return undefined;

  const colorCounts = new Map<string, number>();
  for (const candidate of candidates) {
    colorCounts.set(
      candidate.color,
      (colorCounts.get(candidate.color) ?? 0) + 1,
    );
  }
  const [color] =
    [...colorCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  if (!color) return undefined;

  const xPositions = [
    ...new Set(
      candidates
        .filter((candidate) => candidate.color === color)
        .map((candidate) => candidate.x),
    ),
  ].sort((a, b) => a - b);
  const gaps = xPositions
    .slice(1)
    .map((value, index) => value - xPositions[index])
    .filter((value) => value > 100_000);
  if (gaps.length < 3) return undefined;
  gaps.sort((a, b) => a - b);
  const stepXEmu = gaps[Math.floor(gaps.length / 2)];
  if (!stepXEmu) return undefined;

  const offsetXEmu = xPositions.find((value) => value >= 0) ?? xPositions[0];
  const lineWidthEmu = Math.max(
    1,
    Math.round(
      candidates
        .filter((candidate) => candidate.color === color)
        .reduce((sum, candidate) => sum + candidate.lineWidth, 0) /
        candidates.filter((candidate) => candidate.color === color).length,
    ),
  );

  // The same repeated connector lattice is used for both axes in the Google
  // export. Its horizontal phase is the master group's first repeated offset.
  // Keeping the phase relative to the detected step also works for custom
  // slide sizes that preserve the source grid's square-cell geometry.
  const stepYEmu = stepXEmu;
  const offsetYEmu = Math.round(stepYEmu * 0.9);

  return {
    color: `#${color}`,
    stepXEmu,
    stepYEmu,
    offsetXEmu,
    offsetYEmu,
    lineWidthEmu,
  };
}
/** Resolves a slide master's color-alias mapping plus its title/body default text-color fills (from p:txStyles), so placeholder text without its own explicit color can inherit the right one. */
async function parseMasterColorInfo(args: {
  zip: ZipArchive;
  target: string;
  parseXml: (xml: string) => unknown;
}): Promise<{
  clrMap: Record<string, string>;
  titleFill: Record<string, unknown> | null;
  bodyFill: Record<string, unknown> | null;
}> {
  const empty = { clrMap: {}, titleFill: null, bodyFill: null };
  const path = args.target.startsWith("/")
    ? args.target.slice(1)
    : "ppt/" + args.target.replace(/^\.\.\//, "");
  const xml = await args.zip.file(path)?.async("string");
  if (!xml) return empty;
  const root = record(record(args.parseXml(xml))?.["p:sldMaster"]);
  if (!root) return empty;
  const clrMap = parseClrMapNode(record(root["p:clrMap"]));
  const txStyles = record(root["p:txStyles"]);
  const titleDefRPr = record(
    record(record(txStyles?.["p:titleStyle"])?.["a:lvl1pPr"])?.["a:defRPr"],
  );
  const bodyDefRPr = record(
    record(record(txStyles?.["p:bodyStyle"])?.["a:lvl1pPr"])?.["a:defRPr"],
  );
  return {
    clrMap,
    titleFill: record(titleDefRPr?.["a:solidFill"]),
    bodyFill: record(bodyDefRPr?.["a:solidFill"]),
  };
}

interface ParsedShapeTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
}

interface ShapeTransformContext {
  originX: number;
  originY: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

const SHAPE_ELEMENT_NAMES = new Set([
  "sp",
  "pic",
  "grpSp",
  "cxnSp",
  "graphicFrame",
]);

async function parseSlideElements(args: {
  xml: string;
  parseXml: (xml: string) => unknown;
  slide: unknown;
  zip: ZipArchive;
  slideRelationships: Map<string, { target: string; type: string }>;
  slideWidthEmu?: number;
  slideHeightEmu?: number;
  images: ParsedPptxImage[];
}): Promise<ParsedPptxElement[]> {
  const fragments = extractDirectShapeFragments(args.xml, "spTree");
  const elements: ParsedPptxElement[] = [];
  const context: ShapeTransformContext = {
    originX: 0,
    originY: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
  };

  for (const fragment of fragments) {
    const parsed = await parseShapeFragment(fragment, {
      ...args,
      context,
    });
    if (parsed.length > 0) elements.push(...parsed);
  }

  // Some authors use a picture fill on the slide background instead of a
  // picture shape. Keep it in the same ordered scene graph at the back.
  const backgroundEmbedId = extractBackgroundFillEmbedId(args.slide);
  if (backgroundEmbedId) {
    const backgroundRelationship =
      args.slideRelationships.get(backgroundEmbedId);
    if (backgroundRelationship) {
      const image = await loadPptxImage({
        relationship: backgroundRelationship,
        zip: args.zip,
        slideWidthEmu: args.slideWidthEmu,
        slideHeightEmu: args.slideHeightEmu,
        x: 0,
        y: 0,
        width: args.slideWidthEmu ?? 0,
        height: args.slideHeightEmu ?? 0,
      });
      if (image) {
        args.images.unshift(image.image);
        elements.unshift(image.element);
      }
    }
  }

  return elements;
}

async function parseShapeFragment(
  fragment: string,
  args: {
    parseXml: (xml: string) => unknown;
    zip: ZipArchive;
    slideRelationships: Map<string, { target: string; type: string }>;
    slideWidthEmu?: number;
    slideHeightEmu?: number;
    images: ParsedPptxImage[];
    context: ShapeTransformContext;
  },
): Promise<ParsedPptxElement[]> {
  const parsed = record(args.parseXml(fragment));
  if (!parsed) return [];

  const entry = [...SHAPE_ELEMENT_NAMES].find(
    (name) => parsed[`p:${name}`] != null,
  );
  if (!entry) return [];
  const node = record(parsed[`p:${entry}`]);
  if (!node) return [];

  if (entry === "grpSp") {
    const groupTransform = readTransform(node, "p:grpSpPr");
    const groupXfrm = record(record(node["p:grpSpPr"])?.["a:xfrm"]);
    const childOffset = readPoint(groupXfrm?.["a:chOff"]);
    const childExtent = readPoint(groupXfrm?.["a:chExt"]);
    const groupScaleX =
      childExtent.x > 0 ? groupTransform.width / childExtent.x : 1;
    const groupScaleY =
      childExtent.y > 0 ? groupTransform.height / childExtent.y : 1;
    const nextContext: ShapeTransformContext = {
      originX:
        args.context.originX +
        args.context.scaleX * (groupTransform.x - childOffset.x * groupScaleX),
      originY:
        args.context.originY +
        args.context.scaleY * (groupTransform.y - childOffset.y * groupScaleY),
      scaleX: args.context.scaleX * groupScaleX,
      scaleY: args.context.scaleY * groupScaleY,
      rotation: args.context.rotation + (groupTransform.rotation ?? 0),
    };
    const output: ParsedPptxElement[] = [];
    for (const child of extractDirectShapeFragments(fragment, "grpSp")) {
      output.push(
        ...(await parseShapeFragment(child, {
          ...args,
          context: nextContext,
        })),
      );
    }
    return output;
  }

  const transform = applyTransform(readTransform(node, "p:spPr"), args.context);
  const id = readShapeId(node);
  const name = readShapeName(node);
  const placeholderType = stringValue(
    record(record(record(node["p:nvSpPr"])?.["p:nvPr"])?.["p:ph"])?.["@_type"],
  );
  const shapeProperties = record(node["p:spPr"]);
  const rawText = parseTextBody(node, args.colorContext);
  const placeholderDefaultColor =
    placeholderType === "title" || placeholderType === "ctrTitle"
      ? args.placeholderDefaults?.title
      : placeholderType
        ? args.placeholderDefaults?.body
        : undefined;
  const text = applyPlaceholderDefaultColor(rawText, placeholderDefaultColor);
  const fill = parseShapeFill(shapeProperties, args.colorContext);
  const line = parseShapeLine(shapeProperties, args.colorContext);
  const shapeType = stringValue(
    record(shapeProperties?.["a:prstGeom"])?.["@_prst"],
  );

  if (entry === "pic") {
    const embedId = stringValue(
      record(record(node["p:blipFill"])?.["a:blip"])?.["@_r:embed"],
    );
    if (!embedId) return [];
    const relationship = args.slideRelationships.get(embedId);
    if (!relationship) return [];
    const image = await loadPptxImage({
      relationship,
      zip: args.zip,
      slideWidthEmu: args.slideWidthEmu,
      slideHeightEmu: args.slideHeightEmu,
      x: transform.x,
      y: transform.y,
      width: transform.width,
      height: transform.height,
      crop: parseImageCrop(node),
    });
    if (!image) return [];
    args.images.push(image.image);
    return [
      {
        id,
        name,
        kind: "image",
        ...transform,
        image: image.image,
      },
    ];
  }

  const hasText = text.some((paragraph) => paragraph.runs.length > 0);
  if (hasText) {
    return [
      {
        id,
        name,
        ...(placeholderType ? { placeholderType } : {}),
        kind: "text",
        ...transform,
        shapeType,
        ...(fill ? { fill } : {}),
        ...(line ? { lineColor: line.color, lineWidth: line.width } : {}),
        ...parseTextBoxProperties(node),
        paragraphs: text,
      },
    ];
  }

  if (fill || line) {
    return [
      {
        id,
        name,
        kind: "shape",
        ...transform,
        shapeType,
        ...(fill ? { fill } : {}),
        ...(line ? { lineColor: line.color, lineWidth: line.width } : {}),
      },
    ];
  }

  return [];
}

function extractDirectShapeFragments(xml: string, container: string): string[] {
  const containerMatch = new RegExp(`<p:${container}\\b[^>]*>`, "i").exec(xml);
  if (!containerMatch) return [];
  const containerEnd = findMatchingXmlTag(xml, containerMatch.index, container);
  if (containerEnd < 0) return [];
  const start = containerMatch.index + containerMatch[0].length;
  const end = containerEnd;
  const tagPattern = /<\/?(?:[A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)\b[^>]*>/g;
  tagPattern.lastIndex = start;
  const stack: string[] = [];
  const fragments: string[] = [];
  let shapeStart = -1;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(xml)) && match.index < end) {
    const token = match[0];
    const localName = match[1];
    const isClosing = token.startsWith("</");
    const isSelfClosing = /\/\s*>$/.test(token);
    if (isClosing) {
      if (stack.length > 0) stack.pop();
      if (stack.length === 0 && shapeStart >= 0) {
        fragments.push(xml.slice(shapeStart, match.index + token.length));
        shapeStart = -1;
      }
      continue;
    }
    if (stack.length === 0 && SHAPE_ELEMENT_NAMES.has(localName)) {
      shapeStart = match.index;
    }
    if (!isSelfClosing) stack.push(localName);
  }
  return fragments;
}

function findMatchingXmlTag(
  xml: string,
  start: number,
  localName: string,
): number {
  const tagPattern = /<\/?(?:[A-Za-z_][\w.-]*:)?([A-Za-z_][\w.-]*)\b[^>]*>/g;
  tagPattern.lastIndex = start;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(xml))) {
    const token = match[0];
    if (match[1] !== localName || /\/\s*>$/.test(token)) continue;
    if (token.startsWith("</")) {
      depth -= 1;
      if (depth === 0) return match.index;
    } else {
      depth += 1;
    }
  }
  return -1;
}

function readShapeId(node: Record<string, unknown>): string {
  const cNvPr =
    record(record(node["p:nvSpPr"])?.["p:cNvPr"]) ??
    record(record(node["p:nvPicPr"])?.["p:cNvPr"]);
  return (
    stringValue(cNvPr?.["@_id"]) ??
    `shape-${Math.random().toString(36).slice(2)}`
  );
}

function readShapeName(node: Record<string, unknown>): string | undefined {
  return stringValue(record(record(node["p:nvSpPr"])?.["p:cNvPr"])?.["@_name"]);
}

function readPoint(value: unknown): { x: number; y: number } {
  const point = record(value);
  return {
    x: Number(point?.["@_x"]) || 0,
    y: Number(point?.["@_y"]) || 0,
  };
}

function readExtent(value: unknown): { x: number; y: number } {
  const extent = record(value);
  return {
    x: Number(extent?.["@_cx"]) || 0,
    y: Number(extent?.["@_cy"]) || 0,
  };
}

function readTransform(
  node: Record<string, unknown>,
  key: string,
): ParsedShapeTransform {
  const xfrm = record(record(node[key])?.["a:xfrm"]);
  const off = readPoint(xfrm?.["a:off"]);
  const ext = readExtent(xfrm?.["a:ext"]);
  const rawRotation = Number(xfrm?.["@_rot"]);
  return {
    x: off.x,
    y: off.y,
    width: ext.x,
    height: ext.y,
    ...(Number.isFinite(rawRotation) && rawRotation !== 0
      ? { rotation: rawRotation / 60000 }
      : {}),
  };
}

function applyTransform(
  transform: ParsedShapeTransform,
  context: ShapeTransformContext,
): ParsedShapeTransform {
  return {
    x: context.originX + transform.x * context.scaleX,
    y: context.originY + transform.y * context.scaleY,
    width: transform.width * context.scaleX,
    height: transform.height * context.scaleY,
    ...(transform.rotation || context.rotation
      ? { rotation: (transform.rotation ?? 0) + context.rotation }
      : {}),
  };
}

function parseTextBody(
  node: Record<string, unknown>,
  context?: ColorContext,
): ParsedPptxParagraph[] {
  const txBody = record(node["p:txBody"]);
  if (!txBody) return [];
  return asArray(txBody["a:p"]).map((rawParagraph) => {
    const paragraph = record(rawParagraph);
    const pPr = record(paragraph?.["a:pPr"]);
    const runs: ParsedPptxTextRun[] = [];
    for (const rawRun of asArray(paragraph?.["a:r"])) {
      const run = record(rawRun);
      const content = innerText(run?.["a:t"]);
      if (content) {
        runs.push({
          content,
          ...runProperties(record(run?.["a:rPr"]), {}, context),
        });
      }
    }
    for (const rawField of asArray(paragraph?.["a:fld"])) {
      const field = record(rawField);
      const content = innerText(field?.["a:t"]);
      if (content) {
        runs.push({
          content,
          ...runProperties(record(field?.["a:rPr"]), {}, context),
        });
      }
    }
    const bullet = record(pPr?.["a:buChar"]);
    const bulletColor = parseColor(record(pPr?.["a:buClr"]), context);
    const bulletFont = stringValue(record(pPr?.["a:buFont"])?.["@_typeface"]);
    const bulletSize = Number(record(pPr?.["a:buSzPts"])?.["@_val"]);
    const lineSpacing = parseParagraphSpacing(pPr?.["a:lnSpc"]);
    const spaceBeforePt = parsePoints(pPr?.["a:spcBef"]);
    const spaceAfterPt = parsePoints(pPr?.["a:spcAft"]);
    const alignment = mapAlignment(stringValue(pPr?.["@_algn"]));
    return {
      runs,
      ...(alignment ? { alignment } : {}),
      ...(bullet?.["@_char"] && !pPr?.["a:buNone"]
        ? { bulletChar: String(bullet["@_char"]) }
        : {}),
      ...(bulletColor ? { bulletColor } : {}),
      ...(bulletFont ? { bulletFontFamily: bulletFont } : {}),
      ...(Number.isFinite(bulletSize) && bulletSize > 0
        ? { bulletSize: bulletSize / 100 }
        : {}),
      ...(Number.isFinite(Number(pPr?.["@_lvl"]))
        ? { level: Number(pPr?.["@_lvl"]) }
        : {}),
      ...(Number.isFinite(Number(pPr?.["@_marL"]))
        ? { marginLeftEmu: Number(pPr?.["@_marL"]) }
        : {}),
      ...(Number.isFinite(Number(pPr?.["@_indent"]))
        ? { indentEmu: Number(pPr?.["@_indent"]) }
        : {}),
      ...(lineSpacing !== undefined ? { lineSpacing } : {}),
      ...(spaceBeforePt !== undefined ? { spaceBeforePt } : {}),
      ...(spaceAfterPt !== undefined ? { spaceAfterPt } : {}),
    };
  });
}

function parseTextBoxProperties(
  node: Record<string, unknown>,
): Pick<ParsedPptxElement, "padding" | "verticalAlign"> {
  const bodyPr = record(record(node["p:txBody"])?.["a:bodyPr"]);
  if (!bodyPr) return {};
  const anchor = stringValue(bodyPr["@_anchor"]);
  return {
    padding: {
      left: Number(bodyPr["@_lIns"]) || 0,
      right: Number(bodyPr["@_rIns"]) || 0,
      top: Number(bodyPr["@_tIns"]) || 0,
      bottom: Number(bodyPr["@_bIns"]) || 0,
    },
    ...(anchor === "ctr"
      ? { verticalAlign: "middle" as const }
      : anchor === "b"
        ? { verticalAlign: "bottom" as const }
        : { verticalAlign: "top" as const }),
  };
}

function parseShapeFill(
  shapeProperties: Record<string, unknown> | null,
  context?: ColorContext,
): string | undefined {
  if (!shapeProperties) return undefined;
  if (shapeProperties["a:noFill"] !== undefined) return undefined;
  return parseColor(record(shapeProperties["a:solidFill"]), context);
}

function parseShapeLine(
  shapeProperties: Record<string, unknown> | null,
  context?: ColorContext,
): { color: string; width?: number } | undefined {
  const line = record(shapeProperties?.["a:ln"]);
  if (!line || line["a:noFill"] !== undefined) return undefined;
  const color = parseColor(record(line["a:solidFill"]), context);
  if (!color) return undefined;
  const width = Number(line["@_w"]);
  return {
    color,
    ...(Number.isFinite(width) && width > 0 ? { width } : {}),
  };
}

/**
 * A slide's `schemeClr` references (`tx1`, `bg1`, `accent2`, ...) only mean
 * something once resolved against the presentation's actual theme palette
 * and the active `bg1`/`tx1`-style alias mapping — without this, every
 * scheme-referenced color (which is how most professionally authored decks
 * set placeholder text color, rather than a literal `srgbClr`) was
 * unresolvable and silently dropped.
 */
interface ColorContext {
  themeColorsByName: Record<string, string>;
  clrMap: Record<string, string>;
}

/** PowerPoint's default `bg1`/`tx1`-style alias mapping, used whenever a master doesn't declare its own `<p:clrMap>`. */
const IDENTITY_CLR_MAP: Record<string, string> = {
  bg1: "lt1",
  tx1: "dk1",
  bg2: "lt2",
  tx2: "dk2",
  accent1: "accent1",
  accent2: "accent2",
  accent3: "accent3",
  accent4: "accent4",
  accent5: "accent5",
  accent6: "accent6",
  hlink: "hlink",
  folHlink: "folHlink",
};

const CLR_MAP_ALIASES = Object.keys(IDENTITY_CLR_MAP);

/** Reads a `<p:clrMap .../>` or `<a:overrideClrMapping .../>` node's alias attributes into an alias→theme-slot map. */
function parseClrMapNode(
  node: Record<string, unknown> | null,
): Record<string, string> {
  const map: Record<string, string> = {};
  if (!node) return map;
  for (const alias of CLR_MAP_ALIASES) {
    const target = stringValue(node[`@_${alias}`]);
    if (target) map[alias] = target;
  }
  return map;
}

function resolveSchemeColorName(
  name: string,
  context: ColorContext | undefined,
): string | undefined {
  if (!context) return undefined;
  const slot = context.clrMap[name] ?? IDENTITY_CLR_MAP[name] ?? name;
  return context.themeColorsByName[slot];
}

function parseColor(
  value: Record<string, unknown> | null,
  context?: ColorContext,
): string | undefined {
  if (!value) return undefined;
  const rgb = stringValue(record(value["a:srgbClr"])?.["@_val"]);
  if (rgb) return `#${rgb}`;
  const scheme = stringValue(record(value["a:schemeClr"])?.["@_val"]);
  if (!scheme) return undefined;
  const resolved = resolveSchemeColorName(scheme, context);
  if (resolved) return resolved;
  // No theme/clrMap available for this slot (or the theme didn't define
  // it) — fall back to a coarse dark/light guess along the standard
  // identity mapping, so tx1/dk1/bg1/lt1 text stays visible rather than
  // silently vanishing.
  const pptxDarkColor = "#000000"; // guard:allow-raw-color - PPTX dark scheme fallback
  const pptxLightColor = "#ffffff"; // guard:allow-raw-color - PPTX light scheme fallback
  const fallback: Record<string, string> = {
    dk1: pptxDarkColor,
    dk2: pptxDarkColor,
    lt1: pptxLightColor,
    lt2: pptxLightColor,
    tx1: pptxDarkColor,
    tx2: pptxDarkColor,
    bg1: pptxLightColor,
    bg2: pptxLightColor,
  };
  return fallback[scheme];
}

function parseParagraphSpacing(value: unknown): number | undefined {
  const node = record(value);
  const percent = Number(record(node?.["a:spcPct"])?.["@_val"]);
  if (Number.isFinite(percent) && percent > 0) return percent / 100000;
  return parsePoints(node?.["a:spcPts"]);
}

function parsePoints(value: unknown): number | undefined {
  const node = record(value);
  const points = Number(node?.["@_val"]);
  return Number.isFinite(points) && points >= 0 ? points / 100 : undefined;
}

function mapAlignment(
  value: string | undefined,
): ParsedPptxParagraph["alignment"] {
  if (value === "ctr") return "center";
  if (value === "r") return "right";
  if (value === "just") return "justify";
  if (value === "l") return "left";
  return undefined;
}

function parseImageCrop(
  node: Record<string, unknown>,
): ParsedPptxImage["crop"] {
  const srcRect = record(record(node["p:blipFill"])?.["a:srcRect"]);
  if (!srcRect) return undefined;
  const left = Number(srcRect["@_l"]) || 0;
  const top = Number(srcRect["@_t"]) || 0;
  const right = Number(srcRect["@_r"]) || 0;
  const bottom = Number(srcRect["@_b"]) || 0;
  return left || top || right || bottom
    ? {
        left: left / 100000,
        top: top / 100000,
        right: right / 100000,
        bottom: bottom / 100000,
      }
    : undefined;
}

async function loadPptxImage(args: {
  relationship: { target: string; type: string };
  zip: ZipArchive;
  slideWidthEmu?: number;
  slideHeightEmu?: number;
  x: number;
  y: number;
  width: number;
  height: number;
  crop?: ParsedPptxImage["crop"];
}): Promise<{ image: ParsedPptxImage; element: ParsedPptxElement } | null> {
  if (
    !args.relationship.type.includes("/image") &&
    !/\.(png|jpe?g|gif|svg|webp|bmp|tiff?|emf|wmf)$/i.test(
      args.relationship.target,
    )
  ) {
    return null;
  }
  const imagePath = args.relationship.target.startsWith("/")
    ? args.relationship.target.slice(1)
    : args.relationship.target.startsWith("../")
      ? `ppt/${args.relationship.target.replace(/^\.\.\//, "")}`
      : `ppt/slides/${args.relationship.target}`;
  const imageFile = args.zip.file(imagePath);
  if (!imageFile) return null;
  const name = imagePath.split("/").at(-1) ?? "image";
  const image: ParsedPptxImage = {
    data: new Uint8Array(await imageFile.async("nodebuffer")),
    mimeType: imageMimeType(name),
    name,
    aspectRatio:
      args.width && args.height ? args.width / args.height : undefined,
    fullBleed: Boolean(
      args.width &&
      args.height &&
      args.slideWidthEmu &&
      args.slideHeightEmu &&
      args.width / args.slideWidthEmu >= 0.85 &&
      args.height / args.slideHeightEmu >= 0.85,
    ),
    ...(args.crop ? { crop: args.crop } : {}),
  };
  return {
    image,
    element: {
      id: `image-${name}-${args.x}-${args.y}`,
      name,
      kind: "image",
      x: args.x,
      y: args.y,
      width: args.width,
      height: args.height,
      image,
    },
  };
}

function flattenElementText(
  elements: ParsedPptxElement[],
): ParsedPptxTextRun[] {
  const output: ParsedPptxTextRun[] = [];
  const textElements = elements.filter(
    (element) => element.kind === "text" && element.paragraphs,
  );
  for (const [elementIndex, element] of textElements.entries()) {
    const paragraphs = element.paragraphs ?? [];
    for (const [paragraphIndex, paragraph] of paragraphs.entries()) {
      output.push(...paragraph.runs);
      if (paragraphIndex < paragraphs.length - 1)
        output.push({ content: "\n" });
    }
    if (elementIndex < textElements.length - 1) output.push({ content: "\n" });
  }
  return output;
}

function extractSlideBackgroundColor(value: unknown): string | undefined {
  const root = record(value);
  const cSld = record(record(root?.["p:sld"])?.["p:cSld"] ?? root?.["p:cSld"]);
  const bgPr = record(record(cSld?.["p:bg"])?.["p:bgPr"]);
  return parseColor(record(bgPr?.["a:solidFill"]));
}

export function parsePptxSlideMetadata(
  value: unknown,
): ParsedPptxSlideMetadata {
  const slide = record(value)?.["p:sld"] ?? value;
  const transition = parsePptxTransition(slide);
  return {
    ...(transition ? { transition } : {}),
    ...(detectSplitByParagraph(slide) ? { splitByParagraph: true } : {}),
  };
}

interface ThemeInfo {
  colors: string[];
  colorsByName: Record<string, string>;
  fonts: string[];
}

async function parseTheme(
  zip: ZipArchive,
  parseXml: (xml: string) => unknown,
): Promise<ThemeInfo> {
  const xml = await zip.file("ppt/theme/theme1.xml")?.async("string");
  if (!xml) return { colors: [], colorsByName: {}, fonts: [] };
  const root = record(parseXml(xml));
  const elements = record(record(root?.["a:theme"])?.["a:themeElements"]);
  const scheme = record(elements?.["a:clrScheme"]);
  const colors: string[] = [];
  const colorsByName: Record<string, string> = {};
  for (const [key, value] of Object.entries(scheme ?? {})) {
    if (key.startsWith("@_")) continue;
    const color = record(value);
    const rgb = stringValue(record(color?.["a:srgbClr"])?.["@_val"]);
    const system = stringValue(record(color?.["a:sysClr"])?.["@_lastClr"]);
    if (!rgb && !system) continue;
    const hex = `#${rgb ?? system}`;
    colors.push(hex);
    const slotName = key.replace(/^a:/, "");
    colorsByName[slotName] = hex;
  }
  const fontScheme = record(elements?.["a:fontScheme"]);
  const fonts = ["a:majorFont", "a:minorFont"].flatMap((key) => {
    const value = stringValue(
      record(record(fontScheme?.[key])?.["a:latin"])?.["@_typeface"],
    );
    return value ? [value] : [];
  });
  return { colors, colorsByName, fonts };
}

function collectTextRuns(
  value: unknown,
  runs: ParsedPptxTextRun[],
  inherited: Omit<ParsedPptxTextRun, "content"> = {},
): void {
  const node = record(value);
  if (!node) return;
  const paragraphs = asArray(node["a:p"]);
  if (paragraphs.length > 0) {
    paragraphs.forEach((paragraph, index) => {
      const before = runs.length;
      collectTextRuns(paragraph, runs, inherited);
      if (runs.length > before && index < paragraphs.length - 1) {
        runs.push({ content: "\n" });
      }
    });
    return;
  }
  for (const raw of asArray(node["a:r"])) {
    const run = record(raw);
    const content = innerText(run?.["a:t"]);
    if (content)
      runs.push({
        content,
        ...runProperties(record(run?.["a:rPr"]), inherited),
      });
  }
  if (node["a:t"] !== undefined && node["a:r"] === undefined) {
    const content = innerText(node["a:t"]);
    if (content) runs.push({ content, ...inherited });
  }
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith("@_") || key === "a:r" || key === "a:t") continue;
    const items = asArray(child);
    items.forEach((item, index) => {
      const before = runs.length;
      collectTextRuns(item, runs, inherited);
      if (key === "p:sp" && index < items.length - 1 && runs.length > before) {
        runs.push({ content: "\n" });
      }
    });
  }
}

const PPTX_TRANSITION_MAP: Record<string, ParsedPptxTransition> = {
  "p:fade": "fade",
  "p:zoom": "zoom",
  "p:push": "slide",
  "p:wipe": "slide",
  "p:split": "slide",
  "p:cut": "instant",
};

function parsePptxTransition(value: unknown): ParsedPptxTransition | undefined {
  const node = record(value);
  const transition = record(node?.["p:transition"]);
  if (!transition) return undefined;
  for (const key of Object.keys(transition)) {
    const mapped = PPTX_TRANSITION_MAP[key];
    if (mapped) return mapped;
  }
  return undefined;
}

function detectSplitByParagraph(value: unknown): boolean {
  let clickParagraphRanges = 0;
  walk(value, false);
  return clickParagraphRanges > 1;

  function walk(nodeValue: unknown, clickContext: boolean): void {
    const node = record(nodeValue);
    if (!node) return;
    const nodeType = stringValue(node["@_nodeType"]);
    const event = stringValue(node["@_evt"]);
    const nextClickContext =
      clickContext ||
      nodeType === "clickEffect" ||
      nodeType === "clickPar" ||
      event === "onClick";
    if (nextClickContext) {
      clickParagraphRanges += asArray(node["p:pRg"]).length;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith("@_") || key === "p:pRg") continue;
      for (const item of asArray(child)) walk(item, nextClickContext);
    }
  }
}

/** Read the embed relationship id of a slide's background picture fill (`p:cSld/p:bg/p:bgPr/a:blipFill/a:blip`), if any. */
function extractBackgroundFillEmbedId(slide: unknown): string | undefined {
  const root = record(slide);
  const cSld = record(record(root?.["p:sld"])?.["p:cSld"] ?? root?.["p:cSld"]);
  const bgPr = record(record(cSld?.["p:bg"])?.["p:bgPr"]);
  const blip = record(record(bgPr?.["a:blipFill"])?.["a:blip"]);
  return stringValue(blip?.["@_r:embed"]);
}

function runProperties(
  value: Record<string, unknown> | null,
  inherited: Omit<ParsedPptxTextRun, "content">,
): Omit<ParsedPptxTextRun, "content"> {
  if (!value) return inherited;
  const size = Number(value["@_sz"]);
  const color = parseColor(record(value["a:solidFill"]), context);
  const fontFamily =
    stringValue(record(value["a:latin"])?.["@_typeface"]) ??
    stringValue(record(value["a:ea"])?.["@_typeface"]) ??
    stringValue(record(value["a:cs"])?.["@_typeface"]);
  return {
    ...inherited,
    ...(value["@_b"] === "1" || value["@_b"] === 1 || value["@_b"] === true
      ? { bold: true }
      : {}),
    ...(value["@_i"] === "1" || value["@_i"] === 1 || value["@_i"] === true
      ? { italic: true }
      : {}),
    ...(Number.isFinite(size) && size > 0 ? { fontSize: size / 100 } : {}),
    ...(color ? { color } : {}),
    ...(fontFamily ? { fontFamily } : {}),
    ...(value["@_u"] && value["@_u"] !== "none" ? { underline: true } : {}),
  };
}

function parseRelationships(value: unknown) {
  const output = new Map<string, { target: string; type: string }>();
  for (const raw of asArray(
    record(record(value)?.Relationships)?.Relationship,
  )) {
    const relationship = record(raw);
    const id = stringValue(relationship?.["@_Id"]);
    const target = stringValue(relationship?.["@_Target"]);
    if (id && target) {
      output.set(id, {
        target,
        type: stringValue(relationship?.["@_Type"]) ?? "",
      });
    }
  }
  return output;
}

function guessLayoutHint(texts: ParsedPptxTextRun[], hasImages: boolean) {
  if (hasImages) return "image";
  const maxSize = Math.max(...texts.map((text) => text.fontSize ?? 0), 0);
  const length = texts.reduce((total, text) => total + text.content.length, 0);
  if (texts.length <= 3 && length < 200 && maxSize >= 28) return "title";
  if (texts.length <= 2 && length < 100) return "section";
  return "content";
}

function imageMimeType(name: string): string {
  const extension = name.split(".").at(-1)?.toLowerCase();
  return (
    {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      svg: "image/svg+xml",
      webp: "image/webp",
      bmp: "image/bmp",
      tiff: "image/tiff",
      tif: "image/tiff",
      emf: "image/emf",
      wmf: "image/wmf",
    }[extension ?? ""] ?? "application/octet-stream"
  );
}

async function loadPptxDependencies(): Promise<{
  loadZip(data: Uint8Array): Promise<ZipArchive>;
  parseXml(xml: string): unknown;
}> {
  try {
    const [zipModule, xmlModule] = await Promise.all([
      import("jszip") as Promise<{
        default: { loadAsync(data: Uint8Array): Promise<ZipArchive> };
      }>,
      import("fast-xml-parser") as Promise<{
        XMLParser: new (options: Record<string, unknown>) => {
          parse(xml: string): unknown;
        };
      }>,
    ]);
    const parser = new xmlModule.XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      trimValues: false,
    });
    return {
      loadZip: (data) => zipModule.default.loadAsync(data),
      parseXml: (xml) => parser.parse(xml),
    };
  } catch {
    throw new Error(
      "Structured PPTX parsing requires the optional jszip and fast-xml-parser dependencies.",
    );
  }
}

function slideNumber(value: string): number {
  return Number(value.match(/slide(\d+)/)?.[1] ?? 0);
}

function innerText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  return String(record(value)?.["#text"] ?? "");
}

function asArray(value: unknown): unknown[] {
  return value === undefined || value === null
    ? []
    : Array.isArray(value)
      ? value
      : [value];
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
