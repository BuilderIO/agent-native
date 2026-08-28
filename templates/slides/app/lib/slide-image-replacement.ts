const PLACEHOLDER_TARGET_PREFIX = "placeholder:";

interface ReplaceOptions {
  alt?: string;
}

export interface SlideImageDropPosition {
  x: number;
  y: number;
}

export const IMAGE_OBJECT_POSITION_VALUES = [
  "left top",
  "center top",
  "right top",
  "left center",
  "center center",
  "right center",
  "left bottom",
  "center bottom",
  "right bottom",
] as const;

export type ImageObjectPosition = (typeof IMAGE_OBJECT_POSITION_VALUES)[number];

export interface OptimisticImagePreview {
  previewSrc: string;
  replaceSrc: string | null;
  alt?: string;
  position?: SlideImageDropPosition;
  objectId?: string;
}

const DROPPED_IMAGE_WIDTH = 320;
const DROPPED_IMAGE_HEIGHT = 180;

interface PlaceholderTarget {
  index: number | null;
  label: string;
}

export function imageFileLooksSupported(file: File): boolean {
  return (
    file.type.startsWith("image/") ||
    /\.(?:png|jpe?g|gif|webp|avif|ico)$/i.test(file.name)
  );
}

export function createPlaceholderImageTarget(
  index: number,
  label: string,
): string {
  return `${PLACEHOLDER_TARGET_PREFIX}${index}:${encodeURIComponent(label)}`;
}

function parsePlaceholderTarget(src: string): PlaceholderTarget | null {
  if (!src.startsWith(PLACEHOLDER_TARGET_PREFIX)) return null;

  const rest = src.slice(PLACEHOLDER_TARGET_PREFIX.length);
  const separator = rest.indexOf(":");
  if (separator > 0) {
    const maybeIndex = rest.slice(0, separator);
    if (/^\d+$/.test(maybeIndex)) {
      return {
        index: Number(maybeIndex),
        label: decodeURIComponent(rest.slice(separator + 1) || "image"),
      };
    }
  }

  return { index: null, label: rest || "image" };
}

function parseFragment(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

function serializeFragment(doc: Document): string {
  return doc.body.innerHTML;
}

export function normalizeImageObjectPosition(
  value: string | null | undefined,
): ImageObjectPosition {
  const normalized = value?.trim().toLowerCase().replace(/\s+/g, " ");
  const aliases: Record<string, ImageObjectPosition> = {
    left: "left center",
    right: "right center",
    top: "center top",
    bottom: "center bottom",
    "top left": "left top",
    "top center": "center top",
    "top right": "right top",
    "center left": "left center",
    "center right": "right center",
    "bottom left": "left bottom",
    "bottom center": "center bottom",
    "bottom right": "right bottom",
    "0% 0%": "left top",
    "50% 0%": "center top",
    "100% 0%": "right top",
    "0% 50%": "left center",
    "50% 50%": "center center",
    "100% 50%": "right center",
    "0% 100%": "left bottom",
    "50% 100%": "center bottom",
    "100% 100%": "right bottom",
  };
  if (normalized && normalized in aliases) return aliases[normalized];
  if (
    normalized &&
    IMAGE_OBJECT_POSITION_VALUES.includes(normalized as ImageObjectPosition)
  ) {
    return normalized as ImageObjectPosition;
  }
  return "center center";
}

function hasImageSource(content: string, src: string): boolean {
  const doc = parseFragment(content);
  return Array.from(doc.body.querySelectorAll<HTMLImageElement>("img")).some(
    (image) => image.getAttribute("src") === src,
  );
}

function cleanAlt(value: string | undefined): string {
  return (value || "Uploaded image").replace(/\s+/g, " ").trim();
}

function createSlideObjectId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `slide-object-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function hasStyleProperty(style: string, property: string): boolean {
  return new RegExp(`(?:^|;)\\s*${property}\\s*:`, "i").test(style);
}

function appendImageStyle(baseStyle: string): string {
  const declarations = [baseStyle.trim().replace(/;+\s*$/, "")].filter(Boolean);
  if (!hasStyleProperty(baseStyle, "display"))
    declarations.push("display: block");
  if (!hasStyleProperty(baseStyle, "object-fit")) {
    declarations.push("object-fit: cover");
  }
  if (!hasStyleProperty(baseStyle, "min-width"))
    declarations.push("min-width: 0");
  return declarations.length > 0 ? `${declarations.join("; ")};` : "";
}

function imageElementForPlaceholder(
  doc: Document,
  placeholder: HTMLElement | null,
  newSrc: string,
  alt: string,
): HTMLImageElement {
  const img = doc.createElement("img");
  img.setAttribute("src", newSrc);
  img.setAttribute("alt", alt);
  img.className = "fmd-img-uploaded";

  const placeholderStyle = placeholder?.getAttribute("style") ?? "";
  const style = appendImageStyle(
    placeholderStyle ||
      "width: 100%; height: 100%; border-radius: 8px; object-fit: cover;",
  );
  if (style) img.setAttribute("style", style);

  return img;
}

function replacePlaceholderTarget(
  content: string,
  target: PlaceholderTarget,
  newSrc: string,
  options: ReplaceOptions,
): string {
  const doc = parseFragment(content);
  const placeholders = Array.from(
    doc.body.querySelectorAll<HTMLElement>(".fmd-img-placeholder"),
  );
  const placeholder =
    target.index === null
      ? placeholders.find(
          (el) => el.textContent?.trim() === target.label.trim(),
        ) || placeholders[0]
      : placeholders[target.index];

  if (!placeholder) return content;

  const img = imageElementForPlaceholder(
    doc,
    placeholder,
    newSrc,
    cleanAlt(options.alt || placeholder.textContent || target.label),
  );
  placeholder.replaceWith(img);
  return serializeFragment(doc);
}

function replaceImageSrc(
  content: string,
  oldSrc: string,
  newSrc: string,
  options: ReplaceOptions,
): string {
  const doc = parseFragment(content);
  const image = Array.from(
    doc.body.querySelectorAll<HTMLImageElement>("img"),
  ).find((img) => img.getAttribute("src") === oldSrc);
  if (!image) return content;

  image.setAttribute("src", newSrc);
  if (options.alt) image.setAttribute("alt", cleanAlt(options.alt));
  return serializeFragment(doc);
}

type ImageStyleUpdates = {
  objectFit?: "cover" | "contain";
  objectPosition?: ImageObjectPosition;
};

function applyImageStyle(
  image: HTMLImageElement,
  updates: ImageStyleUpdates,
): void {
  if (updates.objectFit) {
    image.style.setProperty("object-fit", updates.objectFit);
  }
  if (updates.objectPosition) {
    if (!updates.objectFit) image.style.setProperty("object-fit", "cover");
    image.style.setProperty("object-position", updates.objectPosition);
  }
}

function imageStyleDeclarations(updates: ImageStyleUpdates): string {
  return [
    updates.objectFit || (updates.objectPosition ? "cover" : undefined),
    updates.objectPosition,
  ]
    .map((value, index) =>
      value
        ? `${index === 0 ? "object-fit" : "object-position"}: ${value}`
        : null,
    )
    .filter((declaration): declaration is string => declaration !== null)
    .join("; ");
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

interface ImageSourceToken {
  alt?: string;
  end: number;
  kind: "html" | "markdown";
  source: string;
  start: number;
  title?: string;
}

function decodeMarkdownImageDestination(rawSource: string): string {
  const destination = rawSource.startsWith("<")
    ? rawSource.slice(1, -1)
    : rawSource;
  const decoded = parseFragment(`<span>${destination}</span>`).body
    .firstElementChild?.textContent;
  return (decoded ?? destination).replace(/\\([\\()])/g, "$1");
}

function isMarkdownCharacterEscaped(content: string, index: number): boolean {
  let backslashes = 0;
  for (
    let cursor = index - 1;
    cursor >= 0 && content[cursor] === "\\";
    cursor -= 1
  ) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function findClosingMarkdownBracket(
  content: string,
  openIndex: number,
): number {
  let depth = 0;
  for (let index = openIndex; index < content.length; index += 1) {
    if (content[index] === "\\") {
      index += 1;
      continue;
    }
    if (content[index] === "[") {
      depth += 1;
    } else if (content[index] === "]") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function skipMarkdownWhitespace(content: string, start: number): number {
  let index = start;
  while (index < content.length && /\s/.test(content[index] ?? "")) {
    index += 1;
  }
  return index;
}

interface MarkdownDestination {
  end: number;
  rawSource: string;
}

function parseMarkdownDestination(
  content: string,
  start: number,
  endsAtClosingParenthesis: boolean,
): MarkdownDestination | null {
  if (content[start] === "<") {
    for (let index = start + 1; index < content.length; index += 1) {
      if (content[index] === "\\") {
        index += 1;
      } else if (content[index] === ">") {
        return {
          end: index + 1,
          rawSource: content.slice(start, index + 1),
        };
      } else if (/\s/.test(content[index] ?? "")) {
        return null;
      }
    }
    return null;
  }

  let depth = 0;
  let end = start;
  for (; end < content.length; end += 1) {
    const character = content[end];
    if (character === "\\") {
      end += 1;
      continue;
    }
    if (/\s/.test(character ?? "")) break;
    if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      if (depth === 0 && endsAtClosingParenthesis) break;
      if (depth > 0) depth -= 1;
    }
  }

  return end > start ? { end, rawSource: content.slice(start, end) } : null;
}

function parseMarkdownTitle(
  content: string,
  start: number,
): { end: number; value: string } | null {
  const opener = content[start];
  if (opener === '"' || opener === "'") {
    for (let index = start + 1; index < content.length; index += 1) {
      if (content[index] === "\\") {
        index += 1;
      } else if (content[index] === opener) {
        return {
          end: index + 1,
          value: content.slice(start + 1, index),
        };
      }
    }
    return null;
  }

  if (opener !== "(") return null;
  let depth = 0;
  for (let index = start; index < content.length; index += 1) {
    if (content[index] === "\\") {
      index += 1;
    } else if (content[index] === "(") {
      depth += 1;
    } else if (content[index] === ")") {
      depth -= 1;
      if (depth === 0) {
        return {
          end: index + 1,
          value: content.slice(start + 1, index),
        };
      }
    }
  }
  return null;
}

function normalizeMarkdownReferenceLabel(value: string): string {
  return value
    .replace(/\\([\\[\]])/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

interface MarkdownReferenceDefinition {
  source: string;
  title?: string;
}

function markdownReferenceDefinitions(
  content: string,
): Map<string, MarkdownReferenceDefinition> {
  const definitions = new Map<string, MarkdownReferenceDefinition>();
  const nonRenderedRanges = markdownNonRenderedRanges(content);
  let rangeIndex = 0;
  let lineStart = 0;

  while (lineStart < content.length) {
    while (
      rangeIndex < nonRenderedRanges.length &&
      lineStart >= nonRenderedRanges[rangeIndex].end
    ) {
      rangeIndex += 1;
    }
    const newline = content.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? content.length : newline;
    const line = content.slice(lineStart, lineEnd).replace(/\r$/, "");
    const range = nonRenderedRanges[rangeIndex];
    if (range && lineStart >= range.start && lineStart < range.end) {
      if (newline === -1) break;
      lineStart = newline + 1;
      continue;
    }
    let cursor = 0;
    while (cursor < 3 && line[cursor] === " ") cursor += 1;

    const labelStart = cursor;
    if (line[cursor] === "[") {
      const labelEnd = findClosingMarkdownBracket(line, cursor);
      if (labelEnd !== -1 && line[labelEnd + 1] === ":") {
        cursor = skipMarkdownWhitespace(line, labelEnd + 2);
        const destination = parseMarkdownDestination(line, cursor, false);
        if (destination) {
          cursor = skipMarkdownWhitespace(line, destination.end);
          const parsedTitle = parseMarkdownTitle(line, cursor);
          if (parsedTitle) {
            cursor = skipMarkdownWhitespace(line, parsedTitle.end);
          }
          if (cursor === line.length) {
            const label = normalizeMarkdownReferenceLabel(
              line.slice(labelStart + 1, labelEnd),
            );
            if (label && !definitions.has(label)) {
              definitions.set(label, {
                source: decodeMarkdownImageDestination(destination.rawSource),
                ...(parsedTitle ? { title: parsedTitle.value } : {}),
              });
            }
          }
        }
      }
    }

    if (newline === -1) break;
    lineStart = newline + 1;
  }

  return definitions;
}

function markdownReferenceImageToken(
  content: string,
  start: number,
  alt: string,
  afterAlt: number,
  definitions: Map<string, MarkdownReferenceDefinition>,
): ImageSourceToken | null {
  let label = alt;
  let end = afterAlt;
  if (content[afterAlt] === "[") {
    const labelEnd = findClosingMarkdownBracket(content, afterAlt);
    if (labelEnd === -1) return null;
    label = content.slice(afterAlt + 1, labelEnd) || alt;
    end = labelEnd + 1;
  }

  const definition = definitions.get(normalizeMarkdownReferenceLabel(label));
  if (!definition) return null;
  return {
    alt,
    end,
    kind: "markdown",
    source: definition.source,
    start,
    ...(definition.title ? { title: definition.title } : {}),
  };
}

function markdownImageTokenAt(
  content: string,
  start: number,
  definitions: Map<string, MarkdownReferenceDefinition>,
): ImageSourceToken | null {
  const altEnd = findClosingMarkdownBracket(content, start + 1);
  if (altEnd === -1) return null;
  const alt = content.slice(start + 2, altEnd);
  const afterAlt = altEnd + 1;

  if (content[afterAlt] === "(") {
    const destination = parseMarkdownDestination(content, afterAlt + 1, true);
    if (!destination) return null;
    let cursor = skipMarkdownWhitespace(content, destination.end);
    const parsedTitle = parseMarkdownTitle(content, cursor);
    if (parsedTitle) {
      cursor = skipMarkdownWhitespace(content, parsedTitle.end);
    }
    if (content[cursor] !== ")") return null;
    return {
      alt,
      end: cursor + 1,
      kind: "markdown",
      source: decodeMarkdownImageDestination(destination.rawSource),
      start,
      ...(parsedTitle ? { title: parsedTitle.value } : {}),
    };
  }

  return markdownReferenceImageToken(
    content,
    start,
    alt,
    afterAlt,
    definitions,
  );
}

interface SourceRange {
  end: number;
  start: number;
}

function markdownFenceEndAt(content: string, start: number): number | null {
  if (start > 0 && content[start - 1] !== "\n") return null;

  const openingLineEnd = content.indexOf("\n", start);
  const openingLine = content
    .slice(start, openingLineEnd === -1 ? content.length : openingLineEnd)
    .replace(/\r$/, "");
  const opener = openingLine.match(/^ {0,3}(`{3,}|~{3,})/);
  if (!opener) return null;

  const marker = opener[1][0];
  const markerLength = opener[1].length;
  const closingFence = new RegExp(`^ {0,3}${marker}{${markerLength},}[ \\t]*$`);
  let lineStart = openingLineEnd === -1 ? content.length : openingLineEnd + 1;

  while (lineStart < content.length) {
    const lineEnd = content.indexOf("\n", lineStart);
    const line = content
      .slice(lineStart, lineEnd === -1 ? content.length : lineEnd)
      .replace(/\r$/, "");
    if (closingFence.test(line)) {
      return lineEnd === -1 ? content.length : lineEnd + 1;
    }
    if (lineEnd === -1) break;
    lineStart = lineEnd + 1;
  }

  return content.length;
}

function markdownInlineCodeEndAt(
  content: string,
  start: number,
): number | null {
  if (content[start] !== "`" || isMarkdownCharacterEscaped(content, start)) {
    return null;
  }

  let delimiterLength = 1;
  while (content[start + delimiterLength] === "`") delimiterLength += 1;
  const delimiter = "`".repeat(delimiterLength);
  for (let end = start + delimiterLength; end < content.length; end += 1) {
    if (!content.startsWith(delimiter, end)) continue;
    if (content[end - 1] === "`" || content[end + delimiterLength] === "`") {
      continue;
    }
    return end + delimiterLength;
  }

  return null;
}

function findHtmlTagEnd(content: string, start: number): number | null {
  let quote: '"' | "'" | null = null;
  for (let end = start + 1; end < content.length; end += 1) {
    const character = content[end];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return end + 1;
    }
  }
  return null;
}

const NON_RENDERED_HTML_ELEMENTS = new Set([
  "code",
  "pre",
  "script",
  "style",
  "textarea",
]);

function htmlTagEndAt(content: string, start: number): number | null {
  if (content[start] !== "<" || isMarkdownCharacterEscaped(content, start)) {
    return null;
  }

  const next = content[start + 1];
  if (!next || (!/[A-Za-z]/.test(next) && !["/", "!", "?"].includes(next))) {
    return null;
  }

  if (content.startsWith("<!--", start)) {
    const commentEnd = content.indexOf("-->", start + 4);
    return commentEnd === -1 ? content.length : commentEnd + 3;
  }

  return findHtmlTagEnd(content, start);
}

function htmlNonRenderedRangeEndAt(
  content: string,
  start: number,
): number | null {
  const tagEnd = htmlTagEndAt(content, start);
  if (tagEnd === null) return null;

  const rawTag = content.slice(start, tagEnd);
  const element = rawTag.match(/^<([A-Za-z][\w:-]*)(?:\s|\/?>)/);
  if (
    !element ||
    !NON_RENDERED_HTML_ELEMENTS.has(element[1].toLowerCase()) ||
    /\/\s*>$/.test(rawTag)
  ) {
    return tagEnd;
  }

  const closingTag = new RegExp(`</${element[1]}\\s*>`, "i").exec(
    content.slice(tagEnd),
  );
  return closingTag
    ? tagEnd + closingTag.index + closingTag[0].length
    : content.length;
}

function markdownNonRenderedRanges(content: string): SourceRange[] {
  const ranges: SourceRange[] = [];
  let start = 0;
  while (start < content.length) {
    const end =
      markdownFenceEndAt(content, start) ??
      markdownInlineCodeEndAt(content, start) ??
      htmlNonRenderedRangeEndAt(content, start);
    if (end === null || end <= start) {
      start += 1;
      continue;
    }
    ranges.push({ end, start });
    start = end;
  }
  return ranges;
}

function markdownImageSourceTokens(content: string): ImageSourceToken[] {
  const definitions = markdownReferenceDefinitions(content);
  const nonRenderedRanges = markdownNonRenderedRanges(content);
  const tokens: ImageSourceToken[] = [];
  let rangeIndex = 0;
  for (let start = 0; start < content.length - 1; start += 1) {
    const range = nonRenderedRanges[rangeIndex];
    if (range && start >= range.start) {
      if (start < range.end) {
        start = range.end - 1;
        continue;
      }
      rangeIndex += 1;
    }
    if (
      content[start] !== "!" ||
      content[start + 1] !== "[" ||
      isMarkdownCharacterEscaped(content, start)
    ) {
      continue;
    }
    const token = markdownImageTokenAt(content, start, definitions);
    if (token) {
      tokens.push(token);
      start = token.end - 1;
    }
  }
  return tokens;
}

function htmlImageSourceTokens(content: string): ImageSourceToken[] {
  const tokens: ImageSourceToken[] = [];
  let cursor = 0;
  while (cursor < content.length) {
    const start = content.indexOf("<", cursor);
    if (start === -1) break;
    const end = htmlTagEndAt(content, start);
    if (end === null) {
      cursor = start + 1;
      continue;
    }

    const rawTag = content.slice(start, end);
    if (/^<img\b/i.test(rawTag)) {
      const image = parseFragment(rawTag).body.querySelector("img");
      const source = image?.getAttribute("src");
      if (source) {
        tokens.push({
          end,
          kind: "html",
          source,
          start,
        });
      }
    }
    cursor = end;
  }
  return tokens;
}

function imageSourceTokens(content: string): ImageSourceToken[] {
  const tokens = [
    ...htmlImageSourceTokens(content),
    ...markdownImageSourceTokens(content),
  ];
  return tokens.sort((a, b) => a.start - b.start);
}

export function imageOccurrenceInRenderedSlide(
  root: ParentNode | null,
  image: HTMLImageElement,
): number {
  const src = image.getAttribute("src");
  if (!root || !src) return 0;

  return Math.max(
    0,
    Array.from(root.querySelectorAll<HTMLImageElement>(".slide-content img"))
      .filter((candidate) => candidate.getAttribute("src") === src)
      .indexOf(image),
  );
}

function markdownImageStyleDeclarations(updates: ImageStyleUpdates): string {
  const imageStyle = imageStyleDeclarations(updates);
  return ["display: block", "width: 100%", "aspect-ratio: 16 / 9", imageStyle]
    .filter(Boolean)
    .join("; ");
}

function updateMarkdownImageAt(
  content: string,
  token: ImageSourceToken,
  updates: ImageStyleUpdates,
): string {
  if (token.alt === undefined) return content;
  const style = markdownImageStyleDeclarations(updates);
  const title = token.title
    ? ` title="${escapeHtmlAttribute(token.title)}"`
    : "";
  const replacement = `<img data-markdown-image="true" src="${escapeHtmlAttribute(token.source)}" alt="${escapeHtmlAttribute(token.alt)}"${title} style="${style};">`;
  return content.slice(0, token.start) + replacement + content.slice(token.end);
}

function updateHtmlImageAt(
  content: string,
  token: ImageSourceToken,
  updates: ImageStyleUpdates,
): string {
  const image = parseFragment(
    content.slice(token.start, token.end),
  ).body.querySelector<HTMLImageElement>("img");
  if (!image || image.getAttribute("src") !== token.source) return content;
  applyImageStyle(image, updates);
  const replacement = image.outerHTML;
  return content.slice(0, token.start) + replacement + content.slice(token.end);
}

export function updateImageFitInSlideHtml(
  content: string,
  src: string,
  updates: ImageStyleUpdates,
  imageOccurrence = 0,
): string {
  let matchingImage = 0;
  for (const token of imageSourceTokens(content)) {
    if (token.source !== src) continue;
    if (matchingImage++ !== Math.max(0, imageOccurrence)) continue;
    return token.kind === "html"
      ? updateHtmlImageAt(content, token, updates)
      : updateMarkdownImageAt(content, token, updates);
  }
  return content;
}

/** Replace one optimistic preview, or remove it when its upload failed. */
export function replaceOptimisticImagePreview(
  content: string,
  previewSrc: string,
  finalSrc: string | null,
): string {
  const doc = parseFragment(content);
  const image = Array.from(
    doc.body.querySelectorAll<HTMLImageElement>("img"),
  ).find((img) => img.getAttribute("src") === previewSrc);
  if (!image) return content;

  if (finalSrc) image.setAttribute("src", finalSrc);
  else image.remove();
  return serializeFragment(doc);
}

export function applyOptimisticImagePreview(
  content: string,
  preview: OptimisticImagePreview,
): string {
  if (hasImageSource(content, preview.previewSrc)) return content;
  return preview.replaceSrc
    ? replaceImageTargetInSlideHtml(
        content,
        preview.replaceSrc,
        preview.previewSrc,
        {
          alt: preview.alt,
        },
      )
    : insertDroppedImageIntoSlideHtml(content, preview.previewSrc, {
        alt: preview.alt,
        position: preview.position,
        objectId: preview.objectId,
      });
}

export function hasOptimisticImagePreview(
  content: string,
  previewSrc: string,
): boolean {
  return hasImageSource(content, previewSrc);
}

export function stripOptimisticImagePreviews(
  content: string,
  previews: readonly OptimisticImagePreview[],
): string {
  return previews.reduce(
    (current, preview) =>
      replaceOptimisticImagePreview(
        current,
        preview.previewSrc,
        preview.replaceSrc,
      ),
    content,
  );
}

export function insertImageIntoSlideHtml(
  content: string,
  newSrc: string,
  options: ReplaceOptions = {},
): string {
  const doc = parseFragment(content);
  const firstPlaceholder = doc.body.querySelector<HTMLElement>(
    ".fmd-img-placeholder",
  );
  if (firstPlaceholder) {
    const img = imageElementForPlaceholder(
      doc,
      firstPlaceholder,
      newSrc,
      cleanAlt(options.alt || firstPlaceholder.textContent || "Uploaded image"),
    );
    firstPlaceholder.replaceWith(img);
    return serializeFragment(doc);
  }

  // No placeholder to slot into: .fmd-slide is a flex column, so a plain
  // appended <img> becomes a flex item that competes for space with (and
  // visually squishes) the slide's existing content. Position it as a
  // full-bleed background layer behind the existing content instead, which
  // matches how the agent already inserts generated images onto slides that
  // have none.
  const img = doc.createElement("img");
  img.setAttribute("src", newSrc);
  img.setAttribute("alt", cleanAlt(options.alt));
  img.className = "fmd-img-uploaded";
  img.setAttribute(
    "style",
    "position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: -1;",
  );
  const slideRoot = doc.body.querySelector<HTMLElement>(".fmd-slide");
  const root = slideRoot || doc.body;
  if (
    slideRoot &&
    !/(?:^|;)\s*position\s*:/i.test(slideRoot.getAttribute("style") ?? "")
  ) {
    slideRoot.setAttribute(
      "style",
      `${(slideRoot.getAttribute("style") ?? "").trim().replace(/;+\s*$/, "")}; position: relative;`.replace(
        /^;\s*/,
        "",
      ),
    );
  }
  root.insertBefore(img, root.firstChild);
  return serializeFragment(doc);
}

/** Insert a desktop drop as a durable, independently movable canvas object. */
export function insertDroppedImageIntoSlideHtml(
  content: string,
  newSrc: string,
  options: ReplaceOptions & {
    position?: SlideImageDropPosition;
    objectId?: string;
  } = {},
): string {
  const doc = parseFragment(content);
  const img = doc.createElement("img");
  const position = options.position ?? {
    x: 640,
    y: 360,
  };
  const left = Math.max(0, Math.round(position.x - DROPPED_IMAGE_WIDTH / 2));
  const top = Math.max(0, Math.round(position.y - DROPPED_IMAGE_HEIGHT / 2));

  img.setAttribute("src", newSrc);
  img.setAttribute("alt", cleanAlt(options.alt));
  img.setAttribute(
    "data-slide-object-id",
    options.objectId ?? createSlideObjectId(),
  );
  img.className = "fmd-img-uploaded";
  img.setAttribute(
    "style",
    `position: absolute; left: ${left}px; top: ${top}px; width: ${DROPPED_IMAGE_WIDTH}px; height: ${DROPPED_IMAGE_HEIGHT}px; max-width: none; max-height: none; margin: 0; border-radius: 8px; object-fit: contain; box-sizing: border-box; z-index: 1;`,
  );

  const slideRoot = doc.body.querySelector<HTMLElement>(".fmd-slide");
  if (slideRoot) {
    if (!hasStyleProperty(slideRoot.getAttribute("style") ?? "", "position")) {
      slideRoot.setAttribute(
        "style",
        `${(slideRoot.getAttribute("style") ?? "").trim().replace(/;+\s*$/, "")}; position: relative;`.replace(
          /^;\s*/,
          "",
        ),
      );
    }
    slideRoot.appendChild(img);
  } else {
    // Markdown-backed slides keep their source text. Appending a raw image tag
    // lets ReactMarkdown preserve the text while the slide canvas supplies the
    // positioned containing block at render time.
    doc.body.append(doc.createTextNode("\n\n"), img);
  }

  return serializeFragment(doc);
}

export function replaceImageTargetInSlideHtml(
  content: string,
  oldSrc: string,
  newSrc: string,
  options: ReplaceOptions = {},
): string {
  const placeholderTarget = parsePlaceholderTarget(oldSrc);
  if (placeholderTarget) {
    return replacePlaceholderTarget(
      content,
      placeholderTarget,
      newSrc,
      options,
    );
  }

  return replaceImageSrc(content, oldSrc, newSrc, options);
}
