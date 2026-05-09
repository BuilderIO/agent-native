const PLACEHOLDER_TARGET_PREFIX = "placeholder:";

interface ReplaceOptions {
  alt?: string;
}

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

function cleanAlt(value: string | undefined): string {
  return (value || "Uploaded image").replace(/\s+/g, " ").trim();
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

  const img = imageElementForPlaceholder(
    doc,
    null,
    newSrc,
    cleanAlt(options.alt),
  );
  const slideRoot = doc.body.querySelector<HTMLElement>(".fmd-slide");
  (slideRoot || doc.body).appendChild(img);
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
