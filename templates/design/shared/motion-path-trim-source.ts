import { parse } from "parse5";
import type * as TypeScript from "typescript";

import { ts } from "./motion-typescript-runtime";

export const MOTION_PATH_TRIM_PATH_LENGTH_ATTRIBUTE =
  "data-agent-native-motion-path-length";

const NODE_ID_ATTRIBUTE = "data-agent-native-node-id";
const PATH_LENGTH_ATTRIBUTE = "pathLength";
const NORMALIZED_PATH_LENGTH = "100";

export type MotionPathTrimSourceFormat = "html" | "tsx";

export type MotionPathTrimSourceErrorCode =
  | "malformed-source"
  | "target-missing"
  | "target-ambiguous"
  | "unsupported-target"
  | "malformed-marker"
  | "stale-marker";

export class MotionPathTrimSourceError extends Error {
  constructor(
    readonly code: MotionPathTrimSourceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MotionPathTrimSourceError";
  }
}

type HtmlNode = {
  nodeName?: string;
  tagName?: string;
  namespaceURI?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: HtmlNode[];
  sourceCodeLocation?: {
    startTag?: {
      startOffset: number;
      endOffset: number;
      attrs?: Record<string, { startOffset: number; endOffset: number }>;
    };
  };
};

type SourceEdit = { start: number; end: number; text: string };

function sourceError(
  code: MotionPathTrimSourceErrorCode,
  message: string,
): never {
  throw new MotionPathTrimSourceError(code, message);
}

function applyEdits(source: string, edits: SourceEdit[]): string {
  const ordered = [...edits].sort(
    (left, right) => right.start - left.start || right.end - left.end,
  );
  let previousStart = source.length + 1;
  let result = source;
  for (const edit of ordered) {
    if (
      edit.start < 0 ||
      edit.end < edit.start ||
      edit.end > source.length ||
      edit.end > previousStart
    ) {
      sourceError(
        "malformed-source",
        "Motion Path source changes overlap or fall outside the source file.",
      );
    }
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
    previousStart = edit.start;
  }
  return result;
}

function encodeMarker(value: string): string {
  return encodeURIComponent(value);
}

function decodeMarker(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return sourceError(
      "malformed-marker",
      "Motion Path source contains an invalid pathLength marker.",
    );
  }
}

function htmlMarkerFor(attribute: string | null): string {
  return attribute === null
    ? "v1:html:absent"
    : `v1:html:attribute:${encodeMarker(attribute)}`;
}

function readHtmlMarker(value: string): string | null {
  if (value === "v1:html:absent") return null;
  const prefix = "v1:html:attribute:";
  if (!value.startsWith(prefix)) {
    return sourceError(
      "malformed-marker",
      "Motion Path source contains an unsupported pathLength marker.",
    );
  }
  const attribute = decodeMarker(value.slice(prefix.length));
  if (
    !/^pathlength\s*=\s*(?:"[^"<>]*"|'[^'<>]*'|[^\s"'=<>`]+)$/i.test(attribute)
  ) {
    return sourceError(
      "malformed-marker",
      "Motion Path source contains an invalid authored pathLength attribute.",
    );
  }
  return attribute;
}

function jsxMarkerFor(attribute: string | null): string {
  return attribute === null
    ? "v1:tsx:absent"
    : `v1:tsx:attribute:${encodeMarker(attribute)}`;
}

function readJsxMarker(value: string): string | null {
  if (value === "v1:tsx:absent") return null;
  const prefix = "v1:tsx:attribute:";
  if (!value.startsWith(prefix)) {
    return sourceError(
      "malformed-marker",
      "Motion Path source contains an unsupported pathLength marker.",
    );
  }
  const attribute = decodeMarker(value.slice(prefix.length));
  if (!isSafeStaticPathLengthAttribute(attribute)) {
    return sourceError(
      "malformed-marker",
      "Motion Path source contains an invalid authored pathLength attribute.",
    );
  }
  return attribute;
}

function isSafeStaticPathLengthAttribute(attribute: string): boolean {
  const sourceFile = ts.createSourceFile(
    "motion-path-length.tsx",
    `const MotionPath = () => <path ${attribute} />;`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let valid = false;
  const visit = (node: TypeScript.Node) => {
    if (
      ts.isJsxSelfClosingElement(node) &&
      node.tagName.getText(sourceFile) === "path"
    ) {
      const attributes = node.attributes.properties.filter(
        (property): property is TypeScript.JsxAttribute =>
          ts.isJsxAttribute(property) &&
          property.name.getText(sourceFile) === PATH_LENGTH_ATTRIBUTE,
      );
      const hasOtherProperties = node.attributes.properties.some(
        (property) =>
          !ts.isJsxAttribute(property) ||
          property.name.getText(sourceFile) !== PATH_LENGTH_ATTRIBUTE,
      );
      valid =
        attributes.length === 1 &&
        !hasOtherProperties &&
        isStaticJsxPathLength(attributes[0]!);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return valid;
}

function isStaticJsxPathLength(attribute: TypeScript.JsxAttribute): boolean {
  const initializer = attribute.initializer;
  if (!initializer) return false;
  if (ts.isStringLiteral(initializer)) return true;
  if (!ts.isJsxExpression(initializer) || !initializer.expression) return false;
  return (
    ts.isNumericLiteral(initializer.expression) ||
    ts.isStringLiteral(initializer.expression)
  );
}

function applyHtmlPathTrimSource(
  source: string,
  activeTargetNodeIds: ReadonlySet<string>,
): string {
  const document = parse(source, {
    sourceCodeLocationInfo: true,
  }) as unknown as HtmlNode;
  const allNodes: HtmlNode[] = [];
  const visit = (node: HtmlNode) => {
    allNodes.push(node);
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(document);

  const edits: SourceEdit[] = [];
  const activePaths = new Map<string, HtmlNode>();
  for (const node of allNodes) {
    const nodeIdAttrs = (node.attrs ?? []).filter(
      (attribute) => attribute.name.toLowerCase() === NODE_ID_ATTRIBUTE,
    );
    const nodeId = nodeIdAttrs.length === 1 ? nodeIdAttrs[0]!.value : null;
    if (nodeId && activeTargetNodeIds.has(nodeId)) {
      if (
        node.tagName?.toLowerCase() !== "path" ||
        node.namespaceURI !== "http://www.w3.org/2000/svg"
      ) {
        sourceError(
          "unsupported-target",
          `Motion Path trim target "${nodeId}" must be an SVG path element.`,
        );
      }
      if (activePaths.has(nodeId)) {
        sourceError(
          "target-ambiguous",
          `Motion Path trim target "${nodeId}" is ambiguous in the source file.`,
        );
      }
      activePaths.set(nodeId, node);
    }
  }
  for (const targetNodeId of activeTargetNodeIds) {
    if (!activePaths.has(targetNodeId)) {
      sourceError(
        "target-missing",
        `Motion Path trim target "${targetNodeId}" is missing from the source file.`,
      );
    }
  }

  for (const node of allNodes) {
    const attrs = node.attrs ?? [];
    const markerAttrs = attrs.filter(
      (attribute) =>
        attribute.name.toLowerCase() === MOTION_PATH_TRIM_PATH_LENGTH_ATTRIBUTE,
    );
    const pathLengthAttrs = attrs.filter(
      (attribute) => attribute.name.toLowerCase() === "pathlength",
    );
    const nodeId = attrs.find(
      (attribute) => attribute.name.toLowerCase() === NODE_ID_ATTRIBUTE,
    )?.value;
    const active = nodeId !== undefined && activeTargetNodeIds.has(nodeId);
    if (node.tagName?.toLowerCase() !== "path" && markerAttrs.length === 0) {
      continue;
    }
    const location = node.sourceCodeLocation?.startTag;
    if (!location) {
      if (active || markerAttrs.length > 0) {
        sourceError(
          "malformed-source",
          "Motion Path trim cannot edit a path without a static source tag.",
        );
      }
      continue;
    }
    if (markerAttrs.length > 1 || pathLengthAttrs.length > 1) {
      sourceError(
        "malformed-marker",
        "Motion Path source contains duplicate managed pathLength attributes.",
      );
    }
    const marker = markerAttrs[0];
    const pathLength = pathLengthAttrs[0];
    const markerLocation =
      location.attrs?.[MOTION_PATH_TRIM_PATH_LENGTH_ATTRIBUTE];
    const pathLengthLocation = location.attrs?.pathlength;

    if (marker) {
      if (!markerLocation || !pathLength || !pathLengthLocation) {
        sourceError(
          "malformed-marker",
          "Motion Path source has a pathLength marker without its managed pathLength attribute.",
        );
      }
      if (pathLength.value !== NORMALIZED_PATH_LENGTH) {
        sourceError(
          "stale-marker",
          "An authored pathLength changed while Motion Path trim was active.",
        );
      }
      if (active) continue;
      const priorAttribute = readHtmlMarker(marker.value);
      if (priorAttribute === null) {
        edits.push({
          start: removeLeadingInsertedSpace(
            source,
            pathLengthLocation.startOffset,
          ),
          end: pathLengthLocation.endOffset,
          text: "",
        });
      } else {
        edits.push({
          start: pathLengthLocation.startOffset,
          end: pathLengthLocation.endOffset,
          text: priorAttribute,
        });
      }
      edits.push({
        start: removeLeadingInsertedSpace(source, markerLocation.startOffset),
        end: markerLocation.endOffset,
        text: "",
      });
      continue;
    }

    if (!active) continue;
    if (!location.attrs) {
      sourceError(
        "malformed-source",
        "Motion Path trim cannot edit a path with unlocated attributes.",
      );
    }
    const priorAttribute = pathLengthLocation
      ? source.slice(
          pathLengthLocation.startOffset,
          pathLengthLocation.endOffset,
        )
      : null;
    const tagEnd = findHtmlTagAttributeInsertionPoint(source, location);
    if (pathLengthLocation) {
      edits.push({
        start: pathLengthLocation.startOffset,
        end: pathLengthLocation.endOffset,
        text: `pathLength="${NORMALIZED_PATH_LENGTH}"`,
      });
      edits.push({
        start: tagEnd,
        end: tagEnd,
        text: ` ${MOTION_PATH_TRIM_PATH_LENGTH_ATTRIBUTE}="${htmlMarkerFor(priorAttribute)}"`,
      });
    } else {
      edits.push({
        start: tagEnd,
        end: tagEnd,
        text: ` pathLength="${NORMALIZED_PATH_LENGTH}" ${MOTION_PATH_TRIM_PATH_LENGTH_ATTRIBUTE}="${htmlMarkerFor(priorAttribute)}"`,
      });
    }
  }

  return applyEdits(source, edits);
}

function findHtmlTagAttributeInsertionPoint(
  source: string,
  location: NonNullable<
    NonNullable<HtmlNode["sourceCodeLocation"]>["startTag"]
  >,
): number {
  const tag = source.slice(location.startOffset, location.endOffset);
  const closing = tag.lastIndexOf(">");
  if (closing === -1) {
    return sourceError(
      "malformed-source",
      "Motion Path trim found an incomplete SVG path tag.",
    );
  }
  let offset = location.startOffset + closing;
  while (offset > location.startOffset && /\s/.test(source[offset - 1]!)) {
    offset--;
  }
  if (source[offset - 1] === "/") offset--;
  return offset;
}

function removeLeadingInsertedSpace(
  source: string,
  attributeStart: number,
): number {
  return source[attributeStart - 1] === " "
    ? attributeStart - 1
    : attributeStart;
}

type JsxPathNode = {
  node: TypeScript.JsxOpeningElement | TypeScript.JsxSelfClosingElement;
  tagName: string;
  nodeId: string | null;
  pathLength: TypeScript.JsxAttribute | null;
  marker: TypeScript.JsxAttribute | null;
  spreads: TypeScript.JsxSpreadAttribute[];
};

function applyTsxPathTrimSource(
  source: string,
  activeTargetNodeIds: ReadonlySet<string>,
): string {
  const sourceFile = ts.createSourceFile(
    "motion-path-trim.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const parseDiagnostics = (
    sourceFile as TypeScript.SourceFile & {
      parseDiagnostics: readonly TypeScript.Diagnostic[];
    }
  ).parseDiagnostics;
  if (parseDiagnostics.length > 0) {
    sourceError(
      "malformed-source",
      "Motion Path trim requires parseable TSX source.",
    );
  }
  const paths: JsxPathNode[] = [];
  const visit = (node: TypeScript.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const jsxAttributes = node.attributes.properties.filter(
        (property): property is TypeScript.JsxAttribute =>
          ts.isJsxAttribute(property),
      );
      const named = (name: string) =>
        jsxAttributes.filter(
          (attribute) => attribute.name.getText(sourceFile) === name,
        );
      const markerAttrs = named(MOTION_PATH_TRIM_PATH_LENGTH_ATTRIBUTE);
      const tagName = node.tagName.getText(sourceFile);
      if (tagName === "path" || markerAttrs.length > 0) {
        const nodeIdAttrs = named(NODE_ID_ATTRIBUTE);
        const pathLengthAttrs = named(PATH_LENGTH_ATTRIBUTE);
        const nodeId =
          nodeIdAttrs.length === 1
            ? readStaticJsxString(nodeIdAttrs[0]!, sourceFile)
            : null;
        paths.push({
          node,
          tagName,
          nodeId,
          pathLength: pathLengthAttrs[0] ?? null,
          marker: markerAttrs[0] ?? null,
          spreads: node.attributes.properties.filter(ts.isJsxSpreadAttribute),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const activePaths = new Map<string, JsxPathNode>();
  for (const path of paths) {
    if (!path.nodeId || !activeTargetNodeIds.has(path.nodeId)) continue;
    if (path.tagName !== "path") {
      sourceError(
        "unsupported-target",
        `Motion Path trim target "${path.nodeId}" must be a <path> element.`,
      );
    }
    if (path.nodeId && activePaths.has(path.nodeId)) {
      sourceError(
        "target-ambiguous",
        `Motion Path trim target "${path.nodeId}" is ambiguous in the source file.`,
      );
    }
    if (!hasSvgJsxAncestor(path.node)) {
      sourceError(
        "unsupported-target",
        `Motion Path trim target "${path.nodeId}" must be inside an SVG element.`,
      );
    }
    activePaths.set(path.nodeId, path);
  }
  for (const targetNodeId of activeTargetNodeIds) {
    if (!activePaths.has(targetNodeId)) {
      sourceError(
        "target-missing",
        `Motion Path trim target "${targetNodeId}" must be a static <path> element.`,
      );
    }
  }

  const edits: SourceEdit[] = [];
  for (const path of paths) {
    const active = path.nodeId !== null && activeTargetNodeIds.has(path.nodeId);
    const attributes = path.node.attributes.properties;
    const pathLengthAttrs = attributes.filter(
      (property): property is TypeScript.JsxAttribute =>
        ts.isJsxAttribute(property) &&
        property.name.getText(sourceFile) === PATH_LENGTH_ATTRIBUTE,
    );
    const markerAttrs = attributes.filter(
      (property): property is TypeScript.JsxAttribute =>
        ts.isJsxAttribute(property) &&
        property.name.getText(sourceFile) ===
          MOTION_PATH_TRIM_PATH_LENGTH_ATTRIBUTE,
    );
    if (pathLengthAttrs.length > 1 || markerAttrs.length > 1) {
      sourceError(
        "malformed-marker",
        "Motion Path source contains duplicate managed pathLength attributes.",
      );
    }
    const marker = markerAttrs[0] ?? null;
    const pathLength = pathLengthAttrs[0] ?? null;
    if (marker && !pathLength) {
      sourceError(
        "malformed-marker",
        "Motion Path source has a pathLength marker without its managed pathLength attribute.",
      );
    }
    if (marker && pathLength) {
      const markerValue = readStaticJsxString(marker, sourceFile);
      if (markerValue === null || !isNormalizedJsxPathLength(pathLength)) {
        sourceError(
          "stale-marker",
          "An authored pathLength changed while Motion Path trim was active.",
        );
      }
      if (active && path.spreads.length > 0) {
        sourceError(
          "unsupported-target",
          `Motion Path trim target "${path.nodeId}" cannot use JSX spread attributes because they may override pathLength.`,
        );
      }
      if (active) continue;
      const priorAttribute = readJsxMarker(markerValue);
      if (priorAttribute === null) {
        edits.push(removeJsxAttributeEdit(pathLength, sourceFile));
      } else {
        edits.push({
          start: pathLength.getStart(sourceFile),
          end: pathLength.end,
          text: priorAttribute,
        });
      }
      edits.push(removeJsxAttributeEdit(marker, sourceFile));
      continue;
    }
    if (marker || (!active && !marker)) continue;
    if (path.spreads.length > 0) {
      sourceError(
        "unsupported-target",
        `Motion Path trim target "${path.nodeId}" cannot use JSX spread attributes because they may override pathLength.`,
      );
    }
    if (pathLength && !isStaticJsxPathLength(pathLength)) {
      sourceError(
        "unsupported-target",
        `Motion Path trim target "${path.nodeId}" must use a static pathLength value.`,
      );
    }
    const markerValue = jsxMarkerFor(
      pathLength ? pathLength.getText(sourceFile) : null,
    );
    if (pathLength) {
      edits.push({
        start: pathLength.getStart(sourceFile),
        end: pathLength.end,
        text: "pathLength={100}",
      });
      const insertion = jsxAttributeInsertionPoint(path.node, sourceFile);
      edits.push({
        start: insertion,
        end: insertion,
        text: ` ${MOTION_PATH_TRIM_PATH_LENGTH_ATTRIBUTE}=${JSON.stringify(markerValue)}`,
      });
    } else {
      const insertion = jsxAttributeInsertionPoint(path.node, sourceFile);
      edits.push({
        start: insertion,
        end: insertion,
        text: ` pathLength={100} ${MOTION_PATH_TRIM_PATH_LENGTH_ATTRIBUTE}=${JSON.stringify(markerValue)}`,
      });
    }
  }

  return applyEdits(source, edits);
}

function jsxAttributeInsertionPoint(
  node: TypeScript.JsxOpeningElement | TypeScript.JsxSelfClosingElement,
  sourceFile: TypeScript.SourceFile,
): number {
  const end = node.end;
  const text = sourceFile.text;
  if (text[end - 1] !== ">") {
    return sourceError(
      "malformed-source",
      "Motion Path trim found an incomplete JSX path element.",
    );
  }
  return text[end - 2] === "/" ? end - 2 : end - 1;
}

function hasSvgJsxAncestor(
  node: TypeScript.JsxOpeningElement | TypeScript.JsxSelfClosingElement,
): boolean {
  let current: TypeScript.Node | undefined = node.parent;
  while (current) {
    if (
      ts.isJsxElement(current) &&
      current.openingElement.tagName.getText() === "svg"
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function removeJsxAttributeEdit(
  attribute: TypeScript.JsxAttribute,
  sourceFile: TypeScript.SourceFile,
): SourceEdit {
  let start = attribute.getStart(sourceFile);
  if (sourceFile.text[start - 1] === " ") start--;
  return { start, end: attribute.end, text: "" };
}

function readStaticJsxString(
  attribute: TypeScript.JsxAttribute,
  sourceFile: TypeScript.SourceFile,
): string | null {
  const initializer = attribute.initializer;
  if (initializer && ts.isStringLiteral(initializer)) return initializer.text;
  if (
    initializer &&
    ts.isJsxExpression(initializer) &&
    initializer.expression &&
    ts.isStringLiteral(initializer.expression)
  ) {
    return initializer.expression.text;
  }
  return null;
}

function isNormalizedJsxPathLength(
  attribute: TypeScript.JsxAttribute,
): boolean {
  const initializer = attribute.initializer;
  return (
    initializer !== undefined &&
    ts.isJsxExpression(initializer) &&
    initializer.expression !== undefined &&
    ts.isNumericLiteral(initializer.expression) &&
    initializer.expression.text === NORMALIZED_PATH_LENGTH
  );
}

export function applyMotionPathTrimSource(
  source: string,
  activeTargetNodeIds: readonly string[],
  format: MotionPathTrimSourceFormat,
): string {
  const targets = new Set(activeTargetNodeIds);
  return format === "tsx"
    ? applyTsxPathTrimSource(source, targets)
    : applyHtmlPathTrimSource(source, targets);
}

export function restoreMotionPathTrimSource(
  source: string,
  format: MotionPathTrimSourceFormat,
): string {
  return format === "tsx"
    ? applyTsxPathTrimSource(source, new Set())
    : applyHtmlPathTrimSource(source, new Set());
}
