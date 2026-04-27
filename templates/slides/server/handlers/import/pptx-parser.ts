import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

export interface ParsedTextRun {
  content: string;
  bold?: boolean;
  italic?: boolean;
  fontSize?: number;
  color?: string;
}

export interface ParsedImage {
  data: Buffer;
  mimeType: string;
  name: string;
}

export interface ParsedSlide {
  texts: ParsedTextRun[];
  images: ParsedImage[];
  notes?: string;
  layoutHint?: string;
}

export interface ParsedPresentation {
  title: string;
  slides: ParsedSlide[];
  theme?: { colors: string[]; fonts: string[] };
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

/** Normalise a value into an array (handles XML single-child vs multi-child). */
function asArray<T>(val: T | T[] | undefined | null): T[] {
  if (val == null) return [];
  return Array.isArray(val) ? val : [val];
}

/** Recursively collect all `a:t` text nodes from a tree. */
function collectTexts(
  node: unknown,
  runs: ParsedTextRun[],
  inheritedProps?: {
    bold?: boolean;
    italic?: boolean;
    fontSize?: number;
    color?: string;
  },
): void {
  if (node == null || typeof node !== "object") return;

  const obj = node as Record<string, unknown>;

  // a:r — a text run with optional formatting in a:rPr
  if (obj["a:r"] != null) {
    for (const run of asArray(obj["a:r"])) {
      const rObj = run as Record<string, unknown>;
      const rPr = rObj["a:rPr"] as Record<string, unknown> | undefined;
      const text = extractInnerText(rObj["a:t"]);
      if (!text) continue;

      const props = parseRunProps(rPr, inheritedProps);
      runs.push({ content: text, ...props });
    }
  }

  // a:t directly (e.g. inside a:fld)
  if (obj["a:t"] != null && obj["a:r"] == null) {
    const text = extractInnerText(obj["a:t"]);
    if (text) {
      runs.push({ content: text, ...inheritedProps });
    }
  }

  // Recurse into child elements (skip keys we already handled to avoid
  // double-counting text runs that were extracted from a:r above)
  for (const key of Object.keys(obj)) {
    if (key.startsWith("@_")) continue;
    if (key === "a:r" || key === "a:t") continue;
    const child = obj[key];
    if (child != null && typeof child === "object") {
      if (Array.isArray(child)) {
        for (const item of child) {
          collectTexts(item, runs, inheritedProps);
        }
      } else {
        collectTexts(child, runs, inheritedProps);
      }
    }
  }
}

function extractInnerText(val: unknown): string {
  if (val == null) return "";
  if (typeof val === "string") return val;
  if (typeof val === "number") return String(val);
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, unknown>;
    // fast-xml-parser may wrap text in #text when attributes are present
    if (obj["#text"] != null) return String(obj["#text"]);
  }
  return String(val);
}

function parseRunProps(
  rPr: Record<string, unknown> | undefined,
  inherited?: {
    bold?: boolean;
    italic?: boolean;
    fontSize?: number;
    color?: string;
  },
): { bold?: boolean; italic?: boolean; fontSize?: number; color?: string } {
  const props: {
    bold?: boolean;
    italic?: boolean;
    fontSize?: number;
    color?: string;
  } = {
    ...inherited,
  };
  if (!rPr) return props;

  if (rPr["@_b"] === "1" || rPr["@_b"] === 1 || rPr["@_b"] === true) {
    props.bold = true;
  }
  if (rPr["@_i"] === "1" || rPr["@_i"] === 1 || rPr["@_i"] === true) {
    props.italic = true;
  }
  // Font size in hundredths of a point — convert to pt
  if (rPr["@_sz"] != null) {
    const sz = Number(rPr["@_sz"]);
    if (!isNaN(sz) && sz > 0) {
      props.fontSize = sz / 100;
    }
  }
  // Solid fill color
  const solidFill = rPr["a:solidFill"] as Record<string, unknown> | undefined;
  if (solidFill) {
    const srgbClr = solidFill["a:srgbClr"] as
      | Record<string, unknown>
      | undefined;
    if (srgbClr?.["@_val"]) {
      props.color = `#${srgbClr["@_val"]}`;
    }
  }
  return props;
}

/** Extract all text runs from a slide XML object. */
function extractSlideTexts(slideObj: Record<string, unknown>): ParsedTextRun[] {
  const runs: ParsedTextRun[] = [];
  collectTexts(slideObj, runs);
  return runs;
}

/** Parse relationship file to get rId -> target mappings. */
function parseRels(
  relsXml: string,
): Map<string, { target: string; type: string }> {
  const parsed = parser.parse(relsXml);
  const map = new Map<string, { target: string; type: string }>();
  const rels = parsed?.Relationships?.Relationship;
  for (const rel of asArray(rels)) {
    const r = rel as Record<string, unknown>;
    if (r["@_Id"] && r["@_Target"]) {
      map.set(String(r["@_Id"]), {
        target: String(r["@_Target"]),
        type: String(r["@_Type"] ?? ""),
      });
    }
  }
  return map;
}

/** Determine the MIME type from a file extension. */
function mimeFromExt(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
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
  };
  return map[ext] ?? "application/octet-stream";
}

/** Guess a layout hint from the content. */
function guessLayoutHint(texts: ParsedTextRun[], hasImages: boolean): string {
  if (hasImages) return "image";

  // Title slide: typically 1-3 short text runs, largest font
  const maxFontSize = Math.max(...texts.map((t) => t.fontSize ?? 0), 0);
  const totalLength = texts.reduce((sum, t) => sum + t.content.length, 0);

  if (texts.length <= 3 && totalLength < 200 && maxFontSize >= 28) {
    return "title";
  }
  if (texts.length <= 2 && totalLength < 100) {
    return "section";
  }
  return "content";
}

export async function parsePptx(
  fileBuffer: Buffer,
): Promise<ParsedPresentation> {
  const zip = await JSZip.loadAsync(fileBuffer);

  // --- Slide ordering from presentation.xml ---
  const presentationXml = await zip
    .file("ppt/presentation.xml")
    ?.async("string");
  if (!presentationXml) {
    throw new Error("Invalid PPTX: missing ppt/presentation.xml");
  }
  const presentationObj = parser.parse(presentationXml);
  const sldIdList =
    presentationObj?.["p:presentation"]?.["p:sldIdLst"]?.["p:sldId"];
  const slideRIds = asArray(sldIdList).map((s) =>
    String((s as Record<string, unknown>)["@_r:id"] ?? ""),
  );

  // Resolve rIds to slide file paths via presentation.xml.rels
  const presRelsXml = await zip
    .file("ppt/_rels/presentation.xml.rels")
    ?.async("string");
  const presRels = presRelsXml
    ? parseRels(presRelsXml)
    : new Map<string, { target: string; type: string }>();

  const slideFilenames: string[] = [];
  for (const rId of slideRIds) {
    const rel = presRels.get(rId);
    if (rel) {
      // target is relative to ppt/, e.g. "slides/slide1.xml"
      const fullPath = rel.target.startsWith("/")
        ? rel.target.slice(1)
        : `ppt/${rel.target}`;
      slideFilenames.push(fullPath);
    }
  }

  // Fallback: if rels didn't resolve, discover slide files directly
  if (slideFilenames.length === 0) {
    const slideFiles = Object.keys(zip.files)
      .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
      .sort((a, b) => {
        const na = parseInt(a.match(/slide(\d+)/)?.[1] ?? "0", 10);
        const nb = parseInt(b.match(/slide(\d+)/)?.[1] ?? "0", 10);
        return na - nb;
      });
    slideFilenames.push(...slideFiles);
  }

  // --- Theme extraction ---
  let theme: { colors: string[]; fonts: string[] } | undefined;
  const themeXml = await zip.file("ppt/theme/theme1.xml")?.async("string");
  if (themeXml) {
    const themeObj = parser.parse(themeXml);
    const colors: string[] = [];
    const fonts: string[] = [];

    // Extract theme colors from a:clrScheme
    const clrScheme =
      themeObj?.["a:theme"]?.["a:themeElements"]?.["a:clrScheme"];
    if (clrScheme && typeof clrScheme === "object") {
      for (const key of Object.keys(clrScheme)) {
        if (key.startsWith("@_")) continue;
        const colorEl = (clrScheme as Record<string, unknown>)[key] as
          | Record<string, unknown>
          | undefined;
        if (!colorEl) continue;
        const srgb = colorEl["a:srgbClr"] as
          | Record<string, unknown>
          | undefined;
        const sysClr = colorEl["a:sysClr"] as
          | Record<string, unknown>
          | undefined;
        if (srgb?.["@_val"]) {
          colors.push(`#${srgb["@_val"]}`);
        } else if (sysClr?.["@_lastClr"]) {
          colors.push(`#${sysClr["@_lastClr"]}`);
        }
      }
    }

    // Extract fonts
    const fontScheme =
      themeObj?.["a:theme"]?.["a:themeElements"]?.["a:fontScheme"];
    if (fontScheme) {
      const majorFont = (fontScheme as Record<string, unknown>)[
        "a:majorFont"
      ] as Record<string, unknown> | undefined;
      const minorFont = (fontScheme as Record<string, unknown>)[
        "a:minorFont"
      ] as Record<string, unknown> | undefined;
      const latin1 = majorFont?.["a:latin"] as
        | Record<string, unknown>
        | undefined;
      const latin2 = minorFont?.["a:latin"] as
        | Record<string, unknown>
        | undefined;
      if (latin1?.["@_typeface"]) fonts.push(String(latin1["@_typeface"]));
      if (latin2?.["@_typeface"]) fonts.push(String(latin2["@_typeface"]));
    }

    if (colors.length > 0 || fonts.length > 0) {
      theme = { colors, fonts };
    }
  }

  // --- Parse each slide ---
  const parsedSlides: ParsedSlide[] = [];

  for (const slidePath of slideFilenames) {
    const slideXml = await zip.file(slidePath)?.async("string");
    if (!slideXml) continue;

    let slideObj: Record<string, unknown>;
    try {
      slideObj = parser.parse(slideXml);
    } catch {
      // Skip slides with malformed XML rather than crashing the whole import
      continue;
    }
    const texts = extractSlideTexts(slideObj);

    // Extract images via slide rels
    const images: ParsedImage[] = [];
    const slideBasename = slidePath.split("/").pop() ?? "";
    const relsPath = slidePath.replace(
      /slides\/(slide\d+\.xml)/,
      "slides/_rels/$1.rels",
    );
    const slideRelsXml = await zip.file(relsPath)?.async("string");
    if (slideRelsXml) {
      const slideRels = parseRels(slideRelsXml);
      for (const [, rel] of slideRels) {
        if (
          rel.type.includes("/image") ||
          /\.(png|jpe?g|gif|svg|webp|bmp|tiff?|emf|wmf)$/i.test(rel.target)
        ) {
          // Resolve relative target to full zip path
          const imgPath = rel.target.startsWith("/")
            ? rel.target.slice(1)
            : rel.target.startsWith("../")
              ? `ppt/${rel.target.replace(/^\.\.\//, "")}`
              : `ppt/slides/${rel.target}`;

          const imgFile = zip.file(imgPath);
          if (imgFile) {
            const imgData = await imgFile.async("nodebuffer");
            const imgName = imgPath.split("/").pop() ?? "image";
            images.push({
              data: imgData,
              mimeType: mimeFromExt(imgName),
              name: imgName,
            });
          }
        }
      }
    }

    // Extract speaker notes
    let notes: string | undefined;
    const slideNum = slideBasename.match(/slide(\d+)/)?.[1];
    if (slideNum) {
      const notesPath = `ppt/notesSlides/notesSlide${slideNum}.xml`;
      const notesXml = await zip.file(notesPath)?.async("string");
      if (notesXml) {
        const notesObj = parser.parse(notesXml);
        const noteRuns: ParsedTextRun[] = [];
        collectTexts(notesObj, noteRuns);
        const noteText = noteRuns
          .map((r) => r.content)
          .join(" ")
          .trim();
        // Filter out placeholder patterns like slide number references
        if (noteText && noteText.length > 1) {
          notes = noteText;
        }
      }
    }

    const layoutHint = guessLayoutHint(texts, images.length > 0);

    parsedSlides.push({
      texts,
      images,
      notes,
      layoutHint,
    });
  }

  // Derive title from the first slide's largest text
  let title = "Imported Presentation";
  if (parsedSlides.length > 0 && parsedSlides[0].texts.length > 0) {
    // Pick the text run with the largest font, or the first one
    const firstSlideTexts = parsedSlides[0].texts;
    const sorted = [...firstSlideTexts].sort(
      (a, b) => (b.fontSize ?? 0) - (a.fontSize ?? 0),
    );
    const candidate = sorted[0]?.content?.trim();
    if (candidate && candidate.length > 0 && candidate.length < 200) {
      title = candidate;
    }
  }

  return { title, slides: parsedSlides, theme };
}
