import { randomUUID } from "node:crypto";

import { defineAction } from "@agent-native/core";
import type { ActionRunContext } from "@agent-native/core/action";
import * as t from "@babel/types";
import { z } from "zod";

import {
  findJsxAncestors,
  parseSource,
  walkJsx,
} from "../server/lib/slide-source-editing/babel-walk.js";
import {
  planEdit,
  type Splice,
} from "../server/lib/slide-source-editing/edit-ops.js";
import { appStateKey } from "../shared/app-state-tabs.js";
import {
  deleteSourceElement,
  duplicateSourceElement,
  insertSourceObject,
  type SourceSelection,
} from "../shared/slide-object-structure.js";
import { slideSourceFailure } from "./_slide-source.js";
import {
  getCurrentRequestBrowserTabId,
  readAppStateForCurrentTab,
} from "./_tab-state.js";
import getSlideSource from "./get-slide-source.js";
import updateSlideSource from "./update-slide-source.js";

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;
const MIN_OBJECT_SIZE = 24;
const MAX_TARGETS = 64;
const MAX_RENDERED_SLIDE_INSTANCES_PER_SOURCE_LOCATOR = 8_000;

const sourceLocatorSchema = z.object({
  line: z
    .number()
    .int()
    .min(1)
    .describe("1-based JSX source line from view-screen"),
  column: z
    .number()
    .int()
    .min(0)
    .describe("0-based JSX source column from view-screen"),
});

const selectedTargetsSchema = z
  .array(sourceLocatorSchema)
  .min(1)
  .max(MAX_TARGETS)
  .describe(
    "Source locators for selected canvas objects that share one JSX parent",
  );

const boundsSchema = z.object({
  x: z.number().min(-10000).max(10000).describe("Canvas left in 1920x1080 px"),
  y: z.number().min(-10000).max(10000).describe("Canvas top in 1920x1080 px"),
  width: z
    .number()
    .min(MIN_OBJECT_SIZE)
    .max(10000)
    .describe("Target width in px"),
  height: z
    .number()
    .min(MIN_OBJECT_SIZE)
    .max(10000)
    .describe("Target height in px"),
});

const insertionGeometrySchema = z.object({
  left: z
    .number()
    .finite()
    .min(-10000)
    .max(10000)
    .optional()
    .describe("Canvas left in pixels"),
  top: z
    .number()
    .finite()
    .min(-10000)
    .max(10000)
    .optional()
    .describe("Canvas top in pixels"),
  width: z
    .number()
    .finite()
    .min(-10000)
    .max(10000)
    .optional()
    .describe("Canvas width in pixels; negative values normalize leftward"),
  height: z
    .number()
    .finite()
    .min(-10000)
    .max(10000)
    .optional()
    .describe("Canvas height in pixels; negative values normalize upward"),
});

export const slideObjectTransformOperationSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("move"),
    targets: selectedTargetsSchema,
    dx: z
      .number()
      .min(-10000)
      .max(10000)
      .describe("Horizontal movement in canvas px"),
    dy: z
      .number()
      .min(-10000)
      .max(10000)
      .describe("Vertical movement in canvas px"),
  }),
  z.object({
    op: z.literal("resize"),
    targets: selectedTargetsSchema,
    bounds: boundsSchema.describe(
      "Desired selection bounds on the 1920x1080 canvas",
    ),
    preserveAspectRatio: z
      .boolean()
      .default(false)
      .describe(
        "Fit the resized selection inside bounds while preserving its proportions",
      ),
  }),
  z.object({
    op: z.literal("rotate"),
    targets: selectedTargetsSchema,
    deltaDegrees: z
      .number()
      .min(-3600)
      .max(3600)
      .describe("Rotation delta in degrees around the selection center"),
  }),
  z.object({
    op: z.literal("align"),
    targets: selectedTargetsSchema,
    alignment: z
      .enum(["left", "center", "right", "top", "middle", "bottom"])
      .describe("Edge or center to align"),
    reference: z
      .enum(["selection", "slide"])
      .default("selection")
      .describe("Align within the selection bounds or the full slide canvas"),
  }),
  z.object({
    op: z.literal("distribute"),
    targets: selectedTargetsSchema,
    axis: z
      .enum(["horizontal", "vertical"])
      .describe("Spread three or more objects with equal gaps on this axis"),
  }),
  z.object({
    op: z.literal("group"),
    targets: selectedTargetsSchema
      .min(2)
      .describe("Two or more selected sibling objects to group"),
  }),
  z.object({
    op: z.literal("ungroup"),
    target: sourceLocatorSchema.describe(
      "Source locator for the selected group",
    ),
  }),
  z.object({
    op: z.literal("z-order"),
    targets: selectedTargetsSchema,
    target: z
      .enum(["forward", "backward", "front", "back"])
      .describe(
        "Move the selected objects within their same-parent absolute layers",
      ),
  }),
  z
    .object({
      op: z.literal("insert"),
      kind: z
        .enum(["text", "rectangle", "ellipse", "line"])
        .describe("Object to insert into the slide canvas"),
      geometry: insertionGeometrySchema
        .optional()
        .describe(
          "Optional canvas bounds in 1920x1080 px; omitted values use the editor's default for this object kind",
        ),
      text: z
        .string()
        .max(10_000)
        .optional()
        .describe("Text content for a text object; defaults to Text"),
    })
    .superRefine(({ kind, text }, context) => {
      if (kind !== "text" && text !== undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["text"],
          message: "Only text objects accept text content",
        });
      }
    }),
  z.object({
    op: z.literal("duplicate"),
    target: sourceLocatorSchema.describe(
      "Exact source locator for one selected JSX object from current view-screen",
    ),
  }),
  z.object({
    op: z.literal("delete"),
    target: sourceLocatorSchema.describe(
      "Exact source locator for one selected JSX object from current view-screen",
    ),
  }),
]);

export type SlideObjectTransformOperation = z.infer<
  typeof slideObjectTransformOperationSchema
>;

type SourceLocator = z.infer<typeof sourceLocatorSchema>;
type Geometry = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  rotationKey: "rotate" | "transform";
};
type StaticStyleEntry = { value: unknown; isStatic: boolean };
type SourceStyle = Map<string, StaticStyleEntry>;

export type SlideObjectTransformPlan =
  | {
      mode: "edits";
      edits: Array<{
        line: number;
        column: number;
        ops: Array<{
          kind: "set-style";
          key: string;
          value: string;
        }>;
      }>;
      targetCount: number;
    }
  | {
      mode: "source";
      sourceTsx: string;
      targetCount: number;
      createdObjectId?: string;
      createdLocator?: SourceSelection;
    };

function transformFailure(
  message: string,
  details?: Record<string, unknown>,
): never {
  throw slideSourceFailure(
    message,
    422,
    "slide_transform_unsupported",
    details,
  );
}

function sourceConflict(
  message: string,
  details?: Record<string, unknown>,
): never {
  throw slideSourceFailure(message, 409, "slide_source_conflict", details);
}

async function requireCurrentVisualSelection(
  deckId: string,
  slideId: string,
  expectedRevision: number,
  expectedSourceHash: string,
  target: SourceLocator,
): Promise<void> {
  if (!getCurrentRequestBrowserTabId()) {
    throw slideSourceFailure(
      "Duplicate and delete require a current visual selection in the request tab. Reselect the object in the editor and retry.",
      409,
      "slide_transform_selection_required",
    );
  }

  const selection = await readAppStateForCurrentTab(
    appStateKey("slides-selection"),
    { fallbackToGlobal: false },
  );
  const items = Array.isArray(selection?.items)
    ? selection.items.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null && !Array.isArray(item),
      )
    : [];
  const selectedTargets = items.filter(
    (item) =>
      item.sourceLine === target.line && item.sourceColumn === target.column,
  );

  if (
    selection?.deckId !== deckId ||
    selection.slideId !== slideId ||
    selection.sourceRevision !== expectedRevision ||
    selection.sourceHash !== expectedSourceHash ||
    items.length !== 1 ||
    selectedTargets.length !== 1
  ) {
    throw slideSourceFailure(
      "Duplicate and delete require a currently selected source object on the same deck, slide, revision, and source hash. Reselect the object and retry.",
      409,
      "slide_transform_selection_required",
    );
  }

  const selected = selectedTargets[0]!;
  const instanceIndex = selected.instanceIndex;
  const instanceCount = selected.instanceCount;
  if (
    typeof instanceIndex !== "number" ||
    !Number.isSafeInteger(instanceIndex) ||
    typeof instanceCount !== "number" ||
    !Number.isSafeInteger(instanceCount) ||
    instanceIndex < 0 ||
    instanceCount < 1 ||
    instanceCount > MAX_RENDERED_SLIDE_INSTANCES_PER_SOURCE_LOCATOR ||
    instanceIndex >= instanceCount
  ) {
    throw slideSourceFailure(
      "Duplicate and delete require fresh rendered-instance metadata from the editor. Reselect the object and call view-screen again.",
      409,
      "slide_transform_selection_required",
    );
  }
  if (instanceCount !== 1 || instanceIndex !== 0) {
    throw slideSourceFailure(
      `The selected JSX source callsite renders ${instanceCount} visible instances. Duplicate and delete cannot target one rendered copy safely; select an object whose source callsite renders once.`,
      409,
      "slide_transform_selection_required",
    );
  }
}

function readStaticExpression(
  node: t.Node | null | undefined,
): StaticStyleEntry {
  if (!node) return { value: undefined, isStatic: false };
  if (t.isNullLiteral(node)) return { value: null, isStatic: true };
  if (
    t.isStringLiteral(node) ||
    t.isNumericLiteral(node) ||
    t.isBooleanLiteral(node)
  ) {
    return { value: node.value, isStatic: true };
  }
  if (
    t.isUnaryExpression(node) &&
    node.operator === "-" &&
    t.isNumericLiteral(node.argument)
  ) {
    return { value: -node.argument.value, isStatic: true };
  }
  if (t.isTemplateLiteral(node) && node.expressions.length === 0) {
    return {
      value: node.quasis.map((quasi) => quasi.value.cooked ?? "").join(""),
      isStatic: true,
    };
  }
  return { value: undefined, isStatic: false };
}

function jsxAttribute(
  element: t.JSXElement,
  name: string,
): t.JSXAttribute | null {
  for (const attr of element.openingElement.attributes) {
    if (
      t.isJSXAttribute(attr) &&
      t.isJSXIdentifier(attr.name) &&
      attr.name.name === name
    ) {
      return attr;
    }
  }
  return null;
}

function readAttributeString(
  element: t.JSXElement,
  name: string,
): string | null {
  const value = jsxAttribute(element, name)?.value;
  if (t.isStringLiteral(value)) return value.value;
  if (
    t.isJSXExpressionContainer(value) &&
    t.isStringLiteral(value.expression)
  ) {
    return value.expression.value;
  }
  return null;
}

function requireStableObjectId(element: t.JSXElement): void {
  const objectId = readAttributeString(element, "data-slide-object-id");
  if (!objectId?.trim()) {
    transformFailure(
      "Grouping and z-order require every canvas object to have a static data-slide-object-id.",
      { line: element.loc?.start.line, column: element.loc?.start.column },
    );
  }
}

function readSourceStyle(element: t.JSXElement): SourceStyle {
  const attr = jsxAttribute(element, "style");
  const value = attr?.value;
  if (!value || !t.isJSXExpressionContainer(value)) {
    transformFailure(
      "The selected JSX element needs a static inline style object for canvas transforms.",
      { line: element.loc?.start.line, column: element.loc?.start.column },
    );
  }
  if (!t.isObjectExpression(value.expression)) {
    transformFailure(
      "The selected JSX style is computed at runtime and its geometry cannot be verified.",
      { line: element.loc?.start.line, column: element.loc?.start.column },
    );
  }

  const style: SourceStyle = new Map();
  for (const property of value.expression.properties) {
    if (!t.isObjectProperty(property) || property.computed) {
      transformFailure(
        "The selected JSX style contains a spread or computed property, so its geometry cannot be verified.",
        { line: element.loc?.start.line, column: element.loc?.start.column },
      );
    }
    let key: string | null = null;
    if (t.isIdentifier(property.key)) key = property.key.name;
    else if (t.isStringLiteral(property.key)) key = property.key.value;
    if (!key)
      transformFailure(
        "The selected JSX style has an unsupported property name.",
        { line: element.loc?.start.line, column: element.loc?.start.column },
      );
    style.set(key, readStaticExpression(property.value));
  }
  return style;
}

function staticStyleValue(style: SourceStyle, key: string): unknown {
  const entry = style.get(key);
  if (!entry || !entry.isStatic) {
    transformFailure(
      "The selected JSX element has dynamic or missing " + key + " geometry.",
      { key },
    );
  }
  return entry.value;
}

function cssPixel(value: unknown, key: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const match = /^(-?(?:\d+\.?\d*|\.\d+))(?:px)?$/.exec(value.trim());
    if (match && (value.trim().endsWith("px") || Number(match[1]) === 0)) {
      const number = Number(match[1]);
      if (Number.isFinite(number)) return number;
    }
  }
  return transformFailure(
    "The selected JSX element needs numeric pixel " + key + " geometry.",
    { key, value },
  );
}

function parseAngle(value: unknown, key: string): number {
  if (typeof value === "number" && value === 0) return 0;
  if (typeof value !== "string") {
    return transformFailure("The selected JSX rotation is not static.", {
      key,
    });
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed === "none" || trimmed === "0") return 0;
  const match = /^(-?(?:\d+\.?\d*|\.\d+))(deg|grad|rad|turn)$/.exec(trimmed);
  if (!match) {
    return transformFailure(
      "Canvas transforms support only a single static rotation angle.",
      { key, value },
    );
  }
  const amount = Number(match[1]);
  if (match[2] === "deg") return amount;
  if (match[2] === "grad") return amount * 0.9;
  if (match[2] === "rad") return (amount * 180) / Math.PI;
  return amount * 360;
}

function wrapDegrees(value: number): number {
  const wrapped = ((value % 360) + 360) % 360;
  return Math.abs(wrapped) < 0.000001 || Math.abs(wrapped - 360) < 0.000001
    ? 0
    : round(wrapped);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function readRotation(style: SourceStyle): {
  rotation: number;
  rotationKey: "rotate" | "transform";
} {
  const individualRotation = style.get("rotate");
  const transform = style.get("transform");
  if (individualRotation && !individualRotation.isStatic) {
    transformFailure("The selected JSX element has a dynamic rotate style.");
  }
  if (transform && !transform.isStatic) {
    transformFailure("The selected JSX element has a dynamic transform style.");
  }

  const transformValue = transform?.value;
  const individualValue = individualRotation?.value;
  if (
    typeof transformValue === "string" &&
    transformValue.trim() !== "" &&
    transformValue.trim() !== "none"
  ) {
    const match =
      /^rotate\(\s*(-?(?:\d+\.?\d*|\.\d+))(deg|grad|rad|turn)\s*\)$/.exec(
        transformValue.trim(),
      );
    if (
      !match ||
      (individualRotation && parseAngle(individualValue, "rotate") !== 0)
    ) {
      transformFailure(
        "Canvas transforms support a single rotation without translate, scale, or skew.",
        { transform: transformValue },
      );
    }
    return {
      rotation: parseAngle(match[1] + match[2], "transform"),
      rotationKey: "transform",
    };
  }
  if (transform && typeof transformValue !== "string") {
    transformFailure("The selected JSX transform is not a supported rotation.");
  }
  if (
    transformValue !== undefined &&
    transformValue !== null &&
    transformValue !== "none" &&
    transformValue !== ""
  ) {
    transformFailure(
      "Canvas transforms support a single rotation without translate, scale, or skew.",
      { transform: transformValue },
    );
  }
  return {
    rotation: parseAngle(individualValue ?? 0, "rotate"),
    rotationKey: "rotate",
  };
}

function readGeometry(element: t.JSXElement): Geometry {
  const style = readSourceStyle(element);
  const positionEntry = style.get("position");
  if (!positionEntry) {
    transformFailure(
      "The selected JSX element is in flow layout; only absolute canvas objects can be transformed.",
    );
  }
  if (!positionEntry.isStatic) {
    transformFailure("The selected JSX element has dynamic position geometry.");
  }
  const position = positionEntry.value;
  if (position !== "absolute") {
    transformFailure(
      "The selected JSX element is in flow layout; only absolute canvas objects can be transformed.",
      { position },
    );
  }
  const x = cssPixel(staticStyleValue(style, "left"), "left");
  const y = cssPixel(staticStyleValue(style, "top"), "top");
  const width = cssPixel(staticStyleValue(style, "width"), "width");
  const height = cssPixel(staticStyleValue(style, "height"), "height");
  if (width < MIN_OBJECT_SIZE || height < MIN_OBJECT_SIZE) {
    transformFailure(
      "Canvas objects must remain at least " +
        MIN_OBJECT_SIZE +
        " px wide and high.",
      { width, height },
    );
  }
  const origin = style.get("transformOrigin");
  if (origin && !origin.isStatic) {
    transformFailure(
      "The selected JSX element has a dynamic transform origin.",
    );
  }
  if (
    origin?.value !== undefined &&
    !["center", "50%", "50% 50%", "center center"].includes(
      String(origin.value).trim(),
    )
  ) {
    transformFailure(
      "Canvas transforms require the default center transform origin.",
      { transformOrigin: origin.value },
    );
  }
  const translate = style.get("translate");
  if (translate && !translate.isStatic) {
    transformFailure("The selected JSX element has a dynamic translate style.");
  }
  if (
    translate?.value !== undefined &&
    !["none", "0", "0px", "0px 0px"].includes(String(translate.value).trim())
  ) {
    transformFailure(
      "Canvas transforms do not support a non-zero CSS translate value.",
      { translate: translate.value },
    );
  }
  const scale = style.get("scale");
  if (scale && !scale.isStatic) {
    transformFailure("The selected JSX element has a dynamic scale style.");
  }
  if (
    scale?.value !== undefined &&
    !["none", "1", "1 1", "1 1 1"].includes(String(scale.value).trim())
  ) {
    transformFailure(
      "Canvas transforms do not support a non-identity CSS scale value.",
      { scale: scale.value },
    );
  }
  const rotation = readRotation(style);
  return { x, y, width, height, ...rotation };
}

function parseSlideSource(source: string): t.File {
  const ast = parseSource(source);
  if (!ast) {
    return transformFailure(
      "Slide source could not be parsed for a canvas transform.",
    );
  }
  return ast;
}

function findSourceElement(ast: t.File, locator: SourceLocator): t.JSXElement {
  const matches: t.JSXElement[] = [];
  walkJsx(ast, (node) => {
    if (
      t.isJSXElement(node) &&
      node.loc?.start.line === locator.line &&
      node.loc.start.column === locator.column
    ) {
      matches.push(node);
    }
  });
  if (matches.length !== 1) {
    transformFailure(
      "Source locator " +
        locator.line +
        ":" +
        locator.column +
        " matched " +
        matches.length +
        " JSX elements. Refresh view-screen and get-slide-source before transforming.",
      locator,
    );
  }
  return matches[0]!;
}

function findParentJsx(
  ast: t.File,
  locator: SourceLocator,
  element: t.JSXElement,
): t.JSXElement | t.JSXFragment {
  const ancestors = findJsxAncestors(ast, locator.line, locator.column);
  if (ancestors[0] !== element || ancestors.length < 2) {
    return transformFailure(
      "The selected JSX object has no JSX sibling parent.",
      locator,
    );
  }
  return ancestors[1]!;
}

function directJsxChildren(
  parent: t.JSXElement | t.JSXFragment,
): t.JSXElement[] {
  return parent.children.filter(t.isJSXElement);
}

function requireSameParent(
  ast: t.File,
  targets: SourceLocator[],
): { elements: t.JSXElement[]; parent: t.JSXElement | t.JSXFragment } {
  const elements = targets.map((locator) => findSourceElement(ast, locator));
  if (new Set(elements).size !== elements.length) {
    transformFailure("Each canvas object locator must be unique.");
  }
  const parent = findParentJsx(ast, targets[0]!, elements[0]!);
  for (let index = 1; index < elements.length; index += 1) {
    if (findParentJsx(ast, targets[index]!, elements[index]!) !== parent) {
      transformFailure(
        "The selected objects must be direct siblings in the same JSX parent.",
      );
    }
  }
  return { elements, parent };
}

function visualBounds(geometry: Geometry) {
  const radians = (geometry.rotation * Math.PI) / 180;
  const width =
    Math.abs(Math.cos(radians)) * geometry.width +
    Math.abs(Math.sin(radians)) * geometry.height;
  const height =
    Math.abs(Math.sin(radians)) * geometry.width +
    Math.abs(Math.cos(radians)) * geometry.height;
  const centerX = geometry.x + geometry.width / 2;
  const centerY = geometry.y + geometry.height / 2;
  return {
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
  };
}

function unionBounds(geometries: Geometry[]) {
  if (geometries.length === 0) {
    return transformFailure("Select at least one canvas object.");
  }
  const bounds = geometries.map(visualBounds);
  const left = Math.min(...bounds.map((entry) => entry.x));
  const top = Math.min(...bounds.map((entry) => entry.y));
  const right = Math.max(...bounds.map((entry) => entry.x + entry.width));
  const bottom = Math.max(...bounds.map((entry) => entry.y + entry.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function formatPx(value: number): string {
  return round(value) + "px";
}

function formatRotation(value: number): string {
  return wrapDegrees(value) + "deg";
}

function readStaticZIndex(style: SourceStyle): number | null {
  const entry = style.get("zIndex");
  if (!entry) return null;
  if (!entry.isStatic) {
    transformFailure("A same-parent layer has a dynamic z-index.");
  }
  if (entry.value === null || entry.value === "auto") return null;
  const value = Number(entry.value);
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    transformFailure("Same-parent layer z-index values must be integers.");
  }
  return value;
}

type StyleUpdates = Record<string, string>;

function makeEdits(
  targets: SourceLocator[],
  updates: StyleUpdates[],
): Array<{
  line: number;
  column: number;
  ops: Array<{ kind: "set-style"; key: string; value: string }>;
}> {
  return targets.flatMap((target, index) => {
    const values = updates[index] ?? {};
    const ops = Object.entries(values).map(([key, value]) => ({
      kind: "set-style" as const,
      key,
      value,
    }));
    return ops.length
      ? [{ line: target.line, column: target.column, ops }]
      : [];
  });
}

function styleSplices(
  source: string,
  targets: SourceLocator[],
  updates: StyleUpdates[],
): Splice[] {
  const splices: Splice[] = [];
  const edits = makeEdits(targets, updates);
  for (const edit of edits) {
    const result = planEdit(source, edit.line, edit.column, edit.ops, true);
    if (!result.ok) {
      transformFailure(
        "The selected JSX style cannot be edited safely: " + result.error + ".",
        { line: edit.line, column: edit.column },
      );
    }
    splices.push(...result.splices);
  }
  return splices;
}

function applySplicesToRange(
  source: string,
  rangeStart: number,
  rangeEnd: number,
  splices: Splice[],
): string {
  const local = splices.map((splice) => ({
    from: splice.from - rangeStart,
    to: splice.to - rangeStart,
    text: splice.text,
  }));
  if (
    local.some(
      (splice) =>
        splice.from < 0 ||
        splice.to > rangeEnd - rangeStart ||
        splice.from > splice.to,
    )
  ) {
    transformFailure(
      "A source style edit crossed the structural transform range.",
    );
  }
  local.sort((left, right) => right.from - left.from);
  for (let index = 1; index < local.length; index += 1) {
    const previous = local[index - 1]!;
    const current = local[index]!;
    if (current.to > previous.from) {
      transformFailure("Canvas object source edits overlap.");
    }
  }
  let result = source.slice(rangeStart, rangeEnd);
  for (const splice of local) {
    result =
      result.slice(0, splice.from) + splice.text + result.slice(splice.to);
  }
  return result;
}

function requireContiguousSiblingRange(
  parent: t.JSXElement | t.JSXFragment,
  elements: t.JSXElement[],
): { start: number; end: number } {
  const children = parent.children;
  const indexes = elements.map((element) => children.indexOf(element));
  if (indexes.some((index) => index < 0)) {
    transformFailure("Canvas group members must be direct JSX siblings.");
  }
  const startIndex = Math.min(...indexes);
  const endIndex = Math.max(...indexes);
  const selected = new Set(elements);
  for (const child of children.slice(startIndex, endIndex + 1)) {
    if (t.isJSXElement(child) && !selected.has(child)) {
      transformFailure(
        "Grouping cannot move an unselected JSX sibling between selected objects.",
      );
    }
    if (t.isJSXText(child) && child.value.trim() === "") continue;
    if (t.isJSXElement(child) && selected.has(child)) continue;
    transformFailure(
      "Grouping requires selected objects to be adjacent, apart from whitespace.",
    );
  }
  const ordered = [...elements].sort(
    (left, right) => left.start! - right.start!,
  );
  const first = ordered[0]!;
  const last = ordered[ordered.length - 1]!;
  if (typeof first.start !== "number" || typeof last.end !== "number") {
    transformFailure("Selected JSX objects are missing source ranges.");
  }
  return { start: first.start, end: last.end };
}

function sourceSplice(
  source: string,
  start: number,
  end: number,
  replacement: string,
) {
  return source.slice(0, start) + replacement + source.slice(end);
}

function groupSource(
  source: string,
  ast: t.File,
  targets: SourceLocator[],
): SlideObjectTransformPlan {
  if (targets.length < 2) {
    transformFailure("Grouping requires at least two selected canvas objects.");
  }
  const { elements, parent } = requireSameParent(ast, targets);
  elements.forEach(requireStableObjectId);
  const range = requireContiguousSiblingRange(parent, elements);
  const geometries = elements.map(readGeometry);
  const bounds = unionBounds(geometries);
  const updates = geometries.map((geometry) => ({
    left: formatPx(geometry.x - bounds.x),
    top: formatPx(geometry.y - bounds.y),
  }));
  const splices = styleSplices(source, targets, updates);
  const inner = applySplicesToRange(source, range.start, range.end, splices);
  const groupId = randomUUID();
  const explicitZIndexes = elements
    .map((element) => readStaticZIndex(readSourceStyle(element)))
    .filter((value): value is number => value !== null);
  const zIndex =
    explicitZIndexes.length > 0
      ? ", zIndex: " + Math.max(...explicitZIndexes)
      : "";
  const replacement =
    '<div className="fmd-slide-group" data-slide-group="true" data-slide-object-id="' +
    groupId +
    '" style={{ position: "absolute", left: "' +
    formatPx(bounds.x) +
    '", top: "' +
    formatPx(bounds.y) +
    '", width: "' +
    formatPx(bounds.width) +
    '", height: "' +
    formatPx(bounds.height) +
    '", boxSizing: "border-box"' +
    zIndex +
    " }}>" +
    inner +
    "</div>";
  return {
    mode: "source",
    sourceTsx: sourceSplice(source, range.start, range.end, replacement),
    targetCount: targets.length,
    createdObjectId: groupId,
  };
}

function ungroupSource(
  source: string,
  ast: t.File,
  target: SourceLocator,
): SlideObjectTransformPlan {
  const group = findSourceElement(ast, target);
  const isGroup =
    readAttributeString(group, "data-slide-group") === "true" &&
    (readAttributeString(group, "className") ?? "")
      .split(/\s+/)
      .includes("fmd-slide-group");
  if (!isGroup || !group.closingElement) {
    transformFailure(
      "The selected source element is not a complete slide object group.",
      target,
    );
  }
  const sourceChildren = directJsxChildren(group);
  if (sourceChildren.length < 2) {
    transformFailure(
      "A slide object group must contain at least two direct objects.",
      target,
    );
  }
  sourceChildren.forEach(requireStableObjectId);
  for (const child of group.children) {
    if (t.isJSXElement(child)) continue;
    if (t.isJSXText(child) && child.value.trim() === "") continue;
    transformFailure(
      "Ungroup supports direct JSX object children only.",
      target,
    );
  }

  const groupGeometry = readGeometry(group);
  const groupZIndex = readStaticZIndex(readSourceStyle(group));
  const children = sourceChildren
    .map((element, sourceOrder) => ({
      element,
      sourceOrder,
      zIndex: readStaticZIndex(readSourceStyle(element)) ?? 0,
    }))
    .sort(
      (left, right) =>
        left.zIndex - right.zIndex || left.sourceOrder - right.sourceOrder,
    );
  const center = {
    x: groupGeometry.x + groupGeometry.width / 2,
    y: groupGeometry.y + groupGeometry.height / 2,
  };
  const groupAngle = (groupGeometry.rotation * Math.PI) / 180;
  const childrenUpdates: StyleUpdates[] = children.map(({ element }) => {
    const geometry = readGeometry(element);
    const childCenter = {
      x: groupGeometry.x + geometry.x + geometry.width / 2,
      y: groupGeometry.y + geometry.y + geometry.height / 2,
    };
    const dx = childCenter.x - center.x;
    const dy = childCenter.y - center.y;
    const worldCenter = {
      x: center.x + Math.cos(groupAngle) * dx - Math.sin(groupAngle) * dy,
      y: center.y + Math.sin(groupAngle) * dx + Math.cos(groupAngle) * dy,
    };
    const rotation = wrapDegrees(geometry.rotation + groupGeometry.rotation);
    return {
      left: formatPx(worldCenter.x - geometry.width / 2),
      top: formatPx(worldCenter.y - geometry.height / 2),
      zIndex: groupZIndex === null ? "auto" : String(groupZIndex),
      ...(geometry.rotation !== 0 || groupGeometry.rotation !== 0
        ? {
            [geometry.rotationKey]:
              geometry.rotationKey === "transform"
                ? "rotate(" + formatRotation(rotation) + ")"
                : formatRotation(rotation),
          }
        : {}),
    };
  });
  const childTargets = children.map(({ element }) => ({
    line: element.loc!.start.line,
    column: element.loc!.start.column,
  }));
  const childSplices = styleSplices(source, childTargets, childrenUpdates);
  const innerStart = group.openingElement.end;
  const innerEnd = group.closingElement.start;
  if (typeof innerStart !== "number" || typeof innerEnd !== "number") {
    transformFailure(
      "The selected slide object group is missing a source range.",
      target,
    );
  }
  const sourceOrder = [...sourceChildren].sort(
    (left, right) => left.start! - right.start!,
  );
  const firstSourceChild = sourceOrder[0]!;
  const lastSourceChild = sourceOrder[sourceOrder.length - 1]!;
  if (
    typeof firstSourceChild.start !== "number" ||
    typeof lastSourceChild.end !== "number" ||
    children.some(
      ({ element }) =>
        typeof element.start !== "number" || typeof element.end !== "number",
    )
  ) {
    transformFailure(
      "A grouped slide object is missing a source range.",
      target,
    );
  }
  const leadingWhitespace = source.slice(innerStart, firstSourceChild.start);
  const trailingWhitespace = source.slice(lastSourceChild.end, innerEnd);
  const whitespaceBefore = new Map<t.JSXElement, string>();
  for (let index = 1; index < sourceOrder.length; index += 1) {
    const previous = sourceOrder[index - 1]!;
    const current = sourceOrder[index]!;
    whitespaceBefore.set(current, source.slice(previous.end!, current.start!));
  }
  const updatedChildren = children.map(({ element }, index) => {
    const start = element.start!;
    const end = element.end!;
    const edits = childSplices.filter(
      (splice) => splice.from >= start && splice.to <= end,
    );
    const fragment = applySplicesToRange(source, start, end, edits);
    const whitespace =
      index === 0
        ? leadingWhitespace
        : (whitespaceBefore.get(element) ?? leadingWhitespace);
    return whitespace + fragment;
  });
  const inner = updatedChildren.join("") + trailingWhitespace;
  return {
    mode: "source",
    sourceTsx: sourceSplice(source, group.start!, group.end!, inner),
    targetCount: sourceChildren.length,
  };
}

function arrangeZOrder(
  ast: t.File,
  targets: SourceLocator[],
  target: "forward" | "backward" | "front" | "back",
): SlideObjectTransformPlan {
  const { elements, parent } = requireSameParent(ast, targets);
  const children = directJsxChildren(parent);
  const layers: Array<{
    element: t.JSXElement;
    zIndex: number;
    order: number;
    locator: SourceLocator;
  }> = [];
  for (const [order, element] of children.entries()) {
    if (!readAttributeString(element, "data-slide-object-id")) continue;
    const style = readSourceStyle(element);
    const position = style.get("position");
    if (!position) continue;
    if (!position.isStatic) {
      transformFailure("A same-parent layer has dynamic position styles.");
    }
    if (position.value !== "absolute") continue;
    const zIndex = readStaticZIndex(style) ?? 0;
    layers.push({
      element,
      zIndex,
      order,
      locator: {
        line: element.loc!.start.line,
        column: element.loc!.start.column,
      },
    });
  }
  const selected = new Set(elements);
  elements.forEach(requireStableObjectId);
  if (
    elements.some(
      (element) => !layers.some((layer) => layer.element === element),
    )
  ) {
    transformFailure(
      "Z-order applies only to absolute-positioned canvas objects.",
    );
  }
  if (layers.some((layer) => !layer.element.loc)) {
    transformFailure("A same-parent layer is missing its JSX source location.");
  }
  const ordered = [...layers].sort(
    (left, right) => left.zIndex - right.zIndex || left.order - right.order,
  );
  const reordered = [...ordered];
  if (target === "front" || target === "back") {
    const selectedLayers = reordered.filter((layer) =>
      selected.has(layer.element),
    );
    const unselectedLayers = reordered.filter(
      (layer) => !selected.has(layer.element),
    );
    reordered.splice(
      0,
      reordered.length,
      ...(target === "front"
        ? [...unselectedLayers, ...selectedLayers]
        : [...selectedLayers, ...unselectedLayers]),
    );
  } else {
    const step = target === "forward" ? 1 : -1;
    const selectedIndexes = reordered
      .map((layer, index) => (selected.has(layer.element) ? index : -1))
      .filter((index) => index >= 0);
    const indexes = step > 0 ? selectedIndexes.reverse() : selectedIndexes;
    for (const index of indexes) {
      const currentIndex = reordered.findIndex(
        (entry) => entry === ordered[index],
      );
      const nextIndex = currentIndex + step;
      if (
        nextIndex < 0 ||
        nextIndex >= reordered.length ||
        selected.has(reordered[nextIndex]!.element)
      ) {
        continue;
      }
      const [moved] = reordered.splice(currentIndex, 1);
      if (moved) reordered.splice(nextIndex, 0, moved);
    }
  }
  const updates = reordered.map((layer, index) => ({
    zIndex: String(index),
  }));
  const changed = reordered.some((layer, index) => layer.zIndex !== index);
  return {
    mode: "edits",
    edits: changed
      ? makeEdits(
          reordered.map((layer) => layer.locator),
          updates,
        )
      : [],
    targetCount: elements.length,
  };
}

export function planSlideObjectTransform(
  source: string,
  operation: SlideObjectTransformOperation,
): SlideObjectTransformPlan {
  if (operation.op === "insert") {
    const result = insertSourceObject(source, {
      kind: operation.kind,
      ...(operation.geometry ? { geometry: operation.geometry } : {}),
      ...(operation.text !== undefined ? { text: operation.text } : {}),
    });
    if (!result) {
      transformFailure(
        "An object could not be inserted into the default slide canvas. Refresh get-slide-source and try a supported slide component.",
      );
    }
    return {
      mode: "source",
      sourceTsx: result.sourceTsx,
      targetCount: 1,
      createdObjectId: result.createdObjectId,
      createdLocator: result.selection,
    };
  }
  if (operation.op === "duplicate") {
    const result = duplicateSourceElement(source, operation.target);
    if (!result) {
      transformFailure(
        "The selected JSX object cannot be duplicated safely. Use a current view-screen locator for a root or direct JSX child; objects with custom IDs, spreads, or unsupported nested structure are not duplicated.",
        operation.target,
      );
    }
    return {
      mode: "source",
      sourceTsx: result.sourceTsx,
      targetCount: 1,
      ...(result.createdObjectId
        ? { createdObjectId: result.createdObjectId }
        : {}),
      ...(result.selection ? { createdLocator: result.selection } : {}),
    };
  }
  if (operation.op === "delete") {
    const result = deleteSourceElement(source, operation.target);
    if (!result) {
      transformFailure(
        "The selected JSX object cannot be deleted safely. Use a current view-screen locator for a root or direct JSX child.",
        operation.target,
      );
    }
    return {
      mode: "source",
      sourceTsx: result.sourceTsx,
      targetCount: 1,
    };
  }

  const ast = parseSlideSource(source);
  if (operation.op === "group") {
    return groupSource(source, ast, operation.targets);
  }
  if (operation.op === "ungroup") {
    return ungroupSource(source, ast, operation.target);
  }
  if (operation.op === "z-order") {
    return arrangeZOrder(ast, operation.targets, operation.target);
  }

  const targets = operation.targets;
  const { elements } = requireSameParent(ast, targets);
  const geometries = elements.map(readGeometry);
  let updates: StyleUpdates[];
  switch (operation.op) {
    case "move":
      updates = geometries.map((geometry) => ({
        left: formatPx(geometry.x + operation.dx),
        top: formatPx(geometry.y + operation.dy),
      }));
      break;
    case "resize": {
      const current = unionBounds(geometries);
      let scaleX = operation.bounds.width / current.width;
      let scaleY = operation.bounds.height / current.height;
      let targetX = operation.bounds.x;
      let targetY = operation.bounds.y;
      if (operation.preserveAspectRatio) {
        const scale = Math.min(scaleX, scaleY);
        targetX += (operation.bounds.width - current.width * scale) / 2;
        targetY += (operation.bounds.height - current.height * scale) / 2;
        scaleX = scale;
        scaleY = scale;
      }
      if (
        geometries.some(
          (geometry) =>
            geometry.rotation !== 0 && Math.abs(scaleX - scaleY) > 0.000001,
        )
      ) {
        transformFailure(
          "Rotated objects can only be resized with a uniform scale.",
        );
      }
      updates = geometries.map((geometry) => {
        const width = geometry.width * scaleX;
        const height = geometry.height * scaleY;
        if (width < MIN_OBJECT_SIZE || height < MIN_OBJECT_SIZE) {
          transformFailure(
            "Resize would make an object smaller than " +
              MIN_OBJECT_SIZE +
              " px.",
          );
        }
        const centerX =
          targetX + (geometry.x + geometry.width / 2 - current.x) * scaleX;
        const centerY =
          targetY + (geometry.y + geometry.height / 2 - current.y) * scaleY;
        return {
          left: formatPx(centerX - width / 2),
          top: formatPx(centerY - height / 2),
          width: formatPx(width),
          height: formatPx(height),
        };
      });
      break;
    }
    case "rotate": {
      const bounds = unionBounds(geometries);
      const center = {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
      };
      const radians = (operation.deltaDegrees * Math.PI) / 180;
      updates = geometries.map((geometry) => {
        const objectCenter = {
          x: geometry.x + geometry.width / 2,
          y: geometry.y + geometry.height / 2,
        };
        const dx = objectCenter.x - center.x;
        const dy = objectCenter.y - center.y;
        const nextCenter = {
          x: center.x + Math.cos(radians) * dx - Math.sin(radians) * dy,
          y: center.y + Math.sin(radians) * dx + Math.cos(radians) * dy,
        };
        const rotation = wrapDegrees(
          geometry.rotation + operation.deltaDegrees,
        );
        return {
          left: formatPx(nextCenter.x - geometry.width / 2),
          top: formatPx(nextCenter.y - geometry.height / 2),
          [geometry.rotationKey]:
            geometry.rotationKey === "transform"
              ? "rotate(" + formatRotation(rotation) + ")"
              : formatRotation(rotation),
        };
      });
      break;
    }
    case "align": {
      const bounds =
        operation.reference === "slide"
          ? { x: 0, y: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT }
          : unionBounds(geometries);
      updates = geometries.map((geometry) => {
        const visual = visualBounds(geometry);
        let dx = 0;
        let dy = 0;
        if (operation.alignment === "left") dx = bounds.x - visual.x;
        if (operation.alignment === "center") {
          dx = bounds.x + (bounds.width - visual.width) / 2 - visual.x;
        }
        if (operation.alignment === "right") {
          dx = bounds.x + bounds.width - visual.width - visual.x;
        }
        if (operation.alignment === "top") dy = bounds.y - visual.y;
        if (operation.alignment === "middle") {
          dy = bounds.y + (bounds.height - visual.height) / 2 - visual.y;
        }
        if (operation.alignment === "bottom") {
          dy = bounds.y + bounds.height - visual.height - visual.y;
        }
        return {
          ...(dx !== 0 ? { left: formatPx(geometry.x + dx) } : {}),
          ...(dy !== 0 ? { top: formatPx(geometry.y + dy) } : {}),
        };
      });
      break;
    }
    case "distribute": {
      if (geometries.length < 3) {
        transformFailure(
          "Distribution requires at least three selected objects.",
        );
      }
      const horizontal = operation.axis === "horizontal";
      const axis = horizontal ? "x" : "y";
      const size = horizontal ? "width" : "height";
      const visual = geometries.map(visualBounds);
      const ordered = geometries
        .map((geometry, index) => ({ geometry, visual: visual[index]!, index }))
        .sort(
          (left, right) =>
            left.visual[axis] - right.visual[axis] || left.index - right.index,
        );
      const start = Math.min(...visual.map((box) => box[axis]));
      const end = Math.max(...visual.map((box) => box[axis] + box[size]));
      const occupied = visual.reduce((sum, box) => sum + box[size], 0);
      const gap = (end - start - occupied) / (geometries.length - 1);
      let cursor = start;
      updates = geometries.map(() => ({}));
      for (const entry of ordered) {
        const visualOffset = entry.visual[axis] - entry.geometry[axis];
        updates[entry.index] = horizontal
          ? { left: formatPx(cursor - visualOffset) }
          : { top: formatPx(cursor - visualOffset) };
        cursor += entry.visual[size] + gap;
      }
      break;
    }
  }
  return {
    mode: "edits",
    edits: makeEdits(targets, updates),
    targetCount: targets.length,
  };
}

export default defineAction({
  title: "Transform slide objects",
  description:
    "Insert text or basic shapes, duplicate or delete one selected JSX object, or move, resize, rotate, align, distribute, group, ungroup, or reorder objects on a React source-backed slide. Insertion returns the new object ID and source locator; duplication returns the new locator and a remapped ID for editor-created objects. Duplicate/delete require the locator to match the current request-tab visual selection and its deck, slide, revision, source hash, and rendered-instance metadata; shared source callsites are rejected. Structural changes are source-validated and saved as one revision-checked replacement; geometric transforms keep their static absolute-pixel and same-parent requirements.",
  schema: z.object({
    deckId: z.string().min(1).describe("Deck containing the slide"),
    slideId: z.string().min(1).describe("Stable slide ID to transform"),
    expectedRevision: z
      .number()
      .int()
      .positive()
      .describe("Current slide revision returned by get-slide-source"),
    expectedSourceHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .describe("Current SHA-256 sourceHash returned by get-slide-source"),
    operation: slideObjectTransformOperationSchema.describe(
      "One atomic source-backed canvas object operation; duplicate/delete locators come from current view-screen selection",
    ),
  }),
  retrySafe: (input) => typeof input.expectedSourceHash === "string",
  http: { method: "POST" },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async (
    { deckId, slideId, expectedRevision, expectedSourceHash, operation },
    ctx?: ActionRunContext,
  ) => {
    if (operation.op === "duplicate" || operation.op === "delete") {
      await requireCurrentVisualSelection(
        deckId,
        slideId,
        expectedRevision,
        expectedSourceHash,
        operation.target,
      );
    }

    let sourceRead: {
      slide: { sourceTsx: string; revision: number; sourceHash: string };
    };
    try {
      sourceRead = (await getSlideSource.run(
        {
          deckId,
          slideId,
        },
        ctx,
      )) as typeof sourceRead;
    } catch (error) {
      if (
        (error as { errorCode?: unknown })?.errorCode === "slide_source_missing"
      ) {
        throw slideSourceFailure(
          "Canvas transforms in this action require a React source-backed slide. Legacy HTML slide transforms are not supported here.",
          409,
          "slide_transform_legacy_unsupported",
        );
      }
      throw error;
    }
    if (
      sourceRead.slide.revision !== expectedRevision ||
      sourceRead.slide.sourceHash !== expectedSourceHash
    ) {
      sourceConflict(
        "Slide source changed after it was read. Call get-slide-source and rebase the transform.",
        {
          revision: sourceRead.slide.revision,
          sourceHash: sourceRead.slide.sourceHash,
        },
      );
    }

    const plan = planSlideObjectTransform(
      sourceRead.slide.sourceTsx,
      operation,
    );
    const update = await updateSlideSource.run(
      {
        deckId,
        slideId,
        expectedRevision,
        expectedSourceHash,
        ...(plan.mode === "source"
          ? { sourceTsx: plan.sourceTsx }
          : { edits: plan.edits }),
      },
      ctx,
    );
    return {
      ...(update as Record<string, unknown>),
      operation: operation.op,
      targetCount: plan.targetCount,
      ...(plan.mode === "source" && plan.createdObjectId
        ? { createdObjectId: plan.createdObjectId }
        : {}),
      ...(plan.mode === "source" && plan.createdLocator
        ? { createdLocator: plan.createdLocator }
        : {}),
    };
  },
});
