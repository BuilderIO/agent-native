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
  rtl?: boolean;
}

export interface ParsedPptxElement {
  id: string;
  name?: string;
  placeholderType?: string;
  kind: "text" | "image" | "shape" | "table";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  flipH?: boolean;
  flipV?: boolean;
  shapeType?: string;
  shapeAdjustments?: Record<string, number>;
  geometry?: ParsedPptxGeometry;
  fill?: string;
  lineColor?: string;
  lineWidth?: number;
  lineHeadEnd?: ParsedPptxLineEnd;
  lineTailEnd?: ParsedPptxLineEnd;
  padding?: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  };
  verticalAlign?: "top" | "middle" | "bottom";
  paragraphs?: ParsedPptxParagraph[];
  image?: ParsedPptxImage;
  table?: ParsedPptxTable;
}

export interface ParsedPptxLineEnd {
  type: string;
  w?: string;
  len?: string;
}

export type ParsedPptxPathCommand =
  | {
      kind: "moveTo" | "lnTo" | "quadBezTo" | "cubicBezTo";
      points: { x: number; y: number }[];
    }
  | {
      kind: "arcTo";
      wR: number;
      hR: number;
      stAng: number;
      swAng: number;
    }
  | { kind: "close" };

export interface ParsedPptxPath {
  w: number;
  h: number;
  commands: ParsedPptxPathCommand[];
}

export interface ParsedPptxGeometry {
  kind: "custom";
  paths: ParsedPptxPath[];
}

export interface ParsedPptxTable {
  rows: ParsedPptxTableCell[][];
  columnWidthsEmu?: number[];
  rowHeightsEmu?: number[];
}

export interface ParsedPptxTableCell {
  paragraphs: ParsedPptxParagraph[];
  colSpan?: number;
  rowSpan?: number;
  fill?: string;
  borders?: ParsedPptxTableCellBorders;
}

export interface ParsedPptxTableCellBorders {
  left?: ParsedPptxTableBorder;
  right?: ParsedPptxTableBorder;
  top?: ParsedPptxTableBorder;
  bottom?: ParsedPptxTableBorder;
}

export interface ParsedPptxTableBorder {
  color: string;
  widthEmu?: number;
  dash?: "dashed" | "dotted";
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
  aspectRatio?: number;
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
  backgroundGrid?: ParsedPptxGrid;
  notes?: string;
  layoutHint?: string;
  transition?: ParsedPptxTransition;
  splitByParagraph?: boolean;
  tablesDegraded?: number;
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
  hiddenSlideCount?: number;
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
  const dependencies = await loadPptxDependencies();
  const loadZip = dependencies.loadZip.bind(dependencies);
  const parseXml = dependencies.parseXml.bind(dependencies);
  const zip = await loadZip(fileBuffer);
  const presentationXml = await zip.file
    .bind(zip)("ppt/presentation.xml")
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
  const droppedSlides: string[] = [];
  const slidePaths = slideIds.flatMap((id) => {
    const relationship = relationships.get(id);
    if (!relationship) {
      droppedSlides.push(
        `r:id="${id}" has no matching relationship in ppt/_rels/presentation.xml.rels`,
      );
      return [];
    }
    return [
      relationship.target.startsWith("/")
        ? relationship.target.slice(1)
        : `ppt/${relationship.target}`,
    ];
  });
  if (slidePaths.length === 0) {
    droppedSlides.length = 0;
    slidePaths.push(
      ...Object.keys(zip.files)
        .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
        .sort((a, b) => slideNumber(a) - slideNumber(b)),
    );
  }
  const unresolvedSlideIdCount = droppedSlides.length;
  const theme = await parseTheme(zip, parseXml, slideMasterRelationship);
  const tableStyles = await parseTableStyles(zip, parseXml);
  const masterColorInfo = slideMasterRelationship
    ? await parseMasterColorInfo({
        zip,
        target: slideMasterRelationship.target,
        parseXml,
      })
    : {
        clrMap: {},
        titleDefaultsByLevel: {},
        bodyDefaultsByLevel: {},
        otherDefaultsByLevel: {},
        placeholderDefaults: [],
        background: null,
      };
  const colorContext: ColorContext = {
    themeColorsByName: theme.colorsByName,
    clrMap: masterColorInfo.clrMap,
  };
  const placeholderDefaults: PlaceholderDefaults = {
    title: resolveRunDefaultsByLevel(
      masterColorInfo.titleDefaultsByLevel,
      colorContext,
    ),
    body: resolveRunDefaultsByLevel(
      masterColorInfo.bodyDefaultsByLevel,
      colorContext,
    ),
    other: resolveRunDefaultsByLevel(
      masterColorInfo.otherDefaultsByLevel,
      colorContext,
    ),
    layoutPlaceholders: [],
    masterPlaceholders: resolvePlaceholderShapeDefaults(
      masterColorInfo.placeholderDefaults,
      colorContext,
    ),
  };
  const fallbackBackground = parseBackgroundNode(
    masterColorInfo.background,
    colorContext,
  );
  const fallbackContext: SlideTemplateContext = {
    colorContext,
    placeholderDefaults,
    ...(fallbackBackground ? { background: fallbackBackground } : {}),
    layerElements: [],
    layerImages: [],
  };
  const themeCache = new Map<string, Promise<ThemeInfo>>();
  const masterInfoCache = new Map<
    string,
    ReturnType<typeof parseMasterColorInfo>
  >();
  const templateContextCache = new Map<
    string,
    Promise<SlideTemplateContext | undefined>
  >();
  const slides: ParsedPptxSlide[] = [];
  let hiddenSlideCount = 0;
  for (const slidePath of slidePaths) {
    const xml = await zip.file(slidePath)?.async("string");
    if (!xml) {
      droppedSlides.push(`${slidePath} is missing from the package`);
      continue;
    }
    let slide: unknown;
    try {
      slide = parseXml(xml);
    } catch (error) {
      droppedSlides.push(
        `${slidePath} could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    if (stringValue(record(record(slide)?.["p:sld"])?.["@_show"]) === "0") {
      hiddenSlideCount += 1;
      continue;
    }
    const metadata = parsePptxSlideMetadata(slide);
    let elements: ParsedPptxElement[] = [];
    const images: ParsedPptxImage[] = [];
    const tablesDegraded = { count: 0 };
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
    const slideMasterContext =
      (await resolveSlideMasterContext({
        zip,
        parseXml,
        slideRelationships,
        slideWidthEmu,
        slideHeightEmu,
        themeCache,
        masterInfoCache,
        templateContextCache,
      })) ?? fallbackContext;
    const number = slideNumber(slidePath);
    elements = await parseSlideElements({
      xml,
      parseXml,
      slide,
      zip,
      slideRelationships,
      slideWidthEmu,
      slideHeightEmu,
      images,
      tablesDegraded,
      colorContext: slideMasterContext.colorContext,
      placeholderDefaults: slideMasterContext.placeholderDefaults,
      slideNumber: slides.length + 1,
      tableStyles,
    });
    images.unshift(...slideMasterContext.layerImages);
    elements.unshift(
      ...substituteSlideNumber(
        slideMasterContext.layerElements,
        slides.length + 1,
      ),
    );
    const texts = flattenElementText(elements);
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
      backgroundColor:
        extractSlideBackground(slide, slideMasterContext.colorContext) ??
        slideMasterContext.background,
      ...(backgroundGrid ? { backgroundGrid } : {}),
      notes,
      layoutHint: guessLayoutHint(texts, images.length > 0),
      ...(tablesDegraded.count > 0
        ? { tablesDegraded: tablesDegraded.count }
        : {}),
      ...metadata,
    });
  }
  const expectedSlideCount =
    slidePaths.length + unresolvedSlideIdCount - hiddenSlideCount;
  if (slides.length !== expectedSlideCount) {
    throw new Error(
      `Invalid PPTX: expected ${expectedSlideCount} slides but parsed ${slides.length}` +
        (hiddenSlideCount > 0
          ? ` (${hiddenSlideCount} hidden slide${hiddenSlideCount === 1 ? "" : "s"} excluded)`
          : "") +
        (droppedSlides.length > 0
          ? `; dropped: ${droppedSlides.join("; ")}`
          : ""),
    );
  }
  const firstSlide = slides[0]?.texts ?? [];
  const title =
    [...firstSlide]
      .sort((a, b) => (b.fontSize ?? 0) - (a.fontSize ?? 0))[0]
      ?.content.trim()
      .slice(0, 200) || "Imported Presentation";
  return {
    title,
    slides,
    theme,
    ...(hiddenSlideCount > 0 ? { hiddenSlideCount } : {}),
  };
}

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

function resolvePptxRelationshipPath(baseDir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const segments = `${baseDir}/${target}`.split("/");
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") resolved.pop();
    else resolved.push(segment);
  }
  return resolved.join("/");
}

function relsPathForPptxPart(path: string): string {
  const slashIndex = path.lastIndexOf("/");
  const dir = slashIndex >= 0 ? path.slice(0, slashIndex) : "";
  const file = slashIndex >= 0 ? path.slice(slashIndex + 1) : path;
  return `${dir ? `${dir}/` : ""}_rels/${file}.rels`;
}

interface SlideTemplateContext {
  colorContext: ColorContext;
  placeholderDefaults: PlaceholderDefaults;
  background?: string;
  layerElements: ParsedPptxElement[];
  layerImages: ParsedPptxImage[];
}

async function resolveSlideMasterContext(args: {
  zip: ZipArchive;
  parseXml: (xml: string) => unknown;
  slideRelationships: Map<string, { target: string; type: string }>;
  slideWidthEmu?: number;
  slideHeightEmu?: number;
  themeCache: Map<string, Promise<ThemeInfo>>;
  masterInfoCache: Map<string, ReturnType<typeof parseMasterColorInfo>>;
  templateContextCache: Map<string, Promise<SlideTemplateContext | undefined>>;
}): Promise<SlideTemplateContext | undefined> {
  const layoutRelationship = [...args.slideRelationships.values()].find(
    (relationship) => relationship.type.endsWith("/slideLayout"),
  );
  if (!layoutRelationship) return undefined;
  const layoutPath = resolvePptxRelationshipPath(
    "ppt/slides",
    layoutRelationship.target,
  );
  let cached = args.templateContextCache.get(layoutPath);
  if (!cached) {
    cached = buildSlideTemplateContext({ ...args, layoutPath });
    args.templateContextCache.set(layoutPath, cached);
  }
  return cached;
}

async function buildSlideTemplateContext(args: {
  zip: ZipArchive;
  parseXml: (xml: string) => unknown;
  layoutPath: string;
  slideWidthEmu?: number;
  slideHeightEmu?: number;
  themeCache: Map<string, Promise<ThemeInfo>>;
  masterInfoCache: Map<string, ReturnType<typeof parseMasterColorInfo>>;
}): Promise<SlideTemplateContext | undefined> {
  const layoutPath = args.layoutPath;
  const layoutXml = await args.zip.file(layoutPath)?.async("string");
  const layoutRelsXml = await args.zip
    .file(relsPathForPptxPart(layoutPath))
    ?.async("string");
  if (!layoutRelsXml) return undefined;
  const layoutRelationships = parseRelationships(args.parseXml(layoutRelsXml));
  const masterRelationship = [...layoutRelationships.values()].find(
    (relationship) => relationship.type.endsWith("/slideMaster"),
  );
  if (!masterRelationship) return undefined;
  const masterPath = resolvePptxRelationshipPath(
    "ppt/slideLayouts",
    masterRelationship.target,
  );

  let masterInfoPromise = args.masterInfoCache.get(masterPath);
  if (!masterInfoPromise) {
    masterInfoPromise = parseMasterColorInfo({
      zip: args.zip,
      target: masterRelationship.target,
      parseXml: args.parseXml,
    });
    args.masterInfoCache.set(masterPath, masterInfoPromise);
  }
  const masterInfo = await masterInfoPromise;

  const layoutRoot = layoutXml
    ? record(record(args.parseXml(layoutXml))?.["p:sldLayout"])
    : null;
  const layoutPlaceholderDefaults = layoutXml
    ? parsePlaceholderShapeDefaults(layoutXml, args.parseXml)
    : [];

  const masterRelsXml = await args.zip
    .file(relsPathForPptxPart(masterPath))
    ?.async("string");
  const masterRelationships = masterRelsXml
    ? parseRelationships(args.parseXml(masterRelsXml))
    : new Map<string, { target: string; type: string }>();
  const themeRelationship = [...masterRelationships.values()].find(
    (relationship) => relationship.type.endsWith("/theme"),
  );
  if (!themeRelationship) return undefined;
  const themePath = resolvePptxRelationshipPath(
    "ppt/slideMasters",
    themeRelationship.target,
  );
  let themePromise = args.themeCache.get(themePath);
  if (!themePromise) {
    themePromise = parseThemeFromPath(args.zip, args.parseXml, themePath);
    args.themeCache.set(themePath, themePromise);
  }
  const theme = await themePromise;

  const colorContext: ColorContext = {
    themeColorsByName: theme.colorsByName,
    clrMap: masterInfo.clrMap,
  };
  const background =
    parseBackgroundNode(
      record(layoutRoot?.["p:cSld"])?.["p:bg"],
      colorContext,
    ) ?? parseBackgroundNode(masterInfo.background, colorContext);

  const layerImages: ParsedPptxImage[] = [];
  const layerElements: ParsedPptxElement[] = [];
  const layerSources: { xml: string; path: string; prefix: string }[] = [];
  if (masterInfo.xml && stringValue(layoutRoot?.["@_showMasterSp"]) !== "0") {
    layerSources.push({
      xml: masterInfo.xml,
      path: masterPath,
      prefix: "master",
    });
  }
  if (layoutXml) {
    layerSources.push({ xml: layoutXml, path: layoutPath, prefix: "layout" });
  }
  for (const source of layerSources) {
    layerElements.push(
      ...(await parseTemplateLayerElements({
        zip: args.zip,
        parseXml: args.parseXml,
        xml: source.xml,
        path: source.path,
        idPrefix: source.prefix,
        slideWidthEmu: args.slideWidthEmu,
        slideHeightEmu: args.slideHeightEmu,
        images: layerImages,
        colorContext,
      })),
    );
  }

  return {
    colorContext,
    ...(background ? { background } : {}),
    layerElements,
    layerImages,
    placeholderDefaults: {
      title: resolveRunDefaultsByLevel(
        masterInfo.titleDefaultsByLevel,
        colorContext,
      ),
      body: resolveRunDefaultsByLevel(
        masterInfo.bodyDefaultsByLevel,
        colorContext,
      ),
      other: resolveRunDefaultsByLevel(
        masterInfo.otherDefaultsByLevel,
        colorContext,
      ),
      layoutPlaceholders: resolvePlaceholderShapeDefaults(
        layoutPlaceholderDefaults,
        colorContext,
      ),
      masterPlaceholders: resolvePlaceholderShapeDefaults(
        masterInfo.placeholderDefaults,
        colorContext,
      ),
    },
  };
}

async function parseTemplateLayerElements(args: {
  zip: ZipArchive;
  parseXml: (xml: string) => unknown;
  xml: string;
  path: string;
  idPrefix: string;
  slideWidthEmu?: number;
  slideHeightEmu?: number;
  images: ParsedPptxImage[];
  colorContext?: ColorContext;
}): Promise<ParsedPptxElement[]> {
  const relsXml = await args.zip
    .file(relsPathForPptxPart(args.path))
    ?.async("string");
  const relationships = relsXml
    ? parseRelationships(args.parseXml(relsXml))
    : new Map<string, { target: string; type: string }>();
  const elements: ParsedPptxElement[] = [];
  const images: ParsedPptxImage[] = [];
  const tablesDegraded = { count: 0 };
  for (const fragment of extractDirectShapeFragments(args.xml, "spTree")) {
    if (/<p:ph[\s/>]/.test(fragment)) continue;
    elements.push(
      ...(await parseShapeFragment(fragment, {
        parseXml: args.parseXml,
        zip: args.zip,
        slideRelationships: relationships,
        slideWidthEmu: args.slideWidthEmu,
        slideHeightEmu: args.slideHeightEmu,
        images,
        tablesDegraded,
        colorContext: args.colorContext,
        context: { matrix: IDENTITY_MAT, rotation: 0 },
      })),
    );
  }
  const renderable = new Set(images.filter(isBrowserRenderableImage));
  args.images.push(...renderable);
  return elements
    .filter((element) => !element.image || renderable.has(element.image))
    .map((element) => ({ ...element, id: `${args.idPrefix}-${element.id}` }));
}

const BROWSER_RENDERABLE_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/bmp",
]);

function isBrowserRenderableImage(image: ParsedPptxImage): boolean {
  return BROWSER_RENDERABLE_IMAGE_MIME_TYPES.has(image.mimeType);
}

async function parseMasterColorInfo(args: {
  zip: ZipArchive;
  target: string;
  parseXml: (xml: string) => unknown;
}): Promise<{
  clrMap: Record<string, string>;
  titleDefaultsByLevel: Record<number, Record<string, unknown> | null>;
  bodyDefaultsByLevel: Record<number, Record<string, unknown> | null>;
  otherDefaultsByLevel: Record<number, Record<string, unknown> | null>;
  placeholderDefaults: RawPlaceholderShapeDefaults[];
  background: Record<string, unknown> | null;
  xml?: string;
}> {
  const empty = {
    clrMap: {},
    titleDefaultsByLevel: {},
    bodyDefaultsByLevel: {},
    otherDefaultsByLevel: {},
    placeholderDefaults: [],
    background: null,
  };
  const path = args.target.startsWith("/")
    ? args.target.slice(1)
    : "ppt/" + args.target.replace(/^\.\.\//, "");
  const xml = await args.zip.file(path)?.async("string");
  if (!xml) return empty;
  const root = record(record(args.parseXml(xml))?.["p:sldMaster"]);
  if (!root) return empty;
  const clrMap = parseClrMapNode(record(root["p:clrMap"]));
  const txStyles = record(root["p:txStyles"]);
  return {
    clrMap,
    titleDefaultsByLevel: levelDefaultsFromTextStyle(
      record(txStyles?.["p:titleStyle"]),
    ),
    bodyDefaultsByLevel: levelDefaultsFromTextStyle(
      record(txStyles?.["p:bodyStyle"]),
    ),
    otherDefaultsByLevel: levelDefaultsFromTextStyle(
      record(txStyles?.["p:otherStyle"]),
    ),
    placeholderDefaults: parsePlaceholderShapeDefaults(xml, args.parseXml),
    background: record(record(root["p:cSld"])?.["p:bg"]),
    xml,
  };
}

function levelDefaultsFromTextStyle(
  style: Record<string, unknown> | null,
): Record<number, Record<string, unknown> | null> {
  const defaults: Record<number, Record<string, unknown> | null> = {};
  for (let level = 0; level < 9; level++) {
    defaults[level] = record(
      record(style?.[`a:lvl${level + 1}pPr`])?.["a:defRPr"],
    );
  }
  return defaults;
}

type InheritedRunProperties = Omit<ParsedPptxTextRun, "content">;

function resolveRunDefaultsByLevel(
  defaultsByLevel: Record<number, Record<string, unknown> | null>,
  colorContext: ColorContext,
): Record<number, InheritedRunProperties> {
  return Object.fromEntries(
    Object.entries(defaultsByLevel).map(([level, defRPr]) => [
      Number(level),
      runProperties(defRPr, {}, colorContext),
    ]),
  );
}

interface RawPlaceholderShapeDefaults {
  type?: string;
  idx?: string;
  defaultsByLevel: Record<number, Record<string, unknown> | null>;
  transform?: ParsedShapeTransform;
}

function parsePlaceholderShapeDefaults(
  xml: string,
  parseXml: (xml: string) => unknown,
): RawPlaceholderShapeDefaults[] {
  const placeholders: RawPlaceholderShapeDefaults[] = [];
  for (const fragment of extractDirectShapeFragments(xml, "spTree")) {
    const node = record(record(parseXml(fragment))?.["p:sp"]);
    const ph = record(record(record(node?.["p:nvSpPr"])?.["p:nvPr"])?.["p:ph"]);
    if (!node || !ph) continue;
    const transform = readTransform(node, "p:spPr");
    placeholders.push({
      type: stringValue(ph["@_type"]),
      idx: stringValue(ph["@_idx"]),
      defaultsByLevel: levelDefaultsFromTextStyle(
        record(record(node["p:txBody"])?.["a:lstStyle"]),
      ),
      ...(transform.width > 0 && transform.height > 0 ? { transform } : {}),
    });
  }
  return placeholders;
}

function resolvePlaceholderShapeDefaults(
  raw: RawPlaceholderShapeDefaults[],
  colorContext: ColorContext,
): PlaceholderShapeDefaults[] {
  return raw.map((placeholder) => ({
    type: placeholder.type,
    idx: placeholder.idx,
    runDefaultsByLevel: resolveRunDefaultsByLevel(
      placeholder.defaultsByLevel,
      colorContext,
    ),
    transform: placeholder.transform,
  }));
}

interface ParsedShapeTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  flipH?: boolean;
  flipV?: boolean;
  rotation?: number;
}

interface Mat2d {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

const IDENTITY_MAT: Mat2d = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function composeMat(outer: Mat2d, inner: Mat2d): Mat2d {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
}

function scaleMat(sx: number, sy: number): Mat2d {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}

function translateMat(tx: number, ty: number): Mat2d {
  return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty };
}

function rotateAroundMat(degrees: number, cx: number, cy: number): Mat2d {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const rotation: Mat2d = { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
  return composeMat(
    translateMat(cx, cy),
    composeMat(rotation, translateMat(-cx, -cy)),
  );
}

function applyMatPoint(
  m: Mat2d,
  x: number,
  y: number,
): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

interface ShapeTransformContext {
  matrix: Mat2d;
  rotation: number;
}

const SHAPE_ELEMENT_NAMES = new Set([
  "sp",
  "pic",
  "grpSp",
  "cxnSp",
  "graphicFrame",
]);

const FALLBACK_SLIDE_WIDTH_EMU = 12192000;
const FALLBACK_SLIDE_HEIGHT_EMU = 6858000;

async function parseSlideElements(args: {
  xml: string;
  parseXml: (xml: string) => unknown;
  slide: unknown;
  zip: ZipArchive;
  slideRelationships: Map<string, { target: string; type: string }>;
  slideWidthEmu?: number;
  slideHeightEmu?: number;
  images: ParsedPptxImage[];
  tablesDegraded: { count: number };
  colorContext?: ColorContext;
  placeholderDefaults?: PlaceholderDefaults;
  slideNumber?: number;
  tableStyles?: PptxTableStyles;
}): Promise<ParsedPptxElement[]> {
  const fragments = extractDirectShapeFragments(args.xml, "spTree");
  const elements: ParsedPptxElement[] = [];
  const context: ShapeTransformContext = {
    matrix: IDENTITY_MAT,
    rotation: 0,
  };

  for (const fragment of fragments) {
    const parsed = await parseShapeFragment(fragment, {
      ...args,
      context,
    });
    if (parsed.length > 0) elements.push(...parsed);
  }

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
    tablesDegraded: { count: number };
    colorContext?: ColorContext;
    placeholderDefaults?: PlaceholderDefaults;
    slideNumber?: number;
    tableStyles?: PptxTableStyles;
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
    const childExtent = readExtent(groupXfrm?.["a:chExt"]);
    const groupScaleX =
      childExtent.x > 0 ? groupTransform.width / childExtent.x : 1;
    const groupScaleY =
      childExtent.y > 0 ? groupTransform.height / childExtent.y : 1;
    let localToParent = composeMat(
      translateMat(
        groupTransform.x - childOffset.x * groupScaleX,
        groupTransform.y - childOffset.y * groupScaleY,
      ),
      scaleMat(groupScaleX, groupScaleY),
    );
    if (groupTransform.rotation) {
      localToParent = composeMat(
        rotateAroundMat(
          groupTransform.rotation,
          groupTransform.x + groupTransform.width / 2,
          groupTransform.y + groupTransform.height / 2,
        ),
        localToParent,
      );
    }
    const nextContext: ShapeTransformContext = {
      matrix: composeMat(args.context.matrix, localToParent),
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

  if (entry === "graphicFrame") {
    return parseGraphicFrameFragment(node, args);
  }

  const localTransform = readTransform(node, "p:spPr");
  const id = readShapeId(node);
  const name = readShapeName(node);
  const placeholder = record(
    record(record(node["p:nvSpPr"])?.["p:nvPr"])?.["p:ph"],
  );
  const placeholderType = stringValue(placeholder?.["@_type"]);
  const placeholderIdx = stringValue(placeholder?.["@_idx"]);
  const hasOwnSize = localTransform.width > 0 && localTransform.height > 0;
  const inheritedTransform =
    entry === "sp" && !hasOwnSize && placeholder && args.placeholderDefaults
      ? resolvePlaceholderTransform({
          type: placeholderType,
          idx: placeholderIdx,
          defaults: args.placeholderDefaults,
        })
      : undefined;
  const effectiveLocalTransform =
    entry === "sp" && !hasOwnSize
      ? {
          ...localTransform,
          x: inheritedTransform?.x ?? 0,
          y: inheritedTransform?.y ?? 0,
          width:
            inheritedTransform?.width ??
            args.slideWidthEmu ??
            FALLBACK_SLIDE_WIDTH_EMU,
          height:
            inheritedTransform?.height ??
            args.slideHeightEmu ??
            FALLBACK_SLIDE_HEIGHT_EMU,
        }
      : localTransform;
  const transform = applyTransform(effectiveLocalTransform, args.context);
  const shapeProperties = record(node["p:spPr"]);
  const rawText = parseTextBody(node, args.colorContext, {
    relationships: args.slideRelationships,
    slideNumber: args.slideNumber,
  });
  const placeholderRunDefaults =
    placeholder && args.placeholderDefaults
      ? resolvePlaceholderRunDefaults({
          type: placeholderType,
          idx: placeholderIdx,
          defaults: args.placeholderDefaults,
        })
      : undefined;
  const text = applyAutofitScale(
    applyPlaceholderRunDefaults(rawText, placeholderRunDefaults),
    record(record(node["p:txBody"])?.["a:bodyPr"]),
  );
  const fill = parseShapeFill(shapeProperties, args.colorContext);
  const line = parseShapeLine(shapeProperties, args.colorContext);
  const shapeType = stringValue(
    record(shapeProperties?.["a:prstGeom"])?.["@_prst"],
  );
  const shapeAdjustments = parseShapeAdjustments(shapeProperties);
  const geometry = parseCustomGeometry(
    shapeProperties,
    effectiveLocalTransform,
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
        shapeType,
        ...(shapeAdjustments ? { shapeAdjustments } : {}),
        ...(geometry ? { geometry } : {}),
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
        ...(shapeAdjustments ? { shapeAdjustments } : {}),
        ...(geometry ? { geometry } : {}),
        ...(fill ? { fill } : {}),
        ...(line
          ? {
              lineColor: line.color,
              lineWidth: line.width,
              lineHeadEnd: line.headEnd,
              lineTailEnd: line.tailEnd,
            }
          : {}),
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
        ...(shapeAdjustments ? { shapeAdjustments } : {}),
        ...(geometry ? { geometry } : {}),
        ...(fill ? { fill } : {}),
        ...(line
          ? {
              lineColor: line.color,
              lineWidth: line.width,
              lineHeadEnd: line.headEnd,
              lineTailEnd: line.tailEnd,
            }
          : {}),
      },
    ];
  }

  return [];
}

function parseGraphicFrameFragment(
  node: Record<string, unknown>,
  args: {
    context: ShapeTransformContext;
    tablesDegraded: { count: number };
    colorContext?: ColorContext;
    slideRelationships?: Map<string, { target: string; type: string }>;
    slideNumber?: number;
    tableStyles?: PptxTableStyles;
  },
): ParsedPptxElement[] {
  const table = parseGraphicFrameTable(
    node,
    args.colorContext,
    {
      relationships: args.slideRelationships,
      slideNumber: args.slideNumber,
    },
    args.tableStyles,
  );
  if (!table) {
    args.tablesDegraded.count += 1;
    return [];
  }
  const frameTransform = transformFromXfrmNode(record(node["p:xfrm"]));
  const gridWidth = sumOf(table.columnWidthsEmu);
  const gridHeight = sumOf(table.rowHeightsEmu);
  const transform = applyTransform(
    {
      ...frameTransform,
      width: gridWidth ?? frameTransform.width,
      height: gridHeight ?? frameTransform.height,
    },
    args.context,
  );
  return [
    {
      id: readShapeId(node),
      name: readShapeName(node),
      kind: "table",
      ...transform,
      table,
    },
  ];
}

function parseGraphicFrameTable(
  node: Record<string, unknown>,
  context?: ColorContext,
  text?: TextResolutionContext,
  tableStyles?: PptxTableStyles,
): ParsedPptxTable | undefined {
  const graphicData = record(record(node["a:graphic"])?.["a:graphicData"]);
  const tbl = record(graphicData?.["a:tbl"]);
  if (!tbl) return undefined;
  const rawRows = asArray(tbl["a:tr"]);
  const rawGridColumns = asArray(record(tbl["a:tblGrid"])?.["a:gridCol"]);
  const columnWidthsEmu = rawGridColumns
    .map((rawColumn) => positiveAttributeNumber(rawColumn, "@_w"))
    .filter((width): width is number => width !== undefined);
  const rowHeightsEmu = rawRows
    .map((rawRow) => positiveAttributeNumber(rawRow, "@_h"))
    .filter((height): height is number => height !== undefined);
  const tblPr = record(tbl["a:tblPr"]);
  const style = tableStyles?.get(
    normalizeTableStyleId(innerText(tblPr?.["a:tableStyleId"])),
  );
  const banding: TableBandingFlags = {
    firstRow: xmlBoolean(tblPr?.["@_firstRow"]),
    lastRow: xmlBoolean(tblPr?.["@_lastRow"]),
    firstCol: xmlBoolean(tblPr?.["@_firstCol"]),
    lastCol: xmlBoolean(tblPr?.["@_lastCol"]),
    bandRow: xmlBoolean(tblPr?.["@_bandRow"]),
    bandCol: xmlBoolean(tblPr?.["@_bandCol"]),
  };
  const columnCount = Math.max(
    rawGridColumns.length,
    ...rawRows.map((rawRow) => asArray(record(rawRow)?.["a:tc"]).length),
  );
  const rows = rawRows.map((rawRow, rowIndex) => {
    const row = record(rawRow);
    const cells: ParsedPptxTableCell[] = [];
    for (const [columnIndex, rawCell] of asArray(row?.["a:tc"]).entries()) {
      const cell = record(rawCell);
      if (!cell) continue;
      if (xmlBoolean(cell["@_hMerge"]) || xmlBoolean(cell["@_vMerge"]))
        continue;
      const gridSpan = Number(cell["@_gridSpan"]);
      const rowSpan = Number(cell["@_rowSpan"]);
      const tcPr = record(cell["a:tcPr"]);
      const styleParts = tableStyleParts(banding, rowIndex, columnIndex);
      const fill = TABLE_CELL_FILL_ELEMENTS.some(
        (name) => tcPr?.[name] !== undefined,
      )
        ? parseShapeFill(tcPr, context)
        : tableStylePartFill(style, styleParts, context);
      const borders = resolveTableCellBorders({
        tcPr,
        style,
        styleParts,
        context,
        firstColumn: columnIndex === 0,
        lastColumn:
          columnIndex + Math.max(1, Number(cell["@_gridSpan"]) || 1) >=
          columnCount,
        firstRow: rowIndex === 0,
        lastRow:
          rowIndex + Math.max(1, Number(cell["@_rowSpan"]) || 1) >=
          rawRows.length,
      });
      cells.push({
        paragraphs: parseTextBodyParagraphs(
          record(cell["a:txBody"]),
          context,
          text,
        ),
        ...(Number.isFinite(gridSpan) && gridSpan > 1
          ? { colSpan: gridSpan }
          : {}),
        ...(Number.isFinite(rowSpan) && rowSpan > 1 ? { rowSpan } : {}),
        ...(fill ? { fill } : {}),
        ...(borders ? { borders } : {}),
      });
    }
    return cells;
  });
  return rows.length > 0
    ? {
        rows,
        ...(columnWidthsEmu.length > 0 ? { columnWidthsEmu } : {}),
        ...(rowHeightsEmu.length > 0 ? { rowHeightsEmu } : {}),
      }
    : undefined;
}

type PptxTableStyles = Map<string, Record<string, unknown>>;

async function parseTableStyles(
  zip: ZipArchive,
  parseXml: (xml: string) => unknown,
): Promise<PptxTableStyles> {
  const styles: PptxTableStyles = new Map();
  const xml = await zip.file("ppt/tableStyles.xml")?.async("string");
  if (!xml) return styles;
  const list = record(record(parseXml(xml))?.["a:tblStyleLst"]);
  if (!list) return styles;
  for (const raw of asArray(list["a:tblStyle"])) {
    const style = record(raw);
    const id = stringValue(style?.["@_styleId"]);
    if (style && id) styles.set(normalizeTableStyleId(id), style);
  }
  const fallback = styles.get(
    normalizeTableStyleId(stringValue(list["@_def"]) ?? ""),
  );
  if (fallback) styles.set("", fallback);
  return styles;
}

function normalizeTableStyleId(value: string): string {
  return value.replace(/[{}\s]/g, "").toLowerCase();
}

interface TableBandingFlags {
  firstRow: boolean;
  lastRow: boolean;
  firstCol: boolean;
  lastCol: boolean;
  bandRow: boolean;
  bandCol: boolean;
}

function tableStyleParts(
  banding: TableBandingFlags,
  rowIndex: number,
  columnIndex: number,
): string[] {
  const parts = ["wholeTbl"];
  if (banding.bandCol) {
    const band = columnIndex - (banding.firstCol ? 1 : 0);
    if (band >= 0) parts.push(band % 2 === 0 ? "band1V" : "band2V");
  }
  if (banding.bandRow) {
    const band = rowIndex - (banding.firstRow ? 1 : 0);
    if (band >= 0) parts.push(band % 2 === 0 ? "band1H" : "band2H");
  }
  if (banding.firstCol && columnIndex === 0) parts.push("firstCol");
  if (banding.firstRow && rowIndex === 0) parts.push("firstRow");
  return parts;
}

const TABLE_CELL_FILL_ELEMENTS = ["a:noFill", "a:solidFill", "a:gradFill"];

const TABLE_BORDER_SIDES = [
  { side: "left", cellElement: "a:lnL", edge: "a:left", inside: "a:insideV" },
  { side: "right", cellElement: "a:lnR", edge: "a:right", inside: "a:insideV" },
  { side: "top", cellElement: "a:lnT", edge: "a:top", inside: "a:insideH" },
  {
    side: "bottom",
    cellElement: "a:lnB",
    edge: "a:bottom",
    inside: "a:insideH",
  },
] as const;

function resolveTableCellBorders(args: {
  tcPr: Record<string, unknown> | null;
  style: Record<string, unknown> | undefined;
  styleParts: string[];
  context?: ColorContext;
  firstColumn: boolean;
  lastColumn: boolean;
  firstRow: boolean;
  lastRow: boolean;
}): ParsedPptxTableCellBorders | undefined {
  const atEdge = {
    left: args.firstColumn,
    right: args.lastColumn,
    top: args.firstRow,
    bottom: args.lastRow,
  };
  const borders: ParsedPptxTableCellBorders = {};
  for (const { side, cellElement, edge, inside } of TABLE_BORDER_SIDES) {
    const declared = record(args.tcPr?.[cellElement]);
    const border = declared
      ? parseTableBorderLine(declared, args.context)
      : tableStylePartBorder(
          args.style,
          args.styleParts,
          atEdge[side] ? edge : inside,
          args.context,
        );
    if (border) borders[side] = border;
  }
  return Object.keys(borders).length > 0 ? borders : undefined;
}

function tableStylePartBorder(
  style: Record<string, unknown> | undefined,
  parts: string[],
  side: string,
  context?: ColorContext,
): ParsedPptxTableBorder | undefined {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const borderSet = record(
      record(record(style?.[`a:${parts[index]}`])?.["a:tcStyle"])?.["a:tcBdr"],
    );
    const declared = record(borderSet?.[side]);
    if (declared)
      return parseTableBorderLine(record(declared["a:ln"]), context);
  }
  return undefined;
}

function tableStylePartFill(
  style: Record<string, unknown> | undefined,
  parts: string[],
  context?: ColorContext,
): string | undefined {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const fill = record(
      record(record(style?.[`a:${parts[index]}`])?.["a:tcStyle"])?.["a:fill"],
    );
    if (fill) return parseShapeFill(fill, context);
  }
  return undefined;
}

function parseTableBorderLine(
  line: Record<string, unknown> | null,
  context?: ColorContext,
): ParsedPptxTableBorder | undefined {
  if (!line || line["a:noFill"] !== undefined) return undefined;
  const color = parseColor(record(line["a:solidFill"]), context);
  if (!color) return undefined;
  const widthEmu = positiveAttributeNumber(line, "@_w");
  const preset = stringValue(record(line["a:prstDash"])?.["@_val"]);
  const dash =
    !preset || preset === "solid"
      ? undefined
      : preset === "dot" || preset === "sysDot"
        ? "dotted"
        : "dashed";
  return {
    color,
    ...(widthEmu ? { widthEmu } : {}),
    ...(dash ? { dash } : {}),
  };
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

function readNonVisualProperties(
  node: Record<string, unknown>,
): Record<string, unknown> | null {
  return (
    record(record(node["p:nvSpPr"])?.["p:cNvPr"]) ??
    record(record(node["p:nvPicPr"])?.["p:cNvPr"]) ??
    record(record(node["p:nvCxnSpPr"])?.["p:cNvPr"]) ??
    record(record(node["p:nvGraphicFramePr"])?.["p:cNvPr"]) ??
    record(record(node["p:nvGrpSpPr"])?.["p:cNvPr"])
  );
}

function readShapeId(node: Record<string, unknown>): string {
  return (
    stringValue(readNonVisualProperties(node)?.["@_id"]) ??
    `shape-${Math.random().toString(36).slice(2)}`
  );
}

function readShapeName(node: Record<string, unknown>): string | undefined {
  return stringValue(readNonVisualProperties(node)?.["@_name"]);
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
  return transformFromXfrmNode(record(record(node[key])?.["a:xfrm"]));
}

function transformFromXfrmNode(
  xfrm: Record<string, unknown> | null,
): ParsedShapeTransform {
  const off = readPoint(xfrm?.["a:off"]);
  const ext = readExtent(xfrm?.["a:ext"]);
  const rawRotation = Number(xfrm?.["@_rot"]);
  return {
    x: off.x,
    y: off.y,
    width: ext.x,
    height: ext.y,
    ...(xfrm?.["@_flipH"] !== undefined && xmlBoolean(xfrm["@_flipH"])
      ? { flipH: true }
      : {}),
    ...(xfrm?.["@_flipV"] !== undefined && xmlBoolean(xfrm["@_flipV"])
      ? { flipV: true }
      : {}),
    ...(Number.isFinite(rawRotation) && rawRotation !== 0
      ? { rotation: rawRotation / 60000 }
      : {}),
  };
}

function applyTransform(
  transform: ParsedShapeTransform,
  context: ShapeTransformContext,
): ParsedShapeTransform {
  const scaleX = Math.hypot(context.matrix.a, context.matrix.b);
  const scaleY = Math.hypot(context.matrix.c, context.matrix.d);
  const width = transform.width * scaleX;
  const height = transform.height * scaleY;
  const center = applyMatPoint(
    context.matrix,
    transform.x + transform.width / 2,
    transform.y + transform.height / 2,
  );
  const rotation = (transform.rotation ?? 0) + context.rotation;
  return {
    x: center.x - width / 2,
    y: center.y - height / 2,
    width,
    height,
    ...(transform.flipH ? { flipH: true } : {}),
    ...(transform.flipV ? { flipV: true } : {}),
    ...(rotation ? { rotation } : {}),
  };
}

/** A slide-number field on a slideLayout/slideMaster is parsed once and shared by every slide using that layout, so its value cannot be known at parse time. This token stands in until `substituteSlideNumber` resolves it per slide — the alternative, keeping the cached "‹#›" glyph, is the literal placeholder text showing up on 36 of 36 slides. */
const SLIDE_NUMBER_TOKEN = "\u0001slidenum\u0001";

function substituteSlideNumber(
  elements: ParsedPptxElement[],
  slideNumber: number,
): ParsedPptxElement[] {
  return elements.map((element) => {
    if (
      !element.paragraphs?.some((paragraph) =>
        paragraph.runs.some((run) => run.content.includes(SLIDE_NUMBER_TOKEN)),
      )
    ) {
      return element;
    }
    return {
      ...element,
      paragraphs: element.paragraphs.map((paragraph) => ({
        ...paragraph,
        runs: paragraph.runs.map((run) => ({
          ...run,
          content: run.content.replaceAll(
            SLIDE_NUMBER_TOKEN,
            String(slideNumber),
          ),
        })),
      })),
    };
  });
}

interface TextResolutionContext {
  relationships?: Map<string, { target: string; type: string }>;
  slideNumber?: number;
}

function parseTextBody(
  node: Record<string, unknown>,
  context?: ColorContext,
  text?: TextResolutionContext,
): ParsedPptxParagraph[] {
  return parseTextBodyParagraphs(record(node["p:txBody"]), context, text);
}

function formatAutoNumBullet(n: number): string {
  return `${n}.`;
}

function parseTextBodyParagraphs(
  txBody: Record<string, unknown> | null,
  context?: ColorContext,
  text?: TextResolutionContext,
): ParsedPptxParagraph[] {
  if (!txBody) return [];
  const autoNumCounters = new Map<number, number>();
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
          ...runProperties(
            record(run?.["a:rPr"]),
            {},
            context,
            text?.relationships,
          ),
        });
      }
    }
    for (const rawField of asArray(paragraph?.["a:fld"])) {
      const field = record(rawField);
      const content =
        stringValue(field?.["@_type"]) === "slidenum"
          ? (text?.slideNumber?.toString() ?? SLIDE_NUMBER_TOKEN)
          : innerText(field?.["a:t"]);
      if (content) {
        runs.push({
          content,
          ...runProperties(
            record(field?.["a:rPr"]),
            {},
            context,
            text?.relationships,
          ),
        });
      }
    }
    for (const [index, run] of runs.entries()) {
      if (run.content !== "\n" || run.fontSize !== undefined) continue;
      const source = runs[index - 1] ?? runs[index + 1];
      if (source) runs[index] = { ...source, content: "\n" };
    }
    const bullet = record(pPr?.["a:buChar"]);
    const bulletColor = parseColor(record(pPr?.["a:buClr"]), context);
    const bulletFont = stringValue(record(pPr?.["a:buFont"])?.["@_typeface"]);
    const bulletSize = Number(record(pPr?.["a:buSzPts"])?.["@_val"]);
    const lineSpacing = parseParagraphSpacing(
      pPr?.["a:lnSpc"],
      runs[0]?.fontSize,
    );
    const spaceBeforePt = parsePoints(pPr?.["a:spcBef"]);
    const spaceAfterPt = parsePoints(pPr?.["a:spcAft"]);
    const alignment = mapAlignment(stringValue(pPr?.["@_algn"]));
    const level = Number.isFinite(Number(pPr?.["@_lvl"]))
      ? Number(pPr?.["@_lvl"])
      : 0;

    let autoNumBullet: string | undefined;
    if (pPr?.["a:buAutoNum"] !== undefined && pPr?.["a:buNone"] === undefined) {
      for (const key of [...autoNumCounters.keys()]) {
        if (key > level) autoNumCounters.delete(key);
      }
      const next = (autoNumCounters.get(level) ?? 0) + 1;
      autoNumCounters.set(level, next);
      autoNumBullet = formatAutoNumBullet(next);
    } else if (bullet?.["@_char"] === undefined) {
      autoNumCounters.clear();
    }

    return {
      runs,
      ...(alignment ? { alignment } : {}),
      ...(bullet?.["@_char"] && !pPr?.["a:buNone"]
        ? { bulletChar: String(bullet["@_char"]) }
        : autoNumBullet
          ? { bulletChar: autoNumBullet }
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
      ...(pPr?.["@_rtl"] !== undefined && xmlBoolean(pPr["@_rtl"])
        ? { rtl: true }
        : {}),
    };
  });
}

function applyAutofitScale(
  paragraphs: ParsedPptxParagraph[],
  bodyPr: Record<string, unknown> | null,
): ParsedPptxParagraph[] {
  const autofit = record(bodyPr?.["a:normAutofit"]);
  if (!autofit) return paragraphs;
  const fontScale = Number(autofit["@_fontScale"]) / 100000;
  const lineReduction = Number(autofit["@_lnSpcReduction"]) / 100000;
  const scale = Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1;
  const lineScale =
    Number.isFinite(lineReduction) && lineReduction > 0 && lineReduction < 1
      ? 1 - lineReduction
      : 1;
  if (scale === 1 && lineScale === 1) return paragraphs;
  return paragraphs.map((paragraph) => ({
    ...paragraph,
    ...(paragraph.lineSpacing !== undefined
      ? { lineSpacing: roundTo(paragraph.lineSpacing * lineScale, 4) }
      : {}),
    runs: paragraph.runs.map((run) =>
      run.fontSize === undefined
        ? run
        : { ...run, fontSize: roundTo(run.fontSize * scale, 2) },
    ),
  }));
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

const PATH_COMMAND_POINTS: Record<string, number> = {
  "a:moveTo": 1,
  "a:lnTo": 1,
  "a:quadBezTo": 2,
  "a:cubicBezTo": 3,
};

function parseShapeAdjustments(
  shapeProperties: Record<string, unknown> | null,
): Record<string, number> | undefined {
  const guides = asArray(
    record(record(shapeProperties?.["a:prstGeom"])?.["a:avLst"])?.["a:gd"],
  );
  const adjustments: Record<string, number> = {};
  for (const raw of guides) {
    const guide = record(raw);
    const name = stringValue(guide?.["@_name"]);
    const value = Number(
      stringValue(guide?.["@_fmla"])?.match(/^val\s+(-?\d+)$/)?.[1],
    );
    if (name && Number.isFinite(value)) adjustments[name] = value;
  }
  return Object.keys(adjustments).length > 0 ? adjustments : undefined;
}

function parseCustomGeometry(
  shapeProperties: Record<string, unknown> | null,
  shapeBox: { width: number; height: number },
): ParsedPptxGeometry | undefined {
  const custGeom = record(shapeProperties?.["a:custGeom"]);
  if (!custGeom) return undefined;
  const paths: ParsedPptxPath[] = [];
  for (const rawList of asArray(custGeom["a:pathLst"])) {
    for (const rawPath of asArray(record(rawList)?.["a:path"])) {
      const node = record(rawPath);
      if (!node) continue;
      const commands = readPathCommands(node);
      if (!commands) continue;
      const w = Number(node["@_w"]) || shapeBox.width;
      const h = Number(node["@_h"]) || shapeBox.height;
      if (!(w > 0) || !(h > 0)) continue;
      paths.push({ w, h, commands });
    }
  }
  return paths.length > 0 ? { kind: "custom", paths } : undefined;
}

function readPathCommands(
  path: Record<string, unknown>,
): ParsedPptxPathCommand[] | undefined {
  const ordered: { order: number; command: ParsedPptxPathCommand }[] = [];
  let unreadable = false;
  const push = (
    node: Record<string, unknown> | null,
    command: ParsedPptxPathCommand | undefined,
  ) => {
    const order = Number(node?.[PATH_COMMAND_ORDER_ATTRIBUTE]);
    if (!command || !Number.isFinite(order)) unreadable = true;
    else ordered.push({ order, command });
  };
  for (const [tag, count] of Object.entries(PATH_COMMAND_POINTS)) {
    for (const raw of asArray(path[tag])) {
      const node = record(raw);
      const points = asArray(node?.["a:pt"]).map((raw) => {
        const pt = record(raw);
        return { x: Number(pt?.["@_x"]), y: Number(pt?.["@_y"]) };
      });
      const usable =
        points.length === count &&
        points.every((pt) => Number.isFinite(pt.x) && Number.isFinite(pt.y));
      push(
        node,
        usable
          ? {
              kind: tag.slice(2) as
                | "moveTo"
                | "lnTo"
                | "quadBezTo"
                | "cubicBezTo",
              points,
            }
          : undefined,
      );
    }
  }
  for (const raw of asArray(path["a:arcTo"])) {
    const node = record(raw);
    const arc = {
      kind: "arcTo" as const,
      wR: Number(node?.["@_wR"]),
      hR: Number(node?.["@_hR"]),
      stAng: Number(node?.["@_stAng"]),
      swAng: Number(node?.["@_swAng"]),
    };
    const usable = [arc.wR, arc.hR, arc.stAng, arc.swAng].every((value) =>
      Number.isFinite(value),
    );
    push(node, usable ? arc : undefined);
  }
  for (const raw of asArray(path["a:close"])) {
    push(record(raw), { kind: "close" });
  }
  if (unreadable || ordered.length === 0) return undefined;
  ordered.sort((a, b) => a.order - b.order);
  return ordered.map((entry) => entry.command);
}

function parseShapeFill(
  shapeProperties: Record<string, unknown> | null,
  context?: ColorContext,
): string | undefined {
  if (!shapeProperties) return undefined;
  if (shapeProperties["a:noFill"] !== undefined) return undefined;
  const solid = parseColor(record(shapeProperties["a:solidFill"]), context);
  if (solid) return solid;
  return parseGradientFill(record(shapeProperties["a:gradFill"]), context);
}

function parseShapeLine(
  shapeProperties: Record<string, unknown> | null,
  context?: ColorContext,
):
  | {
      color: string;
      width?: number;
      headEnd?: ParsedPptxLineEnd;
      tailEnd?: ParsedPptxLineEnd;
    }
  | undefined {
  const line = record(shapeProperties?.["a:ln"]);
  if (!line || line["a:noFill"] !== undefined) return undefined;
  const color = parseColor(record(line["a:solidFill"]), context);
  if (!color) return undefined;
  const width = Number(line["@_w"]);
  const headEnd = parseLineEnd(line["a:headEnd"]);
  const tailEnd = parseLineEnd(line["a:tailEnd"]);
  return {
    color,
    ...(Number.isFinite(width) && width > 0 ? { width } : {}),
    ...(headEnd ? { headEnd } : {}),
    ...(tailEnd ? { tailEnd } : {}),
  };
}

function parseLineEnd(node: unknown): ParsedPptxLineEnd | undefined {
  const end = record(node);
  const type = stringValue(end?.["@_type"]);
  if (!type) return undefined;
  const w = stringValue(end?.["@_w"]);
  const len = stringValue(end?.["@_len"]);
  return { type, ...(w ? { w } : {}), ...(len ? { len } : {}) };
}

interface ColorContext {
  themeColorsByName: Record<string, string>;
  clrMap: Record<string, string>;
}

interface PlaceholderShapeDefaults {
  type?: string;
  idx?: string;
  runDefaultsByLevel: Record<number, InheritedRunProperties>;
  transform?: ParsedShapeTransform;
}

interface PlaceholderDefaults {
  title: Record<number, InheritedRunProperties>;
  body: Record<number, InheritedRunProperties>;
  other: Record<number, InheritedRunProperties>;
  layoutPlaceholders: PlaceholderShapeDefaults[];
  masterPlaceholders: PlaceholderShapeDefaults[];
}

const PLACEHOLDER_TYPE_GROUPS = [
  ["title", "ctrTitle"],
  ["body", "subTitle", "obj"],
];

function placeholderTypeCandidates(type: string): string[] {
  const group = PLACEHOLDER_TYPE_GROUPS.find((names) => names.includes(type));
  return group ? [type, ...group.filter((name) => name !== type)] : [type];
}

function findMatchingPlaceholderShape(
  placeholders: PlaceholderShapeDefaults[],
  type: string | undefined,
  idx: string | undefined,
): PlaceholderShapeDefaults | undefined {
  if (type) {
    for (const candidate of placeholderTypeCandidates(type)) {
      const match =
        placeholders.find((p) => p.type === candidate && p.idx === idx) ??
        placeholders.find((p) => p.type === candidate);
      if (match) return match;
    }
    return undefined;
  }
  return placeholders.find((p) => p.idx === idx);
}

function txStylesTierForType(
  type: string | undefined,
): "title" | "body" | "other" {
  if (type === "title" || type === "ctrTitle") return "title";
  if (
    type === undefined ||
    type === "body" ||
    type === "subTitle" ||
    type === "obj"
  )
    return "body";
  return "other";
}

function resolvePlaceholderRunDefaults(args: {
  type: string | undefined;
  idx: string | undefined;
  defaults: PlaceholderDefaults;
}): Record<number, InheritedRunProperties> | undefined {
  const layoutMatch = findMatchingPlaceholderShape(
    args.defaults.layoutPlaceholders,
    args.type,
    args.idx,
  );
  const masterMatch = findMatchingPlaceholderShape(
    args.defaults.masterPlaceholders,
    args.type,
    args.idx,
  );
  const txStylesByLevel = args.defaults[txStylesTierForType(args.type)];
  const merged: Record<number, InheritedRunProperties> = {};
  let any = false;
  for (let level = 0; level < 9; level++) {
    const properties: InheritedRunProperties = {
      ...txStylesByLevel[level],
      ...masterMatch?.runDefaultsByLevel[level],
      ...layoutMatch?.runDefaultsByLevel[level],
    };
    merged[level] = properties;
    if (Object.keys(properties).length > 0) any = true;
  }
  return any ? merged : undefined;
}

function resolvePlaceholderTransform(args: {
  type: string | undefined;
  idx: string | undefined;
  defaults: PlaceholderDefaults;
}): ParsedShapeTransform | undefined {
  const layoutMatch = findMatchingPlaceholderShape(
    args.defaults.layoutPlaceholders,
    args.type,
    args.idx,
  );
  const masterMatch = findMatchingPlaceholderShape(
    args.defaults.masterPlaceholders,
    args.type,
    args.idx,
  );
  return layoutMatch?.transform ?? masterMatch?.transform;
}

function applyPlaceholderRunDefaults(
  paragraphs: ParsedPptxParagraph[],
  defaultsByLevel: Record<number, InheritedRunProperties> | undefined,
): ParsedPptxParagraph[] {
  if (!defaultsByLevel) return paragraphs;
  return paragraphs.map((paragraph) => {
    const level = paragraph.level ?? 0;
    const own = defaultsByLevel[level];
    const defaults =
      own && Object.keys(own).length > 0 ? own : defaultsByLevel[0];
    if (!defaults || Object.keys(defaults).length === 0) return paragraph;
    return {
      ...paragraph,
      runs: paragraph.runs.map((run) => ({ ...defaults, ...run })),
    };
  });
}

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

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  switch (max) {
    case r:
      h = (g - b) / d + (g < b ? 6 : 0);
      break;
    case g:
      h = (b - r) / d + 2;
      break;
    default:
      h = (r - g) / d + 4;
  }
  return [h * 60, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const toByte = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16)
      .padStart(2, "0");
  if (s === 0) {
    const gray = toByte(l);
    return `#${gray}${gray}${gray}`;
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hNorm = h / 360;
  const r = hue2rgb(p, q, hNorm + 1 / 3);
  const g = hue2rgb(p, q, hNorm);
  const b = hue2rgb(p, q, hNorm - 1 / 3);
  return `#${toByte(r)}${toByte(g)}${toByte(b)}`;
}

interface ColorTransforms {
  lumMod?: number;
  lumOff?: number;
  tint?: number;
  shade?: number;
  alphaPercent?: number;
}

function readColorTransforms(
  node: Record<string, unknown> | null,
): ColorTransforms {
  if (!node) return {};
  const percent = (key: string): number | undefined => {
    const raw = stringValue(record(node[key])?.["@_val"]);
    return raw !== undefined ? Number(raw) / 100000 : undefined;
  };
  const alphaRaw = stringValue(record(node["a:alpha"])?.["@_val"]);
  return {
    lumMod: percent("a:lumMod"),
    lumOff: percent("a:lumOff"),
    tint: percent("a:tint"),
    shade: percent("a:shade"),
    ...(alphaRaw !== undefined
      ? { alphaPercent: Number(alphaRaw) / 1000 }
      : {}),
  };
}

function applyColorTransforms(
  hex: string,
  transforms: ColorTransforms,
): string {
  const { lumMod, lumOff, tint, shade, alphaPercent } = transforms;
  let result = hex;
  if (
    lumMod !== undefined ||
    lumOff !== undefined ||
    tint !== undefined ||
    shade !== undefined
  ) {
    const [h, s, initialL] = hexToHsl(hex);
    let l = initialL;
    if (lumMod !== undefined) l *= lumMod;
    if (lumOff !== undefined) l += lumOff;
    if (tint !== undefined) l = l * tint + (1 - tint);
    if (shade !== undefined) l *= shade;
    result = hslToHex(h, s, Math.min(1, Math.max(0, l)));
  }
  if (alphaPercent !== undefined) {
    const alphaByte = Math.max(
      0,
      Math.min(255, Math.round((alphaPercent / 100) * 255)),
    );
    result = `${result}${alphaByte.toString(16).padStart(2, "0")}`;
  }
  return result;
}

function parseColor(
  value: Record<string, unknown> | null,
  context?: ColorContext,
): string | undefined {
  if (!value) return undefined;
  const srgbNode = record(value["a:srgbClr"]);
  const rgb = stringValue(srgbNode?.["@_val"]);
  if (rgb) {
    return applyColorTransforms(`#${rgb}`, readColorTransforms(srgbNode));
  }
  const schemeNode = record(value["a:schemeClr"]);
  const scheme = stringValue(schemeNode?.["@_val"]);
  if (!scheme) return undefined;
  const transforms = readColorTransforms(schemeNode);
  const resolved = resolveSchemeColorName(scheme, context);
  if (resolved) return applyColorTransforms(resolved, transforms);
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
  const fallbackColor = fallback[scheme];
  return fallbackColor
    ? applyColorTransforms(fallbackColor, transforms)
    : undefined;
}

const MIN_LINE_SPACING_RATIO = 0.8;
const MAX_LINE_SPACING_RATIO = 3;

// `a:spcPct` is a percentage of *single* line spacing, and single spacing in
// PowerPoint and Google Slides is the font's own line height (ascent +
// descent + line gap), not its em size — the same quantity CSS calls
// `line-height: normal`. Treating `100%` as CSS `line-height: 1` therefore
// shipped every body paragraph ~17% tighter than the source, which is what
// five unrelated decks were independently reported for. CSS cannot scale
// `normal`, so a constant stands in for it.
// ponytail: one constant for every font; per-font ascent/descent metrics if a
// specific deck's leading still reads off.
const SINGLE_LINE_SPACING_RATIO = 1.2;

const DEFAULT_FONT_SIZE_PT = 18;

function parseParagraphSpacing(
  value: unknown,
  fontSizePt: number | undefined,
): number | undefined {
  const node = record(value);
  const percent = Number(record(node?.["a:spcPct"])?.["@_val"]);
  if (Number.isFinite(percent) && percent > 0) {
    return (percent / 100000) * SINGLE_LINE_SPACING_RATIO;
  }
  const points = parsePoints(node?.["a:spcPts"]);
  if (points === undefined) return undefined;
  const ratio =
    points / (fontSizePt && fontSizePt > 0 ? fontSizePt : DEFAULT_FONT_SIZE_PT);
  return Math.min(
    MAX_LINE_SPACING_RATIO,
    Math.max(MIN_LINE_SPACING_RATIO, ratio),
  );
}

function parsePoints(value: unknown): number | undefined {
  const node = record(value);
  const target = record(node?.["a:spcPts"]) ?? node;
  const points = Number(target?.["@_val"]);
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

function extractSlideBackground(
  value: unknown,
  context?: ColorContext,
): string | undefined {
  const root = record(value);
  const cSld = record(record(root?.["p:sld"])?.["p:cSld"] ?? root?.["p:cSld"]);
  return parseBackgroundNode(cSld?.["p:bg"], context);
}

function parseBackgroundNode(
  value: unknown,
  context?: ColorContext,
): string | undefined {
  const bg = record(value);
  if (!bg) return undefined;
  const bgPr = record(bg["p:bgPr"]);
  if (bgPr) {
    const solid = parseColor(record(bgPr["a:solidFill"]), context);
    if (solid) return solid;
    const gradient = parseGradientFill(record(bgPr["a:gradFill"]), context);
    if (gradient) return gradient;
    const pattern = record(bgPr["a:pattFill"]);
    if (pattern) {
      return (
        parseColor(record(pattern["a:bgClr"]), context) ??
        parseColor(record(pattern["a:fgClr"]), context)
      );
    }
    return undefined;
  }
  return parseColor(record(bg["p:bgRef"]), context);
}

function parseGradientFill(
  gradFill: Record<string, unknown> | null,
  context?: ColorContext,
): string | undefined {
  if (!gradFill) return undefined;
  const stops = asArray(record(gradFill["a:gsLst"])?.["a:gs"]).flatMap(
    (rawStop) => {
      const stop = record(rawStop);
      const color = parseColor(stop, context);
      if (!color) return [];
      const position = Number(stop?.["@_pos"]);
      return [
        {
          color,
          position: Number.isFinite(position) ? position / 1000 : undefined,
        },
      ];
    },
  );
  if (stops.length === 0) return undefined;
  if (stops.length === 1) return stops[0].color;
  const stopList = stops
    .map((stop) =>
      stop.position === undefined
        ? stop.color
        : `${stop.color} ${roundTo(stop.position, 2)}%`,
    )
    .join(", ");
  const path = record(gradFill["a:path"]);
  if (path) {
    const rect = record(path["a:fillToRect"]);
    const centerX = fillToRectCenter(rect, "@_l", "@_r");
    const centerY = fillToRectCenter(rect, "@_t", "@_b");
    return `radial-gradient(circle at ${centerX}% ${centerY}%, ${stopList})`;
  }
  const angle = Number(record(gradFill["a:lin"])?.["@_ang"]);
  const cssAngle = Number.isFinite(angle)
    ? (((angle / 60000 + 90) % 360) + 360) % 360
    : 180;
  return `linear-gradient(${roundTo(cssAngle, 2)}deg, ${stopList})`;
}

function fillToRectCenter(
  rect: Record<string, unknown> | null,
  nearAttribute: string,
  farAttribute: string,
): number {
  const near = percentAttribute(rect, nearAttribute) ?? 50;
  const far = percentAttribute(rect, farAttribute) ?? 50;
  return roundTo((near + (100 - far)) / 2, 2);
}

function percentAttribute(
  node: Record<string, unknown> | null,
  attribute: string,
): number | undefined {
  const raw = node?.[attribute];
  if (raw === undefined || raw === null) return undefined;
  const text = String(raw).trim();
  const value = Number(text.replace(/%$/, ""));
  if (!Number.isFinite(value)) return undefined;
  return text.endsWith("%") ? value : value / 1000;
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
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
  slideMasterRelationship?: { target: string; type: string },
): Promise<ThemeInfo> {
  const masterPath = slideMasterRelationship
    ? resolvePptxRelationshipPath("ppt", slideMasterRelationship.target)
    : undefined;
  const masterRelsXml = masterPath
    ? await zip.file(relsPathForPptxPart(masterPath))?.async("string")
    : undefined;
  const themeTarget = masterRelsXml
    ? [...parseRelationships(parseXml(masterRelsXml)).values()].find(
        (relationship) => relationship.type.endsWith("/theme"),
      )?.target
    : undefined;
  const themePath = themeTarget
    ? resolvePptxRelationshipPath("ppt/slideMasters", themeTarget)
    : "ppt/theme/theme1.xml";
  const theme = await parseThemeFromPath(zip, parseXml, themePath);
  return theme.colors.length > 0
    ? theme
    : parseThemeFromPath(zip, parseXml, "ppt/theme/theme1.xml");
}

async function parseThemeFromPath(
  zip: ZipArchive,
  parseXml: (xml: string) => unknown,
  themePath: string,
): Promise<ThemeInfo> {
  const xml = await zip.file(themePath)?.async("string");
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
  context?: ColorContext,
  relationships?: Map<string, { target: string; type: string }>,
): Omit<ParsedPptxTextRun, "content"> {
  if (!value) return inherited;
  const size = Number(value["@_sz"]);
  const linkId = stringValue(record(value["a:hlinkClick"])?.["@_r:id"]);
  const href = linkId ? relationships?.get(linkId)?.target : undefined;
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
    ...(href ? { href } : {}),
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
      parseTagValue: false,
    });
    return {
      loadZip: (data) => zipModule.default.loadAsync(data),
      parseXml: (xml) =>
        parser.parse(annotatePathCommandOrder(normalizeHardLineBreaks(xml))),
    };
  } catch {
    throw new Error(
      "Structured PPTX parsing requires the optional jszip and fast-xml-parser dependencies.",
    );
  }
}

function normalizeHardLineBreaks(xml: string): string {
  return xml.replace(
    /<a:br(?:\s[^>]*?)?\/>|<a:br(?:\s[^>]*?)?>[\s\S]*?<\/a:br>/g,
    "<a:r><a:t>\n</a:t></a:r>",
  );
}

const PATH_COMMAND_ORDER_ATTRIBUTE = "@_an-order";

function annotatePathCommandOrder(xml: string): string {
  let order = 0;
  return xml.replace(
    /<a:(?:moveTo|lnTo|cubicBezTo|quadBezTo|arcTo|close)\b/g,
    (match) => `${match} an-order="${order++}"`,
  );
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

function positiveAttributeNumber(
  value: unknown,
  attribute: string,
): number | undefined {
  const parsed = Number(record(value)?.[attribute]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function sumOf(values: number[] | undefined): number | undefined {
  if (!values || values.length === 0) return undefined;
  const total = values.reduce((sum, value) => sum + value, 0);
  return total > 0 ? total : undefined;
}

function xmlBoolean(value: unknown): boolean {
  return value === true || value === 1 || /^(?:1|true)$/i.test(String(value));
}
