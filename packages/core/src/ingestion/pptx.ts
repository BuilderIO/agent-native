export interface ParsedPptxTextRun {
  content: string;
  bold?: boolean;
  italic?: boolean;
  fontSize?: number;
  color?: string;
}

export interface ParsedPptxImage {
  data: Uint8Array;
  mimeType: string;
  name: string;
}

export interface ParsedPptxSlide {
  texts: ParsedPptxTextRun[];
  images: ParsedPptxImage[];
  notes?: string;
  layoutHint?: string;
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
  const slideIds = asArray(
    record(record(record(presentation)?.["p:presentation"])?.["p:sldIdLst"])?.[
      "p:sldId"
    ],
  ).map((entry) => stringValue(record(entry)?.["@_r:id"]) ?? "");
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
      for (const relationship of parseRelationships(
        parseXml(slideRelationshipsXml),
      ).values()) {
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
        images.push({
          data: new Uint8Array(await image.async("nodebuffer")),
          mimeType: imageMimeType(name),
          name,
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
