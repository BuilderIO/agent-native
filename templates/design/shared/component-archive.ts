import { parse as parseHtml } from "parse5";
import parseCss from "postcss/lib/parse";
import { z } from "zod";

import { BOARD_FILENAME, emptyBoardHtml } from "./board-file";
import {
  buildCodeLayerProjection,
  patchCodeLayerNodeAttributes,
  removeCodeLayerNodeFromHtml,
  type CodeLayerNode,
  type CodeLayerProjection,
} from "./code-layer";
import {
  analyzeComponentLinks,
  isValidComponentReferenceSubtree,
  type ComponentSourceChange,
  type ComponentSourceDocument,
} from "./component-links";
import {
  COMPONENT_ID_ATTR,
  COMPONENT_OVERRIDES_ATTR,
  COMPONENT_REF_ATTR,
} from "./component-model";
import {
  GROUP_RUNTIME_ATTR,
  GROUP_RUNTIME_SOURCE,
  GROUP_RUNTIME_VERSION,
} from "./group-runtime";
import { LEGACY_GROUP_RUNTIME_V1_SOURCE } from "./group-runtime-legacy-v1";
import { sourceContentHash } from "./source-workspace";

const NODE_ID_ATTR = "data-agent-native-node-id";

export const COMPONENT_ARCHIVE_ATTR = "data-agent-native-component-archive";
export const COMPONENT_ARCHIVE_SCHEMA_VERSION = 1 as const;

const archivePointerSchema = z
  .object({
    schemaVersion: z.literal(COMPONENT_ARCHIVE_SCHEMA_VERSION),
    versionId: z.string().min(1),
    fileId: z.string().min(1),
    componentId: z.string().min(1),
    mainNodeId: z.string().min(1),
    sourceVersionHash: z.string().min(1),
  })
  .strict();

const archivePointerSeedSchema = archivePointerSchema
  .omit({ componentId: true })
  .extend({ componentId: z.string().min(1).optional() })
  .strict();

const deletionGeometryRectSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
  })
  .strict();

const deletionGeometryWorldBoundsSchema = z
  .object({
    left: z.number().finite(),
    top: z.number().finite(),
    right: z.number().finite(),
    bottom: z.number().finite(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
    centerX: z.number().finite(),
    centerY: z.number().finite(),
  })
  .strict()
  .refine(
    ({ left, top, right, bottom, width, height, centerX, centerY }) =>
      Math.abs(right - left - width) <= 0.01 &&
      Math.abs(bottom - top - height) <= 0.01 &&
      Math.abs(centerX - (left + right) / 2) <= 0.01 &&
      Math.abs(centerY - (top + bottom) / 2) <= 0.01,
    "world bounds are internally inconsistent",
  );

export const componentDeletionGeometrySchema = z
  .object({
    fileId: z.string().min(1),
    mainNodeId: z.string().min(1),
    sourceVersionHash: z.string().min(1),
    boundingRect: deletionGeometryRectSchema,
    worldBounds: deletionGeometryWorldBoundsSchema.optional(),
  })
  .strict();

export type ComponentArchivePointer = z.infer<typeof archivePointerSchema>;

export type ComponentArchivePointerSeed = Omit<
  ComponentArchivePointer,
  "componentId"
> & { componentId?: string };

export type ComponentDeletionGeometry = z.infer<
  typeof componentDeletionGeometrySchema
>;

export type ComponentArchivePointerRead =
  | { status: "absent" }
  | { status: "valid"; pointer: ComponentArchivePointer }
  | { status: "invalid"; reason: string };

export type ComponentArchiveFailureReason =
  | "invalid-document"
  | "invalid-archive"
  | "source-hash-mismatch"
  | "missing-main"
  | "ambiguous-main"
  | "source-mismatch"
  | "invalid-link"
  | "missing-reference"
  | "invalid-reference"
  | "archive-present"
  | "archive-invalid"
  | "missing-source-span"
  | "main-already-present"
  | "missing-archive-reference"
  | "archive-mismatch"
  | "invalid-archive-location"
  | "missing-restore-anchor"
  | "restore-slot-mismatch";

export type ComponentArchiveTransformResult =
  | {
      status: "updated";
      componentId: string;
      mainNodeId: string;
      archive: ComponentArchivePointer;
      changes: ComponentSourceChange[];
      referenceNodeIds: Array<{ fileId: string; nodeId: string }>;
      beforeVersionHash: string;
      afterVersionHash: string;
    }
  | {
      status: "refused";
      reason: ComponentArchiveFailureReason;
      message: string;
      componentId?: string;
      mainNodeId?: string;
    };

type ComponentArchiveRefusal = Extract<
  ComponentArchiveTransformResult,
  { status: "refused" }
>;

interface ProjectedDocument {
  document: ComponentSourceDocument;
  projection: CodeLayerProjection;
}

interface ComponentReference {
  fileId: string;
  nodeId: string;
}

function refusal(
  reason: ComponentArchiveFailureReason,
  message: string,
  extra: { componentId?: string; mainNodeId?: string } = {},
): ComponentArchiveRefusal {
  return { status: "refused", reason, message, ...extra };
}

function hasAttribute(node: CodeLayerNode, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(node.dataAttributes, name);
}

function identity(node: CodeLayerNode, name: string): string | null {
  const value = node.dataAttributes[name];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function pointerMatches(
  left: ComponentArchivePointer,
  right: ComponentArchivePointer,
): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.versionId === right.versionId &&
    left.fileId === right.fileId &&
    left.componentId === right.componentId &&
    left.mainNodeId === right.mainNodeId &&
    left.sourceVersionHash === right.sourceVersionHash
  );
}

export function encodeComponentArchivePointer(
  pointer: ComponentArchivePointer,
): string {
  if (!archivePointerSchema.safeParse(pointer).success) {
    throw new Error("Component archive pointer is invalid.");
  }
  return encodeURIComponent(JSON.stringify(pointer));
}

export function readComponentArchivePointer(
  raw: string | undefined,
): ComponentArchivePointerRead {
  if (raw === undefined) return { status: "absent" };
  if (!raw.trim()) return { status: "invalid", reason: "empty-pointer" };
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return { status: "invalid", reason: "malformed-encoding" };
  }
  let value: unknown;
  try {
    value = JSON.parse(decoded);
  } catch {
    return { status: "invalid", reason: "malformed-json" };
  }
  const parsed = archivePointerSchema.safeParse(value);
  return parsed.success
    ? { status: "valid", pointer: parsed.data }
    : { status: "invalid", reason: "invalid-pointer-shape" };
}

function projectDocuments(
  documents: readonly ComponentSourceDocument[],
): { status: "ready"; values: ProjectedDocument[] } | ComponentArchiveRefusal {
  const fileIds = documents.map((document) => document.source.fileId ?? "");
  if (
    fileIds.some((fileId) => !fileId) ||
    new Set(fileIds).size !== fileIds.length
  ) {
    return refusal(
      "invalid-document",
      "Component archive documents require unique source file ids.",
    );
  }
  return {
    status: "ready",
    values: documents.map((document) => ({
      document,
      projection: buildCodeLayerProjection(document.content, {
        source: document.source,
      }),
    })),
  };
}

function fileIdFor(value: ProjectedDocument): string {
  return value.document.source.fileId!;
}

function nodesWithDurableId(
  values: readonly ProjectedDocument[],
  nodeId: string,
  fileId?: string,
): Array<{ value: ProjectedDocument; node: CodeLayerNode }> {
  return values.flatMap((value) => {
    if (fileId && fileIdFor(value) !== fileId) return [];
    return value.projection.nodes
      .filter((node) => identity(node, NODE_ID_ATTR) === nodeId)
      .map((node) => ({ value, node }));
  });
}

function componentReferences(
  values: readonly ProjectedDocument[],
  componentId: string,
):
  | {
      status: "ready";
      refs: Array<{ value: ProjectedDocument; node: CodeLayerNode }>;
    }
  | ComponentArchiveRefusal {
  const analysis = analyzeComponentLinks(
    values.map(({ projection }) => projection),
  );
  if (
    analysis.invalidNodes.some(
      ({ node }) =>
        identity(node, COMPONENT_ID_ATTR) === componentId ||
        identity(node, COMPONENT_REF_ATTR) === componentId,
    )
  ) {
    return refusal("invalid-link", "The component identity graph is invalid.", {
      componentId,
    });
  }
  const resolution = analysis.components.find(
    (entry) => entry.componentId === componentId,
  );
  if (!resolution) {
    return refusal("missing-main", "The component identity is missing.", {
      componentId,
    });
  }
  if (resolution.status === "ambiguous-main") {
    return refusal(
      "ambiguous-main",
      "The component has more than one canonical main.",
      {
        componentId,
      },
    );
  }
  if (resolution.status === "missing-main") {
    return refusal("missing-main", "The component has no canonical main.", {
      componentId,
    });
  }
  if (resolution.status === "source-mismatch") {
    return refusal(
      "source-mismatch",
      "The component main and instances are not in one authorized design source scope.",
      { componentId },
    );
  }
  const refs = resolution.references.map((node) => {
    const value = values.find(({ projection }) =>
      projection.nodes.includes(node),
    );
    return value ? { value, node } : null;
  });
  if (refs.some((ref) => ref === null)) {
    return refusal(
      "invalid-reference",
      "A linked instance source document is missing.",
      {
        componentId,
      },
    );
  }
  const seen = new Set<string>();
  for (const ref of refs) {
    if (!ref) continue;
    const nodeId = identity(ref.node, NODE_ID_ATTR);
    const key = `${fileIdFor(ref.value)}:${nodeId ?? ""}`;
    if (!nodeId || seen.has(key)) {
      return refusal(
        "invalid-reference",
        "Every linked instance root must have a unique durable node id.",
        { componentId },
      );
    }
    seen.add(key);
    if (
      !isValidComponentReferenceSubtree({
        documents: values.map(({ document }) => document),
        componentId,
        referenceFileId: fileIdFor(ref.value),
        referenceNodeId: nodeId,
      })
    ) {
      return refusal(
        "invalid-reference",
        "A linked instance subtree is incomplete or has invalid identity metadata.",
        { componentId },
      );
    }
  }
  return {
    status: "ready",
    refs: refs as Array<{ value: ProjectedDocument; node: CodeLayerNode }>,
  };
}

function changesFor(
  documents: readonly ComponentSourceDocument[],
  contents: ReadonlyMap<string, string>,
): ComponentSourceChange[] {
  return documents.flatMap((document) => {
    const fileId = document.source.fileId!;
    const after = contents.get(fileId);
    return after === undefined || after === document.content
      ? []
      : [{ fileId, source: document.source, before: document.content, after }];
  });
}

function exactNodeByDurableId(
  values: readonly ProjectedDocument[],
  fileId: string,
  nodeId: string,
): { value: ProjectedDocument; node: CodeLayerNode } | null {
  const matches = nodesWithDurableId(values, nodeId, fileId);
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

function mainForTarget(
  values: readonly ProjectedDocument[],
  target: { fileId: string; nodeId: string },
  archive: ComponentArchivePointerSeed,
):
  | {
      main: CodeLayerNode;
      value: ProjectedDocument;
      componentId: string;
      refs: Array<{ value: ProjectedDocument; node: CodeLayerNode }>;
      pointer: ComponentArchivePointer;
    }
  | ComponentArchiveRefusal {
  if (!archivePointerSeedSchema.safeParse(archive).success) {
    return refusal(
      "invalid-archive",
      "The component archive pointer seed is invalid.",
    );
  }
  const targetMain = exactNodeByDurableId(values, target.fileId, target.nodeId);
  if (!targetMain) {
    return refusal(
      "missing-main",
      "The canonical component main was not found.",
      {
        mainNodeId: target.nodeId,
      },
    );
  }
  const canonicalMains = nodesWithDurableId(values, target.nodeId).filter(
    ({ node }) => hasAttribute(node, COMPONENT_ID_ATTR),
  );
  if (canonicalMains.length === 0) {
    return refusal(
      "missing-main",
      "The selected node is not a canonical component main.",
      {
        mainNodeId: target.nodeId,
      },
    );
  }
  if (canonicalMains.length !== 1) {
    return refusal(
      "ambiguous-main",
      "The canonical component main durable id is ambiguous.",
      {
        mainNodeId: target.nodeId,
      },
    );
  }
  const canonical = canonicalMains[0]!;
  if (
    hasAttribute(canonical.node, COMPONENT_REF_ATTR) ||
    canonical.value !== targetMain.value ||
    canonical.node !== targetMain.node
  ) {
    return refusal(
      "invalid-link",
      "The selected node is not the unique canonical main.",
      {
        mainNodeId: target.nodeId,
      },
    );
  }
  const componentId = identity(canonical.node, COMPONENT_ID_ATTR);
  if (!componentId) {
    return refusal("invalid-link", "The canonical component id is empty.", {
      mainNodeId: target.nodeId,
    });
  }
  const fail = (
    reason: ComponentArchiveFailureReason,
    message: string,
  ): ComponentArchiveRefusal =>
    refusal(reason, message, { componentId, mainNodeId: target.nodeId });
  if (archive.componentId && archive.componentId !== componentId) {
    return fail(
      "archive-mismatch",
      "The archive component id does not match the canonical main.",
    );
  }
  if (
    archive.fileId !== target.fileId ||
    archive.mainNodeId !== target.nodeId ||
    archive.sourceVersionHash !==
      sourceContentHash(canonical.value.document.content)
  ) {
    return fail(
      "source-hash-mismatch",
      "The archive preimage does not match the live canonical source file.",
    );
  }
  const references = componentReferences(values, componentId);
  if (references.status !== "ready") {
    return fail(references.reason, references.message);
  }
  for (const reference of references.refs) {
    const archiveRead = readComponentArchivePointer(
      reference.node.dataAttributes[COMPONENT_ARCHIVE_ATTR],
    );
    if (archiveRead.status === "invalid") {
      return fail(
        "archive-invalid",
        "A linked instance already carries an invalid archive pointer.",
      );
    }
    if (archiveRead.status === "valid") {
      return fail(
        "archive-present",
        "A linked instance already carries a component archive pointer.",
      );
    }
  }
  return {
    main: canonical.node,
    value: canonical.value,
    componentId,
    refs: references.refs,
    pointer: {
      schemaVersion: COMPONENT_ARCHIVE_SCHEMA_VERSION,
      versionId: archive.versionId,
      fileId: archive.fileId,
      componentId,
      mainNodeId: archive.mainNodeId,
      sourceVersionHash: archive.sourceVersionHash,
    },
  };
}

function finalReferenceNode(
  values: readonly ProjectedDocument[],
  reference: ComponentReference,
): CodeLayerNode | null {
  return (
    exactNodeByDurableId(values, reference.fileId, reference.nodeId)?.node ??
    null
  );
}

function validateFinalReferences(
  values: readonly ProjectedDocument[],
  refs: readonly ComponentReference[],
  pointer: ComponentArchivePointer | null,
  expectedOverrides: ReadonlyMap<string, string | undefined>,
): ComponentArchiveRefusal | null {
  for (const ref of refs) {
    const node = finalReferenceNode(values, ref);
    if (!node) {
      return refusal(
        "invalid-reference",
        "A linked instance disappeared during the archive transform.",
      );
    }
    const archiveRead = readComponentArchivePointer(
      node.dataAttributes[COMPONENT_ARCHIVE_ATTR],
    );
    if (pointer) {
      if (
        archiveRead.status !== "valid" ||
        !pointerMatches(archiveRead.pointer, pointer)
      ) {
        return refusal(
          "archive-mismatch",
          "A linked instance archive pointer was not preserved.",
        );
      }
    } else if (archiveRead.status !== "absent") {
      return refusal(
        "archive-mismatch",
        "A linked instance archive pointer was not cleared.",
      );
    }
    const expected = expectedOverrides.get(`${ref.fileId}:${ref.nodeId}`);
    if (node.dataAttributes[COMPONENT_OVERRIDES_ATTR] !== expected) {
      return refusal(
        "invalid-reference",
        "The component archive transform changed instance override metadata.",
      );
    }
  }
  return null;
}

export function deleteComponentMain(args: {
  documents: readonly ComponentSourceDocument[];
  target: { fileId: string; nodeId: string };
  archive: ComponentArchivePointerSeed;
}): ComponentArchiveTransformResult {
  const prepared = projectDocuments(args.documents);
  if (prepared.status !== "ready") return prepared;
  const selected = mainForTarget(prepared.values, args.target, args.archive);
  if ("status" in selected) return selected;
  const fail = (
    reason: ComponentArchiveFailureReason,
    message: string,
  ): ComponentArchiveRefusal =>
    refusal(reason, message, {
      componentId: selected.componentId,
      mainNodeId: args.target.nodeId,
    });

  const removed = removeCodeLayerNodeFromHtml(
    selected.value.document.content,
    selected.main,
  );
  if (removed === null) {
    return fail(
      "missing-source-span",
      "The canonical component main has no removable source span.",
    );
  }
  const initialOverrides = new Map<string, string | undefined>();
  const references: ComponentReference[] = selected.refs.map((reference) => {
    const nodeId = identity(reference.node, NODE_ID_ATTR)!;
    const fileId = fileIdFor(reference.value);
    initialOverrides.set(
      `${fileId}:${nodeId}`,
      reference.node.dataAttributes[COMPONENT_OVERRIDES_ATTR],
    );
    return { fileId, nodeId };
  });
  const afterRemoval = args.documents.map((document) =>
    document.source.fileId === args.target.fileId
      ? { ...document, content: removed }
      : document,
  );
  const projectedAfterRemoval = projectDocuments(afterRemoval);
  if (projectedAfterRemoval.status !== "ready") return projectedAfterRemoval;
  if (
    nodesWithDurableId(projectedAfterRemoval.values, args.target.nodeId)
      .length > 0
  ) {
    return fail(
      "invalid-link",
      "The canonical component main survived its source-span removal.",
    );
  }

  const updatesByFile = new Map<
    string,
    Array<{ node: CodeLayerNode; attributes: Record<string, string | null> }>
  >();
  for (const reference of references) {
    const node = finalReferenceNode(projectedAfterRemoval.values, reference);
    if (!node) {
      return fail(
        "invalid-reference",
        "A linked instance was removed with the canonical main.",
      );
    }
    const entries = updatesByFile.get(reference.fileId) ?? [];
    entries.push({
      node,
      attributes: {
        [COMPONENT_ARCHIVE_ATTR]: encodeComponentArchivePointer(
          selected.pointer,
        ),
      },
    });
    updatesByFile.set(reference.fileId, entries);
  }
  const stampedContents = new Map<string, string>();
  for (const [fileId, updates] of updatesByFile) {
    const value = projectedAfterRemoval.values.find(
      (candidate) => fileIdFor(candidate) === fileId,
    );
    if (!value) {
      return fail(
        "invalid-reference",
        "A linked instance source file is missing.",
      );
    }
    const content = patchCodeLayerNodeAttributes(
      value.document.content,
      updates,
    );
    if (content === null) {
      return fail(
        "missing-source-span",
        "A linked instance archive attribute has no source span.",
      );
    }
    stampedContents.set(fileId, content);
  }
  const finalDocuments = afterRemoval.map((document) => ({
    ...document,
    content: stampedContents.get(document.source.fileId!) ?? document.content,
  }));
  const finalProjection = projectDocuments(finalDocuments);
  if (finalProjection.status !== "ready") return finalProjection;
  const finalReferenceValidation = validateFinalReferences(
    finalProjection.values,
    references,
    selected.pointer,
    initialOverrides,
  );
  if (finalReferenceValidation) {
    return fail(
      finalReferenceValidation.reason,
      finalReferenceValidation.message,
    );
  }
  if (
    nodesWithDurableId(finalProjection.values, args.target.nodeId).length > 0
  ) {
    return fail(
      "invalid-link",
      "The canonical component main reappeared during archive stamping.",
    );
  }
  const contents = new Map(
    finalDocuments.map((document) => [
      document.source.fileId!,
      document.content,
    ]),
  );
  const changes = changesFor(args.documents, contents);
  const targetAfter = contents.get(args.target.fileId);
  if (!targetAfter || changes.length === 0) {
    return fail(
      "invalid-link",
      "The component archive transform made no source change.",
    );
  }
  return {
    status: "updated",
    componentId: selected.componentId,
    mainNodeId: args.target.nodeId,
    archive: selected.pointer,
    changes,
    referenceNodeIds: references,
    beforeVersionHash: sourceContentHash(selected.value.document.content),
    afterVersionHash: sourceContentHash(targetAfter),
  };
}

function resolveAppendOffset(parent: CodeLayerNode): number | null {
  return parent.source?.contentEnd ?? null;
}

function rootRestoreParent(value: ProjectedDocument): CodeLayerNode | null {
  const bodyNodes = value.projection.nodes.filter(
    (node) => node.tag.toLowerCase() === "body",
  );
  if (bodyNodes.length === 1) return bodyNodes[0]!;
  const rootNodes = value.projection.nodes.filter((node) => !node.parentId);
  return rootNodes.length === 1 ? rootNodes[0]! : null;
}

function normalizedCssValue(value: string | undefined): string {
  return (
    value
      ?.replace(/\s*!important\s*$/i, "")
      .trim()
      .toLowerCase() ?? ""
  );
}

interface HtmlRawTextNode {
  nodeName: string;
  value?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: HtmlRawTextNode[];
}

interface ManagedRawTextBlock {
  tag: "script" | "style";
  attributes: Record<string, string>;
  content: string;
  parentTag: string | undefined;
}

function managedRawTextBlocks(content: string): ManagedRawTextBlock[] {
  const blocks: ManagedRawTextBlock[] = [];
  const visit = (node: HtmlRawTextNode, parentTag?: string): void => {
    if (node.nodeName === "template") return;
    if (node.nodeName === "style" || node.nodeName === "script") {
      blocks.push({
        tag: node.nodeName,
        attributes: Object.fromEntries(
          (node.attrs ?? []).map((attribute) => [
            attribute.name.toLowerCase(),
            attribute.value,
          ]),
        ),
        content: (node.childNodes ?? [])
          .map((child) => child.value ?? "")
          .join(""),
        parentTag,
      });
      return;
    }
    for (const child of node.childNodes ?? []) visit(child, node.nodeName);
  };
  visit(parseHtml(content) as unknown as HtmlRawTextNode);
  return blocks;
}

function stylesheetSignature(content: string): string | null {
  try {
    return parseCss(content, { map: false })
      .toString()
      .replace(/\s+/g, "")
      .toLowerCase();
  } catch {
    // coercion-ok: callers treat null as a typed refusal and fail closed on invalid CSS.
    return null;
  }
}

function hasHeadStylesheetLink(content: string): boolean {
  let found = false;
  const visit = (node: HtmlRawTextNode, parentTag?: string): void => {
    if (found || node.nodeName === "template") return;
    if (node.nodeName === "link" && parentTag === "head") {
      const rel = (node.attrs ?? []).find(
        (attribute) => attribute.name.toLowerCase() === "rel",
      )?.value;
      found =
        rel
          ?.split(/\s+/)
          .some((value) => value.toLowerCase() === "stylesheet") ?? false;
      return;
    }
    for (const child of node.childNodes ?? []) visit(child, node.nodeName);
  };
  visit(parseHtml(content) as unknown as HtmlRawTextNode);
  return found;
}

function hasCanonicalBoardShellCss(content: string): boolean {
  if (hasHeadStylesheetLink(content)) return false;
  const expectedStyles = managedRawTextBlocks(emptyBoardHtml()).filter(
    (block) =>
      block.tag === "style" &&
      block.parentTag === "head" &&
      Object.keys(block.attributes).length === 0,
  );
  const actualBlocks = managedRawTextBlocks(content);
  const actualStyles = actualBlocks.filter(
    (block) =>
      block.tag === "style" &&
      block.parentTag === "head" &&
      Object.keys(block.attributes).length === 0,
  );
  if (
    expectedStyles.length !== 1 ||
    actualStyles.length !== 1 ||
    stylesheetSignature(actualStyles[0]!.content) !==
      stylesheetSignature(expectedStyles[0]!.content)
  ) {
    return false;
  }
  return actualBlocks.every((block) => {
    if (block.tag === "style") {
      return (
        block.parentTag === "head" && Object.keys(block.attributes).length === 0
      );
    }
    if (
      block.parentTag === "body" &&
      block.attributes[GROUP_RUNTIME_ATTR] === ""
    ) {
      const runtimeVersion = block.attributes["data-runtime-version"];
      const expectedRuntimeSource =
        runtimeVersion === GROUP_RUNTIME_VERSION
          ? GROUP_RUNTIME_SOURCE
          : runtimeVersion === "1"
            ? LEGACY_GROUP_RUNTIME_V1_SOURCE
            : null;
      return (
        Object.keys(block.attributes).length === 2 &&
        expectedRuntimeSource !== null &&
        block.content.trim() === expectedRuntimeSource.trim()
      );
    }
    return false;
  });
}

function hasOnlyBoardShellAttributes(
  node: CodeLayerNode,
  allowed: ReadonlySet<string>,
): boolean {
  return Object.entries(node.attributes).every(([name, value]) => {
    return (
      allowed.has(name) &&
      (name !== NODE_ID_ATTR ||
        (typeof value === "string" && value.trim().length > 0))
    );
  });
}

function isZeroCssValue(value: string): boolean {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => /^0(?:[a-z%]+)?$/i.test(token));
}

function hasUnsupportedTransformValue(node: CodeLayerNode): boolean {
  const transform = normalizedCssValue(node.style.transform);
  const attributeTransform = normalizedCssValue(
    typeof node.attributes.transform === "string"
      ? node.attributes.transform
      : undefined,
  );
  const rotate = normalizedCssValue(node.style.rotate);
  const scale = normalizedCssValue(node.style.scale);
  const translate = normalizedCssValue(node.style.translate);
  const zoom = normalizedCssValue(node.style.zoom);
  if (
    (transform && transform !== "none") ||
    (attributeTransform && attributeTransform !== "none")
  ) {
    return true;
  }
  if (
    rotate &&
    rotate !== "none" &&
    !/^[+-]?0(?:\.0+)?(?:deg|rad|turn|grad)?$/i.test(rotate)
  ) {
    return true;
  }
  if (scale && scale !== "none") {
    const scaleValues = scale.split(/\s+/);
    if (
      scaleValues.length === 0 ||
      scaleValues.length > 2 ||
      scaleValues.some((value) => Number(value) !== 1)
    ) {
      return true;
    }
  }
  if (translate && translate !== "none" && !isZeroCssValue(translate)) {
    return true;
  }
  if (zoom && zoom !== "normal" && zoom !== "100%" && Number(zoom) !== 1) {
    return true;
  }
  return node.classes.some((className) => {
    const parts = className.split(":");
    const utility = (parts[parts.length - 1] ?? className).replace(/^!/, "");
    return /^(?:-?(?:rotate|scale|skew|translate)(?:-[xy])?-.+|transform-(?:gpu|cpu)|-?zoom-.+)$/.test(
      utility,
    );
  });
}

function hasUnsupportedTransformAncestry(
  projection: CodeLayerProjection,
  node: CodeLayerNode,
): boolean {
  const nodesById = new Map(
    projection.nodes.map((candidate) => [candidate.id, candidate]),
  );
  const visited = new Set<string>();
  let current: CodeLayerNode | undefined = node;
  while (current && !visited.has(current.id)) {
    if (hasUnsupportedTransformValue(current)) return true;
    visited.add(current.id);
    current = current.parentId ? nodesById.get(current.parentId) : undefined;
  }
  return false;
}

/**
 * The fallback coordinates are world coordinates, not arbitrary document
 * coordinates. Keep the supported root to the generated board shell, whose
 * body has a fixed zero-margin, zero-padding, zero-border origin.
 *
 * ponytail: screen roots stay refused until deletion geometry carries the
 * current containing-block origin and can be rebased against it.
 */
function isCanonicalBoardRestoreRoot(
  value: ProjectedDocument,
  root: CodeLayerNode,
): boolean {
  if (
    value.document.source.filename !== BOARD_FILENAME ||
    root.tag.toLowerCase() !== "body" ||
    !hasOnlyBoardShellAttributes(root, new Set([NODE_ID_ATTR]))
  ) {
    return false;
  }
  const parent = root.parentId
    ? value.projection.nodes.find((node) => node.id === root.parentId)
    : undefined;
  if (
    !parent ||
    parent.tag.toLowerCase() !== "html" ||
    parent.parentId !== undefined ||
    !hasOnlyBoardShellAttributes(parent, new Set(["lang", NODE_ID_ATTR]))
  ) {
    return false;
  }
  return hasCanonicalBoardShellCss(value.document.content);
}

function positionedArchivedMarkup(args: {
  main: CodeLayerNode;
  markup: string;
  bounds: { left: number; top: number; width: number; height: number };
}): string | null {
  const source = args.main.source;
  if (!source) return null;
  const layoutStyle =
    `position:absolute!important;inset:auto!important;right:auto!important;bottom:auto!important;` +
    `left:${args.bounds.left}px!important;top:${args.bounds.top}px!important;` +
    `width:${args.bounds.width}px!important;height:${args.bounds.height}px!important;` +
    `box-sizing:border-box!important;margin:0!important;` +
    `min-width:0!important;max-width:none!important;min-height:0!important;max-height:none!important;`;
  const fragmentMain = {
    ...args.main,
    source: {
      start: 0,
      end: source.end - source.start,
      openStart: source.openStart - source.start,
      openEnd: source.openEnd - source.start,
    },
  };
  const existingStyle =
    typeof args.main.attributes.style === "string"
      ? args.main.attributes.style.trim().replace(/;\s*$/, "")
      : "";
  return patchCodeLayerNodeAttributes(args.markup, [
    {
      node: fragmentMain,
      attributes: {
        style: `${existingStyle ? `${existingStyle};` : ""}${layoutStyle}`,
      },
    },
  ]);
}

function archiveAttributeRange(
  openTag: string,
): { start: number; end: number } | null {
  const nameStart = openTag.indexOf(COMPONENT_ARCHIVE_ATTR);
  if (nameStart <= 0 || !/\s/.test(openTag[nameStart - 1]!)) return null;
  let cursor = nameStart + COMPONENT_ARCHIVE_ATTR.length;
  while (/\s/.test(openTag[cursor] ?? "")) cursor += 1;
  if (openTag[cursor] === "=") {
    cursor += 1;
    while (/\s/.test(openTag[cursor] ?? "")) cursor += 1;
    const quote = openTag[cursor];
    if (quote === '"' || quote === "'") {
      cursor += 1;
      const close = openTag.indexOf(quote, cursor);
      if (close < 0) return null;
      cursor = close + 1;
    } else {
      while (cursor < openTag.length && !/[\s>]/.test(openTag[cursor]!)) {
        cursor += 1;
      }
    }
  }
  return { start: nameStart - 1, end: cursor };
}

function clearArchiveAttributes(
  content: string,
  nodes: readonly CodeLayerNode[],
): string | null {
  const replacements: Array<{ start: number; end: number }> = [];
  for (const node of nodes) {
    const span = node.source;
    if (!span) return null;
    const range = archiveAttributeRange(
      content.slice(span.openStart, span.openEnd),
    );
    if (!range) return null;
    replacements.push({
      start: span.openStart + range.start,
      end: span.openStart + range.end,
    });
  }
  let result = content;
  for (const replacement of replacements.sort(
    (left, right) => right.start - left.start,
  )) {
    result = `${result.slice(0, replacement.start)}${result.slice(replacement.end)}`;
  }
  return result;
}

export function restoreComponentMain(args: {
  documents: readonly ComponentSourceDocument[];
  archived: ComponentSourceDocument;
  archive: ComponentArchivePointer;
  deletionGeometry?: ComponentDeletionGeometry;
}): ComponentArchiveTransformResult {
  if (!archivePointerSchema.safeParse(args.archive).success) {
    return refusal(
      "invalid-archive",
      "The component archive pointer is invalid.",
    );
  }
  if (args.archived.source.fileId !== args.archive.fileId) {
    return refusal(
      "archive-mismatch",
      "The archived source file does not match the pointer.",
    );
  }
  if (
    sourceContentHash(args.archived.content) !== args.archive.sourceVersionHash
  ) {
    return refusal(
      "source-hash-mismatch",
      "The archived source hash does not match the pointer.",
    );
  }
  const prepared = projectDocuments(args.documents);
  if (prepared.status !== "ready") return prepared;
  const fail = (
    reason: ComponentArchiveFailureReason,
    message: string,
    mainNodeId = args.archive.mainNodeId,
  ): ComponentArchiveRefusal =>
    refusal(reason, message, {
      componentId: args.archive.componentId,
      mainNodeId,
    });
  const archivedProjection = buildCodeLayerProjection(args.archived.content, {
    source: args.archived.source,
  });
  const archivedMains = archivedProjection.nodes.filter(
    (node) =>
      identity(node, NODE_ID_ATTR) === args.archive.mainNodeId &&
      identity(node, COMPONENT_ID_ATTR) === args.archive.componentId,
  );
  if (archivedMains.length === 0) {
    return fail(
      "missing-main",
      "The archived canonical component main is missing.",
    );
  }
  if (archivedMains.length !== 1) {
    return fail(
      "ambiguous-main",
      "The archived canonical component main is ambiguous.",
    );
  }
  const archivedMain = archivedMains[0]!;
  if (hasAttribute(archivedMain, COMPONENT_REF_ATTR)) {
    return fail(
      "invalid-link",
      "The archived node is both a main and an instance.",
    );
  }
  if (
    nodesWithDurableId(prepared.values, args.archive.mainNodeId).some(
      ({ node }) =>
        identity(node, COMPONENT_ID_ATTR) === args.archive.componentId,
    )
  ) {
    return fail(
      "main-already-present",
      "The canonical component main is already present.",
    );
  }
  const references: ComponentReference[] = [];
  const expectedOverrides = new Map<string, string | undefined>();
  for (const value of prepared.values) {
    for (const node of value.projection.nodes) {
      const componentRef = identity(node, COMPONENT_REF_ATTR);
      const rawArchive = node.dataAttributes[COMPONENT_ARCHIVE_ATTR];
      const archiveRead = readComponentArchivePointer(rawArchive);
      if (
        archiveRead.status === "invalid" &&
        componentRef === args.archive.componentId
      ) {
        return fail(
          "archive-invalid",
          "A linked instance archive pointer is invalid.",
        );
      }
      if (
        archiveRead.status === "valid" &&
        archiveRead.pointer.componentId === args.archive.componentId &&
        componentRef !== args.archive.componentId
      ) {
        return fail(
          "invalid-archive-location",
          "A component archive pointer is not on an instance root.",
        );
      }
      if (componentRef !== args.archive.componentId) continue;
      if (hasAttribute(node, COMPONENT_ID_ATTR)) {
        return fail(
          "invalid-reference",
          "A linked instance is also marked as canonical.",
        );
      }
      const nodeId = identity(node, NODE_ID_ATTR);
      if (!nodeId) {
        return fail(
          "invalid-reference",
          "Every linked instance root needs a durable node id.",
        );
      }
      if (archiveRead.status === "absent") {
        return fail(
          "missing-archive-reference",
          "A surviving linked instance has no archive pointer.",
        );
      }
      if (archiveRead.status !== "valid") {
        return fail(
          "archive-invalid",
          "A linked instance archive pointer is invalid.",
        );
      }
      if (!pointerMatches(archiveRead.pointer, args.archive)) {
        return fail(
          "archive-mismatch",
          "A linked instance archive pointer does not match the restore target.",
        );
      }
      const fileId = fileIdFor(value);
      references.push({ fileId, nodeId });
      expectedOverrides.set(
        `${fileId}:${nodeId}`,
        node.dataAttributes[COMPONENT_OVERRIDES_ATTR],
      );
    }
  }
  if (references.length === 0) {
    return fail(
      "missing-restore-anchor",
      "No surviving linked instance can anchor component restore.",
    );
  }
  const currentMainDocument = prepared.values.find(
    (value) => fileIdFor(value) === args.archive.fileId,
  );
  if (!currentMainDocument) {
    return fail(
      "missing-restore-anchor",
      "The archived source file is no longer present.",
    );
  }
  const archivedParent = archivedMain.parentId
    ? archivedProjection.nodes.find((node) => node.id === archivedMain.parentId)
    : undefined;
  if (!archivedParent) {
    return fail(
      "missing-restore-anchor",
      "The archived main has no restorable parent anchor.",
    );
  }
  const archivedParentId = identity(archivedParent, NODE_ID_ATTR);
  const parentMatches = currentMainDocument.projection.nodes.filter((node) =>
    archivedParentId
      ? identity(node, NODE_ID_ATTR) === archivedParentId
      : node.id === archivedParent.id && node.tag === archivedParent.tag,
  );
  if (parentMatches.length > 1) {
    return fail(
      "missing-restore-anchor",
      "The archived main parent anchor is ambiguous.",
    );
  }
  const currentParent = parentMatches[0] ?? null;
  const archivedMarkup = archivedMain.source
    ? args.archived.content.slice(
        archivedMain.source.start,
        archivedMain.source.end,
      )
    : null;
  if (archivedMarkup === null) {
    return fail(
      "restore-slot-mismatch",
      "The archived main source slot cannot be reconstructed.",
    );
  }
  const exactArchivedMarkup = archivedMarkup;
  const usingRootFallback = !currentParent;
  let restoreParent = currentParent;
  let insertedMarkup: string | null = exactArchivedMarkup;
  if (!restoreParent) {
    const geometry = componentDeletionGeometrySchema.safeParse(
      args.deletionGeometry,
    );
    if (
      !geometry.success ||
      geometry.data.fileId !== args.archive.fileId ||
      geometry.data.mainNodeId !== args.archive.mainNodeId ||
      geometry.data.sourceVersionHash !== args.archive.sourceVersionHash
    ) {
      return fail(
        "missing-restore-anchor",
        "The archived main parent anchor is missing and has no matching deletion geometry.",
      );
    }
    if (hasUnsupportedTransformAncestry(archivedProjection, archivedMain)) {
      return fail(
        "missing-restore-anchor",
        "The archived main has transformed ancestry that cannot be rebased safely.",
      );
    }
    const rootParent = rootRestoreParent(currentMainDocument);
    if (!rootParent) {
      return fail(
        "missing-restore-anchor",
        "The current source has no unique root restore anchor.",
      );
    }
    if (!isCanonicalBoardRestoreRoot(currentMainDocument, rootParent)) {
      return fail(
        "missing-restore-anchor",
        "Missing-parent restore is supported only for the canonical board root.",
      );
    }
    if (!geometry.data.worldBounds) {
      return fail(
        "missing-restore-anchor",
        "Missing-parent board restore requires world bounds.",
      );
    }
    if (
      hasUnsupportedTransformAncestry(
        currentMainDocument.projection,
        rootParent,
      )
    ) {
      return fail(
        "missing-restore-anchor",
        "The current root restore anchor has transformed ancestry that cannot be rebased safely.",
      );
    }
    restoreParent = rootParent;
    const bounds = {
      left: geometry.data.worldBounds.left,
      top: geometry.data.worldBounds.top,
      width: geometry.data.worldBounds.width,
      height: geometry.data.worldBounds.height,
    };
    insertedMarkup = positionedArchivedMarkup({
      main: archivedMain,
      markup: exactArchivedMarkup,
      bounds,
    });
    if (!insertedMarkup) {
      return fail(
        "restore-slot-mismatch",
        "The archived main cannot be positioned from its source span.",
      );
    }
  }
  if (!restoreParent) {
    return fail(
      "missing-restore-anchor",
      "The current source has no restore parent.",
    );
  }
  const insertAt = resolveAppendOffset(restoreParent);
  if (insertAt === null) {
    return fail(
      "restore-slot-mismatch",
      "The restore parent has no source insertion span.",
    );
  }
  const inserted = `${currentMainDocument.document.content.slice(0, insertAt)}${insertedMarkup}${currentMainDocument.document.content.slice(insertAt)}`;
  const afterInsert = args.documents.map((document) =>
    document.source.fileId === args.archive.fileId
      ? { ...document, content: inserted }
      : document,
  );
  const projectedAfterInsert = projectDocuments(afterInsert);
  if (projectedAfterInsert.status !== "ready") return projectedAfterInsert;
  const restoredMain = exactNodeByDurableId(
    projectedAfterInsert.values,
    args.archive.fileId,
    args.archive.mainNodeId,
  );
  if (
    !restoredMain ||
    identity(restoredMain.node, COMPONENT_ID_ATTR) !==
      args.archive.componentId ||
    hasAttribute(restoredMain.node, COMPONENT_REF_ATTR) ||
    restoredMain.node.source?.start !== insertAt ||
    restoredMain.node.source?.end !== insertAt + insertedMarkup.length ||
    inserted.slice(insertAt, insertAt + insertedMarkup.length) !==
      insertedMarkup ||
    (usingRootFallback && restoredMain.node.parentId !== restoreParent.id)
  ) {
    return fail(
      "restore-slot-mismatch",
      "The restored main did not occupy the archived source slot.",
    );
  }
  for (const reference of references) {
    if (
      !isValidComponentReferenceSubtree({
        documents: afterInsert,
        componentId: args.archive.componentId,
        referenceFileId: reference.fileId,
        referenceNodeId: reference.nodeId,
      })
    ) {
      return fail(
        "invalid-reference",
        "A linked instance subtree is incomplete or has invalid identity metadata.",
      );
    }
  }
  const clearByFile = new Map<
    string,
    Array<{ node: CodeLayerNode; attributes: Record<string, string | null> }>
  >();
  for (const reference of references) {
    const node = finalReferenceNode(projectedAfterInsert.values, reference);
    if (!node) {
      return fail(
        "invalid-reference",
        "A linked instance disappeared during component restore.",
      );
    }
    const updates = clearByFile.get(reference.fileId) ?? [];
    updates.push({ node, attributes: { [COMPONENT_ARCHIVE_ATTR]: null } });
    clearByFile.set(reference.fileId, updates);
  }
  const clearedContents = new Map<string, string>();
  for (const [fileId, updates] of clearByFile) {
    const value = projectedAfterInsert.values.find(
      (candidate) => fileIdFor(candidate) === fileId,
    );
    if (!value) {
      return fail(
        "invalid-reference",
        "A linked instance source file is missing.",
      );
    }
    const content = clearArchiveAttributes(
      value.document.content,
      updates.map(({ node }) => node),
    );
    if (content === null) {
      return fail(
        "missing-source-span",
        "A linked instance archive attribute has no source span.",
      );
    }
    clearedContents.set(fileId, content);
  }
  const finalDocuments = afterInsert.map((document) => ({
    ...document,
    content: clearedContents.get(document.source.fileId!) ?? document.content,
  }));
  const finalProjection = projectDocuments(finalDocuments);
  if (finalProjection.status !== "ready") return finalProjection;
  const finalMain = nodesWithDurableId(
    finalProjection.values,
    args.archive.mainNodeId,
  ).filter(
    ({ node }) =>
      identity(node, COMPONENT_ID_ATTR) === args.archive.componentId,
  );
  if (finalMain.length !== 1) {
    return fail(
      "ambiguous-main",
      "Restore did not leave one canonical component main.",
    );
  }
  const finalReferenceValidation = validateFinalReferences(
    finalProjection.values,
    references,
    null,
    expectedOverrides,
  );
  if (finalReferenceValidation) {
    return fail(
      finalReferenceValidation.reason,
      finalReferenceValidation.message,
    );
  }
  const resolution = analyzeComponentLinks(
    finalProjection.values.map(({ projection }) => projection),
  ).components.find((entry) => entry.componentId === args.archive.componentId);
  if (resolution?.status !== "resolved") {
    return fail(
      "invalid-link",
      "Restore did not leave a resolved component identity graph.",
    );
  }
  const contents = new Map(
    finalDocuments.map((document) => [
      document.source.fileId!,
      document.content,
    ]),
  );
  const changes = changesFor(args.documents, contents);
  const targetAfter = contents.get(args.archive.fileId);
  if (!targetAfter || changes.length === 0) {
    return fail("invalid-link", "The component restore made no source change.");
  }
  return {
    status: "updated",
    componentId: args.archive.componentId,
    mainNodeId: args.archive.mainNodeId,
    archive: args.archive,
    changes,
    referenceNodeIds: references,
    beforeVersionHash: sourceContentHash(currentMainDocument.document.content),
    afterVersionHash: sourceContentHash(targetAfter),
  };
}
