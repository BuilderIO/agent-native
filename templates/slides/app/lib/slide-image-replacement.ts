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

const MARKDOWN_IMAGE_PATTERN =
  /!\[([^\]]*)\]\(\s*(<[^>]+>|(?:\\.|[^)\s])+)(?:\s+("[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
const HTML_IMAGE_PATTERN = /<img\b[^>]*>/gi;

interface ImageSourceToken {
  end: number;
  kind: "html" | "markdown";
  source: string;
  start: number;
}

function decodeMarkdownImageDestination(rawSource: string): string {
  const destination = rawSource.startsWith("<")
    ? rawSource.slice(1, -1)
    : rawSource;
  const decoded = parseFragment(`<span>${destination}</span>`).body
    .firstElementChild?.textContent;
  return (decoded ?? destination).replace(/\\([\\()])/g, "$1");
}

function imageSourceTokens(content: string): ImageSourceToken[] {
  const tokens: ImageSourceToken[] = [];
  for (const match of content.matchAll(HTML_IMAGE_PATTERN)) {
    const rawImage = match[0];
    const image = parseFragment(rawImage).body.querySelector("img");
    const source = image?.getAttribute("src");
    if (source) {
      const start = match.index ?? 0;
      tokens.push({
        end: start + rawImage.length,
        kind: "html",
        source,
        start,
      });
    }
  }
  for (const match of content.matchAll(MARKDOWN_IMAGE_PATTERN)) {
    const rawSource = match[2] as string;
    const start = match.index ?? 0;
    tokens.push({
      end: start + match[0].length,
      kind: "markdown",
      source: decodeMarkdownImageDestination(rawSource),
      start,
    });
  }
  return tokens.sort((a, b) => a.start - b.start);
}

function updateMarkdownImageAt(
  content: string,
  src: string,
  updates: ImageStyleUpdates,
  tokenStart: number,
): string {
  let updated = false;
  const nextContent = content.replace(
    MARKDOWN_IMAGE_PATTERN,
    (
      match,
      alt: string,
      rawSrc: string,
      rawTitle: string | undefined,
      offset: number,
    ) => {
      if (
        offset !== tokenStart ||
        decodeMarkdownImageDestination(rawSrc) !== src
      ) {
        return match;
      }

      const markdownSrc = decodeMarkdownImageDestination(rawSrc);
      const style = imageStyleDeclarations(updates);
      const title = rawTitle
        ? ` title="${escapeHtmlAttribute(rawTitle.slice(1, -1))}"`
        : "";
      updated = true;
      return `<img src="${escapeHtmlAttribute(markdownSrc)}" alt="${escapeHtmlAttribute(alt)}"${title} style="${style};">`;
    },
  );
  return updated ? nextContent : content;
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
      : updateMarkdownImageAt(content, src, updates, token.start);
  }
  return content;
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
  options: ReplaceOptions & { position?: SlideImageDropPosition } = {},
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
  img.setAttribute("data-slide-object-id", createSlideObjectId());
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
