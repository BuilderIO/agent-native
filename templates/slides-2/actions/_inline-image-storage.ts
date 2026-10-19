import { fail } from "@agent-native/core/action";
import { parseBase64DataUrl } from "@agent-native/core/shared";
import { parseFragment, type DefaultTreeAdapterTypes as P5 } from "parse5";

import { MAX_INLINE_IMAGE_BASE64_CHARS } from "../shared/upload-types.js";

type DataUrlOccurrence = { value: string; field: string };

const URL_ATTRIBUTES = new Set(["data", "href", "poster", "src", "srcset"]);
const DATA_URL_FIELDS = new Set(["url", "src", "dataurl", "href", "poster"]);
const CSS_URL = /url\s*\(\s*(?:(["'])(.*?)\1|([^)]*?))\s*\)/gi;
const SOURCE_DATA_URL = /data:[^\s"'`<>)}\]]+/gi;

const isElement = (node: P5.Node): node is P5.Element => "tagName" in node;
const isText = (node: P5.Node): node is P5.TextNode =>
  node.nodeName === "#text";

function isBase64(value: string): boolean {
  const unpadded = value.replace(/={1,2}$/, "");
  if (!/^[A-Za-z0-9+/]*$/.test(unpadded)) return false;
  return unpadded.length === value.length
    ? value.length % 4 !== 1
    : value.length % 4 === 0;
}

function cssDataUrls(css: string, field: string): DataUrlOccurrence[] {
  return [...css.matchAll(CSS_URL)].flatMap((match) => {
    const value = (match[2] ?? match[3] ?? "").trim();
    return value.toLowerCase().startsWith("data:") ? [{ value, field }] : [];
  });
}

function htmlDataUrls(html: string): DataUrlOccurrence[] {
  const occurrences: DataUrlOccurrence[] = [];
  const fragment = parseFragment(html, { scriptingEnabled: false });

  const visit = (node: P5.Node): void => {
    if (!isElement(node)) return;

    for (const attr of node.attrs) {
      const value = attr.value.trim();
      if (URL_ATTRIBUTES.has(attr.name.toLowerCase())) {
        if (value.toLowerCase().startsWith("data:")) {
          occurrences.push({ value, field: `${node.tagName}.${attr.name}` });
        } else if (
          attr.name.toLowerCase() === "srcset" &&
          value.toLowerCase().includes("data:")
        ) {
          occurrences.push({ value, field: `${node.tagName}.srcset` });
        }
      }
      if (attr.name.toLowerCase() === "style") {
        occurrences.push(...cssDataUrls(value, `${node.tagName}.style`));
      }
    }

    if (node.tagName === "style") {
      const css = node.childNodes
        .filter(isText)
        .map((child) => child.value)
        .join("");
      occurrences.push(...cssDataUrls(css, "style"));
    }

    for (const child of node.childNodes) visit(child);
  };

  for (const child of fragment.childNodes) visit(child);
  return occurrences;
}

function sourceDataUrls(source: string, field: string): DataUrlOccurrence[] {
  return [...source.matchAll(SOURCE_DATA_URL)].map((match) => ({
    value: match[0],
    field,
  }));
}

function structuredDataUrls(
  value: unknown,
  rootField: string,
): DataUrlOccurrence[] {
  const occurrences: DataUrlOccurrence[] = [];
  const visit = (current: unknown, path: string, key: string): void => {
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`, key));
      return;
    }
    if (typeof current === "string") {
      if (
        (DATA_URL_FIELDS.has(key.toLowerCase()) ||
          key.toLowerCase() === "referenceurls" ||
          key.toLowerCase() === "imageurls" ||
          key.toLowerCase() === "background") &&
        current.trim().toLowerCase().startsWith("data:")
      ) {
        occurrences.push({
          value: current.trim(),
          field: `${rootField}.${path}`,
        });
      }
      if (/css|background/i.test(key)) {
        occurrences.push(...cssDataUrls(current, `${rootField}.${path}`));
      }
      return;
    }
    if (!current || typeof current !== "object") return;

    for (const [childKey, child] of Object.entries(current)) {
      const childPath = path ? `${path}.${childKey}` : childKey;
      visit(child, childPath, childKey);
    }
  };

  visit(value, "", "");
  return occurrences;
}

function slideDataUrls(
  slide: Record<string, unknown>,
  inspectChangedExcalidrawData: boolean,
): DataUrlOccurrence[] {
  const occurrences =
    typeof slide.content === "string" ? htmlDataUrls(slide.content) : [];

  for (const field of ["imageUrl", "background"] as const) {
    const value = slide[field];
    if (typeof value !== "string") continue;
    if (value.trim().toLowerCase().startsWith("data:")) {
      occurrences.push({ value: value.trim(), field });
    }
    if (field === "background") {
      occurrences.push(...cssDataUrls(value, field));
    }
  }

  if (typeof slide.sourceTsx === "string") {
    occurrences.push(...sourceDataUrls(slide.sourceTsx, "sourceTsx"));
  }

  if (
    inspectChangedExcalidrawData &&
    typeof slide.excalidrawData === "string" &&
    slide.excalidrawData.length > 0
  ) {
    let data: unknown;
    try {
      data = JSON.parse(slide.excalidrawData);
    } catch {
      fail("Excalidraw slide data must be valid JSON.", {
        errorCode: "invalid_excalidraw_data",
      });
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      fail("Excalidraw slide data must be a JSON object.", {
        errorCode: "invalid_excalidraw_data",
      });
    }
    occurrences.push(...structuredDataUrls(data, "excalidrawData"));
  }

  return occurrences;
}

function occurrencesAdded(
  previous: readonly DataUrlOccurrence[],
  next: readonly DataUrlOccurrence[],
): DataUrlOccurrence[] {
  const previousCounts = new Map<string, number>();
  for (const occurrence of previous) {
    const key = `${occurrence.field}\0${occurrence.value}`;
    previousCounts.set(key, (previousCounts.get(key) ?? 0) + 1);
  }

  const added: DataUrlOccurrence[] = [];
  for (const occurrence of next) {
    const key = `${occurrence.field}\0${occurrence.value}`;
    const count = previousCounts.get(key) ?? 0;
    if (count > 0) {
      previousCounts.set(key, count - 1);
    } else {
      added.push(occurrence);
    }
  }
  return added;
}

function assertDataUrlIsNotPersisted(
  occurrence: DataUrlOccurrence,
  resource: "slide" | "design-system",
): void {
  if (occurrence.value.length > MAX_INLINE_IMAGE_BASE64_CHARS) {
    fail(
      `The inline image in ${occurrence.field} exceeds the ${MAX_INLINE_IMAGE_BASE64_CHARS.toLocaleString()} character limit. Upload it and use the returned asset URL.`,
      {
        errorCode: "inline_image_data_url_too_large",
        statusCode: 413,
        details: { field: occurrence.field, resource },
      },
    );
  }

  const parsed = parseBase64DataUrl(occurrence.value);
  if (!parsed || !isBase64(parsed.data)) {
    fail(
      `The inline image in ${occurrence.field} is not a valid base64 data URL. Upload it and use the returned asset URL.`,
      {
        errorCode: "invalid_inline_image_data_url",
        details: { field: occurrence.field, resource },
      },
    );
  }

  fail(
    `Inline image data URLs cannot be saved in ${resource} data. Upload the image and use the returned asset URL.`,
    {
      errorCode: "inline_image_data_url_not_persistable",
      details: { field: occurrence.field, resource },
    },
  );
}

export function assertSlideInlineImagesPersistable(
  previousSlide: Record<string, unknown>,
  nextSlide: Record<string, unknown>,
  slideId: string,
): void {
  const added = occurrencesAdded(
    slideDataUrls(previousSlide, false),
    slideDataUrls(
      nextSlide,
      previousSlide.excalidrawData !== nextSlide.excalidrawData,
    ),
  );
  const occurrence = added[0];
  if (occurrence) {
    assertDataUrlIsNotPersisted(
      { ...occurrence, field: `slide ${slideId} ${occurrence.field}` },
      "slide",
    );
  }
}

export function assertDesignSystemAssetUrlsPersistable(
  value: unknown,
  field: "data" | "assets",
): void {
  const occurrences = structuredDataUrls(value, field);
  const occurrence = occurrences[0];
  if (occurrence) assertDataUrlIsNotPersisted(occurrence, "design-system");
}
