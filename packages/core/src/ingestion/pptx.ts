export interface ParsedPptxTextRun {
  content: string;
  bold?: boolean;
  italic?: boolean;
  fontSize?: number;
  color?: string;
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
}

export interface ParsedPptxSlide {
  texts: ParsedPptxTextRun[];
  images: ParsedPptxImage[];
  notes?: string;
  layoutHint?: string;
  transition?: ParsedPptxTransition;
  splitByParagraph?: boolean;
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
    const texts: ParsedPptxTextRun[] = [];
    collectTextRuns(slide, texts);
    const images: ParsedPptxImage[] = [];
    const relationshipPath = slidePath.replace(
      /slides\/(slide\d+\.xml)/,
      "slides/_rels/$1.rels",
    );
    const slideRelationshipsXml = await zip
      .file(relationshipPath)
      ?.async("string");
    if (slideRelationshipsXml) {
      const slideRelationships = parseRelationships(
        parseXml(slideRelationshipsXml),
      );
      // Walk the slide's own picture shapes (in document order) rather than
      // every image relationship, so each image carries the placed size the
      // author gave it on the slide — that size is what tells a full-bleed
      // cover photo apart from a small inset card photo, which a flat
      // relationship scan has no way to know.
      const pictureShapes: PictureShape[] = [];
      collectPictureShapes(slide, pictureShapes);
      reorderByDocumentPosition(pictureShapes, xml);
      addBackgroundFillShape(
        slide,
        pictureShapes,
        slideWidthEmu,
        slideHeightEmu,
      );
      for (const shape of pictureShapes) {
        if (!shape.embedId) continue;
        const relationship = slideRelationships.get(shape.embedId);
        if (!relationship) continue;
        if (
          !relationship.type.includes("/image") &&
          !/\.(png|jpe?g|gif|svg|webp|bmp|tiff?|emf|wmf)$/i.test(
            relationship.target,
          )
        ) {
          continue;
        }
        const imagePath = relationship.target.startsWith("/")
          ? relationship.target.slice(1)
          : relationship.target.startsWith("../")
            ? `ppt/${relationship.target.replace(/^\.\.\//, "")}`
            : `ppt/slides/${relationship.target}`;
        const image = zip.file(imagePath);
        if (!image) continue;
        const name = imagePath.split("/").at(-1) ?? "image";
        const aspectRatio =
          shape.widthEmu && shape.heightEmu
            ? shape.widthEmu / shape.heightEmu
            : undefined;
        const fullBleed = Boolean(
          shape.widthEmu &&
          shape.heightEmu &&
          slideWidthEmu &&
          slideHeightEmu &&
          shape.widthEmu / slideWidthEmu >= 0.85 &&
          shape.heightEmu / slideHeightEmu >= 0.85,
        );
        images.push({
          data: new Uint8Array(await image.async("nodebuffer")),
          mimeType: imageMimeType(name),
          name,
          aspectRatio,
          fullBleed,
        });
      }
    }
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

export function parsePptxSlideMetadata(
  value: unknown,
): ParsedPptxSlideMetadata {
  const slide = record(value)?.["p:sld"] ?? value;
  return {
    ...(parsePptxTransition(slide) ? { transition: parsePptxTransition(slide) } : {}),
    ...(detectSplitByParagraph(slide) ? { splitByParagraph: true } : {}),
  };
}

async function parseTheme(
  zip: ZipArchive,
  parseXml: (xml: string) => unknown,
): Promise<ParsedPptxPresentation["theme"]> {
  const xml = await zip.file("ppt/theme/theme1.xml")?.async("string");
  if (!xml) return undefined;
  const root = record(parseXml(xml));
  const elements = record(record(root?.["a:theme"])?.["a:themeElements"]);
  const scheme = record(elements?.["a:clrScheme"]);
  const colors: string[] = [];
  for (const [key, value] of Object.entries(scheme ?? {})) {
    if (key.startsWith("@_")) continue;
    const color = record(value);
    const rgb = stringValue(record(color?.["a:srgbClr"])?.["@_val"]);
    const system = stringValue(record(color?.["a:sysClr"])?.["@_lastClr"]);
    if (rgb || system) colors.push(`#${rgb ?? system}`);
  }
  const fontScheme = record(elements?.["a:fontScheme"]);
  const fonts = ["a:majorFont", "a:minorFont"].flatMap((key) => {
    const value = stringValue(
      record(record(fontScheme?.[key])?.["a:latin"])?.["@_typeface"],
    );
    return value ? [value] : [];
  });
  return colors.length || fonts.length ? { colors, fonts } : undefined;
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
    for (const item of asArray(child)) collectTextRuns(item, runs, inherited);
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

function parsePptxTransition(
  value: unknown,
): ParsedPptxTransition | undefined {
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

interface PictureShape {
  embedId?: string;
  widthEmu?: number;
  heightEmu?: number;
}

/**
 * Recursively find every embedded picture in a slide, in document order:
 * plain `p:pic` shapes, and `p:sp` autoshapes whose fill is a picture
 * (common for "photo cutout" shapes and full-bleed decorative rectangles).
 * A group shape (`p:grpSp`) defines its own local coordinate space for its
 * children (`chOff`/`chExt`) that can be scaled arbitrarily relative to the
 * group's own placed size on the slide, so each level of nesting multiplies
 * a running scale factor into the child sizes below it — without that, a
 * picture inside a resized group would report its unscaled design-time
 * size instead of how large it actually appears on the slide.
 */
function collectPictureShapes(
  value: unknown,
  out: PictureShape[],
  scaleX = 1,
  scaleY = 1,
): void {
  const node = record(value);
  if (!node) return;
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith("@_")) continue;
    if (key === "p:pic") {
      for (const picNode of asArray(child)) {
        const pic = record(picNode);
        const blip = record(record(pic?.["p:blipFill"])?.["a:blip"]);
        out.push(
          scaledShape(
            stringValue(blip?.["@_r:embed"]),
            extFromSpPr(pic),
            scaleX,
            scaleY,
          ),
        );
      }
      continue;
    }
    if (key === "p:sp") {
      for (const spNode of asArray(child)) {
        const sp = record(spNode);
        const blip = record(
          record(record(sp?.["p:spPr"])?.["a:blipFill"])?.["a:blip"],
        );
        const embedId = stringValue(blip?.["@_r:embed"]);
        if (embedId) {
          out.push(scaledShape(embedId, extFromSpPr(sp), scaleX, scaleY));
        }
      }
      continue;
    }
    if (key === "p:grpSp") {
      for (const groupNode of asArray(child)) {
        const scale = groupChildScale(record(groupNode), scaleX, scaleY);
        collectPictureShapes(groupNode, out, scale.x, scale.y);
      }
      continue;
    }
    for (const item of asArray(child)) {
      collectPictureShapes(item, out, scaleX, scaleY);
    }
  }
}

/** Whether an `a:xfrm` `rot` value (60,000ths of a degree) is an odd multiple of 90° — a 90/270 turn that swaps effective width and height. */
function isOddQuarterTurn(rot: number): boolean {
  if (!Number.isFinite(rot)) return false;
  const quarterTurns = Math.round(rot / 60000 / 90);
  return ((quarterTurns % 2) + 2) % 2 === 1;
}

/**
 * A group's `chExt` is the coordinate space its children are authored in;
 * `ext` is how large the group actually renders — the ratio between them is
 * the extra scale nested children need on top of their own declared size.
 * When the group itself is rotated a 90/270-degree turn, that ratio applies
 * to the perpendicular axis on the slide, so the X/Y scale factors need
 * swapping the same way a rotated picture's own width/height do.
 */
function groupChildScale(
  groupNode: Record<string, unknown> | null,
  parentScaleX: number,
  parentScaleY: number,
): { x: number; y: number } {
  const xfrm = record(record(groupNode?.["p:grpSpPr"])?.["a:xfrm"]);
  const ext = record(xfrm?.["a:ext"]);
  const chExt = record(xfrm?.["a:chExt"]);
  const extCx = Number(ext?.["@_cx"]);
  const extCy = Number(ext?.["@_cy"]);
  const chExtCx = Number(chExt?.["@_cx"]);
  const chExtCy = Number(chExt?.["@_cy"]);
  let groupScaleX =
    Number.isFinite(extCx) && Number.isFinite(chExtCx) && chExtCx > 0
      ? extCx / chExtCx
      : 1;
  let groupScaleY =
    Number.isFinite(extCy) && Number.isFinite(chExtCy) && chExtCy > 0
      ? extCy / chExtCy
      : 1;
  if (isOddQuarterTurn(Number(xfrm?.["@_rot"]))) {
    [groupScaleX, groupScaleY] = [groupScaleY, groupScaleX];
  }
  return { x: parentScaleX * groupScaleX, y: parentScaleY * groupScaleY };
}

/**
 * `a:xfrm/a:ext` always stores the shape's *unrotated* design-time width and
 * height — `a:xfrm/@rot` (in 60,000ths of a degree) rotates it around its
 * own center afterward. For a 90/270-degree turn, the shape's effective
 * on-slide footprint has its width and height swapped relative to that
 * declared size, so a rotated full-bleed photo can otherwise get treated as
 * a small inset, or a portrait image get an inverted aspect ratio.
 */
function extFromSpPr(shapeNode: Record<string, unknown> | null): {
  cx?: number;
  cy?: number;
} {
  const xfrm = record(record(shapeNode?.["p:spPr"])?.["a:xfrm"]);
  const ext = record(xfrm?.["a:ext"]);
  const cx = Number(ext?.["@_cx"]);
  const cy = Number(ext?.["@_cy"]);
  if (!Number.isFinite(cx) || cx <= 0 || !Number.isFinite(cy) || cy <= 0) {
    return { cx: undefined, cy: undefined };
  }
  return isOddQuarterTurn(Number(xfrm?.["@_rot"]))
    ? { cx: cy, cy: cx }
    : { cx, cy };
}

function scaledShape(
  embedId: string | undefined,
  size: { cx?: number; cy?: number },
  scaleX: number,
  scaleY: number,
): PictureShape {
  return {
    embedId,
    widthEmu: size.cx !== undefined ? size.cx * scaleX : undefined,
    heightEmu: size.cy !== undefined ? size.cy * scaleY : undefined,
  };
}

/**
 * fast-xml-parser groups sibling elements by tag name, so a slide whose
 * picture-bearing shapes alternate types on the page (e.g. `p:sp`, `p:pic`,
 * `p:sp`) comes out of `collectPictureShapes` re-sorted by tag rather than
 * by the order they actually appear — every `p:sp` gets visited before any
 * `p:pic`, even if a `p:pic` came first in the file. Re-derive the true
 * order from the raw XML text instead: `<a:blip r:embed="...">` occurrences
 * appear in exactly document order regardless of nesting, so they can be
 * used to restore the author's original front-to-back ordering (which
 * matters because downstream rendering treats the first image as primary).
 */
function reorderByDocumentPosition(shapes: PictureShape[], xml: string): void {
  const order: string[] = [];
  const blipPattern = /<a:blip\b[^>]*\br:embed=(?:"([^"]+)"|'([^']+)')/g;
  let match: RegExpExecArray | null;
  while ((match = blipPattern.exec(xml))) order.push(match[1] ?? match[2]);

  // The same relationship id can legitimately be reused across multiple
  // placements (e.g. a repeated icon), so looking up a single fixed index
  // per id would assign every reused shape the position of its first XML
  // occurrence. Instead give each id a queue of its occurrence positions
  // and consume one per shape, in the order shapes were collected.
  const occurrences = new Map<string, number[]>();
  order.forEach((embedId, index) => {
    const queue = occurrences.get(embedId);
    if (queue) queue.push(index);
    else occurrences.set(embedId, [index]);
  });
  const positions = shapes.map((shape) => {
    const queue = shape.embedId ? occurrences.get(shape.embedId) : undefined;
    return queue && queue.length > 0 ? queue.shift()! : -1;
  });
  const sortedIndices = shapes.map((_, i) => i);
  sortedIndices.sort((a, b) => positions[a] - positions[b]);
  const sorted = sortedIndices.map((i) => shapes[i]);
  shapes.splice(0, shapes.length, ...sorted);
}

/** Read the embed relationship id of a slide's background picture fill (`p:cSld/p:bg/p:bgPr/a:blipFill/a:blip`), if any. */
function extractBackgroundFillEmbedId(slide: unknown): string | undefined {
  const root = record(slide);
  const cSld = record(record(root?.["p:sld"])?.["p:cSld"] ?? root?.["p:cSld"]);
  const bgPr = record(record(cSld?.["p:bg"])?.["p:bgPr"]);
  const blip = record(record(bgPr?.["a:blipFill"])?.["a:blip"]);
  return stringValue(blip?.["@_r:embed"]);
}

/**
 * Add the slide's background picture fill, if any, as a synthetic
 * full-slide-sized shape. It's unshifted to the front rather than appended:
 * downstream rendering only ever uses the first image in the list, and a
 * background fill is the slide's base layer — the primary visual — so a
 * smaller foreground picture (a logo, an icon) must not bump it out of that
 * slot.
 */
function addBackgroundFillShape(
  slide: unknown,
  pictureShapes: PictureShape[],
  slideWidthEmu: number | undefined,
  slideHeightEmu: number | undefined,
): void {
  const embedId = extractBackgroundFillEmbedId(slide);
  if (!embedId) return;
  pictureShapes.unshift({
    embedId,
    widthEmu: slideWidthEmu,
    heightEmu: slideHeightEmu,
  });
}

function runProperties(
  value: Record<string, unknown> | null,
  inherited: Omit<ParsedPptxTextRun, "content">,
): Omit<ParsedPptxTextRun, "content"> {
  if (!value) return inherited;
  const size = Number(value["@_sz"]);
  const rgb = stringValue(
    record(record(value["a:solidFill"])?.["a:srgbClr"])?.["@_val"],
  );
  return {
    ...inherited,
    ...(value["@_b"] === "1" || value["@_b"] === 1 || value["@_b"] === true
      ? { bold: true }
      : {}),
    ...(value["@_i"] === "1" || value["@_i"] === 1 || value["@_i"] === true
      ? { italic: true }
      : {}),
    ...(Number.isFinite(size) && size > 0 ? { fontSize: size / 100 } : {}),
    ...(rgb ? { color: `#${rgb}` } : {}),
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
