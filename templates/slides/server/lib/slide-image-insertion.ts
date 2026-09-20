interface InsertSlideImageOptions {
  alt?: string;
}

function cleanAlt(value: string | undefined): string {
  return (value || "Uploaded image").replace(/\s+/g, " ").trim();
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function textContent(html: string): string {
  return decodeHtml(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function attribute(attributes: string, name: string): string | null {
  const match = attributes.match(
    new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"),
  );
  return match ? match[2] : null;
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

function imageHtml(src: string, alt: string, style: string): string {
  return `<img src="${escapeAttribute(src)}" alt="${escapeAttribute(alt)}" class="fmd-img-uploaded"${style ? ` style="${escapeAttribute(style)}"` : ""}>`;
}

/**
 * Server-safe counterpart to the editor's image replacement helper. It uses
 * deterministic string transforms because DOMParser is not available in the
 * server runtime that executes actions.
 */
export function insertImageIntoSlideHtml(
  content: string,
  src: string,
  options: InsertSlideImageOptions = {},
): string {
  const openingTags = /<([a-z][\w:-]*)([^>]*)>/gi;
  for (const match of content.matchAll(openingTags)) {
    const className = attribute(match[2], "class") || "";
    if (!/(?:^|\s)fmd-img-placeholder(?:\s|$)/.test(className)) continue;

    const closingTag = new RegExp(`</${match[1]}\\s*>`, "gi");
    closingTag.lastIndex = (match.index ?? 0) + match[0].length;
    const closing = closingTag.exec(content);
    if (!closing || match.index === undefined) continue;

    const style = appendImageStyle(
      attribute(match[2], "style") ||
        "width: 100%; height: 100%; border-radius: 8px; object-fit: cover;",
    );
    const replacement = imageHtml(
      src,
      cleanAlt(
        options.alt ||
          textContent(
            content.slice(match.index + match[0].length, closing.index),
          ) ||
          "Uploaded image",
      ),
      style,
    );
    return `${content.slice(0, match.index)}${replacement}${content.slice(closing.index + closing[0].length)}`;
  }

  const fullBleed = imageHtml(
    src,
    cleanAlt(options.alt),
    "position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: -1;",
  );
  const slideRoot =
    /<([a-z][\w:-]*)([^>]*\bclass\s*=\s*(["'])[^"']*\bfmd-slide\b[^"']*\3[^>]*)>/i.exec(
      content,
    );
  if (!slideRoot || slideRoot.index === undefined)
    return `${fullBleed}${content}`;

  let openingTag = slideRoot[0];
  const style = attribute(slideRoot[2], "style") || "";
  if (!hasStyleProperty(style, "position")) {
    const nextStyle =
      `${style.trim().replace(/;+\s*$/, "")}; position: relative;`.replace(
        /^;\s*/,
        "",
      );
    if (/\bstyle\s*=\s*(["'])/i.test(openingTag)) {
      openingTag = openingTag.replace(
        /\bstyle\s*=\s*(["'])[^"']*\1/i,
        `style="${escapeAttribute(nextStyle)}"`,
      );
    } else {
      openingTag = openingTag.replace(
        />$/,
        ` style="${escapeAttribute(nextStyle)}">`,
      );
    }
  }
  return `${content.slice(0, slideRoot.index)}${openingTag}${fullBleed}${content.slice(slideRoot.index + slideRoot[0].length)}`;
}

export function slideHtmlContainsImageSource(
  html: string,
  src: string,
): boolean {
  const images = /<img\b([^>]*)>/gi;
  for (const match of html.matchAll(images)) {
    if (decodeHtml(attribute(match[1], "src") || "") === src) return true;
  }
  return false;
}
