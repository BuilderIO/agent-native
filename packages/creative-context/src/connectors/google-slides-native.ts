import type {
  NativeCreativeArtifact,
  NativeCreativeArtifactFidelityReport,
} from "../native-artifact.js";
import type { ContextMediaInput } from "../types.js";

const SLIDE_WIDTH = 960;
const MAX_INLINE_HTML_BYTES = 128 * 1024;
const INLINE_PART_TARGET_BYTES = 120 * 1024;

type AffineTransform = [number, number, number, number, number, number];
const IDENTITY_TRANSFORM: AffineTransform = [1, 0, 0, 1, 0, 0];

type JsonObject = Record<string, unknown>;

export interface SlidesNativeAssetRequest {
  sourceUrl: string;
  provenanceUrl?: string;
  presentationId: string;
  slideObjectId: string;
  elementObjectId: string;
  revisionId?: string;
  kind: "image" | "fallback";
  bounds: SlidesNativeBounds;
}

export interface SlidesNativeFallbackRequest {
  presentationId: string;
  slideObjectId: string;
  elementObjectId: string;
  revisionId?: string;
  bounds: SlidesNativeBounds;
  reason: string;
}

export interface SlidesNativeBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CompiledGoogleSlide {
  objectId: string;
  html: string;
  plainText: string;
  lexicalText: string;
  media: ContextMediaInput[];
  nativeArtifact: NativeCreativeArtifact;
  childArtifacts: CompiledGoogleSlideChild[];
}

export interface CompiledGoogleSlideChild {
  externalId: string;
  objectId: string;
  html: string;
  lexicalText: string;
  nativeArtifact: NativeCreativeArtifact;
}

export interface GoogleSlidesNativeCompileOptions {
  presentationId: string;
  revisionId?: string;
  resolveAsset: (
    request: SlidesNativeAssetRequest,
  ) => Promise<ContextMediaInput & { id: string; url: string }>;
  resolveFallback?: (
    request: SlidesNativeFallbackRequest,
  ) => Promise<(ContextMediaInput & { id: string; url: string }) | null>;
}

type FidelityBucket = "exact" | "approximated" | "imageFallback";

interface CompileState {
  presentationId: string;
  revisionId?: string;
  slideObjectId: string;
  pageWidth: number;
  pageHeight: number;
  canvasScale: number;
  themeColors: Map<string, string>;
  media: ContextMediaInput[];
  assetRefs: string[];
  plainText: string[];
  fidelity: NativeCreativeArtifactFidelityReport;
  resolveAsset: GoogleSlidesNativeCompileOptions["resolveAsset"];
  resolveFallback?: GoogleSlidesNativeCompileOptions["resolveFallback"];
}

interface CompileStateSnapshot {
  media: number;
  assetRefs: number;
  exact: number;
  approximated: number;
  approximatedReasons: number;
  imageFallback: number;
  imageFallbackReasons: number;
}

export async function compileGoogleSlidesPresentation(
  presentation: JsonObject,
  options: GoogleSlidesNativeCompileOptions,
): Promise<CompiledGoogleSlide[]> {
  const pageSize = record(presentation.pageSize);
  const pageWidth = dimensionToPx(record(pageSize?.width)) || SLIDE_WIDTH;
  const pageHeight = dimensionToPx(record(pageSize?.height)) || 540;
  const masters = objectMap(presentation.masters);
  const layouts = objectMap(presentation.layouts);
  const slides = array(presentation.slides);
  const compiled: CompiledGoogleSlide[] = [];

  for (const value of slides) {
    const slide = record(value);
    const objectId = text(slide?.objectId);
    if (!slide || !objectId) continue;
    const slideProperties = record(slide.slideProperties);
    const layout = layouts.get(text(slideProperties?.layoutObjectId) ?? "");
    const layoutProperties = record(layout?.layoutProperties);
    const master = masters.get(
      text(slideProperties?.masterObjectId) ??
        text(layoutProperties?.masterObjectId) ??
        "",
    );
    const themeColors = resolveThemeColors(master, layout, slide);
    const state: CompileState = {
      presentationId: options.presentationId,
      revisionId: options.revisionId,
      slideObjectId: objectId,
      pageWidth,
      pageHeight,
      canvasScale: Math.min(SLIDE_WIDTH / pageWidth, 540 / pageHeight),
      themeColors,
      media: [],
      assetRefs: [],
      plainText: [],
      fidelity: emptyFidelityReport(),
      resolveAsset: options.resolveAsset,
      resolveFallback: options.resolveFallback,
    };
    const pageElements = inheritedPageElements(master, layout, slide);
    const rendered: Array<{
      objectId: string;
      html: string;
      bounds: SlidesNativeBounds;
      transform: AffineTransform;
      fidelity: NativeCreativeArtifactFidelityReport;
    }> = [];

    for (let index = 0; index < pageElements.length; index++) {
      const resolved = pageElements[index]!;
      const element = resolved.element;
      const snapshot = snapshotCompileState(state);
      let result = await compilePageElement(
        element,
        state,
        index,
        resolved,
        IDENTITY_TRANSFORM,
      );
      if (!result) continue;
      if (Buffer.byteLength(result, "utf8") > INLINE_PART_TARGET_BYTES) {
        restoreCompileState(state, snapshot);
        const baseStyle = elementCss(element, index, state.canvasScale);
        result = await compileFallback(
          element,
          state,
          elementBounds(
            element,
            state.pageWidth,
            state.pageHeight,
            IDENTITY_TRANSFORM,
          ),
          "Element native markup exceeded the inline artifact budget.",
          baseStyle,
        );
      }
      rendered.push({
        objectId: text(element.objectId) ?? `element-${index + 1}`,
        html: result,
        bounds: elementBounds(
          element,
          state.pageWidth,
          state.pageHeight,
          IDENTITY_TRANSFORM,
        ),
        transform: elementTransform(element),
        fidelity: fidelitySince(state, snapshot),
      });
    }

    const background = pageBackground(master, layout, slide, themeColors);
    if (background.approximationReason) {
      state.fidelity.approximated.count += 1;
      state.fidelity.approximated.reasons.push({
        nodeId: `${objectId}:background`,
        nodeName: "Slide background",
        nodeType: "pageBackground",
        reasons: [background.approximationReason],
      });
    }
    const rootStyle = css({
      position: "relative",
      width: `${SLIDE_WIDTH}px`,
      height: "540px",
      overflow: "hidden",
      background: "#ffffff",
      "transform-origin": "0 0",
    });
    const canvasStyle = css({
      position: "absolute",
      left: `${round((SLIDE_WIDTH - pageWidth * state.canvasScale) / 2)}px`,
      top: `${round((540 - pageHeight * state.canvasScale) / 2)}px`,
      width: `${round(pageWidth * state.canvasScale)}px`,
      height: `${round(pageHeight * state.canvasScale)}px`,
      overflow: "hidden",
      background: background.css,
    });
    const assembledHtml = slideHtml(
      objectId,
      rootStyle,
      canvasStyle,
      rendered.map((entry) => entry.html).join(""),
    );
    const plainText = state.plainText.join("\n").replace(/\s+/g, " ").trim();
    const rootExternalId = `${options.presentationId}:${objectId}`;
    const childArtifacts: CompiledGoogleSlideChild[] = [];
    let html = assembledHtml;
    const nativeArtifact: NativeCreativeArtifact = {
      schemaVersion: 1,
      app: "slides",
      format: "slides-html",
      rootExternalId,
      sourceBounds: { x: 0, y: 0, width: pageWidth, height: pageHeight },
      fidelityReport: state.fidelity,
      ...(state.assetRefs.length
        ? { assetRefs: [...new Set(state.assetRefs)] }
        : {}),
    };
    if (Buffer.byteLength(assembledHtml, "utf8") > MAX_INLINE_HTML_BYTES) {
      const children = rendered.map((entry, index) => {
        const externalId = `${rootExternalId}:native-part:${index + 1}`;
        const childAssetRefs = assetRefsFromHtml(entry.html);
        childArtifacts.push({
          externalId,
          objectId: entry.objectId,
          html: entry.html,
          lexicalText: lexicalIndexText(entry.html, ""),
          nativeArtifact: {
            schemaVersion: 1,
            app: "slides",
            format: "slides-html",
            rootExternalId: externalId,
            sourceBounds: entry.bounds,
            fidelityReport: entry.fidelity,
            ...(childAssetRefs.length ? { assetRefs: childAssetRefs } : {}),
          },
        });
        return {
          externalId,
          sourceNodeId: entry.objectId,
          bounds: entry.bounds,
          transform: entry.transform,
          zOrder: index,
        };
      });
      nativeArtifact.childExternalIds = children.map(
        (child) => child.externalId,
      );
      nativeArtifact.assetRefs = undefined;
      nativeArtifact.manifest = {
        kind: "hierarchical-artboard",
        children,
      };
      html = slideHtml(
        objectId,
        rootStyle,
        canvasStyle,
        children
          .map(
            (child) =>
              `<div data-creative-context-child="${escapeAttr(child.externalId)}"></div>`,
          )
          .join(""),
      );
    }
    if (Buffer.byteLength(html, "utf8") > MAX_INLINE_HTML_BYTES) {
      throw new Error(
        `Compiled slide shell ${objectId} exceeds the ${MAX_INLINE_HTML_BYTES} byte inline HTML limit.`,
      );
    }
    compiled.push({
      objectId,
      html,
      plainText,
      lexicalText: lexicalIndexText(assembledHtml, plainText),
      media: state.media,
      nativeArtifact,
      childArtifacts,
    });
  }
  return compiled;
}

function slideHtml(
  objectId: string,
  rootStyle: string,
  canvasStyle: string,
  content: string,
): string {
  return `<div class="fmd-slide google-slides-native" data-source-slide-id="${escapeAttr(objectId)}" style="${rootStyle}"><div class="google-slides-source-canvas" style="${canvasStyle}">${content}</div></div>`;
}

function snapshotCompileState(state: CompileState): CompileStateSnapshot {
  return {
    media: state.media.length,
    assetRefs: state.assetRefs.length,
    exact: state.fidelity.exact.count,
    approximated: state.fidelity.approximated.count,
    approximatedReasons: state.fidelity.approximated.reasons.length,
    imageFallback: state.fidelity.imageFallback.count,
    imageFallbackReasons: state.fidelity.imageFallback.reasons.length,
  };
}

function restoreCompileState(
  state: CompileState,
  snapshot: CompileStateSnapshot,
): void {
  state.media.length = snapshot.media;
  state.assetRefs.length = snapshot.assetRefs;
  state.fidelity.exact.count = snapshot.exact;
  state.fidelity.approximated.count = snapshot.approximated;
  state.fidelity.approximated.reasons.length = snapshot.approximatedReasons;
  state.fidelity.imageFallback.count = snapshot.imageFallback;
  state.fidelity.imageFallback.reasons.length = snapshot.imageFallbackReasons;
}

function fidelitySince(
  state: CompileState,
  snapshot: CompileStateSnapshot,
): NativeCreativeArtifactFidelityReport {
  return {
    exact: { count: state.fidelity.exact.count - snapshot.exact },
    approximated: {
      count: state.fidelity.approximated.count - snapshot.approximated,
      reasons: state.fidelity.approximated.reasons.slice(
        snapshot.approximatedReasons,
      ),
    },
    imageFallback: {
      count: state.fidelity.imageFallback.count - snapshot.imageFallback,
      reasons: state.fidelity.imageFallback.reasons.slice(
        snapshot.imageFallbackReasons,
      ),
    },
  };
}

function inheritedPageElements(
  master: JsonObject | undefined,
  layout: JsonObject | undefined,
  slide: JsonObject,
): Array<{
  element: JsonObject;
  inherited: JsonObject[];
  local?: JsonObject;
}> {
  const masterElements = pageElementMap(master?.pageElements);
  const layoutElements = pageElementMap(layout?.pageElements);
  const slideElements = pageElementMap(slide.pageElements);
  const masterPlaceholders = placeholderMap(masterElements);
  const layoutPlaceholders = placeholderMap(layoutElements);
  const claimedLayout = new Set<string>();
  const claimedMaster = new Set<string>();
  const output: Array<{
    element: JsonObject;
    inherited: JsonObject[];
    local?: JsonObject;
  }> = [];

  for (const element of slideElements.values()) {
    const placeholder = elementPlaceholder(element);
    const layoutElement = resolvePlaceholder(
      placeholder,
      layoutElements,
      layoutPlaceholders,
    );
    const masterElement =
      resolvePlaceholder(
        elementPlaceholder(layoutElement),
        masterElements,
        masterPlaceholders,
      ) ?? resolvePlaceholder(placeholder, masterElements, masterPlaceholders);
    const layoutId = text(layoutElement?.objectId);
    const masterId = text(masterElement?.objectId);
    if (layoutId) claimedLayout.add(layoutId);
    if (masterId) claimedMaster.add(masterId);
    output.push({
      element: mergeElement(masterElement, layoutElement, element),
      inherited: [masterElement, layoutElement].filter(
        (entry): entry is JsonObject => Boolean(entry),
      ),
      local: element,
    });
  }
  const inheritedDecorations = [
    ...[...masterElements.values()]
      .filter(
        (element) =>
          !elementPlaceholder(element) &&
          !claimedMaster.has(text(element.objectId) ?? ""),
      )
      .map((element) => ({ element, inherited: [] })),
    ...[...layoutElements.values()]
      .filter(
        (element) =>
          !elementPlaceholder(element) &&
          !claimedLayout.has(text(element.objectId) ?? ""),
      )
      .map((element) => ({ element, inherited: [] })),
  ];
  return [...inheritedDecorations, ...output];
}

async function compilePageElement(
  element: JsonObject,
  state: CompileState,
  zOrder: number,
  resolved: { inherited: JsonObject[]; local?: JsonObject },
  parentTransform: AffineTransform,
): Promise<string | null> {
  const objectId = text(element.objectId) ?? `element-${zOrder + 1}`;
  const absoluteTransform = multiplyTransforms(
    parentTransform,
    elementTransform(element),
  );
  const bounds = elementBounds(
    element,
    state.pageWidth,
    state.pageHeight,
    parentTransform,
  );
  const absorbAxisAlignedScale =
    !record(element.elementGroup) &&
    !record(element.line) &&
    shouldAbsorbAxisAlignedScale(element);
  const baseStyle = elementCss(
    element,
    zOrder,
    state.canvasScale,
    absorbAxisAlignedScale,
  );
  if (record(element.wordArt)) {
    return compileFallback(
      element,
      state,
      bounds,
      "WordArt requires raster fidelity.",
      baseStyle,
    );
  }
  if (record(element.sheetsChart)) {
    return compileFallback(
      element,
      state,
      bounds,
      "Linked Sheets chart is indivisible.",
      baseStyle,
    );
  }
  if (record(element.video)) {
    return compileFallback(
      element,
      state,
      bounds,
      "Video poster is indivisible.",
      baseStyle,
    );
  }
  const image = record(element.image);
  if (image) {
    const sourceUrl = text(image.contentUrl);
    if (!sourceUrl) {
      return compileFallback(
        element,
        state,
        bounds,
        "Image has no retrievable content URL.",
        baseStyle,
      );
    }
    const asset = await state.resolveAsset({
      sourceUrl,
      provenanceUrl: safeSourceUrl(text(image.sourceUrl)),
      presentationId: state.presentationId,
      slideObjectId: state.slideObjectId,
      elementObjectId: objectId,
      revisionId: state.revisionId,
      kind: "image",
      bounds,
    });
    state.media.push(asset);
    state.assetRefs.push(asset.url);
    const reasons = imageApproximationReasons(image);
    markFidelity(
      state,
      reasons.length ? "approximated" : "exact",
      element,
      reasons,
    );
    return imageMarkup(element, image, asset.url, baseStyle, state.themeColors);
  }
  const table = record(element.table);
  if (table) {
    const reasons = tableApproximationReasons(table);
    markFidelity(
      state,
      reasons.length ? "approximated" : "exact",
      element,
      reasons,
    );
    return tableMarkup(element, table, state, baseStyle);
  }
  const group = record(element.elementGroup);
  if (group) {
    const children = array(group.children);
    const content: string[] = [];
    for (let index = 0; index < children.length; index++) {
      const child = record(children[index]);
      if (!child) continue;
      const childMarkup = await compilePageElement(
        child,
        state,
        index,
        { inherited: [] },
        absoluteTransform,
      );
      if (childMarkup) content.push(childMarkup);
    }
    markFidelity(state, "exact", element, []);
    return `<div class="gslide-group" data-source-object-id="${escapeAttr(objectId)}" style="${baseStyle}">${content.join("")}</div>`;
  }
  const shape = record(element.shape);
  if (shape) {
    const localShape = record(resolved.local?.shape) ?? shape;
    const shapeType =
      text(localShape.shapeType) ?? text(shape.shapeType) ?? "RECT";
    if (!SUPPORTED_SHAPES.has(shapeType)) {
      return compileFallback(
        element,
        state,
        bounds,
        `Unsupported shape type ${shapeType}.`,
        baseStyle,
      );
    }
    const reasons = shapeApproximationReasons(
      shapeType,
      localShape,
      resolved.inherited,
    );
    markFidelity(
      state,
      reasons.length ? "approximated" : "exact",
      element,
      reasons,
    );
    return shapeMarkup(
      element,
      localShape,
      state,
      baseStyle,
      resolved.inherited,
    );
  }
  const line = record(element.line);
  if (line) {
    const lineType = text(line.lineType) ?? "STRAIGHT_CONNECTOR_1";
    const properties = record(line.lineProperties);
    if (
      !lineType.startsWith("STRAIGHT") ||
      (text(properties?.startArrow) ?? "NONE") !== "NONE" ||
      (text(properties?.endArrow) ?? "NONE") !== "NONE"
    ) {
      return compileFallback(
        element,
        state,
        bounds,
        "Curved, bent, and arrowed lines require raster fidelity.",
        baseStyle,
      );
    }
    const dashStyle = text(properties?.dashStyle) ?? "SOLID";
    markFidelity(
      state,
      dashStyle === "SOLID" ? "exact" : "approximated",
      element,
      dashStyle === "SOLID"
        ? []
        : ["Google line dash spacing is approximated by CSS."],
    );
    return lineMarkup(element, line, state, baseStyle);
  }
  return compileFallback(
    element,
    state,
    bounds,
    "Unsupported Google Slides page element.",
    baseStyle,
  );
}

async function compileFallback(
  element: JsonObject,
  state: CompileState,
  bounds: SlidesNativeBounds,
  reason: string,
  baseStyle: string,
): Promise<string> {
  const objectId = text(element.objectId) ?? "unsupported-element";
  const fallback = state.resolveFallback
    ? await state.resolveFallback({
        presentationId: state.presentationId,
        slideObjectId: state.slideObjectId,
        elementObjectId: objectId,
        revisionId: state.revisionId,
        bounds,
        reason,
      })
    : null;
  if (!fallback) {
    throw new Error(
      `Localized raster fallback for ${objectId} was unavailable: ${reason}`,
    );
  }
  markFidelity(state, "imageFallback", element, [reason]);
  state.media.push(fallback);
  state.assetRefs.push(fallback.url);
  return `<div class="gslide-element gslide-image-fallback" data-source-object-id="${escapeAttr(objectId)}" data-fallback-reason="${escapeAttr(reason)}" style="${baseStyle}"><img alt="${escapeAttr(`Raster fallback for ${objectId}`)}" src="${escapeAttr(fallback.url)}" style="width:100%;height:100%;display:block"/></div>`;
}

function shapeMarkup(
  element: JsonObject,
  shape: JsonObject,
  state: CompileState,
  baseStyle: string,
  inherited: JsonObject[],
): string {
  const objectId = text(element.objectId) ?? "shape";
  const properties = resolvedShapeProperties(inherited, shape);
  const shapeType = text(shape.shapeType) ?? "RECT";
  const geometry = shapeGeometryCss(shapeType);
  const fill = fillCss(
    record(properties.shapeBackgroundFill),
    state.themeColors,
  );
  const outline = outlineCss(record(properties.outline), state.themeColors);
  const textContent = compileRichText(record(shape.text), state, inherited);
  const textScaleCompensation = textScaleCompensationCss(element);
  const alignment = text(properties.contentAlignment) ?? "TOP";
  const justifyContent =
    alignment === "MIDDLE"
      ? "center"
      : alignment === "BOTTOM"
        ? "flex-end"
        : "flex-start";
  return `<div class="gslide-element gslide-shape gslide-shape-${escapeAttr(shapeType.toLowerCase())}" data-source-object-id="${escapeAttr(objectId)}" style="${baseStyle};${fill};${outline};${geometry};overflow:hidden"><div class="gslide-text" style="${textScaleCompensation};box-sizing:border-box;overflow:hidden;display:flex;flex-direction:column;justify-content:${justifyContent};padding:9.6px">${textContent}</div></div>`;
}

function textScaleCompensationCss(element: JsonObject): string {
  if (shouldAbsorbAxisAlignedScale(element)) {
    return css({ width: "100%", height: "100%" });
  }
  const [a, b, c, d] = elementTransform(element);
  const scaleX = Math.hypot(a, b) || 1;
  const determinant = a * d - b * c;
  const scaleY = Math.abs(determinant / scaleX) || 1;
  return css({
    width: `${round(scaleX * 100)}%`,
    height: `${round(scaleY * 100)}%`,
    transform: `scale(${round(1 / scaleX)},${round(1 / scaleY)})`,
    "transform-origin": "0 0",
  });
}

function compileRichText(
  textObject: JsonObject | null,
  state: CompileState,
  inherited: JsonObject[],
): string {
  const elements = array(textObject?.textElements);
  const paragraphs: Array<{
    style: JsonObject;
    runs: string[];
    bullet?: string;
  }> = [];
  let nestingLevel = 0;
  let current = {
    style: inheritedParagraphStyle(inherited, nestingLevel),
    runs: [] as string[],
    bullet: undefined as string | undefined,
  };
  const flush = () => {
    if (current.runs.length || paragraphs.length === 0)
      paragraphs.push(current);
    current = {
      style: inheritedParagraphStyle(inherited, nestingLevel),
      runs: [],
      bullet: undefined,
    };
  };
  for (const value of elements) {
    const entry = record(value);
    const marker = record(entry?.paragraphMarker);
    if (marker) {
      if (current.runs.length) flush();
      nestingLevel = Math.max(
        0,
        Math.round(number(record(marker.bullet)?.nestingLevel) ?? 0),
      );
      current.style = deepMerge(
        {},
        inheritedParagraphStyle(inherited, nestingLevel),
        record(marker.style) ?? {},
      );
      current.bullet = text(record(marker.bullet)?.glyph);
      continue;
    }
    const run = record(entry?.textRun) ?? record(entry?.autoText);
    if (!run) continue;
    const content =
      rawText(run.content) ?? rawText(record(entry?.autoText)?.content) ?? "";
    const segments = content.split("\n");
    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index]!;
      if (segment) {
        state.plainText.push(segment.replaceAll("\u000b", "\n"));
        const style = textRunCss(
          deepMerge(
            {},
            inheritedTextStyle(inherited, nestingLevel),
            record(run.style) ?? {},
          ),
          state.themeColors,
        );
        const span = `<span style="${style}">${escapeTextRun(segment)}</span>`;
        current.runs.push(span);
      }
      if (index < segments.length - 1) flush();
    }
  }
  if (current.runs.length) flush();
  if (!paragraphs.length) return "";
  return paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0;${paragraphCss(paragraph.style)}">${paragraph.bullet ? `<span class="gslide-bullet">${escapeHtml(paragraph.bullet)}&nbsp;</span>` : ""}${paragraph.runs.join("") || "<br>"}</p>`,
    )
    .join("");
}

function inheritedParagraphStyle(
  inherited: JsonObject[],
  nestingLevel: number,
): JsonObject {
  return deepMerge(
    {},
    ...inherited.map(
      (entry) => placeholderTextDefaults(entry, nestingLevel).paragraphStyle,
    ),
  );
}

function inheritedTextStyle(
  inherited: JsonObject[],
  nestingLevel: number,
): JsonObject {
  return deepMerge(
    {},
    ...inherited.map(
      (entry) => placeholderTextDefaults(entry, nestingLevel).textStyle,
    ),
  );
}

function placeholderTextDefaults(
  element: JsonObject,
  nestingLevel: number,
): { paragraphStyle: JsonObject; textStyle: JsonObject } {
  const textObject = record(record(element.shape)?.text);
  let activeLevel = 0;
  let matchingParagraph: JsonObject = {};
  let matchingText: JsonObject = {};
  for (const value of array(textObject?.textElements)) {
    const entry = record(value);
    const marker = record(entry?.paragraphMarker);
    if (marker) {
      activeLevel = Math.max(
        0,
        Math.round(number(record(marker.bullet)?.nestingLevel) ?? 0),
      );
      if (activeLevel === nestingLevel) {
        matchingParagraph = deepMerge(
          {},
          matchingParagraph,
          record(marker.style) ?? {},
        );
      }
      continue;
    }
    const run = record(entry?.textRun) ?? record(entry?.autoText);
    if (run && activeLevel === nestingLevel) {
      matchingText = deepMerge({}, matchingText, record(run.style) ?? {});
      if (Object.keys(matchingText).length > 0) break;
    }
  }
  return { paragraphStyle: matchingParagraph, textStyle: matchingText };
}

function imageMarkup(
  element: JsonObject,
  image: JsonObject,
  url: string,
  baseStyle: string,
  theme: Map<string, string>,
): string {
  const objectId = text(element.objectId) ?? "image";
  const properties = record(image.imageProperties);
  const crop =
    record(properties?.cropProperties) ?? record(image.cropProperties);
  const left = clamp(number(crop?.leftOffset) ?? 0, 0, 0.99);
  const right = clamp(number(crop?.rightOffset) ?? 0, 0, 0.99);
  const top = clamp(number(crop?.topOffset) ?? 0, 0, 0.99);
  const bottom = clamp(number(crop?.bottomOffset) ?? 0, 0, 0.99);
  const visibleWidth = Math.max(0.01, 1 - left - right);
  const visibleHeight = Math.max(0.01, 1 - top - bottom);
  const imageStyle = css({
    position: "absolute",
    left: `${round((-left / visibleWidth) * 100)}%`,
    top: `${round((-top / visibleHeight) * 100)}%`,
    width: `${round((1 / visibleWidth) * 100)}%`,
    height: `${round((1 / visibleHeight) * 100)}%`,
    "object-fit": "fill",
    ...(number(properties?.transparency) !== undefined
      ? {
          opacity: String(
            round(1 - clamp(number(properties?.transparency) ?? 0, 0, 1)),
          ),
        }
      : {}),
    ...imageFilterCss(properties),
  });
  const outline = outlineCss(record(properties?.outline), theme);
  const alt = [text(element.title), text(element.description)]
    .filter(Boolean)
    .join(" — ");
  return `<div class="gslide-element gslide-image" data-source-object-id="${escapeAttr(objectId)}" style="${baseStyle};overflow:hidden;${outline}"><img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}" style="${imageStyle}"/></div>`;
}

function tableMarkup(
  element: JsonObject,
  table: JsonObject,
  state: CompileState,
  baseStyle: string,
): string {
  const objectId = text(element.objectId) ?? "table";
  const rows = array(table.tableRows);
  const columnWidths = array(table.tableColumns).map((value) =>
    dimensionToPx(record(record(value)?.columnWidth)),
  );
  const totalColumnWidth = columnWidths.reduce((sum, width) => sum + width, 0);
  const body = rows
    .map((rowValue) => {
      const row = record(rowValue);
      let columnIndex = 0;
      const rowHeight = dimensionToPx(record(row?.rowHeight));
      return `<tr${rowHeight ? ` style="height:${round(rowHeight * state.canvasScale)}px"` : ""}>${array(
        row?.tableCells,
      )
        .map((cellValue) => {
          const cell = record(cellValue);
          const properties = record(cell?.tableCellProperties);
          const fill = fillCss(
            record(properties?.tableCellBackgroundFill),
            state.themeColors,
          );
          const colSpan = Math.max(
            1,
            Math.round(number(cell?.columnSpan) ?? 1),
          );
          const rowSpan = Math.max(1, Math.round(number(cell?.rowSpan) ?? 1));
          const width = columnWidths
            .slice(columnIndex, columnIndex + colSpan)
            .reduce((sum, value) => sum + value, 0);
          columnIndex += colSpan;
          const contentAlignment = text(properties?.contentAlignment) ?? "TOP";
          const verticalAlign =
            contentAlignment === "MIDDLE"
              ? "middle"
              : contentAlignment === "BOTTOM"
                ? "bottom"
                : "top";
          return `<td colspan="${colSpan}" rowspan="${rowSpan}" style="${fill};border:1px solid transparent;padding:4px;vertical-align:${verticalAlign}${width && totalColumnWidth ? `;width:${round((width / totalColumnWidth) * 100)}%` : ""}">${compileRichText(record(cell?.text), state, [])}</td>`;
        })
        .join("")}</tr>`;
    })
    .join("");
  return `<div class="gslide-element gslide-table" data-source-object-id="${escapeAttr(objectId)}" style="${baseStyle};overflow:hidden"><table style="width:100%;height:100%;border-collapse:collapse;table-layout:fixed">${body}</table></div>`;
}

function lineMarkup(
  element: JsonObject,
  line: JsonObject,
  state: CompileState,
  baseStyle: string,
): string {
  const objectId = text(element.objectId) ?? "line";
  const properties = record(line.lineProperties);
  const weight = Math.max(1, dimensionToPx(record(properties?.weight)));
  const lineFill = record(properties?.lineFill);
  const color =
    lineFill?.propertyState === "NOT_RENDERED"
      ? "transparent"
      : opaqueColor(
          record(record(lineFill?.solidFill)?.color),
          state.themeColors,
        );
  const dash = text(properties?.dashStyle) ?? "SOLID";
  const size = record(element.size);
  const width = dimensionToPx(record(size?.width));
  const height = dimensionToPx(record(size?.height));
  const [a, b, c, d, e, f] = elementTransform(element);
  const deltaX = (a * width + c * height) * state.canvasScale;
  const deltaY = (b * width + d * height) * state.canvasScale;
  const length = Math.hypot(deltaX, deltaY);
  const angle = (Math.atan2(deltaY, deltaX) * 180) / Math.PI;
  const geometry = css({
    width: `${round(length)}px`,
    height: "0",
    transform: `translate(${round(e * state.canvasScale)}px,${round(f * state.canvasScale)}px) rotate(${round(angle)}deg)`,
    "transform-origin": "0 0",
  });
  return `<div class="gslide-element gslide-line" data-source-object-id="${escapeAttr(objectId)}" style="${baseStyle};${geometry};border-top:${round(weight)}px ${dash === "SOLID" ? "solid" : "dashed"} ${color}"></div>`;
}

function pageBackground(
  master: JsonObject | undefined,
  layout: JsonObject | undefined,
  slide: JsonObject,
  theme: Map<string, string>,
): { css: string; approximationReason?: string } {
  for (const page of [slide, layout, master]) {
    const properties = record(page?.pageProperties);
    const fill = record(properties?.pageBackgroundFill);
    if (fill?.propertyState === "INHERIT") continue;
    if (fill?.propertyState === "NOT_RENDERED") return { css: "transparent" };
    if (fill && record(fill.solidFill)) {
      return { css: fillValue(fill, theme) };
    }
    if (fill) {
      return {
        css: "transparent",
        approximationReason:
          "Non-solid page backgrounds are omitted from editable HTML.",
      };
    }
  }
  return { css: "#ffffff" };
}

function elementCss(
  element: JsonObject,
  zOrder: number,
  scale: number,
  absorbAxisAlignedScale = false,
): string {
  const size = record(element.size);
  const transform = elementTransform(element);
  const [a, b, c, d, e, f] = transform;
  const widthScale = absorbAxisAlignedScale ? a : 1;
  const heightScale = absorbAxisAlignedScale ? d : 1;
  return css({
    position: "absolute",
    left: "0",
    top: "0",
    width: `${round(dimensionToPx(record(size?.width)) * scale * widthScale)}px`,
    height: `${round(dimensionToPx(record(size?.height)) * scale * heightScale)}px`,
    transform: `matrix(${round(absorbAxisAlignedScale ? 1 : a)},${round(b)},${round(c)},${round(absorbAxisAlignedScale ? 1 : d)},${round(e * scale)},${round(f * scale)})`,
    "transform-origin": "0 0",
    "z-index": String(zOrder),
    "box-sizing": "border-box",
  });
}

function shouldAbsorbAxisAlignedScale(element: JsonObject): boolean {
  const [a, b, c, d] = elementTransform(element);
  return a > 0 && d > 0 && Math.abs(b) < 0.000_001 && Math.abs(c) < 0.000_001;
}

function elementBounds(
  element: JsonObject,
  pageWidth: number,
  pageHeight: number,
  parentTransform: AffineTransform,
): SlidesNativeBounds {
  const size = record(element.size);
  const [a, b, c, d, e, f] = multiplyTransforms(
    parentTransform,
    elementTransform(element),
  );
  const width = dimensionToPx(record(size?.width));
  const height = dimensionToPx(record(size?.height));
  const points = [
    [e, f],
    [a * width + e, b * width + f],
    [c * height + e, d * height + f],
    [a * width + c * height + e, b * width + d * height + f],
  ];
  const xs = points.map(([x]) => x!);
  const ys = points.map(([, y]) => y!);
  const left = clamp(Math.min(...xs), 0, pageWidth);
  const top = clamp(Math.min(...ys), 0, pageHeight);
  const right = clamp(Math.max(...xs), left, pageWidth);
  const bottom = clamp(Math.max(...ys), top, pageHeight);
  return {
    x: round(left),
    y: round(top),
    width: round(right - left),
    height: round(bottom - top),
  };
}

function elementTransform(element: JsonObject): AffineTransform {
  const transform = record(element.transform);
  if (!transform) return IDENTITY_TRANSFORM;
  return [
    number(transform.scaleX) ?? 0,
    number(transform?.shearY) ?? 0,
    number(transform?.shearX) ?? 0,
    number(transform.scaleY) ?? 0,
    dimensionToPx({
      magnitude: number(transform?.translateX) ?? 0,
      unit: text(transform?.unit) ?? "EMU",
    }),
    dimensionToPx({
      magnitude: number(transform?.translateY) ?? 0,
      unit: text(transform?.unit) ?? "EMU",
    }),
  ];
}

function multiplyTransforms(
  parent: AffineTransform,
  local: AffineTransform,
): AffineTransform {
  const [pa, pb, pc, pd, pe, pf] = parent;
  const [la, lb, lc, ld, le, lf] = local;
  return [
    pa * la + pc * lb,
    pb * la + pd * lb,
    pa * lc + pc * ld,
    pb * lc + pd * ld,
    pa * le + pc * lf + pe,
    pb * le + pd * lf + pf,
  ];
}

function fillCss(fill: JsonObject | null, theme: Map<string, string>): string {
  if (!fill || fill.propertyState === "NOT_RENDERED")
    return "background:transparent";
  return `background:${fillValue(fill, theme)}`;
}

function fillValue(fill: JsonObject, theme: Map<string, string>): string {
  const solid = record(fill.solidFill);
  if (!solid) return "transparent";
  const color = opaqueColor(solid.color, theme);
  const alpha = clamp(number(solid.alpha) ?? 1, 0, 1);
  if (alpha === 1) return color;
  const channels = color
    .slice(1)
    .match(/.{2}/g)
    ?.map((value) => Number.parseInt(value, 16));
  return channels?.length === 3
    ? `rgba(${channels[0]},${channels[1]},${channels[2]},${round(alpha)})`
    : color;
}

function outlineCss(
  outline: JsonObject | null,
  theme: Map<string, string>,
): string {
  if (!outline || outline.propertyState === "NOT_RENDERED")
    return "border:none";
  const weight = dimensionToPx(record(outline.weight));
  const color = opaqueColor(
    record(record(outline.outlineFill)?.solidFill)?.color,
    theme,
  );
  const dash = text(outline.dashStyle);
  return `border:${round(weight || 1)}px ${dash && dash !== "SOLID" ? "dashed" : "solid"} ${color}`;
}

function textRunCss(style: JsonObject, theme: Map<string, string>): string {
  const size = dimensionToPx(record(style.fontSize));
  const weightedFont = record(style.weightedFontFamily);
  const family = safeFont(
    text(weightedFont?.fontFamily) ?? text(style.fontFamily),
  );
  const foreground = opaqueColor(
    record(style.foregroundColor)?.opaqueColor,
    theme,
  );
  const background = record(record(style.backgroundColor)?.opaqueColor);
  const decorations = [
    style.underline === true ? "underline" : "",
    style.strikethrough === true ? "line-through" : "",
  ].filter(Boolean);
  return css({
    ...(family ? { "font-family": family } : {}),
    ...(size ? { "font-size": `${round(size)}px` } : {}),
    ...(style.bold === true ? { "font-weight": "700" } : {}),
    ...(number(weightedFont?.weight)
      ? { "font-weight": String(Math.round(number(weightedFont?.weight)!)) }
      : {}),
    ...(style.italic === true ? { "font-style": "italic" } : {}),
    ...(decorations.length ? { "text-decoration": decorations.join(" ") } : {}),
    ...(style.smallCaps === true ? { "font-variant": "small-caps" } : {}),
    ...(text(style.baselineOffset) === "SUPERSCRIPT"
      ? { "vertical-align": "super" }
      : text(style.baselineOffset) === "SUBSCRIPT"
        ? { "vertical-align": "sub" }
        : {}),
    ...(background
      ? {
          "background-color": opaqueColor(background, theme),
        }
      : {}),
    color: foreground,
  });
}

function paragraphCss(style: JsonObject): string {
  const alignment = text(style.alignment);
  const lineSpacing = number(style.lineSpacing);
  return css({
    ...(alignment ? { "text-align": paragraphAlignment(alignment) } : {}),
    ...(lineSpacing ? { "line-height": String(round(lineSpacing / 100)) } : {}),
    ...(record(style.indentStart)
      ? {
          "padding-left": `${round(dimensionToPx(record(style.indentStart)))}px`,
        }
      : {}),
    ...(record(style.indentEnd)
      ? {
          "padding-right": `${round(dimensionToPx(record(style.indentEnd)))}px`,
        }
      : {}),
    ...(record(style.indentFirstLine)
      ? {
          "text-indent": `${round(dimensionToPx(record(style.indentFirstLine)))}px`,
        }
      : {}),
    ...(text(style.direction) === "RIGHT_TO_LEFT"
      ? { direction: "rtl" }
      : text(style.direction) === "LEFT_TO_RIGHT"
        ? { direction: "ltr" }
        : {}),
    ...(record(style.spaceAbove)
      ? { "padding-top": `${round(dimensionToPx(record(style.spaceAbove)))}px` }
      : {}),
    ...(record(style.spaceBelow)
      ? {
          "padding-bottom": `${round(dimensionToPx(record(style.spaceBelow)))}px`,
        }
      : {}),
  });
}

function paragraphAlignment(value: string): string {
  switch (value) {
    case "JUSTIFIED":
    case "DISTRIBUTED":
      return "justify";
    case "CENTER":
      return "center";
    case "END":
      return "end";
    case "START":
    default:
      return "start";
  }
}

function shapeGeometryCss(shapeType: string): string {
  switch (shapeType) {
    case "ELLIPSE":
      return "border-radius:50%";
    case "ROUND_RECTANGLE":
      return "border-radius:12%";
    case "DIAMOND":
      return "clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%)";
    case "TRIANGLE":
      return "clip-path:polygon(50% 0,100% 100%,0 100%)";
    case "PARALLELOGRAM":
      return "clip-path:polygon(20% 0,100% 0,80% 100%,0 100%)";
    case "HEXAGON":
      return "clip-path:polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%)";
    default:
      return "";
  }
}

function resolveThemeColors(
  ...pages: Array<JsonObject | undefined>
): Map<string, string> {
  const result = new Map<string, string>();
  for (const page of pages) {
    const properties = record(page?.pageProperties);
    const scheme = record(properties?.colorScheme);
    for (const value of array(scheme?.colors)) {
      const entry = record(value);
      const type = text(entry?.type);
      const color = record(entry?.color);
      if (type && color) result.set(type, opaqueColor(color, result));
    }
  }
  return result;
}

function opaqueColor(value: unknown, theme: Map<string, string>): string {
  const color = record(value);
  const rgb =
    record(color?.rgbColor) ??
    (color &&
    [color.red, color.green, color.blue].some(
      (channel) => typeof channel === "number",
    )
      ? color
      : null);
  if (rgb) {
    const channels = [rgb.red, rgb.green, rgb.blue].map((channel) =>
      Math.round(clamp(number(channel) ?? 0, 0, 1) * 255),
    );
    return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  }
  return theme.get(text(color?.themeColor) ?? "") ?? "#000000";
}

function imageFilterCss(properties: JsonObject | null): Record<string, string> {
  if (!properties) return {};
  const filters: string[] = [];
  const brightness = number(properties.brightness);
  const contrast = number(properties.contrast);
  if (brightness !== undefined) {
    filters.push(`brightness(${round(Math.max(0, 1 + brightness))})`);
  }
  if (contrast !== undefined) {
    filters.push(`contrast(${round(Math.max(0, 1 + contrast))})`);
  }
  return filters.length ? { filter: filters.join(" ") } : {};
}

function imageApproximationReasons(image: JsonObject): string[] {
  const properties = record(image.imageProperties);
  const reasons: string[] = [];
  if (record(properties?.recolor)) {
    reasons.push("Image recolor is not representable by the safe CSS subset.");
  }
  if (record(properties?.shadow)) {
    reasons.push("Image shadow is omitted from editable HTML.");
  }
  if (
    record(properties?.outline) &&
    (text(record(properties?.outline)?.dashStyle) ?? "SOLID") !== "SOLID"
  ) {
    reasons.push("Image outline dash spacing is approximated by CSS.");
  }
  if (
    number(properties?.brightness) !== undefined ||
    number(properties?.contrast) !== undefined
  ) {
    reasons.push(
      "Image brightness and contrast use CSS filter approximations.",
    );
  }
  return reasons;
}

function tableApproximationReasons(table: JsonObject): string[] {
  const reasons: string[] = [];
  if (
    array(table.horizontalBorderRows).length > 0 ||
    array(table.verticalBorderRows).length > 0
  ) {
    reasons.push(
      "Table border grids are preserved as editable cells with simplified borders.",
    );
  }
  return reasons;
}

function shapeApproximationReasons(
  shapeType: string,
  shape: JsonObject,
  inherited: JsonObject[],
): string[] {
  const reasons: string[] = [];
  if (APPROXIMATED_SHAPES.has(shapeType)) {
    reasons.push(`${shapeType} uses an editable CSS geometry approximation.`);
  }
  const properties = resolvedShapeProperties(inherited, shape);
  if (record(properties.shadow)) {
    reasons.push("Shape shadow is omitted from editable HTML.");
  }
  if (
    record(properties.outline) &&
    (text(record(properties.outline)?.dashStyle) ?? "SOLID") !== "SOLID"
  ) {
    reasons.push("Shape outline dash spacing is approximated by CSS.");
  }
  const autofit = record(properties.autofit);
  if (autofit && (text(autofit.autofitType) ?? "NONE") !== "NONE") {
    reasons.push("Google Slides text autofit is approximated by clipping.");
  }
  if (record(properties.link) || containsTextLink(record(shape.text))) {
    reasons.push(
      "Interactive links are intentionally omitted from imported code.",
    );
  }
  return reasons;
}

function resolvedShapeProperties(
  inherited: JsonObject[],
  shape: JsonObject,
): JsonObject {
  return deepMerge(
    {},
    ...[
      ...inherited.map(
        (entry) => record(record(entry.shape)?.shapeProperties) ?? {},
      ),
      record(shape.shapeProperties) ?? {},
    ].map(omitInheritedProperties),
  );
}

function omitInheritedProperties(value: JsonObject): JsonObject {
  const output: JsonObject = {};
  for (const [key, child] of Object.entries(value)) {
    const childRecord = record(child);
    if (childRecord?.propertyState === "INHERIT") continue;
    output[key] = childRecord ? omitInheritedProperties(childRecord) : child;
  }
  return output;
}

function containsTextLink(textObject: JsonObject | null): boolean {
  return array(textObject?.textElements).some((value) => {
    const entry = record(value);
    const run = record(entry?.textRun) ?? record(entry?.autoText);
    return Boolean(record(record(run?.style)?.link));
  });
}

function markFidelity(
  state: CompileState,
  bucket: FidelityBucket,
  element: JsonObject,
  reasons: string[],
): void {
  state.fidelity[bucket].count += 1;
  if (bucket === "exact") return;
  state.fidelity[bucket].reasons.push({
    nodeId: text(element.objectId) ?? "unknown",
    nodeName:
      text(element.title) ?? text(element.objectId) ?? "Unnamed element",
    nodeType: elementType(element),
    reasons,
  });
}

function elementType(element: JsonObject): string {
  return (
    [
      "wordArt",
      "sheetsChart",
      "video",
      "image",
      "table",
      "elementGroup",
      "shape",
      "line",
    ].find((key) => record(element[key])) ?? "unknown"
  );
}

function emptyFidelityReport(): NativeCreativeArtifactFidelityReport {
  return {
    exact: { count: 0 },
    approximated: { count: 0, reasons: [] },
    imageFallback: { count: 0, reasons: [] },
  };
}

function lexicalIndexText(html: string, plainText: string): string {
  const tokens = new Set<string>();
  for (const match of html.matchAll(
    /#[0-9a-f]{6}\b|font-family:[^;\"]+|class="([^"]+)"/gi,
  )) {
    const value = (match[1] ?? match[0]).trim();
    for (const token of value.split(/\s+/))
      if (token) tokens.add(token.slice(0, 100));
    if (tokens.size >= 200) break;
  }
  return [plainText.slice(0, 20_000), [...tokens].join(" ")]
    .filter(Boolean)
    .join("\n")
    .slice(0, 24_000);
}

function assetRefsFromHtml(html: string): string[] {
  return [
    ...new Set(
      [...html.matchAll(/\s(?:src|href)="([^"]+)"/gi)]
        .map((match) => match[1] ?? "")
        .filter(Boolean)
        .map((value) => value.replace(/&amp;/g, "&")),
    ),
  ].sort();
}

function mergeElement(...elements: Array<JsonObject | undefined>): JsonObject {
  return deepMerge(
    {},
    ...elements.filter((value): value is JsonObject => Boolean(value)),
  );
}

function pageElementMap(value: unknown): Map<string, JsonObject> {
  const result = new Map<string, JsonObject>();
  for (const valueEntry of array(value)) {
    const entry = record(valueEntry);
    const id = text(entry?.objectId);
    if (entry && id) result.set(id, entry);
  }
  return result;
}

function placeholderMap(
  elements: Map<string, JsonObject>,
): Map<string, JsonObject> {
  const result = new Map<string, JsonObject>();
  for (const element of elements.values()) {
    const placeholder = elementPlaceholder(element);
    const type = text(placeholder?.type);
    if (type) result.set(`${type}:${number(placeholder?.index) ?? 0}`, element);
  }
  return result;
}

function resolvePlaceholder(
  placeholder: JsonObject | null,
  elements: Map<string, JsonObject>,
  placeholders: Map<string, JsonObject>,
): JsonObject | undefined {
  if (!placeholder) return undefined;
  const parentObjectId = text(placeholder.parentObjectId);
  if (parentObjectId && elements.has(parentObjectId))
    return elements.get(parentObjectId);
  const type = text(placeholder.type);
  return type
    ? placeholders.get(`${type}:${number(placeholder.index) ?? 0}`)
    : undefined;
}

function elementPlaceholder(
  element: JsonObject | undefined,
): JsonObject | null {
  return record(record(element?.shape)?.placeholder);
}

function objectMap(value: unknown): Map<string, JsonObject> {
  const result = new Map<string, JsonObject>();
  for (const entryValue of array(value)) {
    const entry = record(entryValue);
    const id = text(entry?.objectId);
    if (entry && id) result.set(id, entry);
  }
  return result;
}

function dimensionToPx(value: JsonObject | null): number {
  if (!value) return 0;
  const magnitude = number(value.magnitude) ?? 0;
  switch ((text(value.unit) ?? "EMU").toUpperCase()) {
    case "PT":
      return (magnitude * 96) / 72;
    case "PX":
      return magnitude;
    case "EMU":
    default:
      return (magnitude * 96) / 914_400;
  }
}

function deepMerge(target: JsonObject, ...sources: JsonObject[]): JsonObject {
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      const child = record(value);
      target[key] = child
        ? deepMerge({ ...(record(target[key]) ?? {}) }, child)
        : Array.isArray(value)
          ? value
          : value;
    }
  }
  return target;
}

function css(values: Record<string, string>): string {
  return Object.entries(values)
    .filter(([, value]) => value !== "")
    .map(([key, value]) => `${key}:${value}`)
    .join(";");
}

function safeFont(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const safe = value
    .replace(/[^A-Za-z0-9 _-]/g, "")
    .trim()
    .slice(0, 100);
  return safe ? `'${safe}'` : undefined;
}

function safeSourceUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeTextRun(value: string): string {
  return value.split("\u000b").map(escapeHtml).join("<br>");
}

const escapeAttr = escapeHtml;

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function record(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function rawText(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

const SUPPORTED_SHAPES = new Set([
  "RECT",
  "TEXT_BOX",
  "ELLIPSE",
  "ROUND_RECTANGLE",
  "DIAMOND",
  "TRIANGLE",
  "PARALLELOGRAM",
  "HEXAGON",
]);

const APPROXIMATED_SHAPES = new Set([
  "DIAMOND",
  "TRIANGLE",
  "PARALLELOGRAM",
  "HEXAGON",
]);
